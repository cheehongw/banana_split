import { describe, expect, it } from 'vitest';
import { parseGroupRef } from './joinRef';

describe('parseGroupRef', () => {
  const id = '11111111-2222-3333-4444-555555555555';

  it('returns a bare id unchanged', () => {
    expect(parseGroupRef(id)).toBe(id);
  });

  it('trims surrounding whitespace', () => {
    expect(parseGroupRef(`  ${id}  `)).toBe(id);
  });

  it('extracts the id from a full startapp deep link', () => {
    expect(parseGroupRef(`https://t.me/melonsplatbot?startapp=${id}`)).toBe(id);
  });

  it('stops at a trailing query param after the id', () => {
    expect(parseGroupRef(`https://t.me/bot?startapp=${id}&mode=compact`)).toBe(id);
  });

  it('decodes a percent-encoded id', () => {
    expect(parseGroupRef('https://t.me/bot?startapp=a%2Db')).toBe('a-b');
  });

  it('ignores a leading param before startapp', () => {
    expect(parseGroupRef(`https://t.me/bot?foo=1&startapp=${id}`)).toBe(id);
  });
});
