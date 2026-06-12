import type { Logger } from "@william/core";
import { hmacSignatureValid } from "../mocks";
import type { InstantlyAdapter } from "../types";
import { callJson, failure, requireTicket, simulatedReal, type RealDeps } from "./shared";

const API = "https://api.instantly.ai/api/v2";

export function createInstantlyAdapter(deps: RealDeps, log: Logger): InstantlyAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const call = (method: string, path: string, body?: Record<string, unknown>) =>
    callJson(fetchImpl, `${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${deps.env.INSTANTLY_API_KEY}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  return {
    name: "instantly",

    async pushLead(ticket, input) {
      requireTicket(ticket, "instantly.pushLead");
      if (ticket.dryRun) {
        return simulatedReal("instantly", "pushLead", `email=${input.email}`, "inst");
      }
      const res = await call("POST", "/leads", {
        email: input.email,
        first_name: input.firstName,
        company_name: input.companyName,
        campaign: input.campaignId ?? deps.env.INSTANTLY_CAMPAIGN_ID,
        custom_variables: input.customVariables,
      });
      if (!res.ok) return failure("instantly.pushLead", res.status, res.text);
      log.info("instantly lead pushed", { id: res.body.id, traceId: ticket.traceId });
      return {
        dryRun: false,
        ok: true,
        externalId: String(res.body.id),
        detail: `Instantly lead created for ${input.email}`,
      };
    },

    async pauseLead(ticket, externalLeadId) {
      requireTicket(ticket, "instantly.pauseLead");
      if (ticket.dryRun) {
        return simulatedReal("instantly", "pauseLead", `lead=${externalLeadId}`, "inst");
      }
      // TODO(phase-c): verify the per-lead pause endpoint against Instantly v2
      // docs once the API key arrives. Remote pause failing is logged but NOT
      // load-bearing for compliance: DNC/unsubscribe screening at draft and at
      // send is what guarantees we never contact an opted-out lead.
      const res = await call("POST", `/leads/${encodeURIComponent(externalLeadId)}/pause`);
      if (!res.ok) return failure("instantly.pauseLead", res.status, res.text);
      return { dryRun: false, ok: true, externalId: externalLeadId, detail: `Instantly lead ${externalLeadId} paused` };
    },

    // Instantly signs webhooks with a plain HMAC-SHA256 hex digest of the body.
    verifyWebhookSignature: hmacSignatureValid,
  };
}
