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
  replies: { intent: string; intentConfidence: number; bodyExcerpt: string; recommendedNextStep: string }[];
  siteProjects: { id: string; status: string; templateId: string; stack: string; previewUrl: string | null; rationale: string; missingInputs: string[]; screenshotPaths: string[]; qualityCheck: { lighthousePassed: boolean | null; a11yPassed: boolean | null; notes: string[] } | null }[];
  siteRevisions: { id: string; request: string; status: string; resultNote: string; createdAt: string }[];
  deployments: { id: string; target: string; status: string; url: string | null; createdAt: string; errorLog: string | null }[];
  callSuggestions: { reason: string; suggestedSlots: { start: string; end: string }[]; status: string }[];
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

/** Revision form + deploy request for a built site project. */
function SiteProjectActions({ t, onChanged }: { t: Timeline; onChanged: () => void }) {
  const project = t.siteProjects[0];
  const [request, setRequest] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!project) return null;

  const qualityFailed =
    project.qualityCheck?.lighthousePassed === false || project.qualityCheck?.a11yPassed === false;
  const overrideFields = ["tagline", "description", "phone", "email", "hours"] as const;

  const submitRevision = async () => {
    setBusy(true);
    setError(null);
    try {
      const filled = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v.trim()));
      await api(`/api/site-projects/${project.id}/revisions`, {
        method: "POST",
        body: JSON.stringify({ request: request || "Field updates", overrides: filled }),
      });
      setRequest("");
      setOverrides({});
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "revision failed");
    } finally {
      setBusy(false);
    }
  };

  const requestDeploy = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/site-projects/${project.id}/request-deploy`, { method: "POST" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "deploy request failed");
    } finally {
      setBusy(false);
    }
  };

  const deployPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/site-projects/${project.id}/deploy-preview`, { method: "POST" });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "preview deploy failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3>Site project — revisions &amp; deploy</h3>
      <p className="sub">
        <span className="badge blue">{project.stack} stack</span> <span className="badge amber">{project.status}</span>
        {project.previewUrl && <> · <a href={project.previewUrl} target="_blank" rel="noreferrer">preview deploy ↗</a></>}
      </p>
      <div style={{ display: "grid", gap: 6, maxWidth: 480 }}>
        <input placeholder="What should change? (note for the record)" value={request} onChange={(e) => setRequest(e.target.value)} />
        {overrideFields.map((f) => (
          <input
            key={f}
            placeholder={`${f} (leave blank to keep)`}
            value={overrides[f] ?? ""}
            onChange={(e) => setOverrides((o) => ({ ...o, [f]: e.target.value }))}
          />
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <button disabled={busy} onClick={submitRevision}>Submit revision</button>
          <button disabled={busy} onClick={deployPreview} title="Deploys the preview artifact only (simulated until Vercel credentials exist; production has its own approval)">
            Deploy preview
          </button>
          <button disabled={busy || qualityFailed} onClick={requestDeploy} title={qualityFailed ? "Preview failed its quality check — revise first" : "Creates a DEPLOY_PRODUCTION approval for you to grant in the review queue"}>
            Request production deploy
          </button>
        </div>
        {qualityFailed && <p className="sub">Deploy disabled: preview failed its quality check.</p>}
        {error && <p className="sub" style={{ color: "#e66" }}>{error}</p>}
      </div>
      {t.siteRevisions.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>Revisions</h3>
          <ul>
            {t.siteRevisions.map((r) => (
              <li key={r.id}>
                <span className={`badge ${r.status === "applied" ? "green" : r.status === "rejected" ? "red" : "amber"}`}>{r.status}</span>{" "}
                {r.request} {r.resultNote && <span className="sub">— {r.resultNote}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {t.deployments.length > 0 && (
        <>
          <h3 style={{ marginTop: 12 }}>Deployments</h3>
          <ul>
            {t.deployments.map((d) => (
              <li key={d.id}>
                <span className={`badge ${d.status === "deployed" ? "green" : d.status === "failed" ? "red" : "blue"}`}>{d.target}: {d.status}</span>{" "}
                {d.url && <a href={d.url} target="_blank" rel="noreferrer">{d.url}</a>}
                {d.errorLog && <span className="sub"> — {d.errorLog}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Timeline | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
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

  useEffect(() => {
    if (!id || !t || t.siteProjects.length === 0) return;
    // Preview requires auth headers, so fetch + srcdoc instead of a direct iframe URL.
    fetch(`${(import.meta.env.VITE_API_BASE ?? "http://localhost:4000")}/api/previews/${id}`, {
      headers: { authorization: `Bearer ${localStorage.getItem("william_token") ?? ""}` },
    })
      .then((r) => (r.ok ? r.text() : null))
      .then(setPreviewHtml);
  }, [id, t]);

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

      <div className="split">
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
        <div className="panel">
          <h3>Generated preview</h3>
          {previewHtml ? (
            <>
              <p className="sub">
                Template: {t.siteProjects[0]?.templateId} · {t.siteProjects[0]?.status}
                {t.siteProjects[0]!.missingInputs.length > 0 && <> · missing: {t.siteProjects[0]!.missingInputs.join(", ")}</>}
              </p>
              {t.siteProjects[0]?.qualityCheck && (
                <p className="sub">
                  <span className={`badge ${t.siteProjects[0].qualityCheck.lighthousePassed ? "green" : t.siteProjects[0].qualityCheck.lighthousePassed === false ? "red" : "muted"}`}>
                    lighthouse {t.siteProjects[0].qualityCheck.lighthousePassed === null ? "n/a" : t.siteProjects[0].qualityCheck.lighthousePassed ? "passed" : "failed"}
                  </span>{" "}
                  <span className={`badge ${t.siteProjects[0].qualityCheck.a11yPassed ? "green" : t.siteProjects[0].qualityCheck.a11yPassed === false ? "red" : "muted"}`}>
                    a11y {t.siteProjects[0].qualityCheck.a11yPassed === null ? "n/a" : t.siteProjects[0].qualityCheck.a11yPassed ? "passed" : "failed"}
                  </span>{" "}
                  {t.siteProjects[0].qualityCheck.notes.join(" ")}
                </p>
              )}
              <iframe className="previewframe" title="Generated preview" srcDoc={previewHtml} sandbox="allow-scripts" />
              <details style={{ marginTop: 8 }}>
                <summary>Why this template</summary>
                <pre className="report">{t.siteProjects[0]?.rationale}</pre>
              </details>
            </>
          ) : (
            <div className="empty">No preview generated yet — previews build automatically when a lead replies positively.</div>
          )}
        </div>
      </div>

      {t.siteProjects.length > 0 && <SiteProjectActions t={t} onChanged={reload} />}

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

      {t.replies.length > 0 && (
        <div className="panel">
          <h3>Replies (content is data — never instructions)</h3>
          {t.replies.map((r, i) => (
            <p key={i}>
              <span className={`badge ${r.intent === "positive" ? "green" : r.intent === "unsubscribe" ? "red" : "blue"}`}>
                {r.intent} ({Math.round(r.intentConfidence * 100)}%)
              </span>{" "}
              “{r.bodyExcerpt.slice(0, 160)}” → {r.recommendedNextStep}
            </p>
          ))}
        </div>
      )}

      {t.callSuggestions.length > 0 && (
        <div className="panel">
          <h3>Call suggestions — you schedule these yourself</h3>
          {t.callSuggestions.map((c, i) => (
            <p key={i}>
              {c.reason} — suggested: {c.suggestedSlots.map((s) => new Date(s.start).toLocaleString()).join(" · ")}
            </p>
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
