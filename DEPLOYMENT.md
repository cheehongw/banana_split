# Deployment & Environments

How Banana Split runs across the three machines it lives on, and the **interim**
hosting setup we're starting with (no custom domain yet).

## The core constraint

A Telegram Mini App needs **two things reachable over public HTTPS**, with
*different* audiences:

1. **The webapp (frontend)** — loaded by *each user's device* inside Telegram's
   in-app webview. Not Telegram's servers — your group members' phones. Needs a
   valid public HTTPS cert.
2. **The bot** — either **webhook** (Telegram POSTs to `/webhook`, needs public
   inbound) or **long-polling** (the server reaches out to Telegram, needs
   nothing inbound). Long-polling is why local dev works with no public bot URL.

Consequence: **being "behind WireGuard" cannot serve prod on its own**, because
group members aren't on the VPN. So we split responsibilities into two planes:

- **Management plane — WireGuard.** SSH into the Proxmox node to deploy/operate.
- **Data plane — public HTTPS.** How users actually reach the app. This is what
  the hosting choices below solve.

## Environments

| | dev (Mac, work laptop) | dev (Fedora laptop) | prod (Proxmox) |
|---|---|---|---|
| Purpose | primary development | continue dev elsewhere | live app for the group |
| Bot mode | long-polling | long-polling | long-polling (interim) |
| Bot token | **dev bot** | **dev bot** (same token) | **prod bot** (separate) |
| Frontend | Vite dev server `:5173` | same | Cloudflare Pages (`*.pages.dev`) |
| API reachability | Vite proxy → `:3000` | same | Cloudflare **quick tunnel** |
| DB | local SQLite, throwaway | local SQLite, throwaway | SQLite on a persistent volume |

> **409 gotcha:** you cannot long-poll the *same* bot token from two places at
> once — Telegram returns HTTP 409. The dev bot token is shared between Mac and
> Fedora, so only run `dev:server` on **one** dev machine at a time. Prod uses a
> **separate** bot token, so it never collides with dev.

## Interim hosting (current plan — no domain)

We're deferring buying a domain, so:

- **Frontend → Cloudflare Pages.** Pages hands out a free, stable, HTTPS
  `*.pages.dev` subdomain (e.g. `banana-split.pages.dev`). Register **that** URL
  as the Web App URL in @BotFather. No domain purchase needed.
- **Backend → Cloudflare quick tunnel.** `cloudflared tunnel --url
  http://localhost:3000` gives a public `https://<random>.trycloudflare.com`
  URL that forwards to the Hono server. No open ports, works behind
  WireGuard/NAT.

Because the frontend (`*.pages.dev`) and the API (`*.trycloudflare.com`) live on
**different origins**, this is a cross-origin setup. The scaffold already
supports it:

- The webapp reads its API base from `VITE_API_URL` (`packages/webapp/src/lib/api.ts`),
  falling back to same-origin. For the Pages build, set `VITE_API_URL` to the
  tunnel URL.
- Hono already enables CORS (`app.use('*', cors())` in `packages/server/src/index.ts`).

### The interim rough edge (accept it, or upgrade)

A quick tunnel's URL is **random and changes every time `cloudflared`
restarts**. Each time it changes you must rebuild + redeploy the Pages frontend
with the new `VITE_API_URL`. Mitigations:

- Keep the `cloudflared` process long-lived (systemd/Compose with restart) so the
  URL churns rarely.
- When it does change: update `VITE_API_URL`, `npm run build -w @banana-split/webapp`,
  redeploy Pages.

**Upgrade path (recommended when ready):** buy a cheap domain (~$10/yr, Cloudflare
Registrar at cost), put it on Cloudflare, and switch the quick tunnel to a
**named tunnel** with a stable hostname (e.g. `banana.example.com`). Then either
give Pages a custom subdomain, or collapse to a **single origin** by serving the
built webapp *and* the API from one tunnel hostname (drops the CORS/`VITE_API_URL`
split entirely). See "Target architecture" below.

## Configuration (env vars)

All config is env-driven (12-factor). `.env` is **never committed**;
`.env.example` is the contract. Per-environment values:

| Var | dev | prod (interim) |
|---|---|---|
| `BOT_TOKEN` | dev bot token | prod bot token |
| `WEBAPP_URL` | `http://localhost:5173` | `https://<app>.pages.dev` |
| `SERVER_URL` | *(empty → long-polling)* | *(empty → long-polling)* |
| `WEBHOOK_SECRET` | unused | unused (until webhook mode) |
| `PORT` | `3000` | `3000` |
| `DATABASE_URL` | `./data/banana-split.sqlite` | persistent-volume path |
| `VITE_API_URL` *(webapp build)* | unset (Vite proxy) | tunnel `trycloudflare.com` URL |

> `VITE_API_URL` is a **webapp build-time** var (baked into the static bundle),
> not read by the server. It should be added to `.env.example` with a comment.
> **TODO:** add `VITE_API_URL` to `.env.example`.

## Working across the two dev machines

- **Code:** git push/pull. Secrets do **not** travel via git (see Secrets TODO).
- **`better-sqlite3` is a native module** — compiled per-platform, so
  `node_modules` cannot be shared between macOS (arm64) and Fedora (x64). Each
  machine runs its own `npm install`. Fedora needs build tools present:
  `gcc`, `gcc-c++`, `make`, `python3`.
- **Pin Node** so all three machines match. **TODO:** add an `.nvmrc` (and an
  `engines` field in `package.json`); there is none yet.

## Running interim prod on the Proxmox node

Recommended shape (details to be fleshed out when we implement):

- Run inside an **LXC container or small VM** on the Proxmox node.
- Two long-lived processes, ideally under **Docker Compose** (or systemd):
  - `server` — `npm run build` then `node` the built server (Compose also
    compiles `better-sqlite3` once in the image, avoiding per-machine native
    rebuilds).
  - `cloudflared` — the quick tunnel to `http://server:3000`.
- **SQLite persistence:** the DB file must live on a **named volume / host
  bind-mount**, never the ephemeral container layer. Enable **WAL mode**.
- **Migrations:** run `npm run db:migrate` as part of deploy, applying the
  committed migrations under `packages/server/drizzle`. Do **not** use `db:push`
  for anything that lands in prod (see CLAUDE.md).
- **Backups (TODO):** add **Litestream** streaming the SQLite file to object
  storage (Backblaze B2 or a Proxmox-local MinIO) for point-in-time restore.
  This is who-owes-whom data — worth automating.

## Target architecture (post-domain, for reference)

Once a domain is on Cloudflare, collapse to the simplest solid shape:

- One tunnel hostname (`banana.example.com`) fronted by a **named**
  `cloudflared` tunnel.
- **Compose serves both** the static webapp and the API from that single origin
  → no CORS, no `VITE_API_URL` split, one URL registered in BotFather.
- Optionally switch the bot to **webhook** mode (set `SERVER_URL` +
  `WEBHOOK_SECRET`) now that stable public inbound exists.

## Open TODOs

- [ ] Add `VITE_API_URL` to `.env.example` with a comment.
- [ ] Add `.nvmrc` + `engines` to pin the Node version across machines.
- [ ] Tighten CORS from wide-open `cors()` to the specific Pages origin.
- [ ] Add Litestream (or equivalent) SQLite backup on prod.
- [ ] Write the `docker-compose.yml` (server + cloudflared) and a deploy script.
- [ ] **Secrets strategy** — how `.env` reaches all three machines (SOPS+age vs.
      password manager vs. manual). Deferred, decide later.
