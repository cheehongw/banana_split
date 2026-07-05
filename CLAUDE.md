# Banana Split 🍌

A Telegram Mini App for splitting shared expenses among a group — a Splitwise
clone that lives inside Telegram. A bot is the entry point; the Mini App (a web
UI rendered in Telegram's in-app webview) is the main interface; a shared backend
persists data to SQLite and posts notifications back to the group chat.

## Requirements

### MVP scope (agreed)
- **Core expense splitting** — create groups, add expenses, split equally / by shares / by exact amounts; track who owes whom.
- **Multi-currency, per-currency balances (the differentiator)** — the reason this exists: unlike Coconut Split, balances are tracked **independently per currency** and never converted. A ¥ debt nets only against ¥ spending, S$ against S$, so borrowing in yen early and covering yen later cancels out regardless of FX. Each expense and settlement carries its own currency (group currency is just the default). FX conversion to a single "at the end" total is an optional future add-on — the ledger never needs it.
- **Balance simplification** — minimize the number of payments needed to settle up (greedy min-cash-flow), run per currency.
- **Settle up + history** — record payments/settlements (per currency); show expense history and an activity feed.
- **Group chat notifications** — the bot posts to the linked Telegram group when an expense is added or a settlement is recorded.

### Non-functional / decisions
- Identity comes from Telegram — no signup, no passwords.
- **Security (non-negotiable):** the frontend sends Telegram `initData` on every API call; the backend validates its HMAC-SHA256 signature against `BOT_TOKEN` before trusting the user id. Never trust a raw user id from the client. Implemented in `packages/server/src/auth.ts`.
- **Money is stored as integer minor units** everywhere — never floats — to avoid rounding drift. Minor-unit decimals are **per-currency** (2 for USD/SGD, 0 for JPY/KRW, 3 for KWD/BHD); use `formatMoney`/`parseMoney`/`currencyDecimals` from `@banana-split/shared` (`money.ts`) — never assume `/100`.

## Tech Stack

- **Language:** TypeScript end-to-end.
- **Monorepo:** npm workspaces (`packages/*`).
- **Backend:** [Hono](https://hono.dev) HTTP API + [grammY](https://grammy.dev) Telegram bot framework, run via `tsx` / `@hono/node-server`.
- **DB:** SQLite via [Drizzle ORM](https://orm.drizzle.team) over `better-sqlite3` (synchronous driver; queries use `.all()` / `.get()` / `.run()`).
- **Frontend:** React + Vite + `@telegram-apps/sdk-react` (plus the raw `telegram-web-app.js` bridge for `initData`).
- **Hosting target:** single server (SQLite file on disk). No serverless — avoids webhook cold starts.

## Architecture

```
Telegram client
   ├─ Bot (grammY)        ──► POST /webhook  (prod)  ─┐
   └─ Mini App (webview)  ──► /api/* with initData ──► Hono server ──► Drizzle ──► SQLite
                                                       └─► bot.api.sendMessage ──► group chat
```

### Data model (`packages/server/src/db/schema.ts`)
- `users` — Telegram user id as PK (not autoincrement).
- `groups` — uuid PK, optional `telegramChatId` (linked group chat), currency, optional `avatar` (emoji), `notificationsEnabled`.
- `group_members` — (groupId, userId) join, composite PK.
- `expenses` — total `amount`, `currency` (per-expense; group currency is the default), `paidBy`, `splitType` ('equal' | 'shares' | 'exact'), optional `category` (id from shared `categories.ts`), `createdBy`.
- `expense_splits` — (expenseId, userId) composite PK; each member's owed `amount` (in the expense's currency) and optional `shares` weight.
- `settlements` — explicit payment `fromUser` → `toUser`, with its own `currency`.

### Balance math (`packages/shared`)
Shared between server and client so previews match server truth:
- `splits.ts` — `resolveSplits(type, total, participants, {shares, exact})` produces exact per-user amounts (integer minor units). Equal split gives leftover cents to the first members; shares uses largest-remainder; exact validates the sum equals the total. Rejects non-positive totals and split maps referencing non-participants.
- `balances.ts` — `computeBalances(memberIds, expenses, settlements)` → net **per (member, currency)**; `simplifyDebts(balances)` → settle-up suggestions run **independently per currency** (never converts between currencies). Each `Balance`/`SettlementSuggestion` carries a `currency`.
- `money.ts` — `formatMoney`/`parseMoney`/`currencyDecimals`/`COMMON_CURRENCIES`; currency-aware minor-unit handling shared by server, bot, and webapp.

### API (`packages/server/src/routes`), all under `/api`, all auth-gated
- `GET /me` (the authenticated caller)
- `GET /groups`, `POST /groups`
- `GET /groups/:id` (group + members), `PATCH /groups/:id` (title/currency/avatar/notifications)
- `POST /groups/:id/members` (interim manual add), `DELETE /groups/:id/members/:userId` (refused if referenced / last member)
- `POST /groups/:id/join` (caller self-joins; used by the bot's deep link)
- `GET /groups/:id/export` (CSV of all expenses + settlements)
- `GET /expenses?groupId=`, `POST /expenses` (optional `category`, per-expense `currency`)
- `GET /settlements/balances?groupId=` (per-currency), `POST /settlements` (per-settlement `currency`)

The Hono app is built in `app.ts` (`createApp()`), so it can be driven in-memory
via `app.request(...)` in tests without binding a port; `index.ts` calls
`serve()` + starts the bot.

### Auth (`packages/server/src/auth.ts`, `authz.ts`)
- `validateInitData()` verifies the Telegram HMAC; `authMiddleware` gates `/api/*` (identity).
- `authz.ts` enforces membership (authorization): `assertMember` / `assertAllMembers` guard every group-scoped route so a valid user can't touch a group they don't belong to.
- **DEV-ONLY bypass:** when `DEV_USER_ID` is set **and `NODE_ENV === development`**
  (allowlist, not denylist), requests sent with **no** initData at all are treated
  as that user, so the Mini App runs in a plain browser with no Telegram tunnel.
  Present-but-invalid initData is always 401, even in dev. `npm run dev:server`
  sets `NODE_ENV=development`; the server refuses to boot if `DEV_USER_ID` is set
  with `NODE_ENV=production`. Never set `DEV_USER_ID` in production.

## Project Structure

```
banana_split/
├── CLAUDE.md
├── package.json              # npm workspaces + root scripts
├── tsconfig.base.json
├── drizzle.config.ts
├── vitest.config.ts          # scopes tests to packages/*/src
├── .env.example
└── packages/
    ├── shared/               # @banana-split/shared — types + split/balance math
    │   └── src/{index,types,splits,balances,categories,money}.ts (+ *.test.ts)
    ├── server/               # @banana-split/server — Hono API + grammY bot + Drizzle
    │   └── src/
    │       ├── index.ts      # entry: serve() + bot (webhook in prod / long-poll in dev)
    │       ├── app.ts        # createApp(): the Hono app (importable for tests)
    │       ├── env.ts        # loads repo-root .env before anything reads process.env
    │       ├── bot.ts        # grammY bot: /start, /balance, my_chat_member linking + notifyGroup()
    │       ├── auth.ts       # initData HMAC validation + middleware + dev bypass
    │       ├── authz.ts      # membership guards (assertMember / assertAllMembers)
    │       ├── groupBalances.ts # computeGroupBalances / memberNames (shared by route + /balance)
    │       ├── db/{schema,index}.ts
    │       └── routes/{groups,expenses,settlements}.ts
    └── webapp/               # @banana-split/webapp — React + Vite Mini App
        └── src/
            ├── main.tsx, App.tsx (navigator + deep-link auto-join), telegram.d.ts, ui.tsx
            ├── lib/{api,money,dates,theme,tutorial}.ts, lib/{useMainButton,useBackButton}.ts
            └── screens/{Groups,GroupDetail,AddExpense,Stats,GroupSettings,ManageUsers}.tsx
```

## Getting Started

```bash
npm install                              # from repo root (installs all workspaces)
cp .env.example .env                     # then fill in BOT_TOKEN from @BotFather

# Create the SQLite schema:
npm run db:push                          # or: npm run db:generate && npm run db:migrate

# Run (two terminals):
npm run dev:server                       # Hono on :3000, bot in long-polling mode
npm run dev:webapp                       # Vite on :5173 (proxies /api -> :3000)

npm test                                 # vitest — split/balance math in packages/shared
```

To test the Mini App inside Telegram you need a public HTTPS URL for the webapp
(e.g. an `ngrok`/`cloudflared` tunnel), set as the Web App URL in @BotFather.
For quick local UI work without Telegram, set `DEV_USER_ID` (see Auth above) and
open `http://localhost:5173` in a normal browser.

### Deployment (homelab, free) — `Dockerfile` + `docker-compose.yml`
Target: a homelab behind self-hosted WireGuard (only the WG port is public). The
Mini App must be reachable by group members' phones over public HTTPS, so we use
an **outbound-only tunnel** — no inbound ports opened.

- **Single origin:** in production the Hono server also serves the built Mini App
  (`WEBAPP_DIST` → `packages/webapp/dist`, SPA fallback) plus `/api`, so one URL
  serves everything and there's no CORS. The webapp calls `/api` same-origin.
- **Bot:** long-polling (leave `SERVER_URL` empty) — dials out to Telegram, so
  Telegram never needs to reach the homelab. Only the client hits the tunnel.
- **Ingress:** a **Tailscale Funnel** sidecar (`tailscale/tailscale`, userspace,
  `deploy/tailscale-funnel.json`) publishes the app at `https://<host>.<tailnet>.ts.net`
  with free TLS. Config chosen because there's no domain and nothing may be
  exposed beyond WireGuard.
- **DB:** SQLite on the `bananadata` volume at `/data/banana-split.sqlite`.
  Migrations are **generated** (`packages/server/drizzle/`) and applied on boot
  when `NODE_ENV=production` (fresh volume → clean schema). Dev still uses `db:push`.
- **Security in prod:** `NODE_ENV=production`; the server refuses to boot if
  `DEV_USER_ID` is set (dev bypass can never arm in prod).

Steps: `cp .env.production.example .env` (fill `BOT_TOKEN`, `WEBAPP_URL`,
`TS_AUTHKEY`) → `docker compose up -d --build` (**build on the homelab host** so
the native `better-sqlite3` binary matches your CPU arch) → set the Mini App URL
in @BotFather to the `*.ts.net` URL (and configure a Main Mini App for the
`?startapp=` deep links). Updates: `git pull && docker compose up -d --build`.
Back up the `bananadata` volume (the SQLite file) periodically.

### Webhook alternative (not used by default)
- Set `SERVER_URL` (public HTTPS) to make the bot use `/webhook` instead of long
  polling; register it once: `bot.api.setWebhook(`${SERVER_URL}/webhook`, { secret_token: WEBHOOK_SECRET })`.

## Development Workflow (SDLC)

Follow these practices on **every** change, without being asked:

### Small, verified loops
- Work in small increments. After each logical unit of work, **verify before moving on** — don't stack unverified changes.
- Type-check and build the affected workspace(s): `npm run build` (or `npm run build -w <workspace>`). The build must be green before you consider a step done.
- Run the test suite after each loop and before every commit. **Vitest is wired up** (root `test`/`test:watch` scripts, `packages/shared` has a `test` script, config in `vitest.config.ts`). Pure logic in `packages/shared` (`splits.ts`, `balances.ts`) is covered first — extend that coverage as the math grows. The Hono app is importable via `createApp()` for in-memory route tests (`app.request(...)`), no port needed.
- If a change touches the DB schema, run `npm run db:generate` and commit the generated migration (see the migrations note below) — don't rely on `db:push` for anything that lands in a commit.
- Never leave the tree broken between commits: each commit should build and pass tests on its own.

### Atomic, readable commits
- One logical change per commit — don't mix refactors, features, and formatting in the same commit.
- Write imperative, present-tense subjects ≤ ~72 chars (e.g. `Add exact-split validation to resolveSplits`), a blank line, then a body explaining the **why** when it isn't obvious.
- A commit should be self-contained and revertible: it builds, passes tests, and doesn't depend on a later "fixup" commit to work.
- Do not commit secrets or local state — `.env`, the SQLite DB file, and build output stay out of git. Keep `.env.example` in sync when you add a new env var.
- Follow the repo's global git rules (see the user's instructions): no `Co-Authored-By` trailer.

### Before opening a PR
- Rebase/update onto `main`, confirm a clean build + passing tests, and self-review the full diff.
- Keep PRs focused and reviewably small; write a description that states the intent, the approach, and how to test it. Format testing steps as a markdown checklist (`- [ ]`), pre-checking (`- [x]`) any step you actually ran.

### Quality bar
- Match the surrounding code's style and idioms; keep the money-as-integer-cents and never-trust-client-user-id invariants intact (see Requirements).
- Prefer adding/extending a test over manual verification when the logic is pure (splits, balances).
- Leave TODOs only with enough context for someone else to act on them.

## Open Questions / Next Steps

- **Member management:** add via `POST /groups/:id/members` (Manage Users screen) or the deep-link self-join; remove via `DELETE /groups/:id/members/:userId` (refused if the member is referenced by any expense/settlement, or is the last member). The bot's `my_chat_member` also seeds the adder. Still open: full roster sync (all chat members), verifying chat membership before honoring a self-join, and role/permission granularity (any member can currently add/remove others).
- **Group ↔ chat linking:** done — `bot.ts` `my_chat_member` creates/links a Group on add and unlinks (`telegramChatId = null`) on removal. Note: `web_app` inline buttons are private-chat-only, so the group greeting uses a `t.me/<bot>?startapp=<groupId>` URL button instead.
- **Authorization:** membership is now enforced (`authz.ts`): every group-scoped route checks the caller is a member, and expense/settlement routes verify the payer, participants, and settlement parties are members too (403 otherwise). Remaining: any member can currently add/act on behalf of others — add role/permission granularity if needed, and a `DELETE /:id/members/:userId`.
- **UI:** core flow is built — groups list, create-group, group detail (balances + settle-up + history + members), add-expense form with a live split preview (equal/shares/exact). Native Telegram **MainButton** (primary action) and **BackButton** (via `useMainButton`/`useBackButton`) drive navigation, with in-page buttons as the browser/dev fallback. The bot answers **`/balance`** in a linked chat. Still to do: richer activity feed, empty/loading polish.
- **Multi-currency:** ✅ per-currency ledgers implemented — each expense/settlement has its own currency; balances and settle-up are computed independently per currency (no conversion). Remaining (optional): an "at the end" FX conversion/summary that totals everything into one chosen currency using a user-supplied rate.
- **Migrations:** ✅ generated migrations committed under `packages/server/drizzle` and applied on boot in production (`migrate()` in `index.ts`, gated to `NODE_ENV=production`). Dev still uses `db:push`; regenerate with `npm run db:generate` after schema changes and commit the SQL.

## Roadmap / Wishlist

Features we want *eventually*, drawn from a reference app ("Coconut Split"). Not
committed to a timeline; grouped by rough effort. Tackle top-down.

### Tier 1 — quick wins (UI over backend we already have) ✅ DONE
- ✅ **Personalized "Your Outstanding Debts"** — group screen shows "You owe X" / "X owes you" (from `simplifyDebts` + `GET /me`), with a "See all group debts" expander.
- ✅ **Summary cards** — "Group Total" and "Your Total" with info tooltips, atop the group screen.
- ✅ **Notifications on/off toggle** — `groups.notificationsEnabled`; expense/settlement routes skip `notifyGroup` when off; toggle in Settings.
- ✅ **Members view** — read-only member list on the group screen + a Members quick-action opening Manage Users.

### Tier 2 — extends existing open items ✅ DONE
- ✅ **Manage Users screen** — `ManageUsers` adds/removes members; `DELETE /groups/:id/members/:userId` refuses removing a referenced member (would orphan balances) or the last member.
- ✅ **Group Currency picker** — Settings picker → `PATCH /groups/:id` (applies to new expenses; past ones keep their currency).
- ✅ **Group avatar/branding** — emoji avatar via Settings (`groups.avatar`), shown in the group header. (Full image upload deferred — needs blob storage.)

### Tier 3 — new features ✅ DONE
- ✅ **Expense categories + icons** — `expenses.category` + shared `categories.ts` (id/label/emoji); picker in AddExpense, icon on the feed.
- ✅ **Search + filter** — client-side search + payer/category filters on the group feed.
- ✅ **Date-grouped feed with expandable rows** — `lib/dates.ts` groups by day ("Today"/"Yesterday"/date); each row expands to its split breakdown.
- ✅ **Analytics / stats** — `Stats` screen: group total + spend by category and by payer (client-side aggregation).
- ✅ **Export to CSV** — `GET /groups/:id/export` streams a CSV; Settings triggers a Blob download.
- ✅ **Light/dark theme toggle** — `lib/theme.ts` overrides the `--tg-theme-*` vars on :root (auto/light/dark), persisted in localStorage.
- ✅ **Onboarding tutorial** — first-run tips card on the groups list (`lib/tutorial.ts`), with "Show tutorial again" in settings.
- ✅ **Group Settings screen** — `GroupSettings` houses theme, tutorial replay, CSV export, and currency (read-only for now).

### Tier 4 — infra-heavy
- **Daily reminders** — scheduled bot reminders about outstanding balances, with a per-group **reminder time** and **timezone**. Requires a server-side scheduler (cron) and storing `timezone` / `reminderTime` on `groups`.

### Low priority
- **PayNow settlement (SG)** — capture a user **phone number** (Personal settings, with a "why?" explainer) and, when settling up, generate a PayNow request/QR to the payee's number. Nice-to-have, not near-term.

## Notes

- grammY supports the `'hono'` webhook adapter — used in `index.ts` via `webhookCallback(bot, 'hono', ...)`.
- `@telegram-apps/sdk-react` version/API churns; the scaffold uses the raw
  `window.Telegram.WebApp` bridge for `initData` to stay version-robust, and keeps
  the SDK available for richer lifecycle/hooks when wanted.
- The group `?startapp=<groupId>` deep link only launches the Mini App if a **Main
  Mini App** is configured in @BotFather (Bot Settings → Configure Mini App); the
  app reads `initDataUnsafe.start_param` to auto-join. Without it, the link just
  opens the bot chat. `web_app` inline buttons work only in private chats.
