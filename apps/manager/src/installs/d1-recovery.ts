export const D1_RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Resource record IDs include binding separators; a D1 name cannot contain them. */
export function recoveryName(name: string, cfId: string): string {
  const prefix = name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 45) || "database";
  const suffix =
    cfId
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-6)
      .toLowerCase() || "db";
  return `${prefix}-recovered-${suffix}`;
}

export function recoveryDeadline(confirmedAt: Date | null): string | null {
  return confirmedAt === null
    ? null
    : new Date(confirmedAt.getTime() + D1_RECOVERY_WINDOW_MS).toISOString();
}

export function recoveryEligible(confirmedAt: Date | null, now: number): boolean {
  return (
    confirmedAt !== null &&
    confirmedAt.getTime() <= now &&
    now < confirmedAt.getTime() + D1_RECOVERY_WINDOW_MS
  );
}
