import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { gitlabConnection, member, organization, trackedRepo, user } from "@/db/schema";
import { encryptToken } from "@/lib/crypto/token-cipher";
import {
  ConnectionNotFoundError,
  activateRepos,
  listConnectionsWithRepos,
  listUntrackedProjects,
  removeConnection,
  removeRepo,
} from "@/lib/repos/service";

// Pins the one security property no other test covers: a caller scoped to
// organization B must never be able to read or mutate organization A's
// gitlab_connection / tracked_repo rows, even when it supplies A's ids
// directly. Exercises the service layer directly (not HTTP) since there is
// no UI path that could ever pass another org's id.

const orgA = { id: `org-a-${randomUUID()}`, slug: `org-a-${randomUUID()}` };
const orgB = { id: `org-b-${randomUUID()}`, slug: `org-b-${randomUUID()}` };
const userA = { id: `user-a-${randomUUID()}`, email: `user-a-${randomUUID()}@example.com` };
const userB = { id: `user-b-${randomUUID()}`, email: `user-b-${randomUUID()}@example.com` };
const connectionA = { id: `conn-a-${randomUUID()}` };
const repoA = { id: `repo-a-${randomUUID()}` };

beforeAll(async () => {
  await db.insert(user).values([
    { id: userA.id, name: "User A", email: userA.email },
    { id: userB.id, name: "User B", email: userB.email },
  ]);

  await db.insert(organization).values([
    { id: orgA.id, name: "Org A", slug: orgA.slug },
    { id: orgB.id, name: "Org B", slug: orgB.slug },
  ]);

  await db.insert(member).values([
    { id: randomUUID(), organizationId: orgA.id, userId: userA.id, role: "owner" },
    { id: randomUUID(), organizationId: orgB.id, userId: userB.id, role: "owner" },
  ]);

  await db.insert(gitlabConnection).values({
    id: connectionA.id,
    organizationId: orgA.id,
    instanceUrl: "https://gitlab.example.com",
    scopeType: "group",
    scopeGitlabId: 42,
    token: encryptToken("org-a-secret-token"),
    botUserId: 9001,
    botUsername: "group_42_bot_authz",
    botName: "skycode bot",
    botAvatarUrl: null,
    tokenExpiresAt: null,
  });

  await db.insert(trackedRepo).values({
    id: repoA.id,
    connectionId: connectionA.id,
    gitlabProjectId: 101,
    name: "backend",
    pathWithNamespace: "acme/backend",
    webUrl: "https://gitlab.example.com/acme/backend",
  });
});

afterAll(async () => {
  // Cascades: organization -> member, gitlab_connection -> tracked_repo.
  await db.delete(organization).where(inArray(organization.id, [orgA.id, orgB.id]));
  await db.delete(user).where(inArray(user.id, [userA.id, userB.id]));
});

describe("cross-organization authorization", () => {
  it("listUntrackedProjects rejects a connection id from another organization", async () => {
    await expect(listUntrackedProjects(orgB.id, connectionA.id)).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
  });

  it("activateRepos rejects a connection id from another organization", async () => {
    await expect(activateRepos(orgB.id, connectionA.id, [101])).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
  });

  it("removeConnection rejects, leaving organization A's connection intact", async () => {
    await expect(removeConnection(orgB.id, connectionA.id)).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );

    const [row] = await db
      .select({ id: gitlabConnection.id })
      .from(gitlabConnection)
      .where(eq(gitlabConnection.id, connectionA.id))
      .limit(1);
    expect(row).toBeDefined();
  });

  it("removeRepo silently no-ops, leaving organization A's repo intact", async () => {
    await expect(removeRepo(orgB.id, repoA.id)).resolves.toBeUndefined();

    const [row] = await db
      .select({ id: trackedRepo.id })
      .from(trackedRepo)
      .where(eq(trackedRepo.id, repoA.id))
      .limit(1);
    expect(row).toBeDefined();
  });

  it("listConnectionsWithRepos(orgB) does not return organization A's connection", async () => {
    const connections = await listConnectionsWithRepos(orgB.id);
    expect(connections.find((c) => c.id === connectionA.id)).toBeUndefined();
  });
});
