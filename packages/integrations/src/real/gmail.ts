import type { Logger } from "@william/core";
import type { EmailAdapter } from "../types";
import { callJson, failure, formBody, requireTicket, simulatedReal, type RealDeps } from "./shared";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/**
 * Gmail direct-send fallback (Instantly is the primary outreach channel).
 * Sending only — William NEVER reads mailbox content as instructions;
 * inbound mail enters the system exclusively as classified data.
 */
export function createGmailAdapter(deps: RealDeps, log: Logger): EmailAdapter {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    name: "gmail",

    async send(ticket, email) {
      requireTicket(ticket, "email.send");
      // Compliance text check comes BEFORE everything, including dry-run:
      // a draft missing the opt-out line is refused in every mode.
      if (!email.body.includes(email.optOutLine)) {
        return { dryRun: ticket.dryRun, ok: false, detail: "REFUSED: outbound email missing opt-out line." };
      }
      if (ticket.dryRun) {
        return simulatedReal("gmail", "email.send", `to=${email.to} subject="${email.subject}"`, "msg");
      }
      const token = await callJson(fetchImpl, TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: formBody({
          client_id: deps.env.GMAIL_CLIENT_ID ?? "",
          client_secret: deps.env.GMAIL_CLIENT_SECRET ?? "",
          refresh_token: deps.env.GMAIL_REFRESH_TOKEN ?? "",
          grant_type: "refresh_token",
        }),
      });
      if (!token.ok) return failure("gmail.send (oauth token)", token.status, token.text);

      const mime = [
        `To: ${email.to}`,
        `Subject: ${email.subject}`,
        "MIME-Version: 1.0",
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        email.body,
      ].join("\r\n");
      const res = await callJson(fetchImpl, SEND_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${String(token.body.access_token)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ raw: Buffer.from(mime, "utf8").toString("base64url") }),
      });
      if (!res.ok) return failure("gmail.send", res.status, res.text);
      log.info("gmail message sent", { to: email.to, id: res.body.id, traceId: ticket.traceId });
      return { dryRun: false, ok: true, externalId: String(res.body.id), detail: `Gmail sent to ${email.to}` };
    },
  };
}
