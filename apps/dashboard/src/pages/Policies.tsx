import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface GateRow {
  gate: string;
  description: string;
  risk: string;
  allowAutopilot: boolean;
  policy: { mode: string; note: string; updatedAt: string };
}

export function Policies() {
  const [gates, setGates] = useState<GateRow[]>([]);
  const [env, setEnv] = useState({ env: "local", dryRun: true });
  const refresh = useCallback(() => {
    api<{ gates: GateRow[]; env: string; dryRun: boolean }>("/api/policies").then((r) => {
      setGates(r.gates);
      setEnv({ env: r.env, dryRun: r.dryRun });
    });
  }, []);
  useEffect(refresh, [refresh]);

  const setMode = async (gate: string, mode: string) => {
    const note = mode === "autopilot" ? prompt("Autopilot is high-trust. Why are you enabling it?") ?? "" : "";
    if (mode === "autopilot" && !note) return;
    await api(`/api/policies/${gate}`, { method: "POST", body: JSON.stringify({ mode, note }) });
    refresh();
  };

  return (
    <>
      <h2>Settings / Policies</h2>
      <p className="sub">
        Per-gate behavior. <strong>closed</strong> = never allowed · <strong>approval</strong> = per-action review (default) ·{" "}
        <strong>autopilot</strong> = pre-authorized (requires ENABLE_FULL_AUTONOMY + production + live credentials).
        Current env: <span className="badge blue">{env.env}</span>{" "}
        {env.dryRun && <span className="badge amber">DRY RUN forced</span>}
      </p>
      <div className="panel">
        <table>
          <thead>
            <tr><th>Gate</th><th>Risk</th><th>Description</th><th>Mode</th><th>Note</th></tr>
          </thead>
          <tbody>
            {gates.map((g) => (
              <tr key={g.gate}>
                <td className="mono">{g.gate}</td>
                <td><span className={`badge ${g.risk === "critical" ? "red" : "amber"}`}>{g.risk}</span></td>
                <td>{g.description}{!g.allowAutopilot && <span className="sub"> (autopilot never allowed)</span>}</td>
                <td>
                  <select value={g.policy.mode} onChange={(e) => setMode(g.gate, e.target.value)}>
                    <option value="closed">closed</option>
                    <option value="approval">approval</option>
                    {g.allowAutopilot && <option value="autopilot">autopilot</option>}
                  </select>
                </td>
                <td className="sub">{g.policy.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
