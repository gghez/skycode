# GitLab Repository Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user register a GitLab bot access token (project- or group-scoped), discover and activate the projects they care about, and manage them on the Repos page.

**Architecture:** A GitLab bot access token is the credential and identity. Tokens are stored encrypted on an org-owned `gitlab_connection`; activated projects are `tracked_repo` rows referencing that connection, so a group token shared across projects is stored once. Ownership is org-level via the better-auth `organization` plugin, with a personal org auto-created at signup. Pure units (crypto, scope parser, GitLab client) are unit-tested; the full flow is proven end-to-end with Playwright against a mock GitLab server.

**Tech Stack:** Next.js (App Router) server actions, better-auth (`organization` plugin), Drizzle ORM + Postgres, Node `crypto` (AES-256-GCM), Vitest, Playwright, Tailwind + radix-ui.

---

## Spec

Design: [docs/superpowers/specs/2026-07-18-repos-gitlab-config-design.md](../specs/2026-07-18-repos-gitlab-config-design.md)

## File Structure

**Create**
- `src/lib/crypto/token-cipher.ts` — AES-256-GCM encrypt/decrypt of a token string.
- `src/lib/gitlab/types.ts` — shared GitLab DTO types.
- `src/lib/gitlab/errors.ts` — typed GitLab client errors.
- `src/lib/gitlab/token-scope.ts` — parse a bot username into `{ scopeType, scopeGitlabId }`.
- `src/lib/gitlab/client.ts` — minimal GitLab REST v4 client.
- `src/lib/organization.ts` — create a personal org; resolve a user's primary org.
- `src/lib/repos/service.ts` — connection/repo domain logic (add, list, activate, remove).
- `src/lib/repos/context.ts` — `requireActiveOrganization()` for server actions.
- `src/app/(app)/repos/actions.ts` — server actions wrapping the service.
- `src/app/(app)/repos/_components/add-connection-dialog.tsx` — add-connection + group selection UI.
- `src/app/(app)/repos/_components/add-repo-dialog.tsx` — add repos from an existing group connection.
- `src/app/(app)/repos/_components/manage-buttons.tsx` — remove repo / remove connection buttons.
- `src/components/ui/dialog.tsx` — radix Dialog wrapper.
- `tests/unit/token-cipher.test.ts`, `tests/unit/token-scope.test.ts`, `tests/unit/gitlab-client.test.ts`
- `tests/e2e/mock-gitlab.mjs` — mock GitLab server for e2e.
- `tests/e2e/repos.spec.ts` — end-to-end flow.

**Modify**
- `src/db/schema.ts` — add `organization`, `member`, `invitation`; add `session.activeOrganizationId`; add `gitlab_connection`, `tracked_repo`.
- `src/lib/auth.ts` — enable `organization` plugin + signup/session hooks.
- `src/lib/auth-client.ts` — add `organizationClient`.
- `src/app/(app)/repos/page.tsx` — render connections and repos.
- `.env.example` — add `SKYCODE_ENCRYPTION_KEY`.
- `playwright.config.ts` — add the mock GitLab server to `webServer`.

---

## Task 1: Token cipher (AES-256-GCM)

**Files:**
- Create: `src/lib/crypto/token-cipher.ts`
- Test: `tests/unit/token-cipher.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/token-cipher.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { encryptToken, decryptToken } from "@/lib/crypto/token-cipher";

// 32 bytes hex = 64 chars
const KEY = "0".repeat(64);

describe("token-cipher", () => {
  beforeAll(() => {
    process.env.SKYCODE_ENCRYPTION_KEY = KEY;
  });

  it("round-trips a token", () => {
    const plain = "glpat-abc123";
    const encrypted = encryptToken(plain);
    expect(encrypted).not.toContain(plain);
    expect(decryptToken(encrypted)).toBe(plain);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptToken("same")).not.toBe(encryptToken("same"));
  });

  it("throws when the key is missing", () => {
    delete process.env.SKYCODE_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow();
    process.env.SKYCODE_ENCRYPTION_KEY = KEY;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/token-cipher.test.ts`
Expected: FAIL — cannot find module `@/lib/crypto/token-cipher`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/crypto/token-cipher.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const hex = process.env.SKYCODE_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("SKYCODE_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  return Buffer.from(hex, "hex");
}

// Stored format: base64(iv):base64(authTag):base64(ciphertext)
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/token-cipher.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Document the env var**

Append to `.env.example`:

```
# 32-byte key as 64 hex chars, e.g. generated with: openssl rand -hex 32
SKYCODE_ENCRYPTION_KEY=
```

Then set a real value in your local `.env` (run `openssl rand -hex 32` and paste it) so the dev server and e2e can encrypt tokens.

- [ ] **Step 6: Commit**

```bash
git add src/lib/crypto/token-cipher.ts tests/unit/token-cipher.test.ts .env.example
git commit -m "feat: AES-256-GCM token cipher"
```

---

## Task 2: Bot-username scope parser

