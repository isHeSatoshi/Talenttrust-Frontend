# Security headers

This document covers the HTTP response headers the app sets and how to change
them. The headers are applied in two places: static ones in `next.config.js`,
and the per-request Content Security Policy in `src/proxy.ts`.

> **Note on this file:** it was previously committed as a single-line base64
> blob (with some mojibake in the decoded text), so it rendered as unreadable
> garbage on GitHub. It has been rewritten as plain markdown. The material that
> was in it about manifest validation and login throttling lives in
> [`route-failure-recovery.md`](route-failure-recovery.md) and
> [`persistence.md`](persistence.md) respectively.

## Headers in use

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | see below | Defence in depth against XSS and data injection |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Forces HTTPS for 2 years. **Production only** |
| `X-Frame-Options` | `DENY` | Legacy clickjacking guard; also covered by CSP `frame-ancestors` |
| `X-Content-Type-Options` | `nosniff` | Stops MIME-type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Sends only the origin cross-origin |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disables sensitive browser features app-wide |

HSTS is set only when `NODE_ENV === 'production'`. Sending it from a local http
server would pin `localhost` to HTTPS for two years in that browser profile,
which is tedious to undo.

## Content Security Policy

Generated per request in `src/proxy.ts` by `buildCsp()` in `src/lib/csp.ts`, so
the policy itself is a pure function and is unit-tested without a server.

```
default-src 'self';
script-src 'self' 'nonce-<per-request>' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' <api> <rpc> <horizon>;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
upgrade-insecure-requests
```

| Directive | Notes |
|---|---|
| `script-src` | `'unsafe-inline'` is never present. `'unsafe-eval'` is added in development only, for Fast Refresh. |
| `style-src` | `'unsafe-inline'` is required: components use React's `style={{…}}` prop, which CSP governs through `style-src`. Removing it means eliminating every inline style in the app, which is a separate change. |
| `connect-src` | The only configuration-dependent directive. Lists the API, Soroban RPC and Horizon origins. |
| `object-src 'none'` | Blocks `<object>`, `<embed>`, `<applet>`. |
| `frame-ancestors 'none'` | CSP-native equivalent of `X-Frame-Options: DENY`. |

### The nonce

`src/proxy.ts` generates 16 random bytes with `crypto.getRandomValues` and
base64-encodes them **per request**. A nonce that repeats is not a nonce: it
would let an injected script reuse the value. Nothing is cached or shared
between requests, and the tests assert that two requests to the same route get
different nonces.

### `'strict-dynamic'` and the layout coupling — read this before changing either

`'strict-dynamic'` makes browsers **ignore host allowlists** in `script-src`.
`'self'` therefore stops covering `/_next/static/chunks/*.js`, and Next has to
stamp the nonce onto every script tag it emits — including its own inline
bootstrap scripts. Next only does that when the root layout actually reads the
nonce:

```tsx
// src/app/layout.tsx
const nonce = (await headers()).get('x-nonce') ?? undefined;
```

This was measured in a real browser on `/`, not assumed:

| Root layout reads the nonce? | Result |
|---|---|
| **No** | 10 CSP violations. Every `/_next/static` chunk and both inline scripts blocked — *"Note that 'strict-dynamic' is present, so host-based allowlisting is disabled … The action has been blocked."* No JavaScript runs; the page is blank. |
| **Yes** | 0 violations. All 11 script tags carry the nonce. |

Two consequences worth knowing:

1. **The read is load-bearing.** Removing it from the layout breaks the app
   loudly rather than degrading quietly, which is the better failure mode, but
   it does mean the CSP and the layout are coupled.
2. **It forces dynamic rendering.** Reading `headers()` opts every route out of
   static generation — the build output changes from `○ (Static)` to
   `ƒ (Dynamic)`. That is the documented cost of a per-request nonce. If static
   rendering matters more than the nonce, set `strictDynamic: false` and drop
   the `headers()` read; `script-src 'self' 'nonce-…'` still authorises inline
   scripts while `'self'` continues to cover the chunks.

To pass a nonce to an inline script, use the value the layout read:

```tsx
<script nonce={nonce} dangerouslySetInnerHTML={{ __html: '…' }} />
```

The layout renders one such tag (`#hy-csp-nonce-probe`) so the pattern has a
live, lintable example rather than only living in this document.

### Adding a new origin

`connect-src` is built from configuration, so adding an endpoint is an env
change, not a code change:

| Env var | Used for |
|---|---|
| `NEXT_PUBLIC_API_URL` | the backend API origin |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC |
| `NEXT_PUBLIC_HORIZON_URL` | Horizon |

Values are reduced to their origin, and anything that is not a valid
`http(s)` URL is **dropped** rather than emitted. That matters: a malformed
value would otherwise produce a directive the browser rejects wholesale, which
silently disables the entire policy. A unit test covers this.

### Rolling out safely

Set `CSP_REPORT_ONLY=1` to send `Content-Security-Policy-Report-Only` instead of
the enforcing header. A report-only policy blocks nothing, so it is the way to
find violations in production before switching over. The header name is chosen
by `cspHeaderName()` and unit-tested.

## Verifying locally

```bash
npm run build && npm start

# Headers, with the nonce:
curl -I http://localhost:3000/contracts

# Nonce freshness — the value must differ every time:
curl -sI http://localhost:3000/ | grep -i content-security-policy
curl -sI http://localhost:3000/ | grep -i content-security-policy

# In a browser: open each route with the console open. Zero CSP violations
# is the pass condition. A violation naming 'strict-dynamic' means the root
# layout stopped reading the nonce — see above.
```

## Known gaps

- **`'unsafe-inline'` remains on `style-src`.** See the table above.
- **No CSP violation reporting backend.** Violations are visible in the browser
  console only. `report-uri` / `report-to` would need an endpoint.
- **Subresource Integrity is not used.** No `integrity` attributes or
  build-time SRI generation for scripts and styles; that is a separate change
  with different build and rendering implications.
- **Wallet extensions are out of scope for CSP.** Extension-injected scripts
  are not subject to the page's policy, so enabling the CSP does not restrict
  Freighter. The reverse is also true: the CSP is not a defence against a
  malicious extension, and it is not claimed to be.
