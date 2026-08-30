// SOT: hono-app-type, request-context, error-shape
// WHAT:  the typed context every route and middleware shares.
// WHY:   `c.get('orgId')` has to be the session's tenant, not something a caller can
//        set. Typing the variables makes that a compile-time guarantee rather than a
//        convention.
// WHERE: middleware in src/lib/auth.ts; routes in src/routes/

import type { Hono, MiddlewareHandler } from 'hono';
import type { Organization, Screen, User } from '../db/schema.js';

/** A session user with branch_ids already parsed out of its JSON column. */
export type SessionUser = Omit<User, 'branch_ids'> & { branch_ids: string[] };

export type Variables = {
  /** Set by requireAuth. */
  user: SessionUser;
  /** The tenant this request acts in — from the session, never from input. */
  orgId: string;
  org: Organization | null;
  impersonated: boolean;
  /** Set by requireDevice, on the TV client's own routes. */
  screen: Screen;
};

export type AppEnv = { Variables: Variables };
export type App = Hono<AppEnv>;
export type Middleware = MiddlewareHandler<AppEnv>;

/** Every error response in the API is `{ error, ...detail }`. */
export type ApiError = { error: string } & Record<string, unknown>;
