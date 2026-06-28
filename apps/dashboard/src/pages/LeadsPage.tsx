import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

interface Lead {
  id: string;
  domain: string | null;
  niche: string;
  status: string;
  createdAt: string;
  source: { kind: string; detail: string };
  companyId: string;
}

// Pending email approval (gate SEND_FIRST_TOUCH covers first-touch, follow-ups,
// and delivery). `detail` is "Subject: …\n\n<body>" — the full email, so the
// owner can read and approve it inline without leaving the Leads page.
interface Approval {
  id: string;
  gate: string;
  title: string;
  detail: string;
  leadId: string | null;
  createdAt: string;
}

interface ContactRow { leadId: string; email: string | null; }
interface ScoreRow { leadId: string; score: number; tier: string; }
interface CompanyRow { id: string; name: string; }

const STATUS_COLOR: Record<string, string> = {
  opportunity: "green",
  customer: "green",
  draft_ready: "amber",
  contacted: "blue",
  replied: "blue",
  disqualified: "muted",
  do_not_contact: "red",
};

const TIER_COLOR: Record<string, string> = {
  hot: "green",
  warm: "amber",
  cold: "muted",
  skip: "red",
};

export function LeadsPage() {
  const [items, setItems] = useState<Lead[]>([]);
  const [emailApprovals, setEmailApprovals] = useState<Record<string, Approval>>({});
  // leadId → contact email from the contacts table
  const [contacts, setContacts] = useState<Record<string, string | null>>({});
  // leadId → { score, tier } from lead-scores table
  const [scores, setScores] = useState<Record<string, { score: number; tier: string }>>({});
  // companyId → company name from companies table
  const [companies, setCompanies] = useState<Record<string, string>>({});
  // "review" (default) or "auto" — from /api/overview
  const [pushMode, setPushMode] = useState<"review" | "auto">("review");
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({ companyName: "", websiteUrl: "", niche: "barbershop", city: "", email: "" });
  const [message, setMessage] = useState("");

  const refresh = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    api<{ items: Lead[] }>(`/api/collections/leads?${params}`).then((r) => setItems(r.items));

    // pushMode from overview (also exposes outreachScoreThreshold for future use)
    api<{ pushMode?: "review" | "auto" }>("/api/overview").then((r) =>
      setPushMode(r.pushMode ?? "review"),
    );

    // Pending email approvals, keyed by lead → render inline below.
    api<{ items: Approval[] }>("/api/review-queue").then((r) => {
      const byLead: Record<string, Approval> = {};
      for (const a of r.items) {
        if (a.gate === "SEND_FIRST_TOUCH" && a.leadId && !byLead[a.leadId]) byLead[a.leadId] = a;
      }
      setEmailApprovals(byLead);
    });

    // Contact emails, one per lead (first contact record wins)
    api<{ items: ContactRow[] }>("/api/collections/contacts?limit=200").then((r) => {
      const byLead: Record<string, string | null> = {};
      for (const c of r.items) {
        if (c.leadId && !(c.leadId in byLead)) byLead[c.leadId] = c.email;
      }
      setContacts(byLead);
    });

    // Lead scores, keyed by leadId (latest record used — list is ordered by recency)
    api<{ items: ScoreRow[] }>("/api/collections/lead-scores?limit=200").then((r) => {
      const byLead: Record<string, { score: number; tier: string }> = {};
      for (const s of r.items) {
        if (s.leadId && !(s.leadId in byLead)) byLead[s.leadId] = { score: s.score, tier: s.tier };
      }
      setScores(byLead);
    });

    // Company names, keyed by company id
    api<{ items: CompanyRow[] }>("/api/collections/companies?limit=200").then((r) => {
      const byId: Record<string, string> = {};
      for (const c of r.items) byId[c.id] = c.name;
      setCompanies(byId);
    });
  }, [search, status]);
  useEffect(refresh, [refresh]);

  // Approve/reject the email right here. Granting routes through the SAME
  // /api/approvals/:id/decide endpoint as the Review Queue — the policy gate and
  // send screening are unchanged; this is only a second place to click it.
  const decide = async (id: string, decision: "granted" | "rejected") => {
    setBusy(id);
    try {
      await api(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision, note: "" }) });
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const addLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage("");
    try {
      await api("/api/leads", { method: "POST", body: JSON.stringify(form) });
      setForm({ companyName: "", websiteUrl: "", niche: form.niche, city: "", email: "" });
      setMessage("Lead created — pipeline running (audit → score → contact → draft).");
      refresh();
    } catch (err) {
      setMessage(`Rejected: ${err instanceof Error ? err.message : "error"} (duplicate or do-not-contact)`);
    }
  };

  return (
    <>
      <h2>Leads</h2>
      <p className="sub">Every lead carries source provenance and identity keys for dedupe + do-not-contact screening.</p>

      <div className="panel">
        <h3>Add lead manually</h3>
        <form className="toolbar" onSubmit={addLead}>
          <input required placeholder="Company name" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          <input placeholder="Website URL (optional)" value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} />
          <select value={form.niche} onChange={(e) => setForm({ ...form, niche: e.target.value })}>
            {["barbershop", "fashion", "photographer", "coffee_shop", "restaurant", "other"].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <input placeholder="Email (optional)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <button className="primary" type="submit">Add lead</button>
        </form>
        {message && <p className="sub">{message}</p>}
      </div>

      <div className="toolbar">
        <input type="search" placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {["new", "audited", "scored", "contact_ready", "draft_ready", "contacted", "replied", "opportunity", "customer", "disqualified", "do_not_contact"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={refresh}>Refresh</button>
        {pushMode === "auto" && <span className="badge green">Auto-push ON</span>}
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr><th>Company</th><th>Status</th><th>Score</th><th>Email / outreach</th><th>Source</th><th>Created</th></tr>
          </thead>
          <tbody>
            {items.map((l) => {
              const approval = emailApprovals[l.id];
              const contactEmail = contacts[l.id];
              const score = scores[l.id];
              const companyName = companies[l.companyId] ?? l.domain ?? l.id;
              return (
                <tr key={l.id}>
                  <td><Link to={`/leads/${l.id}`}>{companyName}</Link></td>
                  <td><span className={`badge ${STATUS_COLOR[l.status] ?? ""}`}>{l.status}</span></td>
                  <td>
                    {score ? (
                      <span className={`badge ${TIER_COLOR[score.tier] ?? ""}`}>{score.score} ({score.tier})</span>
                    ) : (
                      <span className="sub">—</span>
                    )}
                  </td>
                  <td>
                    {contactEmail && (
                      <div className="mono" style={{ fontSize: "0.85em", marginBottom: 4 }}>{contactEmail}</div>
                    )}
                    {approval && pushMode !== "auto" ? (
                      <details>
                        <summary><span className="badge amber">email ready</span> review &amp; approve</summary>
                        <pre className="report" style={{ whiteSpace: "pre-wrap" }}>{approval.detail}</pre>
                        <div className="toolbar" style={{ marginTop: 8 }}>
                          <button className="approve" disabled={busy === approval.id} onClick={() => decide(approval.id, "granted")}>
                            Approve &amp; push
                          </button>
                          <button className="reject" disabled={busy === approval.id} onClick={() => decide(approval.id, "rejected")}>
                            Reject
                          </button>
                        </div>
                      </details>
                    ) : approval && pushMode === "auto" ? (
                      <span className="badge blue">queued (auto-push)</span>
                    ) : !contactEmail ? (
                      <span className="sub">—</span>
                    ) : null}
                  </td>
                  <td>{l.source.kind} <span className="mono">{l.source.detail}</span></td>
                  <td>{new Date(l.createdAt).toLocaleDateString()}</td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={6} className="empty">No leads yet — add one above or POST /api/demo/seed.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
