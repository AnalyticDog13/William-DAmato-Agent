import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

interface Approval {
  id: string;
  gate: string;
  title: string;
  detail: string;
  leadId: string | null;
  createdAt: string;
}

export function ReviewQueue() {
  const [items, setItems] = useState<Approval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(() => {
    api<{ items: Approval[] }>("/api/review-queue").then((r) => setItems(r.items));
  }, []);
  useEffect(refresh, [refresh]);

  const decide = async (id: string, decision: "granted" | "rejected") => {
    setBusy(id);
    try {
      await api(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision, note: "" }) });
      refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <h2>Review Queue</h2>
      <p className="sub">High-risk actions stop here. Nothing customer-facing happens without your one-click decision.</p>
      {items.length === 0 && <div className="panel empty">Queue is empty — no approvals pending.</div>}
      {items.map((a) => (
        <div className="panel" key={a.id}>
          <h3>
            <span className="badge amber">{a.gate}</span> {a.title}
          </h3>
          <p className="sub">
            Requested {new Date(a.createdAt).toLocaleString()}
            {a.leadId && <> · <Link to={`/leads/${a.leadId}`}>lead timeline</Link></>}
          </p>
          <details>
            <summary>Full details</summary>
            <pre className="report">{a.detail}</pre>
          </details>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="approve" disabled={busy === a.id} onClick={() => decide(a.id, "granted")}>
              Approve
            </button>
            <button className="reject" disabled={busy === a.id} onClick={() => decide(a.id, "rejected")}>
              Reject
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