**Files:**
- Create: `src/lib/gitlab/types.ts`, `src/lib/gitlab/token-scope.ts`
- Test: `tests/unit/token-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/token-scope.test.ts
import { describe, it, expect } from "vitest";
import { parseBotScope } from "@/lib/gitlab/token-scope";

describe("parseBotScope", () => {
  it("parses a project token bot username", () => {
    expect(parseBotScope("project_123_bot_4ffca233d8298ea1")).toEqual({
      scopeType: "project",
      scopeGitlabId: 123,
    });
  });

  it("parses a group token bot username", () => {
    expect(parseBotScope("group_42_bot_abc")).toEqual({
      scopeType: "group",
      scopeGitlabId: 42,
    });
  });

  it("returns null for a personal account username", () => {
    expect(parseBotScope("alice")).toBeNull();
  });

  it("returns null for a malformed bot username", () => {
    expect(parseBotScope("project_bot_123")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/token-scope.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the shared types**

```typescript
// src/lib/gitlab/types.ts
export type GitlabScopeType = "project" | "group";

export interface GitlabUser {
  id: number;
  username: string;
  name: string;
  avatar_url: string | null;
}

export interface GitlabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
}

export interface GitlabSelfToken {
  expires_at: string | null;
}
```

- [ ] **Step 4: Write the parser**

```typescript
// src/lib/gitlab/token-scope.ts
import type { GitlabScopeType } from "./types";

export interface BotScope {
  scopeType: GitlabScopeType;
  scopeGitlabId: number;
}

const BOT_USERNAME_RE = /^(project|group)_(\d+)_bot_/;

