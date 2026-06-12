import type { CompanyData, TemplateDefinition } from "./types";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Renders a complete, self-contained preview site (single HTML file).
 * Mobile-first, semantic, no external dependencies, transform/opacity-only
 * animations with prefers-reduced-motion respected, SEO + a11y basics, and a
 * persistent contact CTA. Real multi-page builds come from the site-builder
 * worker in Phase D; this is the preview artifact shown to the owner.
 */
export function renderPreviewSite(template: TemplateDefinition, data: CompanyData): string {
  const t = template.theme;
  const name = esc(data.name);
  const tagline = esc(data.tagline ?? defaultTagline(template, data));
  const description = esc(data.description ?? `${data.name} — ${tagline}`);
  const services = (data.services ?? []).slice(0, 6);
  const trust = (data.trustSignals ?? []).slice(0, 3);
  const phone = data.phone ? esc(data.phone) : null;
  const email = data.email ? esc(data.email) : null;
  const address = [data.address, data.city].filter(Boolean).join(", ");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name} — ${tagline}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${name}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<style>
  :root {
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
  .reveal { opacity: 0; transform: translateY(14px); transition: opacity .5s ease, transform .5s ease; }
  .reveal.in { opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) {
    .reveal { opacity: 1; transform: none; transition: none; }
    .cta { transition: none; }
  }
  footer { padding: 2.5rem 0 3rem; border-top: 1px solid color-mix(in srgb, var(--text) 12%, transparent); font-size: .92rem; opacity: .8; }
  .contact-list { list-style: none; padding: 0; display: grid; gap: .4rem; }
</style>
</head>
<body>
<a class="cta" href="#contact" style="position:fixed;right:1rem;bottom:1rem;z-index:20">${esc(template.defaultCtaLabel)}</a>
<header class="site">
  <div class="wrap">
    <a class="brand" href="#top">${name}</a>
    <nav aria-label="Primary">
      <a class="cta" href="#contact">${esc(template.defaultCtaLabel)}</a>
    </nav>
  </div>
</header>
<main id="top">
  <div class="hero wrap">
    <h1 class="reveal">${name}</h1>
    <p class="reveal">${tagline}</p>
    <a class="cta reveal" href="#contact">${esc(template.defaultCtaLabel)}</a>
  </div>
${
  services.length
    ? `  <section aria-labelledby="services-h">
    <div class="wrap">
      <h2 id="services-h">What we offer</h2>
      <div class="grid">
        ${services.map((s) => `<div class="card reveal"><h3>${esc(s)}</h3></div>`).join("\n        ")}
      </div>
    </div>
  </section>`
    : ""
}
${
  trust.length
    ? `  <section aria-labelledby="trust-h">
    <div class="wrap">
      <h2 id="trust-h">Why people choose us</h2>
      <div class="grid">
        ${trust.map((s) => `<blockquote class="card reveal">${esc(s)}</blockquote>`).join("\n        ")}
      </div>
    </div>
  </section>`
    : ""
}
  <section id="contact" aria-labelledby="contact-h">
    <div class="wrap">
      <h2 id="contact-h">Get in touch</h2>
      <ul class="contact-list">
        ${phone ? `<li>📞 <a href="tel:${phone.replace(/[^+\d]/g, "")}">${phone}</a></li>` : ""}
        ${email ? `<li>✉️ <a href="mailto:${email}">${email}</a></li>` : ""}
        ${address ? `<li>📍 ${esc(address)}</li>` : ""}
        ${data.hours ? `<li>🕒 ${esc(data.hours)}</li>` : ""}
      </ul>
    </div>
  </section>
</main>
<footer>
  <div class="wrap">© ${new Date().getFullYear()} ${name}. Website preview by William D'Amato.</div>
</footer>
<script>
  // Progressive enhancement only: reveal-on-scroll via opacity/transform.
  const els = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { threshold: 0.15 });
    els.forEach((el) => io.observe(el));
  } else {
    els.forEach((el) => el.classList.add("in"));
  }
</script>
</body>
</html>`;
}

function defaultTagline(template: TemplateDefinition, data: CompanyData): string {
  const city = data.city ? ` in ${data.city}` : "";
  switch (template.niche) {
    case "barbershop":
      return `Sharp cuts, honest prices${city}.`;
    case "fashion":
      return `Pieces that say it for you.`;
    case "photographer":
      return `Moments, kept${city}.`;
    case "coffee_shop":
      return `Your neighborhood coffee stop${city}.`;
    case "restaurant":
      return `Good food, done right${city}.`;
    default:
      return `Quality you can count on${city}.`;
  }
}
