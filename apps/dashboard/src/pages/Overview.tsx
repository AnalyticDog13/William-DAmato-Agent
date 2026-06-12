import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

interface OverviewData {
  metrics: Record<string, number>;
  env: string;
  dryRun: boolean;
  pendingApprovals: { id: string; gate: string; title: string }[];
  openOwnerRequests: { id: string; title: string; category: string }[];
  recentActivity: { id: string; leadId: string; kind: string; message: string; createdAt: string; byApproval: boolean }[];
}

export function Overview() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [report, setReport] = useState<string | null>(null);
  useEffect(() => {
    api<OverviewData>("/api/overview").then(setData);
  }, []);
  if (!data) return <p>Loading…</p>;
  const m = data.metrics;

  return (
    <>
      <h2>Overview</h2>
      <p className="sub">
        Environment: <span className={`badge ${data.env === "production" ? "red" : "blue"}`}>{data.env}</span>{" "}
        {data.dryRun && <span className="badge amber">DRY RUN — no external side effects</span>}
      </p>
      <div className="cards">
        {[
          ["Leads", m.leadsTotal],
          ["Contacted", m.leadsContacted],
          ["Reply rate", `${m.replyRate}%`],
          ["Positive rate", `${m.positiveReplyRate}%`],
          ["Bounce rate", `${m.bounceRate}%`],
          ["Opportunities", m.opportunities],
          ["Previews built", m.previewsBuilt],
          ["Pending approvals", m.approvalsPending],
        ].map(([label, value]) => (
          <div className="card" key={label as string}>
            <div className="label">{label}</div>
            <div className="value">{value as never}</div>
          </div>
        ))}
      </div>

      <div className="split">
        <div className="panel">
          <h3>Waiting on you</h3>
          {data.pendingApprovals.length === 0 && data.openOwnerRequests.length === 0 && (
            <div className="empty">Nothing pending. William is working within approved bounds.</div>
          )}
          {data.pendingApprovals.map((a) => (
            <p key={a.id}>
              <span className="badge amber">{a.gate}</span> {a.title} — <Link to="/review-queue">review</Link>
            </p>
          ))}
          {data.openOwnerRequests.map((r) => (
            <p key={r.id}>
              <span className="badge blue">{r.category}</span> {r.title} — <Link to="/owner-requests">details</Link>
            </p>
          ))}
        </div>
        <div className="panel">
          <h3>Recent activity (automatic vs approved)</h3>
          <ul className="timeline">
            {data.recentActivity.map((a) => (
              <li key={a.id} className={a.byApproval ? "approval" : a.kind === "owner_notification" ? "notify" : ""}>
                <div className="when">{new Date(a.createdAt).toLocaleString()} · {a.byApproval ? "owner-approved" : "automatic"}</div>
                <Link to={`/leads/${a.leadId}`}>{a.kind}</Link>: {a.message}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel">
        <h3>Daily report</h3>
        {report ? (
          <pre className="report">{report}</pre>
        ) : (
          <button onClick={() => api<{ reportText: string }>("/api/reports/daily").then((r) => setReport(r.reportText))}>
            Generate today's report
          </button>
        )}
      </div>
    </>
  );
}
