import type { HttpApi } from "../http";

export interface TraceRule {
  action: "set_trace_settings";
  action_parameters: { sampling_ratio: number };
  description: string;
  enabled: boolean;
  expression: string;
}

export interface TraceSettings {
  enabled: boolean;
  persist: boolean;
  sampling_ratio: number;
  destinations: string[];
  propagation_policy: "accept" | "authenticated" | "reject";
  forward_context: boolean;
}

/** Zone-level production tracing, separate from Workers tracing. */
export function createTracing(http: HttpApi) {
  const base = (id: string) => `/zones/${encodeURIComponent(id)}/observability/tracing`;
  return {
    settings(id: string): Promise<TraceSettings> {
      return http.result("GET", `${base(id)}/settings`);
    },
    rules(id: string): Promise<{ rules: TraceRule[] }> {
      return http.result("GET", `${base(id)}/rules`);
    },
    setSettings(id: string, settings: Partial<TraceSettings>): Promise<TraceSettings> {
      return http.result("PATCH", `${base(id)}/settings`, { json: settings });
    },
    setRules(id: string, rules: TraceRule[]): Promise<{ rules: TraceRule[] }> {
      return http.result("PUT", `${base(id)}/rules`, { json: { rules } });
    },
  };
}
