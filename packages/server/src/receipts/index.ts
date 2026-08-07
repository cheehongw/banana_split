import { currencyDecimals, type ParsedReceipt } from '@banana-split/shared';

/**
 * Receipt parsing seam. The route calls a `ReceiptParser` selected by env; the
 * concrete implementation (OCR sidecar, LLM, cloud API) is interchangeable and
 * the rest of the app only ever sees a `ParsedReceipt`. Default is a no-op that
 * signals "not configured" so the manual itemized flow works with no parser.
 */

export class ParserNotConfiguredError extends Error {}

export interface ReceiptParser {
  parse(image: Buffer, opts: { mimeType?: string; currency?: string }): Promise<ParsedReceipt>;
}

/** Select the parser from RECEIPT_PARSER (none | sidecar). Read per request. */
export function getReceiptParser(): ReceiptParser {
  const kind = (process.env.RECEIPT_PARSER ?? 'none').toLowerCase();
  switch (kind) {
    case 'sidecar':
      return new SidecarParser(process.env.RECEIPT_PARSER_URL ?? '');
    default:
      return new NoneParser();
  }
}

class NoneParser implements ReceiptParser {
  parse(): Promise<ParsedReceipt> {
    throw new ParserNotConfiguredError('receipt parsing is not enabled on this server (set RECEIPT_PARSER)');
  }
}

/**
 * Posts the image to an internal parser sidecar over the compose network and
 * normalizes its reply. The sidecar is currency-naive and returns MAJOR-unit
 * amounts (e.g. "3.50" / 3.5); conversion to integer minor units happens here.
 */
class SidecarParser implements ReceiptParser {
  constructor(private readonly url: string) {}

  async parse(image: Buffer, opts: { mimeType?: string; currency?: string }): Promise<ParsedReceipt> {
    if (!this.url) throw new ParserNotConfiguredError('RECEIPT_PARSER_URL is not set');
    const form = new FormData();
    form.append('image', new Blob([image], { type: opts.mimeType ?? 'application/octet-stream' }), 'receipt');
    if (opts.currency) form.append('currency', opts.currency);

    const res = await fetch(`${this.url.replace(/\/+$/, '')}/parse`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`parser sidecar responded ${res.status}: ${await res.text()}`);
    return normalizeSidecarReply((await res.json()) as SidecarReply, opts.currency);
  }
}

/** Raw shape a parser sidecar returns — amounts are major-unit numbers or strings. */
export interface SidecarReply {
  currency?: string;
  items?: { description?: string; amount?: number | string }[];
  tax?: number | string;
  tip?: number | string;
  discount?: number | string;
}

/** Major-unit number/string → integer minor units for the given currency. */
function toMinor(v: number | string | undefined | null, currency?: string): number | undefined {
  if (v == null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 10 ** currencyDecimals(currency));
}

/** Normalize a sidecar reply into the app-facing ParsedReceipt (integer minor units). */
export function normalizeSidecarReply(raw: SidecarReply, currency?: string): ParsedReceipt {
  const cur = raw.currency ?? currency;
  return {
    currency: cur,
    items: (raw.items ?? [])
      .map((it) => ({ description: String(it.description ?? '').trim() || 'Item', amount: toMinor(it.amount, cur) ?? 0 }))
      .filter((it) => it.amount > 0),
    tax: toMinor(raw.tax, cur),
    tip: toMinor(raw.tip, cur),
    discount: toMinor(raw.discount, cur),
  };
}
