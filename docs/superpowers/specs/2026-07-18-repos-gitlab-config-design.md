# skycode — GitLab Repository Configuration (Slice 2)

**Date:** 2026-07-18
**Status:** Approved design, pending implementation plan

## Objective and Scope

A signed-in user can **register a GitLab connection** (via a bot access token scoped to a
project or a group), **discover and activate** the projects they care about, and see those
projects listed on the **Repos** page.

**In scope**
- Add a GitLab connection: paste an instance URL + a project/group access token; validate it
  live against GitLab; resolve the scope and the bot identity.
- Activate / list tracked repositories: for a group connection, pick which projects to track;
  display tracked repositories on the Repos page.
- Remove a tracked repository; remove a connection (cascading to its repositories and wiping
  the stored token).
- Personal organization auto-created at signup (via the better-auth `organization` plugin) so
  connections and repositories are owned at organization level from the start.

**Out of scope (deferred to later specs)**
- Per-repository review options (comment / auto-merge settings).
- Any actual review logic (posting comments, merging MRs).
- Team management: inviting members, roles, multiple organizations.
- GitHub support (a later, separate slice).
- OAuth-based GitLab connection (personal-identity flow) — deliberately rejected, see below.

## Core Concept: the credential is a bot, not the user

The GitLab credential is **not** the user's personal identity. It is a **Project Access Token**
or **Group Access Token**, which in GitLab is backed by a *bot* service account. That bot is the
identity that will later post review comments and merge merge requests according to per-repo
options. A personal access token would make it look like the user reviewed their own MR, which is
nonsensical for a review tool.

Consequences:
- The skycode account stays pure email/password. There is **no** "connect my GitLab account"
  OAuth flow and the better-auth `account` table is untouched.
- GitLab access is owned **per organization**, through bot tokens — never tied to a person.
- "Listing projects" depends on token granularity:
  - **Project token** → designates exactly one project; no selection screen, resolve and show it.
  - **Group token** → grants access to all projects in the group; list them and let the user
    pick which to activate.

## Ownership Model

Connections and repositories are owned at **organization** level (chosen over per-user ownership
so a connection and its bot identity can later be shared across a team).

For this slice, membership management is kept minimal:
- The **better-auth `organization` plugin** provides the `organization`, `member`, and
  `invitation` tables plus the create/invite APIs.
- A **personal organization is auto-created** on signup (after-signup hook); the user is its sole
  member. The `invitation` table is present but unused.
- Invitations, roles, and multi-organization support are deferred to a dedicated "Teams" slice.

## Data Model (new tables)

Beyond the better-auth `organization` plugin tables:

### `gitlab_connection` — the credential and its reach
- `id`
- `organizationId` → FK to `organization`
- `instanceUrl` — e.g. `https://gitlab.com`, or a self-hosted URL
- `scopeType` — `'project'` | `'group'`
- `scopeGitlabId` — the GitLab numeric id of the project or group the token is scoped to
- `token` — encrypted at rest (see Security)
- `botUserId`, `botUsername`, `botName`, `botAvatarUrl` — bot identity resolved from GitLab, for
  display ("will comment as …")
- `tokenExpiresAt` — nullable; GitLab project/group tokens expire, so this is stored
- `createdAt` / `updatedAt`
- **Unique** `(organizationId, instanceUrl, scopeType, scopeGitlabId)` — re-pasting the same token
  reuses the existing connection instead of duplicating the stored credential.

### `tracked_repo` — an activated GitLab project skycode manages
- `id`
- `connectionId` → FK to `gitlab_connection` (cascade delete)
- `gitlabProjectId`
- `pathWithNamespace`, `name`, `webUrl` — cached metadata for display
- `createdAt` / `updatedAt`
- Multiple `tracked_repo` rows may reference the same connection (the group case). A project-scoped
  connection has exactly one `tracked_repo`.
- **Unique** `(connectionId, gitlabProjectId)` — a project cannot be tracked twice via the same
  connection.

## Architecture (isolated units)

