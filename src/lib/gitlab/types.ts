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
