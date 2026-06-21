import type { Niche } from "./schema/common";

export interface NicheMeta {
  /** Human label for the dashboard. */
  label: string;
  /** Plural noun used to build the Places text query, e.g. "med spas". */
  searchTerm: string;
  /** Plain-language outreach hook ("I help <niche> ..."). */
  outreachHook: string;
}

/** Single source of truth for niche labels, Places search terms, and outreach hooks.
 *  `Record<Niche, ...>` makes this exhaustive — a new Niche won't compile without metadata. */
export const NICHE_META: Record<Niche, NicheMeta> = {
  barbershop: { label: "Barbershop", searchTerm: "barbershops", outreachHook: "I help barbershops get found and booked online" },
  fashion: { label: "Fashion brand", searchTerm: "fashion boutiques", outreachHook: "I help fashion brands look as sharp online as their pieces do" },
  photographer: { label: "Photographer", searchTerm: "photographers", outreachHook: "I help photographers turn portfolios into inquiries" },
  coffee_shop: { label: "Coffee shop", searchTerm: "coffee shops", outreachHook: "I help coffee shops turn foot traffic into regulars" },
  restaurant: { label: "Restaurant", searchTerm: "restaurants", outreachHook: "I help restaurants fill more tables from search" },
  med_spa: { label: "Med spa", searchTerm: "med spas", outreachHook: "I help med spas turn website visitors into booked treatments" },
  dental: { label: "Dental practice", searchTerm: "dentists", outreachHook: "I help dental practices win new patients online" },
  chiropractor: { label: "Chiropractor", searchTerm: "chiropractors", outreachHook: "I help chiropractors get more new-patient bookings" },
  law_firm: { label: "Law firm", searchTerm: "law firms", outreachHook: "I help law firms turn searches into consultations" },
  real_estate: { label: "Real estate", searchTerm: "real estate agents", outreachHook: "I help real estate agents turn listings into leads" },
  hvac: { label: "HVAC", searchTerm: "HVAC companies", outreachHook: "I help HVAC companies book more service calls online" },
  plumbing: { label: "Plumber", searchTerm: "plumbers", outreachHook: "I help plumbers get found and called first" },
  electrician: { label: "Electrician", searchTerm: "electricians", outreachHook: "I help electricians turn searches into jobs" },
  landscaping: { label: "Landscaping", searchTerm: "landscapers", outreachHook: "I help landscapers book more seasonal work online" },
  gym: { label: "Gym / fitness", searchTerm: "gyms", outreachHook: "I help gyms turn website visitors into members" },
  yoga_pilates: { label: "Yoga / Pilates", searchTerm: "yoga and pilates studios", outreachHook: "I help studios fill more classes from search" },
  hair_salon: { label: "Hair salon", searchTerm: "hair salons", outreachHook: "I help hair salons get found and booked online" },
  nail_salon: { label: "Nail salon", searchTerm: "nail salons", outreachHook: "I help nail salons turn searches into bookings" },
  day_spa: { label: "Day spa", searchTerm: "day spas", outreachHook: "I help spas turn website visits into bookings" },
  auto_repair: { label: "Auto repair", searchTerm: "auto repair shops", outreachHook: "I help auto shops get found and booked online" },
  roofing: { label: "Roofing", searchTerm: "roofing companies", outreachHook: "I help roofers turn searches into estimates" },
  painter: { label: "Painter", searchTerm: "painting contractors", outreachHook: "I help painters book more jobs from their website" },
  cleaning: { label: "Cleaning service", searchTerm: "cleaning services", outreachHook: "I help cleaning services turn searches into recurring clients" },
  veterinary: { label: "Veterinary", searchTerm: "veterinary clinics", outreachHook: "I help vet clinics win new clients online" },
  accounting: { label: "Accounting / CPA", searchTerm: "accountants", outreachHook: "I help accounting firms turn searches into clients" },
  insurance: { label: "Insurance agency", searchTerm: "insurance agencies", outreachHook: "I help insurance agencies turn searches into quotes" },
  pest_control: { label: "Pest control", searchTerm: "pest control companies", outreachHook: "I help pest control companies book more jobs online" },
  bakery: { label: "Bakery", searchTerm: "bakeries", outreachHook: "I help bakeries turn foot traffic and search into orders" },
  florist: { label: "Florist", searchTerm: "florists", outreachHook: "I help florists turn online searches into orders" },
  jeweler: { label: "Jeweler", searchTerm: "jewelers", outreachHook: "I help jewelers turn online interest into visits" },
  optometry: { label: "Optometry", searchTerm: "optometrists", outreachHook: "I help eye-care practices win new patients online" },
  dermatology: { label: "Dermatology", searchTerm: "dermatology clinics", outreachHook: "I help dermatology clinics turn searches into appointments" },
  physical_therapy: { label: "Physical therapy", searchTerm: "physical therapy clinics", outreachHook: "I help PT clinics get more new-patient bookings" },
  tattoo: { label: "Tattoo studio", searchTerm: "tattoo studios", outreachHook: "I help tattoo studios turn their portfolio into bookings" },
  event_venue: { label: "Event venue", searchTerm: "event venues", outreachHook: "I help event venues turn searches into tours and bookings" },
  interior_design: { label: "Interior design", searchTerm: "interior designers", outreachHook: "I help interior designers turn their portfolio into inquiries" },
  daycare: { label: "Daycare / preschool", searchTerm: "daycares", outreachHook: "I help daycares turn searches into enrollments" },
  pet_grooming: { label: "Pet grooming", searchTerm: "pet groomers", outreachHook: "I help pet groomers get found and booked online" },
  other: { label: "Other local business", searchTerm: "local businesses", outreachHook: "I help local businesses win more customers online" },
};

/** Places text query, e.g. nicheSearchQuery("med_spa", "Austin, TX") => "med spas in Austin, TX". */
export function nicheSearchQuery(niche: Niche, location: string): string {
  return `${NICHE_META[niche].searchTerm} in ${location}`;
}
