# Middleware — validate, don't assume

The load-bearing change. The previous middleware tolerated a cookie without a
session, which produced a state where middleware saw an anonymous request while
the page rendered an authenticated view. Both "allow" and "deny" reasoning break
when the two layers disagree.

`src/middleware.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "session-token";

/**
 * Front-door routing map. Explicit and reviewable.
 * Routing derived from cookie attributes is invisible in review and
 * impossible to unit test.
 */
const FRONTDOOR = new Map<string, string>([
  ["tenant-a-admin@example.com", "tenant-a"],
  ["tenant-b-admin@example.com", "tenant-b"],
]);

function frontDoorSlug(email: string | null | undefined, host: string): string | undefined {
  if (!email) return undefined;
  const slug = FRONTDOOR.get(email.toLowerCase());
  if (!slug) return undefined;
  // Only redirect when we are NOT already on the tenant's own host.
  return host.startsWith(`${slug}.`) ? undefined : slug;
}

export async function middleware(req: NextRequest) {
  const hasCookie = req.cookies.has(SESSION_COOKIE);

  // Read the session with the edge-safe config (no Node-only imports).
  const session = await getEdgeSession(req);

  // STALE COOKIE: present but yields no session. This is what a cross-box
  // cookie looks like on a box with a different database. Clear it so the
  // request becomes honestly anonymous instead of half-authenticated.
  if (hasCookie && !session) {
    const res = NextResponse.redirect(new URL("/login", req.url));
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const slug = frontDoorSlug(session.user.email, req.nextUrl.host);
  if (slug && !req.nextUrl.pathname.startsWith(`/c/${slug}`)) {
    return NextResponse.redirect(new URL(`/c/${slug}/`, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
```

## Why not just "if no session, 403"?

Because the half-auth state is reachable through a path the app does not control:
a cookie minted by another deployment in the same parent domain. A guard that
merely rejects does not remove the cookie, so the browser presents it again on
every subsequent request — an infinite loop of rejections with no self-repair.
**Clearing the cookie converts an unrecoverable state into a recoverable one.**
