# Cookie configuration — host-only by default

`src/auth.config.ts` (edge-safe) and the session block in `src/auth.ts`.

```ts
// src/auth.config.ts — EDGE SAFE.
// No `pg`, no `fs`, no Node-only imports. Anything Node-only here bloats
// the middleware bundle and can break the edge runtime.
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  providers: [Google],
  pages: { signIn: "/login" },
  session: {
    strategy: "database" as const,
    // 365 days. Deliberately below the RFC 6265bis 400-day cap:
    // a value above the cap is rejected by browsers and yields NO cookie.
    maxAge: 31536000,
    updateAge: 86400,
  },
} satisfies NextAuthConfig;
```

```ts
// src/auth.ts — Node side. This module hits Postgres.
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { one } from "@/lib/db";

/**
 * Whether this deployment opts into a shared parent cookie domain.
 *
 * DEFAULT OFF, ON PURPOSE.
 * A shared cookie Domain is a DELIVERY mechanism. It is not a shared session
 * store. Boxes with their own Postgres cannot validate each other's sessions,
 * so a shared domain produces cookies that are transported everywhere and
 * valid nowhere — the half-auth state.
 *
 * Opt in only when a deployment genuinely shares one database.
 */
const CROSS_DOMAIN_OPT_IN = process.env.AUTH_COOKIE_DOMAIN_OPT_IN === "1";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  cookies: {
    sessionToken: {
      name: "session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: true,
        ...(CROSS_DOMAIN_OPT_IN
          ? { domain: process.env.AUTH_COOKIE_DOMAIN }
          : {}), // host-only — the correct default for a per-box fleet
      },
    },
  },
  callbacks: {
    async signIn({ user }) {
      // Two-layer allowlist: operators by env, runtime users by table.
      // Role is EXPLICIT — never derived from the email domain.
      // Domain-derived admin was removed: an email domain is not an
      // authorisation boundary, it is a naming convention.
      return isOperator(user.email) || (await isPortalUser(user.email));
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const portalRole = await lookupPortalRole(user.email);
        token.role = isOperator(user.email) ? "admin" : portalRole ? "client" : undefined;
        token.manage = isOperator(user.email) || portalRole === "admin";
      }
      return token;
    },
  },
});
```

## The two rules worth taking away

1. **Never derive authorisation from an email domain.** An earlier version auto-granted admin to a whole company domain. A domain is a naming convention, not a security boundary; it was replaced with an explicit allowlist plus a runtime user table.
2. **Cookie scope defaults to the least reach that works.** Widen it only when a deployment demonstrably shares a session store. Widening it "for convenience" is how a fleet inherits an SSO it cannot honour.
