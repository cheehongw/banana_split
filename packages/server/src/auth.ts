import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

/**
 * Validate the `initData` string Telegram passes into the Mini App.
 *
 * Telegram signs initData with a key derived from the bot token:
 *   secret_key = HMAC_SHA256(key="WebAppData", message=BOT_TOKEN)
 *   hash       = HMAC_SHA256(key=secret_key, message=data_check_string)
 * where data_check_string is every field EXCEPT `hash`, sorted by key and
 * joined as "k=v" lines with '\n'.
 *
 * Returns the parsed user if the signature is valid and the data is fresh,
 * otherwise null. NEVER trust a user id from the frontend without this check.
 */
export function validateInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Constant-time compare to avoid leaking the hash via timing.
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  // Reject stale initData to limit replay.
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Number.isNaN(authDate)) return null;
  if (Date.now() / 1000 - authDate > maxAgeSeconds) return null;

  const userRaw = params.get('user');
  if (!userRaw) return null;
  try {
    return JSON.parse(userRaw) as TelegramUser;
  } catch {
    return null;
  }
}

// Make the authenticated user available to route handlers via c.get('user').
declare module 'hono' {
  interface ContextVariableMap {
    user: TelegramUser;
  }
}

/** Hono middleware: require and validate the Telegram initData header. */
export function authMiddleware(botToken: string): MiddlewareHandler {
  return async (c, next) => {
    const initData = c.req.header('X-Telegram-Init-Data');
    if (!initData) return c.json({ error: 'missing init data' }, 401);

    const user = validateInitData(initData, botToken);
    if (!user) return c.json({ error: 'invalid init data' }, 401);

    c.set('user', user);
    await next();
  };
}
