# Fix Patch Summary — 4 Files Per Box

Applied identically across 7 independently-deployed portals. Four files per box, same shape everywhere.

## File map

| File | Change |
|---|---|
| `src/auth.ts` | Session lifetime `expiresIn: 31536000`; cookie scope driven by an opt-in flag |
| `src/auth.config.ts` | Edge-safe config; no Node-only imports so the middleware bundle stays clean |
| `src/middleware.ts` | Validate `get-session`; clear stale cross-box cookies; enforce front-door redirect |
| `.env.local` | `AUTH_COOKIE_DOMAIN` removed (opt-in, off); front-door map populated |

## Patch 1 — session lifetime

```ts
session: {
  strategy: "database",   // per-box Postgres is the session store
  maxAge: 31536000,       // 365 days — deliberately under the RFC 6265bis 400-day cap
  updateAge: 86400,       // refresh at most once a day
},
```

`maxAge` above 400 days is rejected by browsers and yields **no cookie**, so an over-large value fails silently. 365 days is inside the ceiling on purpose.

## Patch 2 — cookie scope becomes opt-in

```ts
const CROSS_DOMAIN = process.env.AUTH_COOKIE_DOMAIN_OPT_IN === "1";

cookies: {
  sessionToken: {
    name: "session-token",
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      // Host-only unless a deployment explicitly opts in.
      // A shared parent domain implies an SSO that per-box databases cannot provide.
      ...(CROSS_DOMAIN ? { domain: process.env.AUTH_COOKIE_DOMAIN } : {}),
    },
  },
},
```

The default is host-only. Opting in is a deliberate, per-deployment decision.

## Patch 3 — middleware validates instead of assuming

```ts
export async function middleware(req: NextRequest) {
  const session = await getSessionFromCookie(req);

  // A cookie that is present but yields no session is a STALE cross-box cookie.
  // Clear it so the request becomes honestly anonymous and the normal
  // redirect path handles it. Never let the half-auth state survive.
  if (req.cookies.has(SESSION_COOKIE) && !session) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const slug = frontDoorSlug(session.user.email, req.nextUrl.host);
  if (slug && !req.nextUrl.pathname.startsWith(`/c/${slug}`)) {
    return NextResponse.redirect(new URL(`/c/${slug}/`, req.url));
  }
  return NextResponse.next();
}
```

**Why this matters:** the previous code tolerated a cookie without a session, which produced a state where middleware saw an anonymous user while the page rendered an authenticated view. Deleting the bad cookie eliminates the contradictory state entirely, rather than adding a branch to cope with it.

## Patch 4 — front-door routing as declared data

```ts
// Explicit tenant-routing map. Auditable in review; not an emergent
// side effect of cookie scope.
const FRONTDOOR: Map<string, string> = new Map([
  ["client-a@example.com", "tenant-a"],
  ["client-b@example.com", "tenant-b"],
  // ...
]);
```

An explicit map can be diffed, reviewed, and tested. Emergent routing derived from cookie attributes cannot.

## Cutover discipline

Applied fleet-wide with two rules:

1. **Run the cutover when the counterparts are asleep and no clients are on the platforms** — login changes ripple across every box simultaneously.
2. **Back up before touching anything.** Every box kept `.env.local.bak.<change>` and `src/auth.config.ts.bak.<change>` alongside the changed files.

## Rollback

Each patch is independently reversible:

- Patch 1: lower `maxAge`, redeploy.
- Patch 2: remove the opt-in env var; cookie reverts to host-only on next build.
- Patch 3: revert the middleware file from the `.bak`.
- Patch 4: revert the front-door map.

There was no schema migration and no data mutation, so rollback is a code revert plus a rebuild. That property was a deliberate design constraint — **prefer fixes that are reversible without touching data.**
