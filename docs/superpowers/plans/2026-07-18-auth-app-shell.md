# Authentication & Application Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the web foundation of skycode — a person can register, sign in, sign out, and land in a navigable sidebar application shell with an empty "Repos" page.

**Architecture:** A single Next.js (App Router) TypeScript project. Authentication is handled by better-auth (email/password, httpOnly cookie sessions) backed by PostgreSQL through Drizzle ORM. Postgres runs locally via Docker Compose. The protected area is guarded server-side inside its layout; UI uses Tailwind + shadcn/ui.

**Tech Stack:** Next.js (App Router), TypeScript, better-auth, Drizzle ORM + drizzle-kit, PostgreSQL (Docker Compose), postgres-js driver, Tailwind CSS, shadcn/ui, Vitest, Playwright.

---

## File Structure

Created/modified across tasks:

```
docker-compose.yml            # local postgres (Task 2)
drizzle.config.ts             # drizzle-kit config (Task 2)
.env / .env.example           # DATABASE_URL, BETTER_AUTH_* (Task 2)
vitest.config.ts              # unit test runner (Task 6)
playwright.config.ts          # e2e runner + dev webServer (Task 11)
src/
  db/
    schema.ts                 # better-auth tables (Task 3)
    index.ts                  # drizzle client (Task 2)
  lib/
    auth.ts                   # better-auth server instance (Task 4)
    auth-client.ts            # react auth client (Task 4)
    validation.ts             # validateCredentials pure helper (Task 6)
  app/
    layout.tsx                # root layout (Task 1, from scaffold)
    globals.css               # (Task 1)
    page.tsx                  # "/" -> redirect to /repos or /login (Task 8)
    api/auth/[...all]/route.ts# better-auth handler (Task 4)
    (public)/
      login/page.tsx          # (Task 8)
      register/page.tsx       # (Task 7)
    (app)/
      layout.tsx              # protected shell + session guard (Task 9)
      repos/page.tsx          # empty state (Task 9)
  components/
    ui/                       # shadcn primitives (Task 5)
    auth/auth-form.tsx        # shared login/register client form (Task 7)
    shell/sidebar.tsx         # sidebar nav (Task 9)
    shell/account-menu.tsx    # email + sign out dropdown (Task 9)
tests/
  unit/validation.test.ts     # (Task 6)
  e2e/auth.spec.ts            # (Task 11)
```

**Import alias:** `@/*` maps to `src/*` (configured by the scaffold).

---

## Task 1: Scaffold the Next.js project

**Files:**
- Create: whole Next.js project (package.json, tsconfig.json, next.config.ts, tailwind, `src/app/*`)
- Modify: none (existing `README.md`, `docs/`, `.gitignore` are preserved)

- [ ] **Step 1: Remove the brainstorm artifacts directory**

`.superpowers/` holds only throwaway mockups and is not in create-next-app's allowlist, so it must be removed before scaffolding.

Run:
```bash
rm -rf .superpowers
```

- [ ] **Step 2: Back up the project README so the scaffold cannot overwrite it**

Run:
```bash
cp README.md README.keep.md
```

- [ ] **Step 3: Scaffold Next.js into the current directory**

Run:
```bash
npx --yes create-next-app@latest . --typescript --tailwind --app --src-dir --eslint --import-alias "@/*" --use-npm --yes
```
Expected: it completes and prints "Success! Created ..." (README.md, docs/, .gitignore are on its allowlist so it does not abort).

- [ ] **Step 4: Restore the project README**

Run:
```bash
mv README.keep.md README.md
```

- [ ] **Step 5: Verify the app builds and boots**

Run:
```bash
npm run build
```
Expected: build completes with "Compiled successfully" and no type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app (typescript, tailwind, app router)"
```

---

## Task 2: PostgreSQL (Docker Compose) + Drizzle client + config

**Files:**
- Create: `docker-compose.yml`, `.env`, `.env.example`, `drizzle.config.ts`, `src/db/index.ts`

- [ ] **Step 1: Install data-layer dependencies**

Run:
```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit dotenv
```

- [ ] **Step 2: Create the Docker Compose file for Postgres**

Create `docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: skycode
      POSTGRES_PASSWORD: skycode
      POSTGRES_DB: skycode
    ports:
      - "5432:5432"
    volumes:
      - skycode_pgdata:/var/lib/postgresql/data

