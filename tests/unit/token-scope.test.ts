import { describe, it, expect } from "vitest";
import { parseBotScope } from "@/lib/gitlab/token-scope";

describe("parseBotScope", () => {
  it("parses a project token bot username", () => {
    expect(parseBotScope("project_123_bot_4ffca233d8298ea1")).toEqual({
      scopeType: "project",
      scopeGitlabId: 123,
    });
  });

  it("parses a group token bot username", () => {
    expect(parseBotScope("group_42_bot_abc")).toEqual({
      scopeType: "group",
      scopeGitlabId: 42,
    });
  });

  it("returns null for a personal account username", () => {
    expect(parseBotScope("alice")).toBeNull();
  });

  it("returns null for a malformed bot username", () => {
    expect(parseBotScope("project_bot_123")).toBeNull();
  });
});
