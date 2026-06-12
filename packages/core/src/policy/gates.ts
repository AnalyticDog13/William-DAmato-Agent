import type { PolicyGateName } from "../schema/approval";

export interface GateDefinition {
  gate: PolicyGateName;
  description: string;
  risk: "high" | "critical";
  /** Whether this gate may EVER run without a per-action approval (requires master autonomy + production). */
  allowAutopilot: boolean;
}

export const GATE_DEFINITIONS: Record<PolicyGateName, GateDefinition> = {
  SEND_FIRST_TOUCH: {
    gate: "SEND_FIRST_TOUCH",
    description: "Send a first-touch outreach email to a lead (directly or via Instantly).",
    risk: "high",
    allowAutopilot: true,
  },
  ACTIVATE_NEW_LEAD_SOURCE: {
    gate: "ACTIVATE_NEW_LEAD_SOURCE",
    description: "Turn on a new lead-discovery data source (e.g. Google Maps query batch).",
    risk: "high",
    allowAutopilot: false,
  },
  ENABLE_SOCIAL_SOURCE: {
    gate: "ENABLE_SOCIAL_SOURCE",
    description: "Enable a social-media-derived data source.",
    risk: "high",
    allowAutopilot: false,
  },
  SEND_PAYMENT_REQUEST: {
    gate: "SEND_PAYMENT_REQUEST",
    description: "Send a live Stripe payment link or invoice to a customer.",
    risk: "critical",
    allowAutopilot: true,
  },
  DEPLOY_PRODUCTION: {
    gate: "DEPLOY_PRODUCTION",
    description: "Deploy a site project to a production domain.",
    risk: "critical",
    allowAutopilot: true,
  },
  UPDATE_LIVE_COPY: {
    gate: "UPDATE_LIVE_COPY",
    description: "Change copy/content on an already-live customer site.",
    risk: "high",
    allowAutopilot: true,
  },
  CHANGE_COMPLIANCE_TEXT: {
    gate: "CHANGE_COMPLIANCE_TEXT",
    description: "Modify unsubscribe/opt-out/compliance wording anywhere.",
    risk: "critical",
    allowAutopilot: false,
  },
  ENABLE_FULL_AUTONOMY: {
    gate: "ENABLE_FULL_AUTONOMY",
    description: "Master switch allowing autopilot-mode gates to run without per-action approval.",
    risk: "critical",
    allowAutopilot: false,
  },
};
