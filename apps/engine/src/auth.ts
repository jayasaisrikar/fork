import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { schema, type Db } from '@fork/db';
import { eq } from 'drizzle-orm';

const { sessions } = schema;
const SESSION_HOURS = 12;

export const SESSION_COOKIE = 'fork_session';
export const CSRF_HEADER = 'x-csrf-token';

export interface CfoAccount {
  email: string;
  password: string;
}

export type Session = typeof sessions.$inferSelect;

const digest = (value: string) => createHash('sha256').update(value).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

// demo auth: one CFO, password from env
export function login(
  db: Db,
  cfo: CfoAccount,
  email: unknown,
  password: unknown,
  now: Date,
): Session | undefined {
  if (typeof email !== 'string' || typeof password !== 'string') return undefined;
  if (
    !cfo.password ||
    !same(email.toLowerCase(), cfo.email.toLowerCase()) ||
    !same(password, cfo.password)
  ) {
    return undefined;
  }
  return db
    .insert(sessions)
    .values({
      id: randomBytes(32).toString('hex'),
      email: cfo.email,
      csrfToken: randomBytes(32).toString('hex'),
      expiresAt: new Date(now.getTime() + SESSION_HOURS * 3_600_000).toISOString(),
    })
    .returning()
    .get();
}

export function findSession(db: Db, id: string | undefined, now: Date): Session | undefined {
  if (!id) return undefined;
  const session = db.select().from(sessions).where(eq(sessions.id, id)).get();
  return session && session.expiresAt > now.toISOString() ? session : undefined;
}

export function logout(db: Db, id: string) {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export const csrfMatches = (session: Session, header: string | undefined) =>
  Boolean(header) && same(session.csrfToken, header ?? '');
