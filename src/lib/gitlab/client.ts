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
