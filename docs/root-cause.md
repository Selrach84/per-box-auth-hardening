# Root Cause — Five Simultaneous Defects

> Method rule applied throughout: **live probes only, no documentation trust.**
> Every claim below was established by observing a running system, not by reading a wiki.

## Why documentation was not trusted

The incident had already survived several rounds of "we fixed it" because the available documentation described the *intended* architecture, not the deployed one. The intended design was a coherent centralised platform. The deployed reality was a fleet of independent boxes that had inherited configuration from that centralised ancestor.

The gap between those two things **was** the bug. Reading the docs first would have reproduced the misunderstanding.

## Probe inventory

| Probe | What it established |
|---|---|
| Before/after HTTP status + headers on `/`, `/me`, `/work/`, `/c/<slug>/` | Which routes actually served, and with which cookie |
| Remote shell reads of `src/auth.ts`, `src/auth.config.ts`, `.env.local` per box | The real session config, on the real hosts |
| `git clone` of the upstream template + grep | Whether the 7-day default still shipped upstream |
| Cross-box sign-in attempt with a valid account | Whether the implied SSO existed at all |
| Cookie attribute dump (`Domain`, `Max-Age`, `Secure`, `HttpOnly`, `SameSite`) | The actual scope of the session cookie |

## Defect 1 — 7-day session expiry

**Observed:** session cookie `Max-Age` corresponded to 7 days.

**Effect:** every client was ejected from the portal weekly. Because the ejections were spread across the week and across tenants, they presented as random support noise rather than a schedule.

**Fix:** `expiresIn: 31536000` (365 days).

**Why not "whatever the maximum is":** RFC 6265bis caps cookie lifetime at 400 days, and browsers enforce it. A value above the cap is rejected outright, so the naive "set it huge" fix silently produces *no cookie at all*. 365 days is deliberately inside the ceiling.

## Defect 2 — cookie scoped to a shared parent domain

**Observed:** the admin session cookie was set with `Domain=.app.example.com`, while every box ran its own Postgres with its own user table.

**Effect:** the cookie was sent to every box. Each box dutifully tried to validate a session minted by a *different* database and failed. Cross-box sign-in returned `INVALID_EMAIL_OR_PASSWORD` — an error that reads like a wrong password and sent people hunting for credential problems that did not exist.

**Root cause:** a shared cookie domain is a *delivery* mechanism. It is not a shared session store. Seven databases cannot share a session. The configuration had been copied from a centralised deployment where a single database made the scope coherent.

**Fix:** cross-subdomain cookie scope became **opt-in behind an explicit flag, off by default.** A per-box fleet does not inherit SSO it cannot support.

## Defect 3 — half-auth state

**Observed:** with the admin cookie present, `get-session` returned `null`, but `/work/` returned **HTTP 200**.

**Effect:** the app could not see a session while still rendering authenticated pages for it. This is the worst class of auth defect: middleware believes the user is anonymous, the page believes the user is logged in, and neither is authoritative. It defeats both "deny" and "allow" reasoning.

**Fix:** middleware now **validates `get-session` and clears stale cross-box cookies.** Deleting the incoherent cookie converts a silent half-auth into an explicit anonymous request, which the normal redirect path handles correctly.

**Design principle:** make the invalid state *impossible*, not merely *unlikely*. A guard that tolerates a contradictory session will eventually serve one.

## Defect 4 — client route 404

**Observed:** `/me` returned 404 on client boxes, while working on the admin box.

**Effect:** post-login redirects and every deep link landed on an error page. Users perceived this as "the portal is down".

**Fix:** route restored; front-door redirect target corrected to `/c/<slug>/`.

## Defect 5 — single-domain front-door map

**Observed:** the front-door slug map contained one entry.

**Effect:** in a multi-tenant deployment, routing was effectively single-tenant. Every other client's login had no destination.

**Fix:** the map was populated for all clients, and made a **declared, explicit structure** rather than an emergent behaviour of cookie scope. Declared routing is auditable; emergent routing is not.

## Through-line

Every one of the five defects was a **centralised-system assumption surviving into a per-box deployment.** None was a coding error in the ordinary sense. All five were configuration and architecture drift, which is why they resisted debugging by reading code and yielded immediately to observing running systems.

## The rule extracted

> **Load the architecture first, change second. Then verify the serving stack before declaring collateral damage.**

The costly wrong turn during this incident was inferring that a central backend outage had broken the client boxes — because a shared *data* backend was mistaken for a shared *auth* backend. The client boxes authenticate locally. They were never affected. Half a day went to a hypothesis that a single cookie dump would have eliminated.
