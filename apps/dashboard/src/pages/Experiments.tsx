import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

interface Experiment {
  id: string;
  name: string;
  hypothesis: string;
  dimension: string;
  variants: string[];
  status: string;
  conclusion: string;
}

interface ExperimentResult {
  id: string;
  experimentId: string;
  variant: string;
  metric: string;
  value: number;
  sampleSize: number;
}

const DIMENSIONS = ["outreach_variant", "niche", "template", "lead_source", "other"];
// Must match FIRST_TOUCH_VARIANTS in workers/outreach (server validates anyway).
const DEFAULT_VARIANTS = "v1-cornell-mockup, v2-finding-first";

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [dimension, setDimension] = useState("outreach_variant");
  const [variants, setVariants] = useState(DEFAULT_VARIANTS);
  const [error, setError] = useState("");

  return (
    <div className="panel">
      <h3>Start an experiment</h3>
      <p className="sub">
        outreach_variant experiments steer first-touch copy: each new lead is deterministically assigned one
        of the variants. Every draft still goes through the Review Queue.
      </p>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await api("/api/experiments", {
              method: "POST",
              body: JSON.stringify({
                name,
                hypothesis,
                dimension,
                variants: variants.split(",").map((v) => v.trim()).filter(Boolean),
              }),
            });
            setName("");
            setHypothesis("");
            onCreated();
          } catch (err) {
            setError(err instanceof Error ? err.message : "create failed");
          }
        }}
      >
        <input placeholder="Name (e.g. First-touch copy A/B)" value={name} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Hypothesis (what do you expect to win, and why?)" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} />
        <select value={dimension} onChange={(e) => setDimension(e.target.value)}>
          {DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input placeholder="Variants, comma-separated" value={variants} onChange={(e) => setVariants(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">Start (status: running)</button>
      </form>
    </div>
  );
}

function ExperimentRow({ experiment, results, onChanged }: { experiment: Experiment; results: ExperimentResult[]; onChanged: () => void }) {
  const [conclusion, setConclusion] = useState("");
  const [error, setError] = useState("");
  const conclude = async (status: "concluded" | "abandoned") => {
    setError("");
    try {
      await api(`/api/experiments/${experiment.id}/conclude`, { method: "POST", body: JSON.stringify({ status, conclusion }) });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "conclude failed");
    }
  };
  const compute = async () => {
    await api(`/api/experiments/${experiment.id}/compute`, { method: "POST" });
    onChanged();
  };
  const mine = results.filter((r) => r.experimentId === experiment.id);
  return (
    <div className="panel">
      <h3>
        {experiment.name} <span className={`badge ${experiment.status === "running" ? "green" : "blue"}`}>{experiment.status}</span>
      </h3>
      <p className="sub">{experiment.hypothesis} — dimension: {experiment.dimension}; variants: {experiment.variants.join(", ")}</p>
      {experiment.conclusion && <p><strong>Conclusion:</strong> {experiment.conclusion}</p>}
      {mine.length > 0 && (
        <table>
          <thead>
            <tr><th>variant</th><th>metric</th><th>value</th><th>sample</th></tr>
          </thead>
          <tbody>
            {mine.map((r) => (
              <tr key={r.id}>
                <td>{r.variant}</td>
                <td>{r.metric}</td>
                <td>{r.value}</td>
                <td className="sub">{r.sampleSize}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {experiment.status === "running" && (
        <div className="toolbar">
          <button onClick={compute}>Recompute results</button>
          <input placeholder="Conclusion note (required to close)" value={conclusion} onChange={(e) => setConclusion(e.target.value)} />
          <button className="approve" onClick={() => conclude("concluded")}>Conclude</button>
          <button onClick={() => conclude("abandoned")}>Abandon</button>
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

export function Experiments() {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [results, setResults] = useState<ExperimentResult[]>([]);
  const refresh = useCallback(() => {
    api<{ items: Experiment[] }>("/api/collections/experiments").then((r) => setExperiments(r.items));
    api<{ items: ExperimentResult[] }>("/api/collections/experiment-results?limit=500").then((r) => setResults(r.items));
  }, []);
  useEffect(refresh, [refresh]);

  return (
    <>
      <h2>Experiments</h2>
      <p className="sub">Structured A/B tests. Results recompute from sent drafts and replies; weekly reports fold findings in automatically.</p>
      <CreateForm onCreated={refresh} />
      {experiments.map((e) => <ExperimentRow key={e.id} experiment={e} results={results} onChanged={refresh} />)}
      {experiments.length === 0 && <div className="panel"><p className="empty">No experiments yet.</p></div>}
    </>
  );
}
