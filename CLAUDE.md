# Banana Split 🍌

A Telegram Mini App for splitting shared expenses among a group — a Splitwise
clone that lives inside Telegram. A bot is the entry point; the Mini App (a web
UI rendered in Telegram's in-app webview) is the main interface; a shared backend
persists data to SQLite and posts notifications back to the group chat.

## Requirements

### MVP scope (agreed)
- **Core expense splitting** — create groups, add expenses, split equally / by shares / by exact amounts; track who owes whom.
- **Balance simplification** — minimize the number of payments needed to settle up (greedy min-cash-flow).
- **Settle up + history** — record payments/settlements; show expense history and an activity feed.
- **Group chat notifications** — the bot posts to the linked Telegram group when an expense is added or a settlement is recorded.

### Non-functional / decisions
- Identity comes from Telegram — no signup, no passwords.
- **Security (non-negotiable):** the frontend sends Telegram `initData` on every API call; the backend validates its HMAC-SHA256 signature against `BOT_TOKEN` before trusting the user id. Never trust a raw user id from the client. Implemented in `packages/server/src/auth.ts`.
- **Money is stored as integer minor units (cents)** everywhere — never floats — to avoid rounding drift.

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
- `groups` — uuid PK, optional `telegramChatId` (linked group chat), currency.
- `group_members` — (groupId, userId) join, composite PK.
- `expenses` — total `amount`, `paidBy`, `splitType` ('equal' | 'shares' | 'exact'), `createdBy`.
- `expense_splits` — (expenseId, userId) composite PK; each member's owed `amount` and optional `shares` weight.
- `settlements` — explicit payment `fromUser` → `toUser`.

### Balance math (`packages/shared`)
Shared between server and client so previews match server truth:
- `splits.ts` — `resolveSplits(type, total, participants, {shares, exact})` produces exact per-user amounts. Equal split gives leftover cents to the first members; shares uses largest-remainder; exact validates the sum equals the total.
- `balances.ts` — `computeBalances(memberIds, expenses, settlements)` → net per member (positive = owed, negative = owes); `simplifyDebts(balances)` → minimal-ish settle-up suggestions via greedy min-cash-flow.

### API (`packages/server/src/routes`), all under `/api`, all auth-gated
- `GET /groups`, `POST /groups`
- `GET /expenses?groupId=`, `POST /expenses`
- `GET /settlements/balances?groupId=`, `POST /settlements`

## Project Structure

```
banana_split/
├── CLAUDE.md
├── package.json              # npm workspaces + root scripts
├── tsconfig.base.json
├── drizzle.config.ts
├── .env.example
└── packages/
    ├── shared/               # @banana-split/shared — types + split/balance math
    │   └── src/{index,types,splits,balances}.ts
    ├── server/               # @banana-split/server — Hono API + grammY bot + Drizzle
    │   └── src/
    │       ├── index.ts      # entry: mounts API, /webhook; long-polls in dev
    │       ├── bot.ts        # grammY bot singleton + notifyGroup()
    │       ├── auth.ts       # initData HMAC validation + Hono middleware
    │       ├── db/{schema,index}.ts
    │       └── routes/{groups,expenses,settlements}.ts
    └── webapp/               # @banana-split/webapp — React + Vite Mini App
        └── src/{main.tsx,App.tsx,telegram.d.ts,lib/api.ts}
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
```

To test the Mini App inside Telegram you need a public HTTPS URL for the webapp
(e.g. an `ngrok`/`cloudflared` tunnel), set as the Web App URL in @BotFather.

### Production notes
- Set `SERVER_URL` (public HTTPS) so the bot uses the `/webhook` endpoint instead
  of long polling; register it once: `bot.api.setWebhook(`${SERVER_URL}/webhook`, { secret_token: WEBHOOK_SECRET })`.
- Build the webapp (`npm run build`) and serve its static output; point `WEBAPP_URL` at it.

## Development Workflow (SDLC)

Follow these practices on **every** change, without being asked:

### Small, verified loops
- Work in small increments. After each logical unit of work, **verify before moving on** — don't stack unverified changes.
- Type-check and build the affected workspace(s): `npm run build` (or `npm run build -w <workspace>`). The build must be green before you consider a step done.
- Run the test suite after each loop and before every commit. There is **no test runner wired up yet** — the first time tests are needed, set one up (Vitest fits this stack) and add a root `test` script + per-workspace `test` scripts. Start with the pure logic in `packages/shared` (`splits.ts`, `balances.ts`), which is deterministic and the highest-value thing to cover.
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

- **Member management:** how are non-creator members added to a group? Options: bot reads group chat membership when added to a chat, or invite-by-username in the Mini App. (Routes stubbed with TODOs.)
- **Group ↔ chat linking:** implement the `my_chat_member` handler in `bot.ts` to auto-create/link a `Group` when the bot joins a chat.
- **Authorization:** current auth verifies *identity* but not *membership* — add checks that the caller belongs to the group they're mutating.
- **UI:** the webapp is a skeleton (lists groups only). Build: create-group, add-expense form (equal/shares/exact), balances + settle-up, activity feed. Use Telegram `MainButton` and `themeParams`.
- **Multi-currency:** currently one currency per group; no FX. Fine for MVP.
- **Migrations:** `db:push` is fine for dev; switch to generated migrations (`db:generate`/`db:migrate`, committed under `packages/server/drizzle`) before prod.

## Notes

- grammY supports the `'hono'` webhook adapter — used in `index.ts` via `webhookCallback(bot, 'hono', ...)`.
- `@telegram-apps/sdk-react` version/API churns; the scaffold uses the raw
  `window.Telegram.WebApp` bridge for `initData` to stay version-robust, and keeps
  the SDK available for richer lifecycle/hooks when wanted.
