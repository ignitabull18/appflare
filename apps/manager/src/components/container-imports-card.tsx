import { Button, Text } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { readContainerImports, setContainerImports } from "../sandbox/container-imports.functions";
import { Section, SectionBody } from "./section";

export function ContainerImportsCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void readContainerImports()
      .then((s) => {
        if (alive) setEnabled(s.enabled);
      })
      .catch(() => {
        if (alive) setError("Could not read the container import setting.");
      });
    return () => {
      alive = false;
    };
  }, []);
  async function change() {
    if (enabled === null) return;
    setBusy(true);
    setError(null);
    try {
      setEnabled((await setContainerImports({ data: { enabled: !enabled } })).enabled);
    } catch {
      setError("Could not change the container import setting.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      id="container-imports"
      title="Container imports"
      description="Experimental support for stateless web applications with published images."
      error={error}
    >
      <SectionBody>
        <div className="grid gap-3">
          <Text>
            Requires Workers Paid. Local files are temporary. The first release permits one instance
            per app and images from public Docker Hub or this account's Cloudflare registry.
          </Text>
          <Button
            variant="secondary"
            disabled={busy || enabled === null}
            onClick={() => {
              void change();
            }}
          >
            {enabled ? "Disable container imports" : "Enable container imports"}
          </Button>
        </div>
      </SectionBody>
    </Section>
  );
}
