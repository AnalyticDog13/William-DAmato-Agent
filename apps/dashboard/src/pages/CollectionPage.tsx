import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

export interface Section {
  title: string;
  collection: string;
  columns: string[];
  ownerRequestActions?: boolean;
}

function Cell({ value, column }: { value: unknown; column: string }) {
  if (value == null) return <span className="sub">—</span>;
  if (column === "leadId") return <Link to={`/leads/${String(value)}`}>{String(value).slice(-8)}</Link>;
  if (typeof value === "boolean") return <span className={`badge ${value ? "green" : "red"}`}>{String(value)}</span>;
  if (column === "status" || column === "intent" || column === "mode" || column === "kind")
    return <span className="badge blue">{String(value)}</span>;
  if (Array.isArray(value))
    return <span>{value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join("; ").slice(0, 200)}</span>;
  if (typeof value === "object") return <span className="mono">{JSON.stringify(value).slice(0, 120)}</span>;
  return <span>{String(value).slice(0, 240)}</span>;
}

function SectionTable({ section }: { section: Section }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState("");
  const refresh = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    api<{ items: Record<string, unknown>[] }>(`/api/collections/${section.collection}?${params}`).then((r) =>
      setItems(r.items),
    );
  }, [search, section.collection]);
  useEffect(refresh, [refresh]);

  const setRequestStatus = async (id: string, status: string) => {
    await api(`/api/owner-requests/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
    refresh();
  };

  return (
    <div className="panel">
      <h3>{section.title}</h3>
      <div className="toolbar">
        <input type="search" placeholder={`Search ${section.collection}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
        <button onClick={refresh}>Refresh</button>
      </div>
      <table>
        <thead>
          <tr>
            {section.columns.map((c) => <th key={c}>{c}</th>)}
            <th>created</th>
            {section.ownerRequestActions && <th>actions</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={String(item.id)}>
              {section.columns.map((c) => (
                <td key={c}><Cell value={item[c]} column={c} /></td>
              ))}
              <td className="sub">{item.createdAt ? new Date(String(item.createdAt)).toLocaleDateString() : "—"}</td>
              {section.ownerRequestActions && (
                <td>
                  {item.status === "open" && (
                    <span className="toolbar">
                      <button className="approve" onClick={() => setRequestStatus(String(item.id), "fulfilled")}>Fulfilled</button>
                      <button onClick={() => setRequestStatus(String(item.id), "dismissed")}>Dismiss</button>
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
          {items.length === 0 && (
            <tr><td colSpan={section.columns.length + 2} className="empty">Nothing here yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function CollectionPage({ title, sections }: { title: string; sections: Section[] }) {
  return (
    <>
      <h2>{title}</h2>
      <p className="sub">Searchable view over the runtime database.</p>
      {sections.map((s) => <SectionTable key={s.collection} section={s} />)}
    </>
  );
}
