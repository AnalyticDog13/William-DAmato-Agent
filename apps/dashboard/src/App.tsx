import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, clearToken, getToken, setToken } from "./api";
import { Overview } from "./pages/Overview";
import { ReviewQueue } from "./pages/ReviewQueue";
import { LeadsPage } from "./pages/LeadsPage";
import { LeadDetail } from "./pages/LeadDetail";
import { Policies } from "./pages/Policies";
import { SourcingPage } from "./pages/SourcingPage";
import { CollectionPage, type Section } from "./pages/CollectionPage";

interface NavEntry {
  path: string;
  label: string;
  sections?: Section[];
  group?: string;
  /** Site Projects shows a "builder disabled" banner while WILLIAM_BUILDS_WEBSITES is off. */
  builderGated?: boolean;
}

const NAV: NavEntry[] = [
  { path: "/", label: "Overview" },
  { path: "/review-queue", label: "Review Queue" },
  { path: "/leads", label: "Leads", group: "Pipeline" },
  { path: "/sourcing", label: "Source leads", group: "Pipeline" },
  { path: "/audits", label: "Audits", sections: [{ title: "Website Audits", collection: "audits", columns: ["leadId", "mode", "auditScore", "summary"] }] },
  { path: "/outreach", label: "Outreach", sections: [
    { title: "Drafts", collection: "outreach-drafts", columns: ["leadId", "status", "subject", "variant"] },
    { title: "Campaign Syncs", collection: "campaign-syncs", columns: ["leadId", "status", "detail"] },
  ] },
  { path: "/failures", label: "Failures / Logs", sections: [
    { title: "Failures", collection: "failures", columns: ["category", "message", "leadId", "retryable"] },
    { title: "Audit Log (every sensitive action)", collection: "audit-log", columns: ["actor", "action", "outcome", "detail"] },
    { title: "Compliance Events", collection: "compliance-events", columns: ["kind", "detail"] },
    { title: "Webhook Events", collection: "webhook-events", columns: ["provider", "eventType", "signatureValid"] },
  ] },
  { path: "/owner-requests", label: "Owner Requests", group: "Control", sections: [{ title: "Owner Requests", collection: "owner-requests", columns: ["status", "title", "whyItMatters", "neededFields", "unblocks"], ownerRequestActions: true }] },
  { path: "/integrations", label: "Integrations", sections: [{ title: "Credential Status", collection: "integrations", columns: ["integration", "mode", "healthy", "detail", "lastCheckedAt"] }] },
  { path: "/policies", label: "Settings / Policies" },
];

function Login({ onAuthed }: { onAuthed: () => void }) {
  const [token, setTokenInput] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="login">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setToken(token.trim());
          try {
            await api("/api/overview");
            onAuthed();
          } catch {
            clearToken();
            setError("Invalid token — check OWNER_API_TOKEN (local default: dev-owner-token).");
          }
        }}
      >
        <h1>William D'Amato — Control Plane</h1>
        <p className="sub">Owner access only. Authorization is enforced server-side on every request.</p>
        <input
          type="password"
          placeholder="Owner API token"
          value={token}
          onChange={(e) => setTokenInput(e.target.value)}
          autoFocus
        />
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">Sign in</button>
      </form>
    </div>
  );
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!getToken()) {
      setAuthed(false);
      return;
    }
    api("/api/overview").then(() => setAuthed(true)).catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="login"><p>Connecting…</p></div>;
  if (!authed) return <Login onAuthed={() => setAuthed(true)} />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>
          William D'Amato
          <small>agentic sales &amp; delivery</small>
        </h1>
        <nav>
          {NAV.map((entry) => (
            <span key={entry.path}>
              {entry.group && <div className="group">{entry.group}</div>}
              <NavLink to={entry.path} end={entry.path === "/"} className={({ isActive }) => (isActive ? "active" : "")}>
                {entry.label}
              </NavLink>
            </span>
          ))}
        </nav>
        <div style={{ marginTop: 20, padding: "0 10px" }}>
          <button onClick={() => { clearToken(); location.reload(); }}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/review-queue" element={<ReviewQueue />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/:id" element={<LeadDetail />} />
          <Route path="/policies" element={<Policies />} />
          <Route path="/sourcing" element={<SourcingPage />} />
          {NAV.filter((n) => n.sections).map((n) => (
            <Route key={n.path} path={n.path} element={<CollectionPage title={n.label} sections={n.sections!} builderGated={n.builderGated} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
