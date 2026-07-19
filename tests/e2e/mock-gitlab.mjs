// tests/e2e/mock-gitlab.mjs
// Minimal GitLab REST v4 mock for e2e. A "group" token bot sees group 42 with two projects.
// A "project" token bot sees a single project (101, acme/backend).
//
// Token convention (see /api/v4/user below): the app sends the pasted access
// token in the PRIVATE-TOKEN request header. This mock keys its response off
// that header so behaviour is deterministic per-request, with no shared
// mutable state between tests:
//   - PRIVATE-TOKEN: personal  -> returns a personal (non-bot) user, so
//     parseBotScope() fails and the app rejects the token.
//   - PRIVATE-TOKEN: project   -> returns the project_101_bot_e2e bot user
//     (a project access token scoped to project 101, acme/backend).
//   - any other token          -> returns the group_42_bot_e2e bot user
//     (a group access token scoped to group 42).
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
  const token = req.headers["private-token"];

  if (path === "/api/v4/user") {
    if (token === "personal") {
      return send(res, 200, { id: 1, username: "alice", name: "Alice", avatar_url: null });
    }
    if (token === "project") {
      return send(res, 200, {
        id: 9002,
        username: "project_101_bot_e2e",
        name: "skycode bot",
        avatar_url: null,
      });
    }
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
  if (path.startsWith("/api/v4/projects/")) {
    const id = Number(path.slice("/api/v4/projects/".length));
    const project = GROUP_PROJECTS.find((p) => p.id === id);
    if (project) return send(res, 200, project);
    return send(res, 404, { message: "not found" });
  }
  return send(res, 404, { message: "not found" });
}).listen(PORT, () => {
  console.log(`mock-gitlab listening on ${PORT}`);
});
