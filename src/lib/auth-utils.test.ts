import { describe, it, expect } from "vitest";
import { safeNext, maskEmail } from "./auth-utils";

describe("safeNext", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/admin?tab=users")).toBe("/admin?tab=users");
    expect(safeNext("/activity/feed/1")).toBe("/activity/feed/1");
    expect(safeNext("/")).toBe("/");
  });

  it("rejects absolute/external URLs", () => {
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("http://evil.com/path")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
  });

  it("rejects protocol-relative and backslash tricks", () => {
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("/\\evil.com")).toBe("/");
    expect(safeNext("\\\\evil.com")).toBe("/");
  });

  it("never bounces back to auth screens", () => {
    expect(safeNext("/auth")).toBe("/");
    expect(safeNext("/auth/")).toBe("/");
    expect(safeNext("/auth?next=/")).toBe("/");
    expect(safeNext("/auth/callback")).toBe("/");
  });

  it("handles null, undefined and non-strings", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext("")).toBe("/");
  });
});

describe("maskEmail", () => {
  it("masks the local part, keeping only edges", () => {
    expect(maskEmail("jane@clinic.com")).toBe("j**e@clinic.com");
    expect(maskEmail("ab@clinic.com")).toBe("a***@clinic.com");
    expect(maskEmail("a@clinic.com")).toBe("a***@clinic.com");
    expect(maskEmail("john.smith@clinic.com")).toBe("j********h@clinic.com");
  });

  it("keeps the domain visible", () => {
    expect(maskEmail("jane@clinic.com")).toContain("@clinic.com");
    expect(maskEmail("jane@clinic.com")).not.toContain("jane");
  });

  it("degrades gracefully for malformed input", () => {
    expect(maskEmail(null)).toBe("");
    expect(maskEmail("not-an-email")).toBe("not-an-email");
    expect(maskEmail("").length).toBe(0);
  });
});