volumes:
  skycode_pgdata:
```

- [ ] **Step 3: Create environment files**

Create `.env`:
```
DATABASE_URL=postgres://skycode:skycode@localhost:5432/skycode
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=replace-me
```

Create `.env.example` (same keys, no real secret):
```
DATABASE_URL=postgres://skycode:skycode@localhost:5432/skycode
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=
```

- [ ] **Step 4: Generate a real auth secret into `.env`**

Run:
```bash
node -e "const s=require('crypto').randomBytes(32).toString('base64');const fs=require('fs');let e=fs.readFileSync('.env','utf8').replace(/BETTER_AUTH_SECRET=.*/,'BETTER_AUTH_SECRET='+s);fs.writeFileSync('.env',e);console.log('secret written')"
```
Expected: prints "secret written".

- [ ] **Step 5: Ensure `.env` is ignored (never commit real secrets)**

Confirm `.gitignore` contains a line matching `.env` (create-next-app adds `.env*`). If not, append:
```bash
grep -qE "^\.env" .gitignore || printf ".env\n" >> .gitignore
```

- [ ] **Step 6: Create the Drizzle client**

Create `src/db/index.ts`:
```ts
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);

export const db = drizzle(client, { schema });
```
(Note: `./schema` is created in Task 3; the app is not run until then.)

- [ ] **Step 7: Create the drizzle-kit config**

Create `drizzle.config.ts`:
```ts
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 8: Start Postgres and verify it is reachable**

