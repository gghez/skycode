import type { GitlabScopeType } from "./types";

export interface BotScope {
  scopeType: GitlabScopeType;
  scopeGitlabId: number;
}

const BOT_USERNAME_RE = /^(project|group)_(\d+)_bot_/;

/**
 * Parses a GitLab bot username (as returned by GET /api/v4/user for a
 * project/group access token) into its scope type and target GitLab id.
 *
 * Returns null when the username does not match the bot pattern, which
 * indicates the token is a personal access token rather than a
 * project/group access token.
 */
export function parseBotScope(username: string): BotScope | null {
  const match = BOT_USERNAME_RE.exec(username);
  if (!match) return null;
  return { scopeType: match[1] as GitlabScopeType, scopeGitlabId: Number(match[2]) };
}
