import { Button, Input, Text } from "@cloudflare/kumo";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listD1Recovery, recoverD1 } from "../installs/d1-recovery.functions";
import { ConfirmDialog } from "./confirm-dialog";
import { Section, SectionBody } from "./section";

export function D1RecoveryCard() {
  const router = useRouter();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listD1Recovery>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A recovery increments revision to refetch server state.
  useEffect(() => {
    let alive = true;
    setError(null);
    void listD1Recovery()
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        if (alive) setError("Could not read database recovery history.");
      });
    return () => {
      alive = false;
    };
  }, [revision]);
  return (
    <Section
      title="Recently deleted databases"
      id="database-recovery"
      error={error}
      description="Cloudflare may recover D1 databases within seven days of deletion."
    >
      <SectionBody>
        <div className="grid gap-4">
          <Text>
            Recovery restores retained data. It does not reinstall or reconnect an app, and does not
            replace backups.
          </Text>
          {rows.length === 0 && !error && <Text>No recently deleted databases are recorded.</Text>}
          {rows.map((row) => (
            <div key={row.id} className="grid gap-1">
              <Text bold>{row.name}</Text>
              <Text>
                Database: {row.cfId}.{" "}
                {row.deadline
                  ? `Recovery deadline: ${row.deadline}`
                  : "Deletion time is unconfirmed; Appflare cannot promise eligibility."}
              </Text>
              {row.eligible && (
                <Input
                  label="Recovery name"
                  value={names[row.id] ?? row.destination}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setNames((current) => ({ ...current, [row.id]: value }));
                  }}
                />
              )}
              {row.eligible && (
                <ConfirmDialog
                  destructive={false}
                  disabled={!/^[a-zA-Z0-9_-]{1,63}$/.test(names[row.id] ?? row.destination)}
                  title={`Recover ${row.name}`}
                  description={`Recover database ${row.cfId} as ${names[row.id] ?? row.destination}. Cloudflare must still confirm it is recoverable.`}
                  actionLabel="Recover database"
                  trigger={(p) => (
                    <Button {...p} variant="secondary">
                      Recover database
                    </Button>
                  )}
                  onConfirm={async () => {
                    await recoverD1({
                      data: { resourceId: row.id, newName: names[row.id] ?? row.destination },
                    });
                    setRevision((n) => n + 1);
                    await router.invalidate();
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </SectionBody>
    </Section>
  );
}
