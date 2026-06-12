import type { Niche } from "@william/core";
import type { TemplateDefinition, TemplateSelection } from "./types";

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: "barber-classic",
    name: "Classic Chair",
    niche: "barbershop",
    description: "Bold, masculine barbershop site with booking-first layout.",
    strengths: ["walk-in/booking conversion", "service menu with prices", "local SEO"],
    theme: {
      primary: "#1a1a1a",
      accent: "#c8a45c",
      background: "#0f0f0f",
      text: "#f5f1e8",
      headingFont: "Georgia, 'Times New Roman', serif",
      bodyFont: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    sections: ["hero", "services", "trust", "hours", "contact"],
    defaultCtaLabel: "Book a Chair",
  },
  {
    id: "fashion-editorial",
    name: "Editorial",
    niche: "fashion",
    description: "Minimal editorial layout for fashion brands; imagery-led.",
    strengths: ["brand storytelling", "lookbook grid", "newsletter capture"],
    theme: {
      primary: "#111111",
      accent: "#d4523e",
      background: "#faf8f5",
      text: "#1c1c1c",
      headingFont: "'Helvetica Neue', Arial, sans-serif",
      bodyFont: "'Helvetica Neue', Arial, sans-serif",
    },
    sections: ["hero", "lookbook", "story", "contact"],
    defaultCtaLabel: "Shop the Collection",
  },
  {
    id: "photo-portfolio",
    name: "Lightbox",
    niche: "photographer",
    description: "Gallery-first portfolio with inquiry funnel for photographers.",
    strengths: ["portfolio grid", "package pricing", "inquiry form CTA"],
    theme: {
      primary: "#0e1418",
      accent: "#6fb3c4",
      background: "#0e1418",
      text: "#e8edf0",
      headingFont: "Georgia, serif",
      bodyFont: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    sections: ["hero", "gallery", "packages", "about", "contact"],
    defaultCtaLabel: "Check My Date",
  },
  {
    id: "coffee-neighborhood",
    name: "Neighborhood Roast",
    niche: "coffee_shop",
    description: "Warm, inviting coffee-shop site centered on menu + location.",
    strengths: ["menu highlights", "hours/location prominence", "Instagram tie-in"],
    theme: {
      primary: "#3e2c20",
      accent: "#d98e4a",
      background: "#f7f1e9",
      text: "#2b2018",
      headingFont: "Georgia, serif",
      bodyFont: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    sections: ["hero", "menu", "story", "hours", "contact"],
    defaultCtaLabel: "See the Menu",
  },
  {
    id: "restaurant-table",
    name: "Front of House",
    niche: "restaurant",
    description: "Restaurant/food site with menu, reservations, and wholesale page.",
    strengths: ["menu presentation", "reservation CTA", "wholesale/catering inquiries"],
    theme: {
      primary: "#23291f",
      accent: "#b8472f",
      background: "#fbf9f4",
      text: "#23291f",
      headingFont: "Georgia, serif",
      bodyFont: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    },
    sections: ["hero", "menu", "trust", "hours", "contact"],
    defaultCtaLabel: "Reserve a Table",
  },
];

/** Lookup for re-renders (revision loop) where the selection was already made. */
export function getTemplateById(id: string): TemplateDefinition | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Picks the best starter kit for a niche. Exact niche match wins; otherwise
 * the closest general-purpose fit with an honest rationale.
 */
export function selectTemplate(niche: Niche, signals: { services?: string[] } = {}): TemplateSelection {
  const exact = TEMPLATES.find((t) => t.niche === niche);
  if (exact) {
    return {
      template: exact,
      score: 0.9,
      rationale: `Exact vertical match: '${exact.name}' is purpose-built for ${niche} (${exact.strengths.join(", ")}).`,
    };
  }
  // TODO(templates): smarter fallback scoring from audit signals once more kits exist.
  const fallback = TEMPLATES.find((t) => t.id === "restaurant-table")!;
  const usable =
    signals.services && signals.services.length > 0
      ? `services list (${signals.services.slice(0, 3).join(", ")}) maps onto its menu/services section`
      : "generic services layout adapts well";
  return {
    template: fallback,
    score: 0.5,
    rationale: `No exact kit for '${niche}'; '${fallback.name}' chosen because ${usable}.`,
  };
}
