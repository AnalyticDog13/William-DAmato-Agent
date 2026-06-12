import type { Niche } from "@william/core";

export interface TemplateDefinition {
  id: string;
  name: string;
  niche: Niche;
  description: string;
  /** What this template optimizes for; used in selection rationale. */
  strengths: string[];
  theme: {
    primary: string;
    accent: string;
    background: string;
    text: string;
    headingFont: string;
    bodyFont: string;
  };
  sections: string[];
  defaultCtaLabel: string;
}

/** Structured company data a template is rendered from. */
export interface CompanyData {
  name: string;
  niche: Niche;
  tagline?: string;
  description?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  services?: string[];
  socialLinks?: Record<string, string>;
  hours?: string;
  trustSignals?: string[];
}

export interface TemplateSelection {
  template: TemplateDefinition;
  score: number;
  rationale: string;
}
