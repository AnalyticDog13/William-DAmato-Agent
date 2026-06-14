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

function bullet(items: string[], fallback: string): string {
  return items.length ? items.map((i) => `- ${i}`).join("\n") : `- ${fallback}`;
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

  const buildPrompt = [
    `# Build prompt — ${input.companyName} (${input.niche})`,
    "",
    `Build a brand-new marketing website for **${input.companyName}**, a ${input.niche}.` +
      (input.websiteUrl ? ` It replaces their current site (${input.websiteUrl}).` : ""),
    "",
    "## Non-negotiable quality bar",
    "- Make it **awwward-winning worthy**: bold, modern, memorable art direction with tasteful, performant motion.",
    "- It MUST be **mobile-friendly, fully interactive, and fully working on mobile** — design mobile-first, test every",
    "  interaction (nav, animations, forms, 3D/scroll effects) on small touch screens, and never ship a layout that",
    "  breaks or a control that is unusable on a phone.",
    "- Fast: lazy-load heavy assets, respect `prefers-reduced-motion`, keep Lighthouse performance and accessibility high.",
    "",
    "## Recommended stack",
    `- Libraries: ${stack.libs.join(", ")}`,
    `- Plugins/helpers: ${stack.plugins.join(", ")}`,
    "",
    "## Fix these weaknesses from the audit of their current site",
    bullet(input.weaknesses, "General modernization — the current site looks dated and converts poorly."),
    "",
    "## Use these REAL business facts (do not invent details; quote/transform only what is given)",
    `- Services: ${f.services.length ? f.services.join(", ") : "(none captured — ask the owner before inventing)"}`,
    `- About: ${f.about || "(none captured)"}`,
    `- Hours: ${f.hours || "(none captured)"}`,
    `- Contact: ${contactLines.length ? contactLines.join(", ") : "(none captured)"}`,
    "",
    "## Sections to include",
    "- Hero with a clear single call-to-action above the fold",
    "- Services, an about/story section, social proof/trust, a gallery, and a prominent contact/booking section",
    "",
    "Deliver a complete, deployable project (a git repo). The site owner will review it and ship it.",
  ].join("\n");

  return { buildPrompt, recommendedStack: stack, generatedBy: "mock" };
}
