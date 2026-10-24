import { describe, expect, it } from "vitest";
import { D1_RECOVERY_WINDOW_MS, recoveryDeadline, recoveryEligible } from "./d1-recovery";

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
