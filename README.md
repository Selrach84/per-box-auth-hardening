# Per-Box Auth Hardening

Fixing fleet-wide session kick-outs across **7 independently-deployed Next.js portals** that each ran their own Postgres, but shared one cookie domain — an SSO topology that could not possibly work.

This is the de-identified engineering write-up, patch pattern, and verification record from a real production fleet. No client names, hostnames, credentials, or proprietary business data.

---

## The symptom

Clients were being logged out of their portals at random, and admins could not hop between tenant boxes without re-authenticating. Support kept restarting services, which never helped — because the cause was configuration, not availability.

## What was actually wrong

Investigated by **live probes only** — explicitly refusing to trust existing documentation. Method: before/after HTTP and API checks, remote shell reads of source and env on each box, and a clone of the upstream GitHub template to confirm what still shipped by default.

Five distinct defects, all present simultaneously:

| # | Defect | Effect |
|---|---|---|
| 1 | Session `expiresIn` set to **7 days** | Clients logged out weekly, mid-work |
| 2 | Admin cookie scoped `Domain=.app.example.com` | Implied a cross-box SSO that per-box Postgres cannot provide. Cross-box sign-in failed with `INVALID_EMAIL_OR_PASSWORD`. |
| 3 | Admin cookie granted **half-auth** | `get-session` returned `null` while `/work/` returned **HTTP 200** — a page rendered for a session the app considered absent |
| 4 | Client route `/me` returned **404** | Broke every deep link and post-login redirect |
| 5 | Front-door map covered only one domain | Multi-tenant routing silently single-tenant |

The critical insight: **a shared cookie domain is not an SSO.** Seven databases cannot share a session. The original author had copied a centralised deployment's cookie config into a per-box fleet, and the fleet inherited an assumption that was never true.

## The fix — 4 files per box

1. **Session lifetime** raised to `expiresIn: 31536000` (365 days) — deliberately below the RFC 6265bis 400-day cookie cap, so the browser does not reject it.
2. **Cross-subdomain cookies made opt-in** behind an explicit flag, **off by default**. A fleet should not inherit SSO it cannot support.
3. **Middleware validates `get-session` and clears stale cross-box cookies** — the half-auth state becomes impossible rather than merely unlikely.
4. **Broken SSO replaced with an explicit front-door handoff** — routing is a declared map, not an emergent side effect of cookie scope.

See [`docs/fix-patch-summary.md`](docs/fix-patch-summary.md) for the patch shape and [`examples/`](examples/) for genericised reference implementations.

## Verification

Nothing here is "should work". Post-deploy, on every box:

```
admin cookie        → host-only, Max-Age=31536000      ✅
client /me          → 307 → /c/<slug>/ for all 6       ✅
front-door          → correct redirectSlug             ✅
all 7 boxes         → RUNNING, {"ok":true}             ✅
```

Probe users created for the test were deleted afterwards. Full record: [`docs/verification.md`](docs/verification.md).

**Honest residual:** the upstream template push was still pending at the time of handover. Recorded here rather than quietly omitted.

## Read this before copying it

[`SECURITY.md`](SECURITY.md) documents the one knowingly-accepted tradeoff in the wider system (a shared `AUTH_SECRET` that buys seamless hopping at the cost of per-box session isolation) and why we would not make that choice again on a fleet of independent databases.

## Layout

```
docs/root-cause.md           the five defects, with the probe that found each
docs/fix-patch-summary.md    the 4-file patch pattern
docs/verification.md         before/after evidence per box
examples/                    genericised middleware + cookie config reference
SECURITY.md                  known tradeoffs and threat model
```

## The transferable lesson

**Verify the serving stack before declaring collateral damage. A shared cookie domain is not a shared session.** Most of the time lost on this incident went to a wrong hypothesis — that a central service had broken the client boxes — when the boxes were simply Next servers behind a CDN with their own auth.

## License

MIT — see [LICENSE](LICENSE).