- **`lib/gitlab/client.ts`** — a minimal GitLab REST v4 client built from `(instanceUrl, token)`.
  Methods: `getCurrentUser()`, `getProject(id)`, `listGroupProjects(id)`. Depends only on `fetch`;
  testable with a mocked `fetch`.
- **`lib/gitlab/token-scope.ts`** — a pure function mapping a bot `username` to
  `{ scopeType, scopeGitlabId }` via the pattern `^(project|group)_(\d+)_bot_`. Any username that
  does not match (i.e. a personal PAT) is rejected.
- **`lib/crypto/token-cipher.ts`** — AES-256-GCM encrypt/decrypt of the token, key from the
  `SKYCODE_ENCRYPTION_KEY` environment variable. Round-trip tested.
- **`db/schema.ts`** — add the tables above; wire the better-auth `organization` plugin schema.
- **`lib/auth.ts`** — enable the better-auth `organization` plugin and the after-signup hook that
  creates the personal organization.
- **Server actions** — `addConnection`, `listUntrackedProjects` (for an existing group
  connection), `activateRepos`, `removeRepo`, `removeConnection`. Every action verifies the caller
  is a member of the owning organization.
- **`app/(app)/repos/`** — the Repos page: tracked repositories grouped by connection; an "Add
  connection" dialog; a project-selection step for group connections; remove actions.

## Data Flow

### Add a connection
1. User enters `instanceUrl` (defaulting to `https://gitlab.com`) and a token.
2. Server calls `GET /api/v4/user` with the token to validate it and read the bot user. The bot
   `username` is parsed to derive `scopeType` + `scopeGitlabId` and to capture the bot identity.
   A non-bot username → clear error ("not a project/group access token").
3. **Dedup**: if a connection already exists for `(org, instanceUrl, scopeType, scopeGitlabId)`,
   reuse it instead of creating a duplicate.
4. Encrypt the token and persist the connection with its bot identity and `tokenExpiresAt`.
5. Resolve projects:
   - project scope → `getProject(id)` → directly activate the single repository;
   - group scope → `listGroupProjects(id)` (with subgroups) → present a checklist → activate the
     chosen projects.

### Add a repository from an existing connection (the A/B reuse case)
On the Repos page, "Add a repository" can also start from an existing **group** connection: list
the projects it can see that are not yet tracked, and let the user activate them. Because the token
lives on the connection, activating a second project never re-prompts for a token.

### Remove
- Remove a `tracked_repo` → the repository is no longer tracked.
- Remove a `gitlab_connection` → cascade-delete its tracked repositories and wipe the stored token.

## Error Handling

Inline, explicit messages for: invalid or expired token (GitLab 401), a token that is not a
project/group bot token, project/group not found, GitLab network/unavailability errors, and
duplicate connection. Tokens are never returned to the client; all GitLab calls happen
server-side.

## Security

- The token is **encrypted at rest** with AES-256-GCM (key from `SKYCODE_ENCRYPTION_KEY`), storing
  the IV, ciphertext, and auth tag.
- The token is never sent to the browser and never logged.
- Every server action authorizes on organization membership before reading or mutating a
  connection or repository.

## Testing

- **Unit (Vitest):** the bot-username scope parser (valid project/group, rejected PAT); the
  token-cipher encrypt/decrypt round-trip; the GitLab client against a mocked `fetch`; the dedup
  logic.
- **Integration (Vitest):** server actions against a mocked GitLab and a test database — add
  connection (project and group), activate repos, dedup on re-paste, remove repo, remove
  connection with cascade.
- **E2E (Playwright):** add a group connection (GitLab mocked) → select projects → see them on the
  Repos page → remove a repository → remove the connection. The GitLab mocking strategy for e2e is
  to be settled in the implementation plan.

## Repository Structure (additions)

```
src/
  db/                # + gitlab_connection, tracked_repo tables; organization plugin schema
  lib/
    auth.ts          # + organization plugin, after-signup hook that creates the personal org
    gitlab/          # client.ts, token-scope.ts
    crypto/          # token-cipher.ts
  app/(app)/repos/   # list, add-connection dialog, group project selection, remove actions
```
