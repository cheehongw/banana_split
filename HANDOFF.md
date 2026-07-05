# Handoff — Banana Split

State of the project and what's left, for the next session. The full
architecture, data model, API list, auth model, and deployment notes live in
[`CLAUDE.md`](./CLAUDE.md); deployment steps are in [`deploy/README.md`](./deploy/README.md).

## Where it stands
A working Telegram Mini App for splitting shared expenses. Core flow, the
**multi-currency per-currency ledger** (the differentiator), membership
authorization, native Telegram buttons, and a homelab Docker + Tailscale Funnel
deploy are all in. Green at the branch tip: 24 Vitest tests, all three
workspaces type-check, the webapp builds, and the API + prod wiring pass
in-process checks.

## Verify on the first real deploy (couldn't be done in the build env)
- [ ] Docker image builds on the homelab host; Tailscale Funnel is reachable
- [ ] Live Telegram flows: Mini App loads, MainButton/BackButton, `my_chat_member` chat-linking, `/balance` (verified by type-check + in-process tests, not clicked)
- [ ] Browser click-through of the UI via the dev bypass

## Features (roadmap)
- **Tier 4 — daily reminders**: store `timezone` / `reminderTime` on `groups`, add a scheduler (e.g. `node-cron`) in the server, and a job that posts outstanding balances to the linked chat.
- **Optional end-of-trip FX summary**: convert the per-currency balances into one chosen currency with a user-supplied rate (display-only; the ledger stays currency-pure).
- **PayNow (SG)** settlement + phone-number capture (low priority).

## Hardening / tech-debt (from the code review, deferred)
- Generalize the per-route membership guard into **middleware** so a new group-scoped route can't forget `assertMember`.
- Batch `assertAllMembers` — currently one `SELECT` per user (N+1) → a single `IN` query.
- **Roles/permissions**: any member can currently add/remove members and act on behalf of others.
- Verify chat membership before honoring a **self-join** (today any authenticated user with the group uuid can join).
- Full **roster sync** from the linked chat; **image-upload avatar** (emoji only today); a Hono `onError` handler for clean 500s + logging.

## Reminders
- After any schema change: `npm run db:generate` and commit the migration (prod applies migrations on boot).
- Never set `DEV_USER_ID` in production (the server refuses to boot with it).
- Money is integer minor units, per-currency decimals — always use the helpers in `@banana-split/shared` (`money.ts`); never assume `/100`.
