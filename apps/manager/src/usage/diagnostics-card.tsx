import { Button, Link, Text } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { Section, SectionBody } from "../components/section";
import { changeDiagnostics, changeHostnameTracing, getDiagnostics } from "./diagnostics.functions";

type State = Awaited<ReturnType<typeof getDiagnostics>>;

export function DiagnosticsCard({ installId }: { installId?: string }) {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void getDiagnostics({ data: { installId } })
      .then((next) => {
        if (alive) setData(next);
      })
      .catch(() => {
        if (alive)
          setError("Could not read diagnostics. Check the Cloudflare connection and reload.");
      });
    return () => {
      alive = false;
    };
  }, [installId]);
  async function change(action: () => Promise<State>) {
    setBusy(true);
    setError(null);
    try {
      setData(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change diagnostics.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      id="diagnostics"
      title="Diagnostics"
      description="Record failures and follow sampled requests through Cloudflare."
      error={error}
    >
      <SectionBody>
        <div className="grid gap-4">
          <Text>
            Worker traces sample 10% of requests. Stored logs and traces can incur Cloudflare usage
            charges.{" "}
            <Link
              href="https://developers.cloudflare.com/observability/pricing/"
              target="_blank"
              rel="noreferrer"
            >
              Review pricing
            </Link>
            .
          </Text>
          {data === null && !error && <Text>Reading diagnostics…</Text>}
          {data?.workers.map((worker) => (
            <div key={worker.name} className="grid gap-2">
              <Text bold>{worker.name}</Text>
              <div className="flex flex-wrap gap-2">
                {(["logs", "traces", "issues"] as const).map((feature) => (
                  <Button
                    key={feature}
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      void change(() =>
                        changeDiagnostics({
                          data: {
                            installId,
                            workerName: worker.name,
                            feature,
                            enabled: !worker[feature],
                            sampling: 0.1,
                          },
                        }),
                      );
                    }}
                  >
                    {feature === "logs"
                      ? "Logs"
                      : feature === "traces"
                        ? "Worker traces"
                        : "Error monitoring"}
                    : {worker[feature] ? "on" : "off"}
                  </Button>
                ))}
                <Link href={worker.dashboard} target="_blank" rel="noreferrer">
                  Open in Cloudflare
                </Link>
              </div>
            </div>
          ))}
          {data && (
            <div className="grid gap-2">
              <Text bold>Hostname traces{data.hostname ? `: ${data.hostname}` : ""}</Text>
              {data.hostnameTrace ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    void change(() =>
                      changeHostnameTracing({
                        data: { installId, enabled: !data.hostnameTrace?.enabled },
                      }),
                    );
                  }}
                >
                  {data.hostnameTrace.enabled
                    ? "Turn off hostname traces"
                    : "Enable hostname traces at 10%"}
                </Button>
              ) : (
                <Text>{data.hostnameProblem}</Text>
              )}
              <Text>
                Only sampled requests are recorded. Some Cloudflare processing has no trace detail.
                A missing trace does not explain a failure.
              </Text>
            </div>
          )}
        </div>
      </SectionBody>
    </Section>
  );
}