Run:
```bash
docker compose up -d
docker compose exec -T db pg_isready -U skycode
```
Expected: `... accepting connections`.

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml drizzle.config.ts src/db/index.ts .env.example .gitignore
git commit -m "feat: add postgres compose, drizzle client and config"
```

---

## Task 3: Authentication database schema + migrations

**Files:**
- Create: `src/db/schema.ts`
- Create (generated): `drizzle/*` migration files

- [ ] **Step 1: Create the better-auth schema (Postgres, singular table names)**

Create `src/db/schema.ts`:
```ts
import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
```

- [ ] **Step 2: Add database scripts to `package.json`**

In `package.json`, add to `"scripts"`:
```json
"db:up": "docker compose up -d",
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate"
```

- [ ] **Step 3: Generate the migration**

Run:
```bash
npm run db:generate
```
Expected: creates a `drizzle/0000_*.sql` file and prints the tables to be created.

- [ ] **Step 4: Apply the migration**

Run:
```bash
npm run db:migrate
```
Expected: prints applied migration, no errors.

- [ ] **Step 5: Verify the tables exist**

Run:
```bash
docker compose exec -T db psql -U skycode -d skycode -c "\dt"
```
Expected: lists `user`, `session`, `account`, `verification` (plus a drizzle migrations table).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts drizzle package.json
git commit -m "feat: add better-auth database schema and migration"
```

---

## Task 4: better-auth server instance + route handler + client

**Files:**
- Create: `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/api/auth/[...all]/route.ts`

- [ ] **Step 1: Install better-auth**

Run:
```bash
npm install better-auth
```

- [ ] **Step 2: Create the server auth instance**

Create `src/lib/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/db";
import * as schema from "@/db/schema";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  // nextCookies must be the last plugin so it can set cookies from server actions.
  plugins: [nextCookies()],
});
```

- [ ] **Step 3: Create the route handler**

Create `src/app/api/auth/[...all]/route.ts`:
```ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 4: Create the React auth client**

Create `src/lib/auth-client.ts`:
```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
export const { signUp, signIn, signOut, useSession } = authClient;
```

- [ ] **Step 5: Smoke-test the auth endpoint end-to-end**

Start the dev server in the background, create a user through the real API, then stop it.

Run:
```bash
npm run dev & echo $! > .devpid; sleep 6
curl -s -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.com","password":"password123","name":"smoke"}' ; echo
kill "$(cat .devpid)" && rm -f .devpid
```
Expected: JSON containing a `token` and a `user` object with `"email":"smoke@example.com"` (not an error). If the port is busy, adjust or stop other dev servers first.

- [ ] **Step 6: Clean up the smoke-test user**

Run:
```bash
docker compose exec -T db psql -U skycode -d skycode -c "DELETE FROM \"user\" WHERE email='smoke@example.com';"
```
Expected: `DELETE 1`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/auth.ts src/lib/auth-client.ts src/app/api/auth package.json
git commit -m "feat: wire better-auth server instance, route handler and client"
```

---

## Task 5: shadcn/ui primitives

**Files:**
- Create: `components.json`, `src/components/ui/*`, `src/lib/utils.ts` (generated by shadcn)

- [ ] **Step 1: Initialize shadcn/ui**

Run:
```bash
npx --yes shadcn@latest init --yes --base-color neutral
```
Expected: creates `components.json`, `src/lib/utils.ts`, and updates `globals.css`.

- [ ] **Step 2: Add the primitives used by the UI**

Run:
```bash
npx --yes shadcn@latest add button input label card dropdown-menu
```
Expected: files appear under `src/components/ui/` (`button.tsx`, `input.tsx`, `label.tsx`, `card.tsx`, `dropdown-menu.tsx`).

- [ ] **Step 3: Verify the project still builds**

Run:
```bash
npm run build
```
Expected: "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add components.json src/components/ui src/lib/utils.ts src/app/globals.css
git commit -m "feat: add shadcn/ui primitives"
```

---

## Task 6: Credential validation helper (TDD)

**Files:**
- Create: `src/lib/validation.ts`
- Test: `tests/unit/validation.test.ts`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest**

Run:
```bash
npm install -D vitest
```

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run"
```

- [ ] **Step 4: Write the failing test**

Create `tests/unit/validation.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateCredentials } from "@/lib/validation";

describe("validateCredentials", () => {
  it("returns no errors for a valid email and password", () => {
    expect(validateCredentials("user@example.com", "password123")).toEqual({});
  });

  it("flags an invalid email", () => {
    const errors = validateCredentials("not-an-email", "password123");
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeUndefined();
  });

  it("flags a password shorter than 8 characters", () => {
    const errors = validateCredentials("user@example.com", "short");
    expect(errors.password).toBeDefined();
    expect(errors.email).toBeUndefined();
  });

  it("flags both fields when both are invalid", () => {
    const errors = validateCredentials("bad", "x");
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
  });
});
```

Vitest resolves the `@/*` alias from `tsconfig.json` automatically via its default config loader only when `vite-tsconfig-paths` is present. To keep it dependency-free, add the alias explicitly. Update `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run:
```bash
npm test
```
Expected: FAIL — cannot resolve `@/lib/validation` (module does not exist yet).

- [ ] **Step 6: Write the minimal implementation**

Create `src/lib/validation.ts`:
```ts
export type CredentialErrors = { email?: string; password?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors better-auth's minPasswordLength (8). Keep both in sync.
export function validateCredentials(email: string, password: string): CredentialErrors {
  const errors: CredentialErrors = {};
  if (!EMAIL_RE.test(email)) errors.email = "Adresse email invalide";
  if (password.length < 8) errors.password = "Le mot de passe doit contenir au moins 8 caractères";
  return errors;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run:
```bash
npm test
```
Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts tests/unit/validation.test.ts src/lib/validation.ts package.json
git commit -m "feat: add credential validation helper with unit tests"
```

---

## Task 7: Shared auth form + Register page

**Files:**
- Create: `src/components/auth/auth-form.tsx`
- Create: `src/app/(public)/register/page.tsx`

- [ ] **Step 1: Create the shared auth form (client component)**

Create `src/components/auth/auth-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, signUp } from "@/lib/auth-client";
import { validateCredentials, type CredentialErrors } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Mode = "login" | "register";

const COPY = {
  login: {
    title: "Connexion",
    description: "Connectez-vous à votre compte",
    submit: "Se connecter",
    switchText: "Pas de compte ?",
    switchCta: "Créer un compte",
    switchHref: "/register",
  },
  register: {
    title: "Créer un compte",
    description: "Créez votre compte skycode",
    submit: "Créer le compte",
    switchText: "Déjà un compte ?",
    switchCta: "Se connecter",
    switchHref: "/login",
  },
} as const;

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const copy = COPY[mode];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<CredentialErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const validation = validateCredentials(email, password);
    setErrors(validation);
    if (validation.email || validation.password) return;

    setLoading(true);
    const result =
      mode === "register"
        ? await signUp.email({ email, password, name: email.split("@")[0] })
        : await signIn.email({ email, password });
    setLoading(false);

    if (result.error) {
      setFormError(
        mode === "register"
          ? "Impossible de créer le compte (email déjà utilisé ?)"
          : "Identifiants invalides",
      );
      return;
    }
    router.push("/repos");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            {errors.email && <p className="text-sm text-red-600">{errors.email}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
            {errors.password && <p className="text-sm text-red-600">{errors.password}</p>}
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "…" : copy.submit}
          </Button>
          <p className="text-sm text-muted-foreground">
            {copy.switchText}{" "}
            <Link href={copy.switchHref} className="underline text-foreground">
              {copy.switchCta}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
```

- [ ] **Step 2: Create the register page**

Create `src/app/(public)/register/page.tsx`:
```tsx
import { AuthForm } from "@/components/auth/auth-form";

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <AuthForm mode="register" />
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
npm run build
```
Expected: "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/auth-form.tsx "src/app/(public)/register/page.tsx"
git commit -m "feat: add shared auth form and register page"
```

---

## Task 8: Login page + root landing redirect

**Files:**
- Create: `src/app/(public)/login/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create the login page**

Create `src/app/(public)/login/page.tsx`:
```tsx
import { AuthForm } from "@/components/auth/auth-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <AuthForm mode="login" />
    </main>
  );
}
```

- [ ] **Step 2: Replace the scaffold home page with a session-aware redirect**

Replace the entire contents of `src/app/page.tsx`:
```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session ? "/repos" : "/login");
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
npm run build
```
Expected: "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add "src/app/(public)/login/page.tsx" src/app/page.tsx
git commit -m "feat: add login page and root landing redirect"
```

---

## Task 9: Protected shell (guard + sidebar + account menu) + repos empty state

**Files:**
- Create: `src/components/shell/sidebar.tsx`
- Create: `src/components/shell/account-menu.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/repos/page.tsx`

- [ ] **Step 1: Create the sidebar (static navigation)**

Create `src/components/shell/sidebar.tsx`:
```tsx
import Link from "next/link";

const NAV = [
  { label: "Repos", href: "/repos" },
  { label: "Revues", href: "/reviews" },
  { label: "Activité", href: "/activity" },
];

export function Sidebar() {
  return (
    <aside className="flex w-56 flex-col border-r bg-background p-4">
      <span className="mb-6 px-2 text-lg font-semibold">skycode</span>
      <nav className="flex flex-col gap-1">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Create the account menu (client component with sign out)**

Create `src/components/shell/account-menu.tsx`:
```tsx
"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AccountMenu({ email }: { email: string }) {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Compte
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>Se déconnecter</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: Create the protected layout with a server-side session guard**

Create `src/app/(app)/layout.tsx`:
```tsx
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { AccountMenu } from "@/components/shell/account-menu";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end border-b px-6 py-3">
          <AccountMenu email={session.user.email} />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create the repos empty-state page**

Create `src/app/(app)/repos/page.tsx`:
```tsx
export default function ReposPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Repos</h1>
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-20 text-center">
        <p className="font-medium">Aucun repo pour l&apos;instant</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Les repos surveillés apparaîtront ici.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run:
```bash
npm run build
```
Expected: "Compiled successfully".

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)" src/components/shell
git commit -m "feat: add protected shell, sidebar, account menu and repos empty state"
```

---

## Task 10: Manual end-to-end sanity check

**Files:** none (manual verification before automating).

- [ ] **Step 1: Ensure Postgres is up and migrated**

Run:
```bash
npm run db:up
npm run db:migrate
```
Expected: migration is already applied (no error).

- [ ] **Step 2: Start the dev server**

Run (leave running in another shell, or background it):
```bash
npm run dev
```
Expected: "Ready on http://localhost:3000".

- [ ] **Step 3: Walk the flow in a browser**

- Visit `http://localhost:3000` → redirected to `/login`.
- Click "Créer un compte" → `/register`. Submit with a fresh email + an 8+ char password → land on `/repos`, see "Aucun repo pour l'instant" and the sidebar.
- Open the "Compte" menu → it shows your email → "Se déconnecter" → back to `/login`.
- Sign in with the same credentials → back on `/repos`.
- Try registering with a 3-char password → inline error under the password field, no request sent.

Expected: every step behaves as described. Fix issues before proceeding to automation.

---

## Task 11: Playwright E2E — full auth journey

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/auth.spec.ts`

- [ ] **Step 1: Install Playwright and its browser**

Run:
```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Create the Playwright config (auto-starts the dev server)**

Create `playwright.config.ts`:
```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Add the e2e script**

In `package.json` `"scripts"`, add:
```json
"test:e2e": "playwright test"
```

- [ ] **Step 4: Write the E2E test**

Create `tests/e2e/auth.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("register, land on repos, sign out, sign in", async ({ page }) => {
  const email = `user_${Date.now()}@example.com`;
  const password = "password123";

  // Register
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Créer le compte" }).click();

  // Lands on the protected repos page (empty state)
  await expect(page).toHaveURL(/\/repos$/);
  await expect(page.getByText("Aucun repo pour l'instant")).toBeVisible();

  // Account menu shows the email
  await page.getByRole("button", { name: "Compte" }).click();
  await expect(page.getByText(email)).toBeVisible();

  // Sign out
  await page.getByRole("menuitem", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Sign in again
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/repos$/);
});

test("blocks access to protected area without a session", async ({ page }) => {
  await page.goto("/repos");
  await expect(page).toHaveURL(/\/login$/);
});

test("rejects a too-short password with an inline error", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Email").fill(`user_${Date.now()}@example.com`);
  await page.getByLabel("Mot de passe").fill("short");
  await page.getByRole("button", { name: "Créer le compte" }).click();
  await expect(
    page.getByText("Le mot de passe doit contenir au moins 8 caractères"),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
});
```

- [ ] **Step 5: Run the E2E suite (Postgres must be up and migrated)**

Run:
```bash
npm run db:up
npm run db:migrate
npm run test:e2e
```
Expected: 3 passed.

- [ ] **Step 6: Ignore Playwright artifacts**

Append to `.gitignore`:
```bash
printf "test-results/\nplaywright-report/\n" >> .gitignore
```

- [ ] **Step 7: Commit**

```bash
git add playwright.config.ts tests/e2e/auth.spec.ts package.json .gitignore
git commit -m "test: add playwright e2e for the auth journey"
```

---

## Task 12: Project documentation

**Files:**
- Modify: `README.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Update the README (purpose + setup only)**

Replace `README.md` with:
```markdown
# skycode

A platform to control code review processes across multiple repositories.

## Setup

Requirements: Node.js 20+, Docker.

```bash
npm install
cp .env.example .env          # then set BETTER_AUTH_SECRET
npm run db:up                 # start postgres
npm run db:migrate            # create tables
npm run dev                   # http://localhost:3000
```

## Tests

```bash
npm test        # unit (Vitest)
npm run test:e2e # end-to-end (Playwright); requires db up + migrated
```
```

- [ ] **Step 2: Create the root CLAUDE.md (stack + doc pointers)**

Create `CLAUDE.md`:
```markdown
# skycode

See `README.md` for the project's purpose and setup.

## Technical stack

- Next.js (App Router) + TypeScript
- better-auth (email/password, cookie sessions)
- PostgreSQL via Drizzle ORM + drizzle-kit, run locally with Docker Compose
- Tailwind CSS + shadcn/ui
- Vitest (unit) and Playwright (e2e)

## Documentation

- Design specs: `docs/superpowers/specs/`
- Implementation plans: `docs/superpowers/plans/`
```

- [ ] **Step 3: Verify build once more**

Run:
```bash
npm run build
```
Expected: "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document purpose, setup and stack"
```

---

## Self-Review Notes

- **Spec coverage:** registration (Task 7), sign in (Task 8), sign out (Task 9), protected sidebar shell + empty repos (Task 9), centered-card auth screens (Tasks 7–8), email+password only with name derived from email (Task 7), Postgres+Drizzle+Docker (Tasks 2–3), better-auth (Task 4), Tailwind+shadcn (Tasks 1, 5), Vitest guard/validation + Playwright journey (Tasks 6, 11). The spec's "route guard redirect" test is covered by the Playwright "blocks access without a session" test rather than a Vitest unit, because the guard depends on `next/headers` and is exercised more faithfully end-to-end.
- **Out of scope (unchanged):** email verification, password reset, OIDC, invitations, real repo/review logic. The `/reviews` and `/activity` sidebar links intentionally point to not-yet-built pages (future slices).
```
