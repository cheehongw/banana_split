# Deploying Banana Split (homelab, free)

A runbook for hosting behind a homelab where only the WireGuard port is public.
The Mini App must be reachable by group members' phones over public HTTPS, so we
publish it with an **outbound-only Tailscale Funnel** — no inbound ports, no
domain. See the architecture notes in the repo `CLAUDE.md`.

## Prerequisites (on the homelab host)
- Docker + Docker Compose, git, and this repo cloned.
- Everything else runs in containers.

## 1. Telegram bot token
In @BotFather: `/newbot` (or reuse an existing bot) → copy the `BOT_TOKEN`.

## 2. Tailscale (one-time account setup)
1. Create a free Tailscale account.
2. **DNS**: enable MagicDNS **and** HTTPS Certificates (admin console → DNS). Funnel needs valid certs.
3. **Access Controls**: grant the funnel node attribute:
   ```jsonc
   "nodeAttrs": [ { "target": ["autogroup:member"], "attr": ["funnel"] } ]
   ```
4. **Auth key**: Settings → Keys → generate a *reusable* key → copy `tskey-auth-...`.
5. Note your **tailnet name** (e.g. `tigercat.ts.net`). The app's public URL will be
   **`https://banana.<tailnet>.ts.net`** (`banana` = the `tailscale` service hostname in `docker-compose.yml`).

## 3. Configure `.env`
```bash
cp .env.production.example .env
```
Fill in `BOT_TOKEN`, `TS_AUTHKEY`, and `WEBAPP_URL=https://banana.<tailnet>.ts.net`.
Leave `SERVER_URL` empty (long-polling). **Never set `DEV_USER_ID`** — the server
refuses to boot with it when `NODE_ENV=production`.

## 4. Build & run (on the homelab host)
Build on the host so the native `better-sqlite3` binary matches your CPU arch.
```bash
docker compose up -d --build
docker compose logs -f app        # "Applied migrations", "listening on :3000", "Bot @… started (long polling)"
docker compose logs -f tailscale  # funnel established at https://banana.<tailnet>.ts.net
```
Sanity check: `curl https://banana.<tailnet>.ts.net/health` → `{"ok":true}`.

## 5. Point Telegram at it (@BotFather)
- **Menu Button**: Bot Settings → Menu Button → URL = `https://banana.<tailnet>.ts.net`.
- **Main Mini App**: Bot Settings → Configure Mini App → enable + same URL.
  *(Required for the `?startapp=<groupId>` deep-link group auto-join.)*
- Optional `/setcommands`: `start`, `balance`.

## 6. Smoke test
- Open the bot → `/start` → **Open Banana Split** → create a group, add a ¥ expense
  and an S$ expense, confirm balances are tracked per currency.
- Add the bot to a Telegram **group** → it links the chat and posts a join link;
  `/balance` in that chat prints the settle-up.

## Operations
- **Update:** `git pull && docker compose up -d --build`
- **Backup** (SQLite lives in the `bananadata` volume):
  ```bash
  docker run --rm -v banana_split_bananadata:/data -v "$PWD":/out alpine \
    sh -c 'cp /data/banana-split.sqlite* /out/'
  ```
  Copies the `.sqlite` plus `-wal`/`-shm`. Put it in a nightly cron.
- **Regenerate migrations** after any schema change: `npm run db:generate`, commit the SQL.

## Troubleshooting
- **Funnel unreachable** → recheck the `funnel` ACL attribute + HTTPS certs; `docker compose exec tailscale tailscale funnel status`.
- **Bot `409 Conflict`** → another instance is polling the same token (stop the dev bot).
- **`DEV_USER_ID must not be set` on boot** → remove it from `.env`.
- **`better-sqlite3` build error** → ensure you built on the homelab host (arch match).
- **Mini App shows 401 in a browser** → expected; `initData` only exists inside Telegram (use `DEV_USER_ID` + `npm run dev:webapp` for local UI work).

## Webhook alternative (not used by default)
Set `SERVER_URL` to the public URL to switch the bot from long-polling to a
`/webhook` endpoint, and register it once with `bot.api.setWebhook(...)`.
Long-polling is recommended here — it needs no inbound path to the homelab.
