import type { Logger } from "@william/core";
import { hmacSignatureValid } from "../mocks";
import type { InboundEmail, InstantlyAdapter } from "../types";
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

    async pollInbound(ticket, input) {
      requireTicket(ticket, "instantly.pollInbound");
      if (ticket.dryRun) return []; // local always dry-run → zero network
      const limit = input?.limit ?? 100;
      // TODO(activation): confirm exact field names + pagination against the live
      // v2 /emails response when the key first runs in staging (mirrors the
      // pauseLead TODO above). email_type=received = inbound replies/responses;
      // preview_only=false returns the full body text.
      const res = await call("GET", `/emails?email_type=received&preview_only=false&limit=${limit}`);
      if (!res.ok) {
        log.warn("instantly pollInbound failed", { status: res.status, traceId: ticket.traceId });
        return []; // fail-closed: never crash the poll loop
      }
      const body = res.body as { items?: unknown[]; data?: unknown[] } | undefined;
      const items = Array.isArray(body?.items) ? body!.items : Array.isArray(body?.data) ? body!.data : [];
      const out: InboundEmail[] = [];
      for (const raw of items) {
        const e = raw as Record<string, unknown>;
        const externalMessageId = String(e.id ?? e.message_id ?? "");
        const fromEmail = String(e.from_address_email ?? e.from_email ?? e.lead ?? e.from ?? "").toLowerCase();
        const bodyObj = e.body as { text?: unknown; html?: unknown } | undefined;
        const text = String(bodyObj?.text ?? bodyObj?.html ?? e.content_preview ?? e.preview ?? "");
        if (!externalMessageId || !fromEmail) continue;
        out.push({ externalMessageId, fromEmail, text });
      }
      return out;
    },

    // Instantly signs webhooks with a plain HMAC-SHA256 hex digest of the body.
    verifyWebhookSignature: hmacSignatureValid,
  };
}
