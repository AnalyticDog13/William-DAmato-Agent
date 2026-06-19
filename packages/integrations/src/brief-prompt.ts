import { CompanyFacts } from "@william/core";
import type { BuildPromptRequest, BuildPromptResult, CompanyScrapeHints } from "./types";

/**
 * Deterministic, network-free brief building blocks. Shared by the MOCK adapters
 * and the REAL adapters' dry-run path, so local/demo behavior is identical with
 * or without API keys.
 *
 * INVARIANT 1: company facts, audit weaknesses, and the lead's site content are
 * QUOTED MATERIAL the build prompt asks the owner's model to transform. They are
 * never treated as instructions. The mock does no LLM call at all (pure string
 * templating); the real adapter must keep the same quoted-material framing.
 */

/** Synthesize plausible CompanyFacts from audit-derived hints (no network). */
export function synthesizeCompanyFacts(url: string, hints: CompanyScrapeHints = {}): CompanyFacts {
  return CompanyFacts.parse({
    services: hints.services ?? [],
    hours: null,
    photos: [],
    about: hints.about ?? (hints.companyName ? `${hints.companyName} — ${hints.niche ?? "local business"} at ${url}.` : ""),
    contact: {
      email: hints.contactEmails?.[0] ?? null,
      phone: hints.phones?.[0] ?? null,
      address: null,
    },
  });
}

/** The recommended modern, animation-forward stack for an award-worthy build. */
export function recommendedStack(): BuildPromptResult["recommendedStack"] {
  return {
    libs: ["React + Vite", "Three.js", "GSAP", "Framer Motion"],
    plugins: ["@react-three/fiber + drei (3D)", "Lenis (smooth scroll)", "split-type (kinetic text)"],
  };
}

/**
 * Build the full build prompt the owner pastes into Fable 5 / Opus 4.8. This is
 * the deterministic mock output (also the real adapter's dry-run output).
 */
export function templateBuildPrompt(input: BuildPromptRequest): BuildPromptResult {
  const stack = recommendedStack();
  const f = input.companyFacts;
  const contactLines = [
    f.contact.email ? `email ${f.contact.email}` : null,
    f.contact.phone ? `phone ${f.contact.phone}` : null,
    f.contact.address ? `address ${f.contact.address}` : null,
  ].filter(Boolean) as string[];

  const contactLine = contactLines.length ? contactLines.join(", ") : "(none captured — ask the owner)";
  const buildPrompt = [
    `Build a new, **awwward-winning-worthy** marketing website for **${input.companyName}** (a ${input.niche})` +
      (input.websiteUrl ? `, replacing ${input.websiteUrl}` : "") +
      ". It must be mobile-first and fully working/interactive on mobile, and fast (lazy-load heavy assets, respect " +
      "`prefers-reduced-motion`), with graceful **loading** states — skeleton/placeholder base layers and loading " +
      "spinners before content/assets are ready, ZERO layout shift, plus clear empty and error states. Make use of " +
      "**React**, **Framer** Motion, **Figma**, and **frontend-design**; animate with **GSAP** (scroll/timeline) and " +
      "**Three.js** (`@react-three/fiber` for 3D/WebGL); generate the hero/gallery imagery with **Higgsfield** so it " +
      "is bespoke and on-brand, not stock.",
    "",
    "Ship a REAL working **backend** (Next.js API routes/server actions, or Node/Express + Postgres/SQLite) for every " +
      "interactive feature (contact, booking/lead capture, newsletter): server-side validation, spam protection, " +
      "persistence, and an owner notification on submit — not a static mockup. Cover basic **SEO**: semantic HTML + " +
      "heading hierarchy, a unique per-page `<title>` and **meta description**, Open Graph/Twitter tags, descriptive " +
      "image alt text, `sitemap.xml` + `robots.txt`, and JSON-LD `LocalBusiness` structured data. Use ONLY these real " +
      `facts (do not invent details): services ${f.services.length ? f.services.join(", ") : "(none — ask the owner)"}; ` +
      `about ${f.about || "(none — ask the owner)"}; hours ${f.hours || "(none — ask the owner)"}; contact ${contactLine}. ` +
      `Fix the audit weaknesses: ${input.weaknesses.length ? input.weaknesses.join("; ") : "general modernization"}.`,
    "",
    "Before delivery, review your work with **Chrome DevTools**: run Lighthouse (high Performance/Accessibility/" +
      "Best-Practices/SEO), use the Performance panel to remove long tasks/jank, ship a Console free of errors, and " +
      "test mobile device emulation with throttled network — confirm the skeletons/spinners, animations, and backend " +
      "forms all work. Deliver a complete, deployable git repo. Recommended stack: " +
      `${stack.libs.join(", ")} (plugins: ${stack.plugins.join(", ")}).\ndo not use superpowers`,
  ].join("\n");

  return { buildPrompt, recommendedStack: stack, generatedBy: "mock" };
}
