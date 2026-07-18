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

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Connection not found for this organization");
    this.name = "ConnectionNotFoundError";
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
  if (!row) throw new ConnectionNotFoundError();
  return row;
}

export async function listUntrackedProjects(
  organizationId: string,
  connectionId: string,
): Promise<DiscoveredProject[]> {
  const connection = await requireOwnedConnection(organizationId, connectionId);
  // A project-scoped connection tracks exactly one project (already tracked by
  // addConnection), so there is nothing left to discover; avoid calling
  // GitLab's group-projects endpoint with a project id, which 404s.
  if (connection.scopeType !== "group") return [];
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

  const selectedIds = new Set(gitlabProjectIds);
  const selected = source.filter((p) => selectedIds.has(p.id));
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
