export class GitlabAuthError extends Error {
  constructor() {
    super("GitLab rejected the token (invalid or expired)");
    this.name = "GitlabAuthError";
  }
}

export class GitlabNotFoundError extends Error {
  constructor() {
    super("The GitLab project or group was not found");
    this.name = "GitlabNotFoundError";
  }
}

export class GitlabUnavailableError extends Error {
  constructor() {
    super("GitLab could not be reached");
    this.name = "GitlabUnavailableError";
  }
}
