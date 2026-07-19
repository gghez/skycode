import "server-only";
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

export class InvalidInstanceUrlError extends Error {
  constructor() {
    super("Invalid GitLab instance URL");
    this.name = "InvalidInstanceUrlError";
  }
}

// Hostnames/ranges that are never a legitimate public GitLab instance.
const PRIVATE_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^\[?::1\]?$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
];

/**
 * Rejects instanceUrl values that are obviously unsafe before we let
 * createGitlabClient fetch them, to raise the bar against SSRF through a
 * user-supplied GitLab instance URL.
 *
 * This is NOT a complete SSRF defence: it is a hostname/scheme allowlist
 * checked against the literal string the user typed. A public hostname
 * that resolves (via DNS, including DNS rebinding) to a private address
 * is not caught here.
 */
function assertAllowedInstanceUrl(instanceUrl: string): void {
  let url: URL;
  try {
    url = new URL(instanceUrl);
  } catch {
    throw new InvalidInstanceUrlError();
  }

  const isProduction = process.env.NODE_ENV === "production";
  const schemeAllowed = url.protocol === "https:" || (url.protocol === "http:" && !isProduction);
  if (!schemeAllowed) throw new InvalidInstanceUrlError();

  if (isProduction && PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(url.hostname))) {
    throw new InvalidInstanceUrlError();
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
  | { scopeType: "project"; connectionId: string }
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
  assertAllowedInstanceUrl(instanceUrl);
  const client = createGitlabClient(instanceUrl, input.token);

  // Validate token + resolve bot identity and scope (throws GitlabAuthError on 401).
  const botUser = await client.getCurrentUser();
  const scope = parseBotScope(botUser.username);
  if (!scope) throw new NotABotTokenError();

  const tokenExpiresAt = await bestEffortExpiry(client);

  // Dedup: reuse an existing connection for the same scope, refreshing its token/identity.
  // A single upsert (instead of select-then-insert-or-update) avoids a race where two
  // concurrent submissions for the same scope both miss the select and both try to
  // insert, with the loser hitting the gitlab_connection_scope_unique constraint.
  const refreshedFields = {
    token: encryptToken(input.token),
    botUserId: botUser.id,
    botUsername: botUser.username,
    botName: botUser.name,
    botAvatarUrl: botUser.avatar_url,
    tokenExpiresAt,
  };
  const [connectionRow] = await db
    .insert(gitlabConnection)
    .values({
      id: randomUUID(),
      organizationId,
      instanceUrl,
      scopeType: scope.scopeType,
      scopeGitlabId: scope.scopeGitlabId,
      ...refreshedFields,
    })
    .onConflictDoUpdate({
      target: [
        gitlabConnection.organizationId,
        gitlabConnection.instanceUrl,
        gitlabConnection.scopeType,
        gitlabConnection.scopeGitlabId,
      ],
      set: refreshedFields,
    })
    .returning();
  const connectionId = connectionRow.id;

  if (scope.scopeType === "project") {
    const project = await client.getProject(scope.scopeGitlabId);
    await db
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
      });

    return { scopeType: "project", connectionId };
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

// Kept private: only used internally to build a client from a stored (encrypted) connection.
function loadClientForConnection(row: typeof gitlabConnection.$inferSelect): GitlabClient {
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
  const client = loadClientForConnection(connection);
  const trackedIds = new Set(
    (
      await db
        .select({ gitlabProjectId: trackedRepo.gitlabProjectId })
        .from(trackedRepo)
        .where(eq(trackedRepo.connectionId, connectionId))
    ).map((r) => r.gitlabProjectId),
  );

  // A project-scoped connection tracks exactly one project. If its lone repo was
  // removed, it becomes "untracked" again and must be offered for re-activation
  // (GitLab's group-projects endpoint can't be used here: it 404s on a project id).
  if (connection.scopeType === "project") {
    if (trackedIds.has(connection.scopeGitlabId)) return [];
    const project = await client.getProject(connection.scopeGitlabId);
    return [
      {
        gitlabProjectId: project.id,
        name: project.name,
        pathWithNamespace: project.path_with_namespace,
        webUrl: project.web_url,
        alreadyTracked: false,
      },
    ];
  }

  const projects = await client.listGroupProjects(connection.scopeGitlabId);
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
