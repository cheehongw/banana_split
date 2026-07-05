import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db, schema } from './db';

// Authorization = membership. Identity is established by auth.ts; these guards
// ensure the authenticated caller (and any users they reference) actually belong
// to the group being read or mutated. Thrown HTTPExceptions become 403 responses.

export function isMember(groupId: string, userId: number): boolean {
  const row = db
    .select({ userId: schema.groupMembers.userId })
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)))
    .get();
  return row !== undefined;
}

/** Require that `userId` is a member of `groupId`, else 403. */
export function assertMember(groupId: string, userId: number): void {
  if (!isMember(groupId, userId)) {
    throw new HTTPException(403, { message: 'not a member of this group' });
  }
}

/** Require that every id in `userIds` is a member of `groupId`, else 403. */
export function assertAllMembers(groupId: string, userIds: number[]): void {
  for (const id of userIds) {
    if (!isMember(groupId, id)) {
      throw new HTTPException(403, { message: `user ${id} is not a member of this group` });
    }
  }
}
