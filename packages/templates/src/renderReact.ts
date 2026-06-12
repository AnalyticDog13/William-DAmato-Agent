import type { CompanyData, TemplateDefinition } from "./types";

export interface GeneratedFile {
  /** posix-relative path inside the project, e.g. "src/App.tsx" */
  file: string;
  data: string;
}

/**
 * Renders a complete Vite + React + Framer Motion project (STACK_MODE=react).
 * Mirrors the static preview's sections — header, hero, services, trust,
 * contact — with transform/opacity-only motion and useReducedMotion respected.
 * Company data is embedded as JSON (never interpolated into JSX source), so
 * scraped content cannot inject code into the generated project.
 */
export function renderReactProject(template: TemplateDefinition, data: CompanyData): GeneratedFile[] {
  const t = template.theme;
  const site = {
    name: data.name,
    tagline: data.tagline ?? "",
    description: data.description ?? "",
    phone: data.phone ?? null,
    email: data.email ?? null,
    address: [data.address, data.city].filter(Boolean).join(", ") || null,
    hours: data.hours ?? null,
    services: (data.services ?? []).slice(0, 6),
    trustSignals: (data.trustSignals ?? []).slice(0, 3),
    ctaLabel: template.defaultCtaLabel,
  };

  return [
    {
      file: "package.json",
      data: JSON.stringify(
        {
          name: slugify(data.name) || "preview-site",
          private: true,
          type: "module",
          scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
          dependencies: { react: "^18.3.1", "react-dom": "^18.3.1", "framer-motion": "^11.2.0" },
          devDependencies: { vite: "^5.4.0", "@vitejs/plugin-react": "^4.3.0" },
        },
        null,
        2,
      ) + "\n",
    },
    {
      file: "vite.config.ts",
      data: `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [react()] });
`,
    },
    {
      file: "index.html",
      data: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(data.name)}</title>
    <meta name="description" content="${escapeHtml(site.description || site.tagline || data.name)}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    },
    {
      file: "src/main.tsx",
      data: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
    },
    {
      file: "src/App.tsx",
      data: `import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

const SITE = ${JSON.stringify(site, null, 2)} as const;

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  if (reduced) return <div>{children}</div>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

export default function App() {
  return (
    <>
      <a className="cta floating" href="#contact">{SITE.ctaLabel}</a>
      <header className="site">
        <div className="wrap">
          <a className="brand" href="#top">{SITE.name}</a>
          <nav aria-label="Primary">
            <a className="cta" href="#contact">{SITE.ctaLabel}</a>
          </nav>
        </div>
      </header>
      <main id="top">
        <div className="hero wrap">
          <Reveal><h1>{SITE.name}</h1></Reveal>
          <Reveal delay={0.1}><p>{SITE.tagline || SITE.description}</p></Reveal>
          <Reveal delay={0.2}><a className="cta" href="#contact">{SITE.ctaLabel}</a></Reveal>
        </div>
        {SITE.services.length > 0 && (
          <section aria-labelledby="services-h">
            <div className="wrap">
              <h2 id="services-h">What we offer</h2>
              <div className="grid">
                {SITE.services.map((s, i) => (
                  <Reveal key={s} delay={i * 0.06}><div className="card"><h3>{s}</h3></div></Reveal>
                ))}
              </div>
            </div>
          </section>
        )}
        {SITE.trustSignals.length > 0 && (
          <section aria-labelledby="trust-h">
            <div className="wrap">
              <h2 id="trust-h">Why people choose us</h2>
              <div className="grid">
                {SITE.trustSignals.map((s, i) => (
                  <Reveal key={s} delay={i * 0.06}><blockquote className="card">{s}</blockquote></Reveal>
                ))}
              </div>
            </div>
          </section>
        )}
        <section id="contact" aria-labelledby="contact-h">
          <div className="wrap">
            <h2 id="contact-h">Get in touch</h2>
            <ul className="contact-list">
              {SITE.phone && <li>📞 <a href={"tel:" + SITE.phone.replace(/[^+\\d]/g, "")}>{SITE.phone}</a></li>}
              {SITE.email && <li>✉️ <a href={"mailto:" + SITE.email}>{SITE.email}</a></li>}
              {SITE.address && <li>📍 {SITE.address}</li>}
              {SITE.hours && <li>🕒 {SITE.hours}</li>}
            </ul>
          </div>
        </section>
      </main>
      <footer>
        <div className="wrap">© {new Date().getFullYear()} {SITE.name}. Website by William D'Amato.</div>
      </footer>
    </>
  );
}
`,
    },
    {
      file: "src/styles.css",
      data: `:root {
  --primary: ${t.primary}; --accent: ${t.accent};
  --bg: ${t.background}; --text: ${t.text};
}
* { box-sizing: border-box; margin: 0; }
body {
  font-family: ${t.bodyFont};
  background: var(--bg); color: var(--text);
  line-height: 1.6; -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { font-family: ${t.headingFont}; line-height: 1.15; }
a { color: var(--accent); }
.wrap { max-width: 64rem; margin: 0 auto; padding: 0 1.25rem; }
header.site {
  position: sticky; top: 0; z-index: 10;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
}
header.site .wrap { display: flex; align-items: center; justify-content: space-between; padding: .85rem 1.25rem; }
.brand { font-family: ${t.headingFont}; font-size: 1.15rem; font-weight: 700; color: var(--text); text-decoration: none; }
.cta {
  display: inline-block; background: var(--accent); color: var(--bg);
  padding: .65rem 1.3rem; border-radius: 999px; text-decoration: none; font-weight: 600;
  transition: transform .18s ease, opacity .18s ease;
}
.cta:hover { transform: translateY(-2px); }
.cta:focus-visible { outline: 3px solid var(--text); outline-offset: 2px; }
.cta.floating { position: fixed; right: 1rem; bottom: 1rem; z-index: 20; }
.hero { padding: 5.5rem 0 4.5rem; }
.hero h1 { font-size: clamp(2.1rem, 6vw, 3.6rem); max-width: 22ch; }
.hero p { font-size: 1.15rem; margin: 1.1rem 0 1.8rem; max-width: 48ch; opacity: .85; }
section { padding: 3.25rem 0; }
section h2 { font-size: 1.6rem; margin-bottom: 1.25rem; color: var(--accent); }
.grid { display: grid; gap: 1rem; grid-template-columns: 1fr; }
@media (min-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 900px) { .grid { grid-template-columns: repeat(3, 1fr); } }
.card {
  border: 1px solid color-mix(in srgb, var(--text) 14%, transparent);
  border-radius: .75rem; padding: 1.1rem 1.2rem;
  background: color-mix(in srgb, var(--text) 4%, transparent);
}
@media (prefers-reduced-motion: reduce) { .cta { transition: none; } }
footer { padding: 2.5rem 0 3rem; border-top: 1px solid color-mix(in srgb, var(--text) 12%, transparent); font-size: .92rem; opacity: .8; }
.contact-list { list-style: none; padding: 0; display: grid; gap: .4rem; }
`,
    },
  ];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 52);
}
