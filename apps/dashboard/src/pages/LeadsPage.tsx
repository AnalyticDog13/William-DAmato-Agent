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

const STATUS_COLOR: Record<string, string> = {
  opportunity: "green",
  customer: "green",
  draft_ready: "amber",
  contacted: "blue",
  replied: "blue",
  disqualified: "muted",
  do_not_contact: "red",
};

export function LeadsPage() {
  const [items, setItems] = useState<Lead[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({ companyName: "", websiteUrl: "", niche: "barbershop", city: "", email: "" });
  const [message, setMessage] = useState("");

  const refresh = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    api<{ items: Lead[] }>(`/api/collections/leads?${params}`).then((r) => setItems(r.items));
  }, [search, status]);
  useEffect(refresh, [refresh]);

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
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr><th>Lead</th><th>Niche</th><th>Status</th><th>Source</th><th>Created</th></tr>
          </thead>
          <tbody>
            {items.map((l) => (
              <tr key={l.id}>
                <td><Link to={`/leads/${l.id}`}>{l.domain ?? l.id}</Link></td>
                <td>{l.niche}</td>
                <td><span className={`badge ${STATUS_COLOR[l.status] ?? ""}`}>{l.status}</span></td>
                <td>{l.source.kind} <span className="mono">{l.source.detail}</span></td>
                <td>{new Date(l.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="empty">No leads yet — add one above or POST /api/demo/seed.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
