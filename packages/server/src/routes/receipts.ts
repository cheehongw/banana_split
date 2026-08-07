import { Hono } from 'hono';
import { getReceiptParser, ParserNotConfiguredError } from '../receipts';

export const receiptsRoute = new Hono();

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Parse a receipt image into a ParsedReceipt (line items + tax/tip in minor
 * units) for the webapp to pre-fill an itemized expense. Auth-gated by the
 * global middleware. Delegates to the configured parser; returns 501 when none
 * is set, so the manual flow is unaffected until a parser is wired up.
 */
receiptsRoute.post('/parse', async (c) => {
  const body = await c.req.parseBody();
  const file = body['image'];
  if (!(file instanceof File)) return c.json({ error: 'multipart field "image" (a file) is required' }, 400);
  if (file.size === 0) return c.json({ error: 'image is empty' }, 400);
  if (file.size > MAX_IMAGE_BYTES) return c.json({ error: 'image too large (max 10 MB)' }, 413);

  const currency = typeof body['currency'] === 'string' ? (body['currency'] as string) : undefined;
  const image = Buffer.from(await file.arrayBuffer());

  try {
    const parsed = await getReceiptParser().parse(image, { mimeType: file.type, currency });
    return c.json(parsed);
  } catch (err) {
    if (err instanceof ParserNotConfiguredError) return c.json({ error: err.message }, 501);
    console.error('receipt parse failed', err);
    return c.json({ error: `receipt parsing failed: ${(err as Error).message}` }, 502);
  }
});
