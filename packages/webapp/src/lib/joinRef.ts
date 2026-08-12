/**
 * Normalize whatever a user pastes into "Join a group" down to a group id.
 * They may paste a bare id, or the whole deep link the bot posts
 * (t.me/<bot>?startapp=<id>). We pull the id out of the `startapp=` param when
 * present, otherwise treat the trimmed input as the id itself.
 */
export function parseGroupRef(input: string): string {
  const raw = input.trim();
  const match = raw.match(/startapp=([^&\s]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : raw;
}
