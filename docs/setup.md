# Setup Guide

## Prerequisites

- Node.js ≥ 22.12 (uses built-in `node:sqlite`; no native builds)
- npm 10+

## Local development

```bash
npm install
cp .env.example .env       # optional — defaults work for local
npm run demo               # verify everything works end-to-end
npm run dev:api            # :4000
npm run dev:dashboard      # :5173, token: dev-owner-token
```

Set `OWNER_API_TOKEN` in `.env` to replace the dev token:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Environments

| | `WILLIAM_ENV=local` | `staging` | `production` |
|---|---|---|---|
| Side effects | always simulated | sandbox creds only | live creds + approval |
| DRY_RUN | forced `true` | honored | honored |
| OWNER_API_TOKEN | optional (dev token) | required | required |
| Unsigned webhooks | accepted + logged | rejected | rejected |

## Credentials — what each one unblocks

Fill `.env` values as you obtain them; the Integrations page reflects status
on restart, and matching OwnerRequests can be marked fulfilled.

| Credential | Unblocks | Notes |
|---|---|---|
| `INSTANTLY_API_KEY` + `INSTANTLY_WEBHOOK_SECRET` | real sends after approval; reply/bounce/unsub webhooks | point Instantly webhooks at `/webhooks/instantly` |
| `GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN` | direct-send fallback, mailbox ingestion, calendar free/busy | OAuth2 for will@williamdamato.com; William never reads email as instructions |
| `GOOGLE_MAPS_API_KEY` | automated lead discovery | activation still needs the ACTIVATE_NEW_LEAD_SOURCE gate |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | payment links/invoices (start with test mode) | webhooks at `/webhooks/stripe` |
| `VERCEL_TOKEN` (+ `VERCEL_TEAM_ID`) | shareable preview URLs; gated production deploys | |
| `GITHUB_TOKEN` | preview/production branch pushes | |
| `ENRICHMENT_API_KEY` / `EMAIL_VERIFY_API_KEY` | contacts for leads without published emails; bounce protection | provider choice is an open OwnerRequest |
| `HIGGSFIELD_ENABLED=true` | visual generation via Higgsfield MCP | stays dry-run until owner confirms credit budget |

## Anthropic models — per task

William calls Anthropic on a **per-task** basis; each has its own env var with a
sensible default. Leave them unset to use the defaults.

| Env var | Drives | Default |
|---|---|---|
| `ANTHROPIC_MODEL` | global fallback + reply-classification + transcript extraction | `claude-haiku-4-5-20251001` (Haiku) |
| `ANTHROPIC_VISUAL_MODEL` | visual scoring of audit screenshots | Haiku |
| `ANTHROPIC_OUTREACH_MODEL` | outreach copy | Haiku |
| `ANTHROPIC_BUILD_MODEL` | build prompts | `claude-sonnet-4-6` (Sonnet 4.6) |

> **⚠️ Activation caveat:** the global default flipped Opus → Haiku. An explicit
> `ANTHROPIC_MODEL=claude-opus-4-8` left in `.env` from the activation session
> **OVERRIDES the Haiku default** and runs reply-classification + transcript
> extraction on Opus. **Unset it** (or set the Haiku id) to run those on Haiku.
> The three per-task vars above are unaffected by this.

## Visual scoring + email discovery

| Env var | Controls | Default |
|---|---|---|
| `VISUAL_SCORING_WEIGHT` | weight of the Haiku vision verdict in `scoreLead` | see `.env.example` |
| `VISUAL_PROMOTE_MIN_CONFIDENCE` | min confidence for a `weak` verdict to floor a lead to warm (promote) | see `.env.example` |
| `VISUAL_DEMOTE_MIN_CONFIDENCE` | min confidence for a `strong` verdict to cap a lead to skip (demote) | see `.env.example` |
| `EMAIL_DISCOVERY_SUBPATHS` | subpaths the Playwright email crawl visits (`/contact`, `/about`, …) | see `.env.example` |
| `EMAIL_DISCOVERY_MAX_PAGES` | max pages the email crawl fetches per lead | see `.env.example` |

Outreach is **email-only**: a lead with no real email (phone-only counts as
no-email) is set to `disqualified` (record kept) and never contacted. Email
discovery is staged + cost-ordered — cheap homepage regex → Playwright subpage
crawl (only on a miss; robots-respecting, dry-run-safe) → enrichment → disqualify.
Visual scoring runs only in `AUDITOR_MODE=playwright` (it scores the audit
screenshots) and is mock-first (no-op in local/dry-run).

## Site auditor modes

- `AUDITOR_MODE=mock` (default) — synthesized audits, zero network.
- `AUDITOR_MODE=http` — real robots.txt + homepage fetch, heuristic analysis.
- `AUDITOR_MODE=playwright` — real Chromium audit (screenshots, Lighthouse,
  axe-core) plus the preview quality gate. Needs `npx playwright install chromium`;
  falls back to `http` mode automatically when browsers are missing.

## Production checklist

1. `WILLIAM_ENV=production`, strong `OWNER_API_TOKEN`, HTTPS termination in front.
2. Live credentials only in the production secret store — never in git.
3. Keep `DRY_RUN=true` for the first soak; flip per-gate policies in
   Settings/Policies as confidence grows.
4. ENABLE_FULL_AUTONOMY stays closed until weeks of clean approval history.
