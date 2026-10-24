export const D1_RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