export function parseBotScope(username: string): BotScope | null {
  const match = BOT_USERNAME_RE.exec(username);
  if (!match) return null;
  return { scopeType: match[1] as GitlabScopeType, scopeGitlabId: Number(match[2]) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/token-scope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/gitlab/types.ts src/lib/gitlab/token-scope.ts tests/unit/token-scope.test.ts
git commit -m "feat: parse GitLab bot username into token scope"
```

---

## Task 3: GitLab REST v4 client

**Files:**
- Create: `src/lib/gitlab/errors.ts`, `src/lib/gitlab/client.ts`
- Test: `tests/unit/gitlab-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/gitlab-client.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createGitlabClient } from "@/lib/gitlab/client";
import { GitlabAuthError, GitlabNotFoundError } from "@/lib/gitlab/errors";

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("createGitlabClient", () => {
  it("getCurrentUser calls /user with the token and maps fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ id: 7, username: "group_42_bot_x", name: "Bot", avatar_url: null }),
    );
    const client = createGitlabClient("https://gitlab.com/", "tok");
    const user = await client.getCurrentUser();

    expect(user).toEqual({ id: 7, username: "group_42_bot_x", name: "Bot", avatar_url: null });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gitlab.com/api/v4/user");
    expect((init as RequestInit).headers).toMatchObject({ "PRIVATE-TOKEN": "tok" });
  });

  it("maps 401 to GitlabAuthError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    const client = createGitlabClient("https://gitlab.com", "tok");
    await expect(client.getCurrentUser()).rejects.toBeInstanceOf(GitlabAuthError);
  });

  it("maps 404 to GitlabNotFoundError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    const client = createGitlabClient("https://gitlab.com", "tok");
    await expect(client.getProject(1)).rejects.toBeInstanceOf(GitlabNotFoundError);
  });

  it("listGroupProjects follows x-next-page pagination", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          [{ id: 1, name: "a", path_with_namespace: "g/a", web_url: "u1" }],
          { "x-next-page": "2" },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: 2, name: "b", path_with_namespace: "g/b", web_url: "u2" }]),
      );
    const client = createGitlabClient("https://gitlab.com", "tok");
    const projects = await client.listGroupProjects(42);

    expect(projects.map((p) => p.id)).toEqual([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/groups/42/projects?");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/gitlab-client.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the errors**

```typescript
// src/lib/gitlab/errors.ts
export class GitlabAuthError extends Error {
  constructor() {
    super("GitLab rejected the token (invalid or expired)");
    this.name = "GitlabAuthError";
  }
}

export class GitlabNotFoundError extends Error {
  constructor() {
    super("The GitLab project or group was not found");
    this.name = "GitlabNotFoundError";
  }
}

export class GitlabUnavailableError extends Error {
  constructor() {
    super("GitLab could not be reached");
    this.name = "GitlabUnavailableError";
  }
}
```

- [ ] **Step 4: Write the client**

```typescript
// src/lib/gitlab/client.ts
import { GitlabAuthError, GitlabNotFoundError, GitlabUnavailableError } from "./errors";
import type { GitlabProject, GitlabSelfToken, GitlabUser } from "./types";

export interface GitlabClient {
  getCurrentUser(): Promise<GitlabUser>;
  getSelfToken(): Promise<GitlabSelfToken>;
  getProject(id: number): Promise<GitlabProject>;
  listGroupProjects(id: number): Promise<GitlabProject[]>;
}

function toProject(p: GitlabProject): GitlabProject {
  return { id: p.id, name: p.name, path_with_namespace: p.path_with_namespace, web_url: p.web_url };
}

export function createGitlabClient(instanceUrl: string, token: string): GitlabClient {
  const base = instanceUrl.replace(/\/+$/, "") + "/api/v4";
  const headers = { "PRIVATE-TOKEN": token };

  async function req(path: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(base + path, { headers });
    } catch {
      throw new GitlabUnavailableError();
    }
    if (res.status === 401 || res.status === 403) throw new GitlabAuthError();
    if (res.status === 404) throw new GitlabNotFoundError();
    if (!res.ok) throw new GitlabUnavailableError();
    return res;
  }

  return {
    async getCurrentUser() {
      const u = await (await req("/user")).json();
      return { id: u.id, username: u.username, name: u.name, avatar_url: u.avatar_url ?? null };
    },
    async getSelfToken() {
      const t = await (await req("/personal_access_tokens/self")).json();
      return { expires_at: t.expires_at ?? null };
    },
    async getProject(id) {
      return toProject(await (await req(`/projects/${id}`)).json());
    },
    async listGroupProjects(id) {
      const projects: GitlabProject[] = [];
      let page = 1;
      for (;;) {
        const res = await req(
          `/groups/${id}/projects?include_subgroups=true&per_page=100&page=${page}`,
        );
        const batch: GitlabProject[] = await res.json();
        projects.push(...batch.map(toProject));
        const next = res.headers.get("x-next-page");
        if (!next) break;
        page = Number(next);
      }
      return projects;
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/gitlab-client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/gitlab/errors.ts src/lib/gitlab/client.ts tests/unit/gitlab-client.test.ts
git commit -m "feat: GitLab REST v4 client"
```

---

## Task 4: Database schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Add the organization plugin tables and session column**

Keep the existing `user`, `session`, `account`, `verification`. First add `activeOrganizationId` to the existing `session` table: in `src/db/schema.ts`, replace the `userId` column line inside the `session` table (currently the last column before the `(table) => [...]` argument) so the column map ends with both `userId` and the new field:

```typescript
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
```

(This replaces the existing `userId: ... },` block that closes the `session` column object — the `(table) => [index(...)]` argument stays unchanged.)

Then append the new tables at the end of the file:

```typescript
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const member = pgTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("member_organization_id_idx").on(table.organizationId)],
);

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").default("pending").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const gitlabConnection = pgTable(
  "gitlab_connection",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    instanceUrl: text("instance_url").notNull(),
    scopeType: text("scope_type").notNull(), // 'project' | 'group'
    scopeGitlabId: integer("scope_gitlab_id").notNull(),
    token: text("token").notNull(), // encrypted at rest
    botUserId: integer("bot_user_id").notNull(),
    botUsername: text("bot_username").notNull(),
    botName: text("bot_name").notNull(),
    botAvatarUrl: text("bot_avatar_url"),
    tokenExpiresAt: timestamp("token_expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("gitlab_connection_org_id_idx").on(table.organizationId),
    uniqueIndex("gitlab_connection_scope_unique").on(
      table.organizationId,
      table.instanceUrl,
      table.scopeType,
      table.scopeGitlabId,
    ),
  ],
);

export const trackedRepo = pgTable(
  "tracked_repo",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => gitlabConnection.id, { onDelete: "cascade" }),
    gitlabProjectId: integer("gitlab_project_id").notNull(),
    pathWithNamespace: text("path_with_namespace").notNull(),
    name: text("name").notNull(),
    webUrl: text("web_url").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("tracked_repo_connection_id_idx").on(table.connectionId),
    uniqueIndex("tracked_repo_unique").on(table.connectionId, table.gitlabProjectId),
  ],
);
```

- [ ] **Step 2: Update the imports at the top of the file**

The existing import is:

```typescript
import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
```

Replace it with:

```typescript
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
```

- [ ] **Step 3: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/` adding the five tables and the `active_organization_id` column. Confirm no errors.

- [ ] **Step 4: Apply the migration**

Run: `npm run db:up && npm run db:migrate`
Expected: migration applies cleanly against the local Postgres.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: schema for organizations and GitLab connections/repos"
```

---

## Task 5: Auth wiring — organization plugin and auto org

**Files:**
- Create: `src/lib/organization.ts`
- Modify: `src/lib/auth.ts`, `src/lib/auth-client.ts`

- [ ] **Step 1: Write the organization helpers**

```typescript
// src/lib/organization.ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { member, organization } from "@/db/schema";

export async function createPersonalOrganization(userId: string, name: string): Promise<string> {
  const orgId = randomUUID();
  await db.insert(organization).values({ id: orgId, name, slug: `personal-${userId}` });
  await db.insert(member).values({ id: randomUUID(), organizationId: orgId, userId, role: "owner" });
  return orgId;
}

export async function getPrimaryOrganizationId(userId: string): Promise<string | null> {
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}
```

- [ ] **Step 2: Enable the plugin and hooks in auth.ts**

Replace `src/lib/auth.ts` with:

```typescript
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { createPersonalOrganization, getPrimaryOrganizationId } from "@/lib/organization";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await createPersonalOrganization(user.id, "Espace personnel");
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const organizationId = await getPrimaryOrganizationId(session.userId);
          return { data: { ...session, activeOrganizationId: organizationId } };
        },
      },
    },
  },
  plugins: [
    organization(),
    // nextCookies must be the last plugin so it can set cookies from server actions.
    nextCookies(),
  ],
});
```

- [ ] **Step 3: Add the client plugin**

Replace `src/lib/auth-client.ts` with:

```typescript
import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [organizationClient()],
});
export const { signUp, signIn, signOut, useSession } = authClient;
```

- [ ] **Step 4: Verify the app still builds and auth still works**

Run: `npm run build`
Expected: build succeeds with no type errors.

Then run the existing auth e2e to confirm signup still works (the after-hook now creates an org):

Run: `npm run test:e2e -- tests/e2e/auth.spec.ts`
Expected: PASS. (If it fails on a schema mismatch for org tables, reconcile `src/db/schema.ts` column names/types with what `better-auth` expects and regenerate the migration.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/organization.ts src/lib/auth.ts src/lib/auth-client.ts
git commit -m "feat: org plugin with personal org auto-created at signup"
```

---

## Task 6: Active-organization context helper

**Files:**
- Create: `src/lib/repos/context.ts`

- [ ] **Step 1: Write the helper**

```typescript
// src/lib/repos/context.ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getPrimaryOrganizationId } from "@/lib/organization";

export interface OrgContext {
  userId: string;
  organizationId: string;
}

export async function requireActiveOrganization(): Promise<OrgContext> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const organizationId =
    session.session.activeOrganizationId ?? (await getPrimaryOrganizationId(session.user.id));
  if (!organizationId) throw new Error("No active organization for the current user");
  return { userId: session.user.id, organizationId };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/repos/context.ts
git commit -m "feat: requireActiveOrganization context helper"
```

---

## Task 7: Repos service — add connection and listing

**Files:**
- Create: `src/lib/repos/service.ts`

- [ ] **Step 1: Write the add-connection and listing logic**

```typescript
// src/lib/repos/service.ts
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { gitlabConnection, trackedRepo } from "@/db/schema";
import { encryptToken, decryptToken } from "@/lib/crypto/token-cipher";
import { createGitlabClient, type GitlabClient } from "@/lib/gitlab/client";
import { parseBotScope } from "@/lib/gitlab/token-scope";
import type { GitlabScopeType } from "@/lib/gitlab/types";

export class NotABotTokenError extends Error {
  constructor() {
    super("This token is not a project or group access token");
    this.name = "NotABotTokenError";
  }
}

export interface TrackedRepoView {
  id: string;
  gitlabProjectId: number;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
}

export interface DiscoveredProject {
  gitlabProjectId: number;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
  alreadyTracked: boolean;
}

export interface ConnectionView {
  id: string;
  instanceUrl: string;
  scopeType: GitlabScopeType;
  scopeGitlabId: number;
  botName: string;
  botUsername: string;
  botAvatarUrl: string | null;
  repos: TrackedRepoView[];
}

export type AddConnectionResult =
  | { scopeType: "project"; connectionId: string; repo: TrackedRepoView }
  | { scopeType: "group"; connectionId: string; projects: DiscoveredProject[] };

function repoView(row: typeof trackedRepo.$inferSelect): TrackedRepoView {
  return {
    id: row.id,
    gitlabProjectId: row.gitlabProjectId,
    name: row.name,
    pathWithNamespace: row.pathWithNamespace,
    webUrl: row.webUrl,
  };
}

async function bestEffortExpiry(client: GitlabClient): Promise<Date | null> {
  try {
    const self = await client.getSelfToken();
    return self.expires_at ? new Date(self.expires_at) : null;
  } catch {
    return null;
  }
}

export async function addConnection(
  organizationId: string,
  input: { instanceUrl: string; token: string },
): Promise<AddConnectionResult> {
  const instanceUrl = input.instanceUrl.trim();
  const client = createGitlabClient(instanceUrl, input.token);

  // Validate token + resolve bot identity and scope (throws GitlabAuthError on 401).
  const botUser = await client.getCurrentUser();
  const scope = parseBotScope(botUser.username);
  if (!scope) throw new NotABotTokenError();

  const tokenExpiresAt = await bestEffortExpiry(client);

  // Dedup: reuse an existing connection for the same scope, refreshing its token/identity.
  const [existing] = await db
    .select()
    .from(gitlabConnection)
    .where(
      and(
        eq(gitlabConnection.organizationId, organizationId),
        eq(gitlabConnection.instanceUrl, instanceUrl),
        eq(gitlabConnection.scopeType, scope.scopeType),
        eq(gitlabConnection.scopeGitlabId, scope.scopeGitlabId),
      ),
    )
    .limit(1);

  let connectionId: string;
  if (existing) {
    connectionId = existing.id;
    await db
      .update(gitlabConnection)
      .set({
        token: encryptToken(input.token),
        botUserId: botUser.id,
        botUsername: botUser.username,
        botName: botUser.name,
        botAvatarUrl: botUser.avatar_url,
        tokenExpiresAt,
      })
      .where(eq(gitlabConnection.id, connectionId));
  } else {
    connectionId = randomUUID();
    await db.insert(gitlabConnection).values({
      id: connectionId,
      organizationId,
      instanceUrl,
      scopeType: scope.scopeType,
      scopeGitlabId: scope.scopeGitlabId,
      token: encryptToken(input.token),
      botUserId: botUser.id,
      botUsername: botUser.username,
      botName: botUser.name,
      botAvatarUrl: botUser.avatar_url,
      tokenExpiresAt,
    });
  }

  if (scope.scopeType === "project") {
    const project = await client.getProject(scope.scopeGitlabId);
    const [repo] = await db
      .insert(trackedRepo)
      .values({
        id: randomUUID(),
        connectionId,
        gitlabProjectId: project.id,
        name: project.name,
        pathWithNamespace: project.path_with_namespace,
        webUrl: project.web_url,
      })
      .onConflictDoNothing({
        target: [trackedRepo.connectionId, trackedRepo.gitlabProjectId],
      })
      .returning();

    const finalRepo =
      repo ??
      (
        await db
          .select()
          .from(trackedRepo)
          .where(
            and(
              eq(trackedRepo.connectionId, connectionId),
              eq(trackedRepo.gitlabProjectId, project.id),
            ),
          )
          .limit(1)
      )[0];

    return { scopeType: "project", connectionId, repo: repoView(finalRepo) };
  }

  const projects = await client.listGroupProjects(scope.scopeGitlabId);
  const trackedIds = new Set(
    (
      await db
        .select({ gitlabProjectId: trackedRepo.gitlabProjectId })
        .from(trackedRepo)
        .where(eq(trackedRepo.connectionId, connectionId))
    ).map((r) => r.gitlabProjectId),
  );

  return {
    scopeType: "group",
    connectionId,
    projects: projects.map((p) => ({
      gitlabProjectId: p.id,
      name: p.name,
      pathWithNamespace: p.path_with_namespace,
      webUrl: p.web_url,
      alreadyTracked: trackedIds.has(p.id),
    })),
  };
}

export async function listConnectionsWithRepos(
  organizationId: string,
): Promise<ConnectionView[]> {
  const connections = await db
    .select()
    .from(gitlabConnection)
    .where(eq(gitlabConnection.organizationId, organizationId));

  if (connections.length === 0) return [];

  const repos = await db
    .select()
    .from(trackedRepo)
    .where(
      inArray(
        trackedRepo.connectionId,
        connections.map((c) => c.id),
      ),
    );

  return connections.map((c) => ({
    id: c.id,
    instanceUrl: c.instanceUrl,
    scopeType: c.scopeType as GitlabScopeType,
    scopeGitlabId: c.scopeGitlabId,
    botName: c.botName,
    botUsername: c.botUsername,
    botAvatarUrl: c.botAvatarUrl,
    repos: repos.filter((r) => r.connectionId === c.id).map(repoView),
  }));
}

// Used by Task 8; kept here so decryptToken import stays close to its callers.
export function loadClientForConnection(row: typeof gitlabConnection.$inferSelect): GitlabClient {
  return createGitlabClient(row.instanceUrl, decryptToken(row.token));
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/repos/service.ts
git commit -m "feat: repos service — add connection and list connections"
```

---

## Task 8: Repos service — activate and remove

**Files:**
- Modify: `src/lib/repos/service.ts`

- [ ] **Step 1: Append the remaining service functions**

Add to the end of `src/lib/repos/service.ts`:

```typescript
async function requireOwnedConnection(
  organizationId: string,
  connectionId: string,
): Promise<typeof gitlabConnection.$inferSelect> {
  const [row] = await db
    .select()
    .from(gitlabConnection)
    .where(
      and(eq(gitlabConnection.id, connectionId), eq(gitlabConnection.organizationId, organizationId)),
    )
    .limit(1);
  if (!row) throw new Error("Connection not found for this organization");
  return row;
}

export async function listUntrackedProjects(
  organizationId: string,
  connectionId: string,
): Promise<DiscoveredProject[]> {
  const connection = await requireOwnedConnection(organizationId, connectionId);
  const client = loadClientForConnection(connection);
  const projects = await client.listGroupProjects(connection.scopeGitlabId);
  const trackedIds = new Set(
    (
      await db
        .select({ gitlabProjectId: trackedRepo.gitlabProjectId })
        .from(trackedRepo)
        .where(eq(trackedRepo.connectionId, connectionId))
    ).map((r) => r.gitlabProjectId),
  );
  return projects
    .filter((p) => !trackedIds.has(p.id))
    .map((p) => ({
      gitlabProjectId: p.id,
      name: p.name,
      pathWithNamespace: p.path_with_namespace,
      webUrl: p.web_url,
      alreadyTracked: false,
    }));
}

export async function activateRepos(
  organizationId: string,
  connectionId: string,
  gitlabProjectIds: number[],
): Promise<void> {
  if (gitlabProjectIds.length === 0) return;
  const connection = await requireOwnedConnection(organizationId, connectionId);
  const client = loadClientForConnection(connection);

  const source =
    connection.scopeType === "group"
      ? await client.listGroupProjects(connection.scopeGitlabId)
      : [await client.getProject(connection.scopeGitlabId)];

  const selected = source.filter((p) => gitlabProjectIds.includes(p.id));
  if (selected.length === 0) return;

  await db
    .insert(trackedRepo)
    .values(
      selected.map((p) => ({
        id: randomUUID(),
        connectionId,
        gitlabProjectId: p.id,
        name: p.name,
        pathWithNamespace: p.path_with_namespace,
        webUrl: p.web_url,
      })),
    )
    .onConflictDoNothing({ target: [trackedRepo.connectionId, trackedRepo.gitlabProjectId] });
}

export async function removeRepo(organizationId: string, repoId: string): Promise<void> {
  const [row] = await db
    .select({ connectionId: trackedRepo.connectionId })
    .from(trackedRepo)
    .innerJoin(gitlabConnection, eq(trackedRepo.connectionId, gitlabConnection.id))
    .where(and(eq(trackedRepo.id, repoId), eq(gitlabConnection.organizationId, organizationId)))
    .limit(1);
  if (!row) return;
  await db.delete(trackedRepo).where(eq(trackedRepo.id, repoId));
}

export async function removeConnection(
  organizationId: string,
  connectionId: string,
): Promise<void> {
  await requireOwnedConnection(organizationId, connectionId);
  await db.delete(gitlabConnection).where(eq(gitlabConnection.id, connectionId));
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/repos/service.ts
git commit -m "feat: repos service — activate and remove repos/connections"
```

---

## Task 9: Server actions

**Files:**
- Create: `src/app/(app)/repos/actions.ts`

- [ ] **Step 1: Write the server actions**

```typescript
// src/app/(app)/repos/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { requireActiveOrganization } from "@/lib/repos/context";
import {
  addConnection,
  activateRepos,
  listUntrackedProjects,
  removeConnection,
  removeRepo,
  type AddConnectionResult,
  type DiscoveredProject,
} from "@/lib/repos/service";
import { GitlabAuthError, GitlabNotFoundError, GitlabUnavailableError } from "@/lib/gitlab/errors";
import { NotABotTokenError } from "@/lib/repos/service";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

function toMessage(e: unknown): string {
  if (e instanceof GitlabAuthError) return "Token invalide ou expiré.";
  if (e instanceof NotABotTokenError)
    return "Ce token n'est pas un token de projet ou de groupe (token personnel ?).";
  if (e instanceof GitlabNotFoundError) return "Projet ou groupe GitLab introuvable.";
  if (e instanceof GitlabUnavailableError) return "GitLab est injoignable pour le moment.";
  return "Une erreur inattendue est survenue.";
}

export async function addConnectionAction(
  input: { instanceUrl: string; token: string },
): Promise<ActionResult<AddConnectionResult>> {
  const { organizationId } = await requireActiveOrganization();
  try {
    const data = await addConnection(organizationId, input);
    revalidatePath("/repos");
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function activateReposAction(
  connectionId: string,
  gitlabProjectIds: number[],
): Promise<ActionResult<null>> {
  const { organizationId } = await requireActiveOrganization();
  try {
    await activateRepos(organizationId, connectionId, gitlabProjectIds);
    revalidatePath("/repos");
    return { ok: true, data: null };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function listUntrackedProjectsAction(
  connectionId: string,
): Promise<ActionResult<DiscoveredProject[]>> {
  const { organizationId } = await requireActiveOrganization();
  try {
    const data = await listUntrackedProjects(organizationId, connectionId);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function removeRepoAction(repoId: string): Promise<ActionResult<null>> {
  const { organizationId } = await requireActiveOrganization();
  await removeRepo(organizationId, repoId);
  revalidatePath("/repos");
  return { ok: true, data: null };
}

export async function removeConnectionAction(connectionId: string): Promise<ActionResult<null>> {
  const { organizationId } = await requireActiveOrganization();
  await removeConnection(organizationId, connectionId);
  revalidatePath("/repos");
  return { ok: true, data: null };
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/repos/actions.ts"
git commit -m "feat: repos server actions"
```

---

## Task 10: Repos UI

**Files:**
- Create: `src/components/ui/dialog.tsx`, `src/app/(app)/repos/_components/add-connection-dialog.tsx`, `src/app/(app)/repos/_components/add-repo-dialog.tsx`, `src/app/(app)/repos/_components/manage-buttons.tsx`
- Modify: `src/app/(app)/repos/page.tsx`

- [ ] **Step 1: Add a Dialog primitive**

```tsx
// src/components/ui/dialog.tsx
"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100">
          <XIcon className="size-4" />
          <span className="sr-only">Fermer</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title className={cn("text-lg font-semibold", className)} {...props} />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
};
```

- [ ] **Step 2: Write the add-connection dialog (with group selection step)**

```tsx
// src/app/(app)/repos/_components/add-connection-dialog.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addConnectionAction, activateReposAction } from "../actions";
import type { DiscoveredProject } from "@/lib/repos/service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type GroupStep = { connectionId: string; projects: DiscoveredProject[] };

export function AddConnectionDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [instanceUrl, setInstanceUrl] = useState("https://gitlab.com");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupStep | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function reset() {
    setInstanceUrl("https://gitlab.com");
    setToken("");
    setError(null);
    setGroup(null);
    setSelected(new Set());
  }

  async function onSubmitToken(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await addConnectionAction({ instanceUrl, token });
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.scopeType === "project") {
      setOpen(false);
      reset();
      router.refresh();
      return;
    }
    setGroup({ connectionId: result.data.connectionId, projects: result.data.projects });
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onConfirmGroup() {
    if (!group) return;
    setError(null);
    setLoading(true);
    const result = await activateReposAction(group.connectionId, [...selected]);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>Ajouter une connexion</Button>
      </DialogTrigger>
      <DialogContent>
        {!group ? (
          <form onSubmit={onSubmitToken}>
            <DialogHeader>
              <DialogTitle>Ajouter une connexion GitLab</DialogTitle>
              <DialogDescription>
                Collez un token d&apos;accès de projet ou de groupe. Son identité bot postera les
                commentaires et fusions.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="instanceUrl">URL de l&apos;instance</Label>
                <Input
                  id="instanceUrl"
                  value={instanceUrl}
                  onChange={(e) => setInstanceUrl(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="token">Access token</Label>
                <Input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || !token}>
                {loading ? "…" : "Valider"}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <DialogHeader>
              <DialogTitle>Sélectionner les projets</DialogTitle>
              <DialogDescription>
                Cochez les projets du groupe que skycode doit suivre.
              </DialogDescription>
            </DialogHeader>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {group.projects.map((p) => (
                <li key={p.gitlabProjectId} className="flex items-center gap-2">
                  <input
                    id={`p-${p.gitlabProjectId}`}
                    type="checkbox"
                    disabled={p.alreadyTracked}
                    checked={p.alreadyTracked || selected.has(p.gitlabProjectId)}
                    onChange={() => toggle(p.gitlabProjectId)}
                  />
                  <label htmlFor={`p-${p.gitlabProjectId}`} className="text-sm">
                    {p.pathWithNamespace}
                    {p.alreadyTracked && (
                      <span className="ml-2 text-xs text-muted-foreground">(déjà suivi)</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            <Button
              className="mt-4 w-full"
              disabled={loading || selected.size === 0}
              onClick={onConfirmGroup}
            >
              {loading ? "…" : `Activer ${selected.size} projet(s)`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Write the add-repo-from-connection dialog**

```tsx
// src/app/(app)/repos/_components/add-repo-dialog.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { listUntrackedProjectsAction, activateReposAction } from "../actions";
import type { DiscoveredProject } from "@/lib/repos/service";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function AddRepoDialog({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<DiscoveredProject[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function onOpenChange(o: boolean) {
    setOpen(o);
    setError(null);
    setSelected(new Set());
    if (o) {
      setLoading(true);
      const result = await listUntrackedProjectsAction(connectionId);
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        setProjects([]);
        return;
      }
      setProjects(result.data);
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onConfirm() {
    setLoading(true);
    const result = await activateReposAction(connectionId, [...selected]);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Ajouter un repo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un repo</DialogTitle>
          <DialogDescription>Projets du groupe non encore suivis.</DialogDescription>
        </DialogHeader>
        {loading && <p className="text-sm text-muted-foreground">Chargement…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!loading && !error && projects.length === 0 && (
          <p className="text-sm text-muted-foreground">Tous les projets sont déjà suivis.</p>
        )}
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {projects.map((p) => (
            <li key={p.gitlabProjectId} className="flex items-center gap-2">
              <input
                id={`ap-${p.gitlabProjectId}`}
                type="checkbox"
                checked={selected.has(p.gitlabProjectId)}
                onChange={() => toggle(p.gitlabProjectId)}
              />
              <label htmlFor={`ap-${p.gitlabProjectId}`} className="text-sm">
                {p.pathWithNamespace}
              </label>
            </li>
          ))}
        </ul>
        {projects.length > 0 && (
          <Button className="mt-4 w-full" disabled={loading || selected.size === 0} onClick={onConfirm}>
            {loading ? "…" : `Activer ${selected.size} projet(s)`}
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Write the remove buttons**

```tsx
// src/app/(app)/repos/_components/manage-buttons.tsx
"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { removeRepoAction, removeConnectionAction } from "../actions";
import { Button } from "@/components/ui/button";

export function RemoveRepoButton({ repoId }: { repoId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removeRepoAction(repoId);
          router.refresh();
        })
      }
    >
      Retirer
    </Button>
  );
}

export function RemoveConnectionButton({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await removeConnectionAction(connectionId);
          router.refresh();
        })
      }
    >
      Supprimer la connexion
    </Button>
  );
}
```

- [ ] **Step 5: Rewrite the Repos page**

```tsx
// src/app/(app)/repos/page.tsx
import { requireActiveOrganization } from "@/lib/repos/context";
import { listConnectionsWithRepos } from "@/lib/repos/service";
import { AddConnectionDialog } from "./_components/add-connection-dialog";
import { AddRepoDialog } from "./_components/add-repo-dialog";
import { RemoveRepoButton, RemoveConnectionButton } from "./_components/manage-buttons";

export default async function ReposPage() {
  const { organizationId } = await requireActiveOrganization();
  const connections = await listConnectionsWithRepos(organizationId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Repos</h1>
        <AddConnectionDialog />
      </div>

      {connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
          <p className="font-medium">Aucun repo pour l&apos;instant</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ajoutez une connexion GitLab pour suivre des projets.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {connections.map((c) => (
            <section key={c.id} className="rounded-lg border">
              <header className="flex items-center justify-between border-b px-4 py-3">
                <div className="text-sm">
                  <span className="font-medium">@{c.botUsername}</span>{" "}
                  <span className="text-muted-foreground">
                    · {c.scopeType} · {c.instanceUrl}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {c.scopeType === "group" && <AddRepoDialog connectionId={c.id} />}
                  <RemoveConnectionButton connectionId={c.id} />
                </div>
              </header>
              {c.repos.length === 0 ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Aucun projet suivi.</p>
              ) : (
                <ul className="divide-y">
                  {c.repos.map((r) => (
                    <li key={r.id} className="flex items-center justify-between px-4 py-3">
                      <a
                        href={r.webUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline-offset-4 hover:underline"
                      >
                        {r.pathWithNamespace}
                      </a>
                      <RemoveRepoButton repoId={r.id} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/dialog.tsx "src/app/(app)/repos"
git commit -m "feat: repos configuration UI"
```

---

## Task 11: End-to-end flow with a mock GitLab server

**Files:**
- Create: `tests/e2e/mock-gitlab.mjs`, `tests/e2e/repos.spec.ts`
- Modify: `playwright.config.ts`

- [ ] **Step 1: Write the mock GitLab server**

```javascript
// tests/e2e/mock-gitlab.mjs
// Minimal GitLab REST v4 mock for e2e. A "group" token bot sees group 42 with two projects.
import { createServer } from "node:http";

const PORT = 4000;

const GROUP_PROJECTS = [
  { id: 101, name: "backend", path_with_namespace: "acme/backend", web_url: "http://x/acme/backend" },
  { id: 102, name: "frontend", path_with_namespace: "acme/frontend", web_url: "http://x/acme/frontend" },
];

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === "/api/v4/user") {
    return send(res, 200, {
      id: 9001,
      username: "group_42_bot_e2e",
      name: "skycode bot",
      avatar_url: null,
    });
  }
  if (path === "/api/v4/personal_access_tokens/self") {
    return send(res, 200, { expires_at: null });
  }
  if (path === "/api/v4/groups/42/projects") {
    return send(res, 200, GROUP_PROJECTS);
  }
  return send(res, 404, { message: "not found" });
}).listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`mock-gitlab listening on ${PORT}`);
});
```

- [ ] **Step 2: Register the mock server in Playwright**

Replace `playwright.config.ts` with:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: [
    {
      command: "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: "node tests/e2e/mock-gitlab.mjs",
      url: "http://localhost:4000/api/v4/user",
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
```

- [ ] **Step 3: Write the e2e test**

```typescript
// tests/e2e/repos.spec.ts
import { test, expect, type Page } from "@playwright/test";

async function registerAndGoToRepos(page: Page) {
  const email = `repos_${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill("password123");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(page).toHaveURL(/\/repos$/);
}

test("add a group connection, select projects, then remove one", async ({ page }) => {
  await registerAndGoToRepos(page);

  // Open the add-connection dialog and submit the mock instance + any token.
  await page.getByRole("button", { name: "Ajouter une connexion" }).click();
  await page.getByLabel("URL de l'instance").fill("http://localhost:4000");
  await page.getByLabel("Access token").fill("glpat-e2e");
  await page.getByRole("button", { name: "Valider" }).click();

  // Group selection step appears; pick both projects.
  await expect(page.getByText("Sélectionner les projets")).toBeVisible();
  await page.getByText("acme/backend").click();
  await page.getByText("acme/frontend").click();
  await page.getByRole("button", { name: /Activer 2 projet/ }).click();

  // Both repos are listed.
  await expect(page.getByRole("link", { name: "acme/backend" })).toBeVisible();
  await expect(page.getByRole("link", { name: "acme/frontend" })).toBeVisible();

  // Remove one repo.
  await page
    .locator("li", { hasText: "acme/backend" })
    .getByRole("button", { name: "Retirer" })
    .click();
  await expect(page.getByRole("link", { name: "acme/backend" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "acme/frontend" })).toBeVisible();
});

test("re-adding the same group token does not duplicate the connection", async ({ page }) => {
  await registerAndGoToRepos(page);

  async function addGroupConnectionActivatingFirst() {
    await page.getByRole("button", { name: "Ajouter une connexion" }).click();
    await page.getByLabel("URL de l'instance").fill("http://localhost:4000");
    await page.getByLabel("Access token").fill("glpat-e2e");
    await page.getByRole("button", { name: "Valider" }).click();
    await expect(page.getByText("Sélectionner les projets")).toBeVisible();
    await page.getByText("acme/backend").click();
    await page.getByRole("button", { name: /Activer 1 projet/ }).click();
    await expect(page.getByRole("link", { name: "acme/backend" })).toBeVisible();
  }

  await addGroupConnectionActivatingFirst();

  // Re-add the same token: it must reuse the connection (single @group_42_bot_e2e header).
  await page.getByRole("button", { name: "Ajouter une connexion" }).click();
  await page.getByLabel("URL de l'instance").fill("http://localhost:4000");
  await page.getByLabel("Access token").fill("glpat-e2e");
  await page.getByRole("button", { name: "Valider" }).click();
  // backend is already tracked → shown as disabled/marked, frontend still selectable.
  await expect(page.getByText("acme/backend")).toBeVisible();
  await expect(page.getByText("(déjà suivi)")).toBeVisible();

  await expect(page.getByText("@group_42_bot_e2e")).toHaveCount(1);
});
```

- [ ] **Step 4: Run the e2e suite**

Prerequisites: local Postgres is up (`npm run db:up && npm run db:migrate`) and `.env` has a valid `SKYCODE_ENCRYPTION_KEY`.

Run: `npm run test:e2e -- tests/e2e/repos.spec.ts`
Expected: both tests PASS.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm run test && npm run test:e2e`
Expected: all unit and e2e tests PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/mock-gitlab.mjs tests/e2e/repos.spec.ts playwright.config.ts
git commit -m "test: e2e for GitLab repository configuration"
```

---

## Notes on deferred decisions

- **DB integration harness:** deliberately not built. Pure logic is unit-tested; the service + DB + actions are proven by the Playwright e2e against the mock GitLab server, matching slice 1's testing philosophy.
- **Token expiry usage:** `tokenExpiresAt` is captured best-effort but not yet acted on (no rotation/expiry warnings) — that belongs with the review-execution slices.
- **GitHub, per-repo options, team invitations/roles:** out of scope, per the spec.
