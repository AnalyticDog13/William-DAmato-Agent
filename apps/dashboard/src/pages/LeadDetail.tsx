import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";

interface Timeline {
  lead: { id: string; domain: string | null; websiteUrl: string | null; niche: string; status: string };
  company: { name: string; city: string | null } | null;
  contacts: { email: string | null; verification: string; emailSource: string | null; confidence: number }[];
  audits: { id: string; summary: string; auditScore: number; weaknesses: { category: string; detail: string; severity: string }[]; outreachAngles: string[]; a11yFindings: string[]; lighthouse: { performance: number | null; accessibility: number | null; bestPractices: number | null; seo: number | null } | null; pages: { url: string; screenshotPath: string | null; mobileScreenshotPath: string | null }[]; visualAssessment: { visualOpportunityScore: number; verdict: string; confidence: number; findings: { category: string; detail: string; severity: string }[]; positives: string[]; model: string } | null }[];
  scores: { score: number; tier: string; reasons: string[] }[];
  drafts: { id: string; status: string; subject: string; body: string }[];
  activity: { id: string; kind: string; message: string; createdAt: string; byApproval: boolean }[];
}

/** Screenshots need auth headers, so fetch as blob → object URL instead of a direct img src. */
function Screenshot({ leadId, path, label }: { leadId: string; path: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const file = path.split(/[\\/]/).pop();
    if (!file) return;
    let objectUrl: string | null = null;
    fetch(`${import.meta.env.VITE_API_BASE ?? "http://localhost:4000"}/api/screenshots/${leadId}/${file}`, {
      headers: { authorization: `Bearer ${localStorage.getItem("william_token") ?? ""}` },
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) {
          objectUrl = URL.createObjectURL(b);
          setSrc(objectUrl);
        }
      });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [leadId, path]);
  if (!src) return null;
  return (
    <figure style={{ margin: 0 }}>
      <img src={src} alt={label} style={{ maxWidth: "100%", border: "1px solid #333", borderRadius: 4 }} />
      <figcaption className="sub">{label}</figcaption>
    </figure>
  );
}

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Timeline | null>(null);
  // The lead's pending first-touch email approval, if any — so it can be approved
  // right here. Routes through the SAME SEND_FIRST_TOUCH gate + send screening as
  // the Review Queue / Leads page; this is just another place to click it.
  const [emailApproval, setEmailApproval] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadApproval = () =>
    api<{ items: { id: string; leadId: string | null }[] }>("/api/review-queue").then((r) =>
      setEmailApproval(r.items.find((a) => a.leadId === id) ?? null),
    );

  useEffect(() => {
    if (!id) return;
    api<Timeline>(`/api/leads/${id}/timeline`).then(setT);
    loadApproval();
  }, [id]);

  const reload = () => {
    if (!id) return;
    api<Timeline>(`/api/leads/${id}/timeline`).then(setT);
    loadApproval();
  };

  const decideEmail = async (decision: "granted" | "rejected") => {
    if (!emailApproval) return;
    setBusy(true);
    try {
      await api(`/api/approvals/${emailApproval.id}/decide`, { method: "POST", body: JSON.stringify({ decision, note: "" }) });
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (!t) return <p>Loading…</p>;
  const audit = t.audits[0];
  const score = t.scores[0];

  return (
    <>
      <h2>{t.company?.name ?? t.lead.domain ?? t.lead.id}</h2>
      <p className="sub">
        <span className="badge blue">{t.lead.niche}</span> <span className="badge amber">{t.lead.status}</span>{" "}
        {t.lead.websiteUrl && <a href={t.lead.websiteUrl} target="_blank" rel="noreferrer">current site ↗</a>}
        {t.company?.city && <> · {t.company.city}</>}
      </p>

      {score && (
        <div className="panel">
          <h3>Lead score: {score.score}/100 ({score.tier})</h3>
          <details>
            <summary>Why this score</summary>
            <ul>{score.reasons.map((r, i) => <li key={i} className="mono">{r}</li>)}</ul>
          </details>
        </div>
      )}

      <div className="panel">
        <h3>Contact</h3>
        {t.contacts.length === 0 ? (
          <p className="sub">No contact email found — lead is not contactable (disqualified unless an email is discovered).</p>
        ) : (
          <ul>
            {t.contacts.map((c, i) => (
              <li key={i}>
                <span className="mono">{c.email ?? "(none)"}</span>{" "}
                <span className="badge blue">{c.emailSource ?? "unknown source"}</span>{" "}
                <span className={`badge ${c.verification === "valid" ? "green" : c.verification === "risky" ? "amber" : "red"}`}>{c.verification}</span>{" "}
                <span className="sub">confidence {(c.confidence * 100).toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h3>Current site — audit findings</h3>
        {audit ? (
          <>
            <p>{audit.summary}</p>
            <p className="sub">Audit score: {audit.auditScore}/100</p>
            <ul>
              {audit.weaknesses.map((w, i) => (
                <li key={i}><span className={`badge ${w.severity === "high" ? "red" : w.severity === "medium" ? "amber" : "muted"}`}>{w.category}</span> {w.detail}</li>
              ))}
            </ul>
            {audit.lighthouse && (
              <p className="sub">
                Lighthouse: perf {audit.lighthouse.performance ?? "–"} · a11y {audit.lighthouse.accessibility ?? "–"} · bp {audit.lighthouse.bestPractices ?? "–"} · seo {audit.lighthouse.seo ?? "–"}
              </p>
            )}
            {audit.a11yFindings.length > 0 && (
              <details>
                <summary>{audit.a11yFindings.length} accessibility violation(s) (axe-core)</summary>
                <ul>{audit.a11yFindings.map((f, i) => <li key={i} className="mono">{f}</li>)}</ul>
              </details>
            )}
            {audit.pages[0]?.screenshotPath && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <Screenshot leadId={t.lead.id} path={audit.pages[0].screenshotPath} label="Desktop" />
                {audit.pages[0].mobileScreenshotPath && (
                  <Screenshot leadId={t.lead.id} path={audit.pages[0].mobileScreenshotPath} label="Mobile" />
                )}
              </div>
            )}
            {audit.visualAssessment && (
              <>
                <h3 style={{ marginTop: 12 }}>Visual assessment</h3>
                <p className="sub">
                  <span className={`badge ${audit.visualAssessment.verdict === "weak" ? "red" : audit.visualAssessment.verdict === "adequate" ? "amber" : "green"}`}>{audit.visualAssessment.verdict}</span>{" "}
                  opportunity {audit.visualAssessment.visualOpportunityScore}/100 · confidence {(audit.visualAssessment.confidence * 100).toFixed(0)}% · <span className="mono">{audit.visualAssessment.model}</span>
                </p>
                {audit.visualAssessment.findings.length > 0 && (
                  <ul>
                    {audit.visualAssessment.findings.map((f, i) => (
                      <li key={i}><span className={`badge ${f.severity === "high" ? "red" : f.severity === "medium" ? "amber" : "muted"}`}>{f.category}</span> {f.detail}</li>
                    ))}
                  </ul>
                )}
                {audit.visualAssessment.positives.length > 0 && (
                  <p className="sub">Positives: {audit.visualAssessment.positives.join("; ")}</p>
                )}
              </>
            )}
            {audit.outreachAngles.length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>Outreach angles</h3>
                <ul>{audit.outreachAngles.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </>
            )}
          </>
        ) : (
          <div className="empty">No audit yet.</div>
        )}
      </div>

      {t.drafts.length > 0 && (
        <div className="panel">
          <h3>Outreach drafts</h3>
          {emailApproval && (
            <div className="toolbar" style={{ marginBottom: 8, alignItems: "center" }}>
              <span className="badge amber">email awaiting your approval</span>
              <button className="approve" disabled={busy} onClick={() => decideEmail("granted")}>
                Approve &amp; send
              </button>
              <button className="reject" disabled={busy} onClick={() => decideEmail("rejected")}>
                Reject
              </button>
            </div>
          )}
          {t.drafts.map((d) => (
            <details key={d.id} open={d.status === "pending_approval"}>
              <summary><span className="badge amber">{d.status}</span> {d.subject}</summary>
              <pre className="report">{d.body}</pre>
            </details>
          ))}
        </div>
      )}

      <div className="panel">
        <h3>Activity timeline</h3>
        <ul className="timeline">
          {t.activity.map((a) => (
            <li key={a.id} className={a.byApproval ? "approval" : a.kind === "owner_notification" ? "notify" : ""}>
              <div className="when">{new Date(a.createdAt).toLocaleString()} · {a.byApproval ? "owner-approved" : "automatic"}</div>
              <strong>{a.kind}</strong>: {a.message}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
