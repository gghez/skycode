import { describe, it, expect } from "vitest";
import { validateCredentials } from "@/lib/validation";

describe("validateCredentials", () => {
  it("returns no errors for a valid email and password", () => {
    expect(validateCredentials("user@example.com", "password123")).toEqual({});
  });

  it("flags an invalid email", () => {
    const errors = validateCredentials("not-an-email", "password123");
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeUndefined();
  });

  it("flags a password shorter than 8 characters", () => {
    const errors = validateCredentials("user@example.com", "short");
    expect(errors.password).toBeDefined();
    expect(errors.email).toBeUndefined();
  });

  it("flags both fields when both are invalid", () => {
    const errors = validateCredentials("bad", "x");
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
  });
});
