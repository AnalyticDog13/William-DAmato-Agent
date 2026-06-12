/**
 * Curated design-reference catalogue William consults when selecting layouts,
 * components, and motion patterns for preview sites and landing pages.
 *
 * Usage rules:
 * - These are INSPIRATION sources: study patterns, never copy assets or
 *   markup wholesale. Licenses must be checked before any component reuse.
 * - Owner-provided repos/sites/transcripts flow in via the
 *   transcript-ingestion adapter and become DurableLessons (topic: design).
 */

export interface DesignReference {
  id: string;
  name: string;
  url: string;
  kind: "component_catalogue" | "design_gallery" | "motion_library" | "agent_inspiration" | "experimental";
  useFor: string[];
  notes: string;
}

export const DESIGN_REFERENCES: DesignReference[] = [
  {
    id: "refero",
    name: "Refero Design",
    url: "https://style.refero.design",
    kind: "design_gallery",
    useFor: ["real-product page layouts", "niche landing-page research", "typography and spacing patterns"],
    notes: "Search by page type (pricing, landing, menu) to ground template revisions in proven layouts.",
  },
  {
    id: "aceternity",
    name: "Aceternity UI",
    url: "https://ui.aceternity.com",
    kind: "component_catalogue",
    useFor: ["hero sections", "3D scroll animations", "marquee/spotlight effects", "React + Framer Motion components"],
    notes: "React/Tailwind/Framer Motion components; strongest source for high-impact animated heroes.",
  },
  {
    id: "componentry",
    name: "Componentry",
    url: "https://componentry.fun/docs",
    kind: "component_catalogue",
    useFor: ["composable UI primitives", "documented component APIs"],
    notes: "Check docs for accessible component patterns before hand-rolling.",
  },
  {
    id: "manus",
    name: "Manus",
    url: "https://manus.im",
    kind: "agent_inspiration",
    useFor: ["agent UX patterns", "progress/loading states for async work", "task-timeline presentation"],
    notes: "Reference for how agentic products present long-running work — informs the dashboard too.",
  },
  {
    id: "dotmatrix",
    name: "dotmatrix (zzzzshawn)",
    url: "https://dotmatrix.zzzzshawn.dev",
    kind: "experimental",
    useFor: ["dot-matrix/ASCII visual effects", "distinctive texture treatments"],
    notes: "Sparing use: one signature effect per site maximum; verify performance on mobile.",
  },
  {
    id: "twentyfirst",
    name: "21st.dev",
    url: "https://21st.dev",
    kind: "component_catalogue",
    useFor: ["community React components", "landing-page sections", "CTA blocks"],
    notes: "Broad catalogue for section-level inspiration across niches.",
  },
];

/**
 * Motion & stack principles applied to every generated site.
 * Phase A previews are static HTML (CSS transform/opacity only). Phase D full
 * builds target React + Framer Motion per these rules (STACK_MODE config).
 */
export const DESIGN_PRINCIPLES: string[] = [
  "Mobile-first; every section must work at 360px before desktop polish.",
  "Animate transform and opacity only; never animate layout properties.",
  "All motion respects prefers-reduced-motion; content readable with JS disabled.",
  "3D scroll animations (perspective/scroll-driven) reserved for hero + one feature section; must hit 60fps on mid-range mobile.",
  "Framer Motion for React builds: useScroll/useTransform for scroll effects, layout animations off by default.",
  "Tasteful progress/loading states whenever real async work occurs.",
  "Conversion first: a contact CTA reachable within one viewport at all times.",
  "Performance budget: Lighthouse performance >= 90 on previews; no heavy dependencies without explicit justification.",
];

export function referencesFor(useCase: string): DesignReference[] {
  const q = useCase.toLowerCase();
  return DESIGN_REFERENCES.filter((r) =>
    r.useFor.some((u) => u.toLowerCase().includes(q)) || r.notes.toLowerCase().includes(q),
  );
}
