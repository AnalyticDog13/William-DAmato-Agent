import { z } from "zod";

export const IsoDate = z.string().datetime({ offset: true }).or(z.string().datetime());
export const Id = z.string().min(4);

export const Niche = z.enum([
  "barbershop", "fashion", "photographer", "coffee_shop", "restaurant",
  "med_spa", "dental", "chiropractor", "law_firm", "real_estate",
  "hvac", "plumbing", "electrician", "landscaping", "gym",
  "yoga_pilates", "hair_salon", "nail_salon", "day_spa", "auto_repair",
  "roofing", "painter", "cleaning", "veterinary", "accounting",
  "insurance", "pest_control", "bakery", "florist", "jeweler",
  "optometry", "dermatology", "physical_therapy", "tattoo", "event_venue",
  "interior_design", "daycare", "pet_grooming",
  "other",
]);
export type Niche = z.infer<typeof Niche>;

export const LeadSourceKind = z.enum(["csv", "manual", "api", "google_maps", "referral", "other"]);
export type LeadSourceKind = z.infer<typeof LeadSourceKind>;

/** Where a record came from. Required on leads/contacts for compliance. */
export const SourceProvenance = z.object({
  kind: LeadSourceKind,
  detail: z.string().default(""),
  importedAt: IsoDate,
  importedBy: z.enum(["owner", "system"]).default("system"),
});
export type SourceProvenance = z.infer<typeof SourceProvenance>;

export const BaseEntity = z.object({
  id: Id,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type BaseEntity = z.infer<typeof BaseEntity>;

export const Confidence = z.number().min(0).max(1);
