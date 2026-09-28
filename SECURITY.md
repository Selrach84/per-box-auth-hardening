# Security Notes & Threat Model

Explicit about what this codebase does, what it does not do, and where a
deployment can make it worse.

## The design, stated plainly

Each portal box is an **independent security domain**. It runs its own Next.js
app and its own Postgres. Authentication is local. No box can mint a session that
another box trusts.

This is the opposite of the common "shared identity provider" pattern, and it was
chosen deliberately: the tenants are clients of a single operator, not a single
organisation. Independent databases were the requirement, so independent sessions
follow from it.

## Known tradeoff — cited from a wider system, not this one

A related deployment in the same estate did the opposite of what this repo
recommends: it set a **shared `AUTH_SECRET` across all boxes plus a shared cookie
domain**, to let an operator sign in once and hop between tenants without
re-authenticating.

That worked. It also meant **one compromised box could mint valid sessions for
every box** — per-box isolation traded for operator convenience.

If you are considering the same trade:

| | Shared secret + shared domain | This repo (per-box, host-only) |
|---|---|---|
| Operator experience | seamless hopping | re-auth per box |
| Blast radius of one box compromise | **all boxes** | that box only |
| Reversible at runtime | yes, remove the cookie domain and rebuild | n/a |
| Correct when databases are per-box | **no** — sessions cannot validate | yes |

**Recommendation:** keep per-box isolation and solve operator convenience at the
routing layer (front-door handoff, one link per tenant), not by widening the trust
boundary. Convenience is a UI problem; a shared secret is an architecture problem.

## Threat model — what this handles

| Threat | Handling |
|---|---|
| Stolen session cookie used on another tenant box | Host-only scope means the cookie is never transmitted cross-box |
| Stale/incoherent cookie causing auth confusion | Middleware clears it; request becomes explicitly anonymous |
| Domain-shaped privilege escalation | Authorisation is an explicit allowlist + user table, never a domain match |
| Privilege escalation via role claim tampering | Role resolved server-side at sign-in; sessions are database-backed, not client-held JWTs |

## Threat model — what this does NOT handle

- **No rate limiting on the login endpoint.** Add it at the edge or in the app; this repo does not ship it.
- **No session revocation UI.** Database sessions can be deleted directly, but there is no operator-facing "log out all users" control.
- **No MFA.** This deployment relied on the identity provider for that. If you use email/password, add MFA — a long session lifetime is only as safe as the factor that created it.
- **Long session lifetime (365 days) amplifies any credential compromise.** The lifetime was chosen for a workflow where weekly re-auth caused real business harm. If your threat model differs, shorten it. **Do not copy `31536000` without deciding it is right for you.**
- **`sameSite: "lax"`** permits top-level cross-site GET navigation to carry the cookie. That is standard and appropriate here, but it is a choice, not a default to inherit blindly.

## Data handling

This repository contains **no** client data, credentials, hostnames, tenant
identifiers, or production configuration. Examples use `example.com` and
placeholder tenant slugs. The verification record contains status codes, header
values, and cookie attributes only.

## Reporting

Open an issue for anything in the reference code. For anything in a deployed
system, contact the operator of that system — this repository is not that system
and cannot fix it.
