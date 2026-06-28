import { useCallback, useEffect, useState } from "react";
import { NICHE_META } from "@william/core";
import { api } from "../api";

interface SourcingRun {
  id: string;
  location: string;
  niche: string;
  status: string;
  target: number;
  candidateCap: number;
  candidatesIngested: number;
  qualifiedCount: number;
  resultNote: string | null;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  pending_approval: "amber",
  running: "blue",
  completed: "green",
  stopped_cap: "muted",
  stopped_exhausted: "muted",
  failed: "red",
};

const FIRST_NICHE = Object.keys(NICHE_META)[0] ?? "barbershop";

export function SourcingPage() {
  const [runs, setRuns] = useState<SourcingRun[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [form, setForm] = useState({
    location: "",
    niche: FIRST_NICHE,
    target: 5,
    candidateCap: 40,
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    api<SourcingRun[]>("/api/sourcing-runs")
      .then((rows) => setRuns(Array.isArray(rows) ? rows : []))
      .catch((err) => setError(err instanceof Error ? err.message : "failed to load runs"));
  }, []);
  useEffect(refresh, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    setError("");
    try {
      const payload = batchMode
        ? { location: form.location.trim(), mode: "batch", candidateCap: form.candidateCap }
        : { location: form.location.trim(), niche: form.niche, target: form.target, candidateCap: form.candidateCap };
      await api("/api/sourcing-runs", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessage(
        "Sourcing run created — grant the ACTIVATE_NEW_LEAD_SOURCE approval in the Review Queue to start it."
      );
      setForm({ ...form, location: "" });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    }
  };

  return (
    <>
      <h2>Source leads</h2>
      <p className="sub">
        Pick a city and niche — William searches Google Places for local businesses, audits each one,
        and stops when the qualified target is reached (or the candidate cap is hit). After creating a
        run, grant the <strong>ACTIVATE_NEW_LEAD_SOURCE</strong> approval in the{" "}
        <a href="/review-queue">Review Queue</a> to start it.
      </p>

      <div className="panel">
        <h3>New sourcing run</h3>
        <form className="toolbar" onSubmit={submit}>
          <input
            required
            placeholder="City, ST (e.g. Austin, TX)"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            style={{ minWidth: 200 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={batchMode}
              onChange={(e) => setBatchMode(e.target.checked)}
            />
            <span>Batch (sweep all niches)</span>
          </label>
          {!batchMode && (
            <>
              <select
                value={form.niche}
                onChange={(e) => setForm({ ...form, niche: e.target.value })}
              >
                {Object.entries(NICHE_META).map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="sub">Target qualified:</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  style={{ width: 70 }}
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: Number(e.target.value) })}
                />
              </label>
            </>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="sub">Candidate cap:</span>
            <input
              type="number"
              min={1}
              max={200}
              style={{ width: 70 }}
              value={form.candidateCap}
              onChange={(e) => setForm({ ...form, candidateCap: Number(e.target.value) })}
            />
          </label>
          <button className="primary" type="submit">
            Create run
          </button>
        </form>
        {message && (
          <p className="sub" style={{ color: "var(--green, green)", marginTop: 8 }}>
            {message}
          </p>
        )}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="panel">
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Sourcing runs</h3>
          <button onClick={refresh}>Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Location</th>
              <th>Niche</th>
              <th>Status</th>
              <th>Qualified / Target</th>
              <th>Candidates audited</th>
              <th>Note</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{r.location}</td>
                <td>{NICHE_META[r.niche as keyof typeof NICHE_META]?.label ?? r.niche}</td>
                <td>
                  <span className={`badge ${STATUS_COLOR[r.status] ?? ""}`}>{r.status}</span>
                </td>
                <td>
                  {r.qualifiedCount} / {r.target}
                </td>
                <td>{r.candidatesIngested}</td>
                <td>{r.resultNote ?? <span className="sub">—</span>}</td>
                <td>{new Date(r.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={7} className="empty">
                  No sourcing runs yet — create one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
