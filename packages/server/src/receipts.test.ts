// Tests for the receipt-parse seam: the pure sidecar-reply normalizer (currency
// -aware minor-unit conversion) and the route's no-image / not-configured paths.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

process.env.BOT_TOKEN = 'test-bot-token';
process.env.DATABASE_URL = ':memory:';
delete process.env.DEV_USER_ID;
delete process.env.RECEIPT_PARSER; // default 'none'

const { createApp } = await import('./app');
const { normalizeSidecarReply } = await import('./receipts');
const app = createApp();

function initData(userId: number): string {
  const p = new URLSearchParams();
  p.set('user', JSON.stringify({ id: userId, first_name: `U${userId}` }));
  p.set('auth_date', String(Math.floor(Date.now() / 1000)));
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update('test-bot-token').digest();
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

describe('normalizeSidecarReply', () => {
  it('converts major-unit numbers/strings to minor units for a 2-decimal currency', () => {
    const r = normalizeSidecarReply(
      { items: [{ description: 'Steak', amount: '20.00' }, { description: 'Salad', amount: 10.5 }], tax: '1.25', tip: 2 },
      'USD',
    );
    expect(r.items).toEqual([
      { description: 'Steak', amount: 2000 },
      { description: 'Salad', amount: 1050 },
    ]);
    expect(r.tax).toBe(125);
    expect(r.tip).toBe(200);
  });

  it('respects zero-decimal currencies (JPY)', () => {
    const r = normalizeSidecarReply({ currency: 'JPY', items: [{ description: 'Ramen', amount: 900 }] }, 'JPY');
    expect(r.items[0]).toEqual({ description: 'Ramen', amount: 900 });
  });

  it('drops zero/invalid item amounts and defaults blank descriptions', () => {
    const r = normalizeSidecarReply({ items: [{ amount: '5.00' }, { description: 'x', amount: 'n/a' }] }, 'USD');
    expect(r.items).toEqual([{ description: 'Item', amount: 500 }]);
  });
});

describe('POST /api/receipts/parse', () => {
  it('401s without auth', async () => {
    const res = await app.request('/api/receipts/parse', { method: 'POST', body: new FormData() });
    expect(res.status).toBe(401);
  });

  it('400s when no image is attached', async () => {
    const res = await app.request('/api/receipts/parse', {
      method: 'POST',
      headers: { 'X-Telegram-Init-Data': initData(1) },
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it('501s when no parser is configured', async () => {
    const form = new FormData();
    form.append('image', new Blob([Buffer.from([1, 2, 3])], { type: 'image/png' }), 'receipt.png');
    const res = await app.request('/api/receipts/parse', {
      method: 'POST',
      headers: { 'X-Telegram-Init-Data': initData(1) },
      body: form,
    });
    expect(res.status).toBe(501);
  });
});
