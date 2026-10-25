import { describe, expect, it } from "vitest";
import {
  D1_RECOVERY_WINDOW_MS,
  recoveryDeadline,
  recoveryEligible,
  recoveryName,
} from "./d1-recovery";

describe("D1 recovery names", () => {
  it("uses the database identity rather than resource binding separators", () => {
    expect(
      recoveryName("appflare-production-validation-db", "f78b4a45-1dba-4059-b40c-25ce23e4d724"),
    ).toBe("appflare-production-validation-db-recovered-e4d724");
    expect(recoveryName("a".repeat(80), "install:d1:DB")).toMatch(/^[a-zA-Z0-9_-]{1,63}$/);
    expect(recoveryName("legacy name:db", "install:d1:DB")).toMatch(/^[a-zA-Z0-9_-]{1,63}$/);
  });
});

describe("D1 recovery eligibility", () => {
  const at = new Date("2026-10-23T12:00:00Z");
  it("does not infer a deletion date", () => {
    expect(recoveryDeadline(null)).toBeNull();
    expect(recoveryEligible(null, at.getTime())).toBe(false);
  });
  it("expires at seven days, not after", () => {
    expect(recoveryDeadline(at)).toBe("2026-10-30T12:00:00.000Z");
    expect(recoveryEligible(at, at.getTime() + D1_RECOVERY_WINDOW_MS - 1)).toBe(true);
    expect(recoveryEligible(at, at.getTime() + D1_RECOVERY_WINDOW_MS)).toBe(false);
    expect(recoveryEligible(at, at.getTime() - 1)).toBe(false);
  });
});
