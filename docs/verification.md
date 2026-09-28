# Verification Record

Every assertion below was produced by observing a running system after deploy. Where a claim could not be verified, it is listed under **Not verified** rather than omitted.

## Pre-deploy baseline

| Check | Observed (before) |
|---|---|
| Admin session cookie `Domain` | `.app.example.com` (shared parent) |
| Session `maxAge` | 7 days |
| Client `/me` | `404` |
| Cross-box sign-in | `INVALID_EMAIL_OR_PASSWORD` |
| Cookie present + `get-session` | cookie present, session `null`, `/work/` → `200` |
| Front-door map entries | 1 |
| Box status | 7 boxes up, `{"ok":true}` |

The half-auth row is the one that mattered: an authenticated page served to a request the app considered anonymous.

## Post-deploy verification

| Check | Observed (after) |
|---|---|
| Admin cookie `Domain` | **host-only** (no `Domain` attribute) |
| Admin cookie `Max-Age` | **31536000** |
| Client `/me` | **307 → `/c/<slug>/`** for all 6 clients |
| Front-door `redirectSlug` | correct per tenant |
| Fleet status | **all 7 boxes RUNNING, `{"ok":true}`** |
| Stale cross-box cookie | cleared; request becomes anonymous; login redirect correct |

## Self-heal behaviour

A browser still holding a stale host-scoped cookie self-heals **without a re-login**: middleware detects the cookie-without-session case, clears it, and the next request mints a correct session in the same flow. Verified in a real browser, not a headless fetcher — the failure mode being tested was browser cookie storage, which a headless client does not model faithfully.

## Test hygiene

Probe users created for the verification pass were **deleted afterwards**. No production credentials were used for probing, and no client data was read during the sweep — every assertion is a status code, a header, or a cookie attribute.

## Honest residual

**Not verified at handover:**

- **Upstream template push was still pending.** The fix was live on all 7 boxes but not yet merged back to the template that provisions new boxes. Any box provisioned before that merge would have been born with the original defects.
- **Long-duration soak not run.** The 365-day expiry was verified as a cookie attribute, not by waiting. The claim is that the attribute is set correctly and is within the browser cap — not that a session survived a year in the field.
- **Cross-browser matrix not exhaustive.** Verification was performed in one mainstream browser. Safari's stricter cookie policies (notably around `SameSite`) were not exercised.

Recording these matters more than the green rows: a verification record that only lists passes is a marketing document, not evidence.

## Verification method, stated plainly

The reason these probes are trustworthy is that they are **independent of the code being tested**. A unit test and a patch can both be wrong in the same direction. A cookie attribute read off a live response, or a 307 observed from an external client, cannot be — it is the deployed artifact describing itself.
