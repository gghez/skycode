import { describe, it, expect, vi, afterEach } from "vitest";
import { createGitlabClient } from "@/lib/gitlab/client";
import {
  GitlabAuthError,
  GitlabNotFoundError,
  GitlabUnavailableError,
} from "@/lib/gitlab/errors";

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

  it("maps a network failure to GitlabUnavailableError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const client = createGitlabClient("https://gitlab.example.com", "tok");
    await expect(client.getCurrentUser()).rejects.toBeInstanceOf(GitlabUnavailableError);
  });

  it("maps 500 to GitlabUnavailableError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const client = createGitlabClient("https://gitlab.com", "tok");
    await expect(client.getCurrentUser()).rejects.toBeInstanceOf(GitlabUnavailableError);
  });

  it("getSelfToken reads expires_at from /personal_access_tokens/self", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id: 3, name: "bot token", expires_at: "2026-01-31" }));
    const client = createGitlabClient("https://gitlab.com", "tok");

    await expect(client.getSelfToken()).resolves.toEqual({ expires_at: "2026-01-31" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://gitlab.com/api/v4/personal_access_tokens/self");
  });

  it("getSelfToken falls back to null when expires_at is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ id: 3, name: "bot token" }));
    const client = createGitlabClient("https://gitlab.com", "tok");

    await expect(client.getSelfToken()).resolves.toEqual({ expires_at: null });
  });

  it("listGroupProjects follows x-next-page pagination and keeps only known fields", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse(
          [
            {
              id: 1,
              name: "a",
              path_with_namespace: "g/a",
              web_url: "u1",
              description: "unexpected",
              visibility: "private",
            },
          ],
          { "x-next-page": "2" },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: 2, name: "b", path_with_namespace: "g/b", web_url: "u2" }]),
      );
    const client = createGitlabClient("https://gitlab.com", "tok");
    const projects = await client.listGroupProjects(42);

    expect(projects).toEqual([
      { id: 1, name: "a", path_with_namespace: "g/a", web_url: "u1" },
      { id: 2, name: "b", path_with_namespace: "g/b", web_url: "u2" },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/groups/42/projects?");
  });

  it("listGroupProjects stops when x-next-page is present but empty", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse([{ id: 1, name: "a", path_with_namespace: "g/a", web_url: "u1" }], {
        "x-next-page": "",
      }),
    );
    const client = createGitlabClient("https://gitlab.com", "tok");
    const projects = await client.listGroupProjects(42);

    expect(projects.map((p) => p.id)).toEqual([1]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
