import { pathToFileURL } from "node:url";
import { newId, nowIso } from "@william/core";
import { ingestLead, type LeadInput } from "./pipelines";
import { ensureBootstrapOwnerRequests } from "./ownerRequests";
import { createContext, type AppContext } from "./context";

const now = nowIso();
const src = (detail: string): LeadInput["source"] => ({
  kind: "manual",
  detail,
  importedAt: now,
  importedBy: "owner",
});

export const DEMO_LEADS: LeadInput[] = [
  { companyName: "Fade Factory Barbershop", niche: "barbershop", city: "Ithaca", phone: "+1-607-555-0141", websiteUrl: null, source: src("demo seed — no website") },
  { companyName: "Collegetown Cuts", niche: "barbershop", city: "Ithaca", websiteUrl: "http://collegetowncuts.example.com", source: src("demo seed") },
  { companyName: "Gimme Beans Coffee", niche: "coffee_shop", city: "Ithaca", websiteUrl: "https://gimmebeans.example.com", source: src("demo seed") },
  { companyName: "Luna Threads", niche: "fashion", city: "Brooklyn", websiteUrl: "https://lunathreads.example.com", source: src("demo seed") },
  { companyName: "Sarah Reyes Photography", niche: "photographer", city: "Syracuse", websiteUrl: "http://sarahreyesphoto.example.com", source: src("demo seed") },
  { companyName: "Taverna Roma", niche: "restaurant", city: "Ithaca", websiteUrl: "https://tavernaroma.example.com", email: "ciao@tavernaroma.example.com", source: src("demo seed — published email") },
  { companyName: "Northside Wholesale Foods", niche: "restaurant", city: "Albany", websiteUrl: "https://northsidewholesale.example.com", source: src("demo seed") },
  { companyName: "Stone & Co Barbers", niche: "barbershop", city: "Binghamton", websiteUrl: "https://stoneandco.example.com", source: src("demo seed") },
];

export interface SeedSummary {
  created: number;
  duplicates: number;
  blocked: number;
}

/** Seeds demo data: a DNC record, an unsubscribe, and 8 leads across niches. */
export function seedDemoData(ctx: AppContext): SeedSummary {
  ensureBootstrapOwnerRequests(ctx);

  // Pre-existing compliance records the pipeline must respect.
  ctx.store.doNotContact.insert({
    id: newId("dnc"),
    createdAt: now,
    updatedAt: now,
    identityKey: "company:blocked-barbers@ithaca",
    reason: "Owner met them; asked not to be contacted",
    addedBy: "owner",
  });
  ctx.store.unsubscribes.insert({
    id: newId("unsub"),
    createdAt: now,
    updatedAt: now,
    email: "owner@previouslyunsubscribed.example.com",
    leadId: null,
    source: "manual",
    reason: "Unsubscribed during earlier manual outreach",
  });

  const summary: SeedSummary = { created: 0, duplicates: 0, blocked: 0 };
  const inputs: LeadInput[] = [
    ...DEMO_LEADS,
    // These two exercise dedupe + DNC refusal:
    { companyName: "Fade Factory Barbershop LLC", niche: "barbershop", city: "Ithaca", websiteUrl: null, source: src("demo seed — duplicate test") },
    { companyName: "Blocked Barbers", niche: "barbershop", city: "Ithaca", websiteUrl: null, source: src("demo seed — DNC test") },
  ];
  for (const input of inputs) {
    const result = ingestLead(ctx, input);
    summary[result.outcome === "created" ? "created" : result.outcome === "duplicate" ? "duplicates" : "blocked"]++;
  }
  return summary;
}

// `npm run seed` — seed the persistent database without running the pipeline.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const summary = seedDemoData(createContext());
  console.log(`Seeded: ${summary.created} created, ${summary.duplicates} duplicates, ${summary.blocked} blocked.`);
  console.log(`Run 'npm run worker' to process the queued jobs.`);
}
