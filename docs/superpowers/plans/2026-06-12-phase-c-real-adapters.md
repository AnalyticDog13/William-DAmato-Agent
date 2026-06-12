# Phase C: Real Adapters Implementation Plan

**Goal:** Real Instantly/Stripe/Vercel/Gmail adapters behind the existing
`packages/integrations` interfaces, selected by credential presence, with mocks
as the fallback. Zero behavior change when credentials are absent (CI/demo).

**Safety architecture (unchanged invariants):**
- Every adapter method still throws without a PolicyTicket.
- Real adapters MUST honor `ticket.dryRun` by simulating — no network call.
  Local env forces dry-run, so creds in `.env` locally are still safe.
- Gmail adapter refuses outbound email missing the opt-out line (same as mock).
- Injectable `fetchImpl` so tests never hit the network.

## Tasks

- [x] 1. `src/real/shared.ts` — requireTicket, dry-run simulation result,
      `RealDeps { fetchImpl?, env }`, response helper.
- [x] 2. `src/real/stripe.ts` — `createStripeAdapter`: price→payment_link
      (2 calls, metadata copied to checkout sessions), customer→invoice→item
      draft flow; `stripeSignatureValid` implementing `t=...,v1=...` with
      300s tolerance.
- [x] 3. `src/real/instantly.ts` — v2 API Bearer auth; pushLead POST /leads;
      pauseLead (TODO(phase-c): verify pause endpoint against docs when key
      arrives); HMAC webhook verification (unchanged scheme).
- [x] 4. `src/real/vercel.ts` — POST /v13/deployments with inlined files from
      sourcePath; rollback via GET deployment → POST project rollback; teamId
      param when set.
- [x] 5. `src/real/gmail.ts` — OAuth2 refresh-token → access token, RFC2822 +
      base64url, users/me/messages/send; opt-out line enforcement.
- [x] 6. `src/types.ts` — optional `metadata` on Stripe inputs;
      `workers/billing` passes `{ invoiceDraftId }` (webhook already matches it).
- [x] 7. `src/registry.ts` — credential-presence selection + injectable env/fetch;
      `src/index.ts` exports.
- [x] 8. `apps/api/src/webhooks.ts` — verify via the ACTIVE adapter
      (`ctx.integrations.{instantly,stripe}.verifyWebhookSignature`); removes
      the TODO(phase-c) plain-HMAC stopgap for Stripe.
- [x] 9. Tests `packages/integrations/test/real-adapters.test.ts`: ticket
      required; dry-run = zero fetch calls; live paths hit fake fetch with
      right auth/body; stripe signature valid/invalid/stale; gmail opt-out
      refusal; registry selection by env.
- [x] 10. `npm test` + `npm run typecheck` + `npm run demo`; compliance-reviewer
      (billing + webhooks touched); docs/CLAUDE.md status; commit + push.
