/**
 * Content Security Policy construction.
 *
 * Kept as a pure function so the policy can be unit-tested without a server:
 * `src/proxy.ts` only supplies the per-request nonce and the configured origins.
 *
 * The policy is nonce-based rather than allowlist-based. With
 * `'strict-dynamic'` in `script-src`, browsers ignore host allowlists for
 * scripts and trust only scripts carrying the per-request nonce (plus whatever
 * those scripts load themselves), which is what makes a nonce meaningful here:
 * an injected `<script src="https://evil.example">` cannot execute even if the
 * origin were somehow allowed.
 */

export interface CspOrigins {
  /** The backend API origin, e.g. `https://talenttrust-backend.vercel.app`. */
  apiUrl?: string;
  /** Soroban RPC endpoints the app may talk to. */
  rpcUrls?: readonly string[];
  /** Horizon endpoints the app may talk to. */
  horizonUrls?: readonly string[];
}

export interface CspOptions extends CspOrigins {
  /** Per-request nonce. Must never be reused across requests. */
  nonce: string;
  /** Development mode relaxes `script-src` for Fast Refresh and allows HMR sockets. */
  dev?: boolean;
  /**
   * Add `'strict-dynamic'` to `script-src`. On by default, but it **only works
   * while `src/app/layout.tsx` reads the nonce from `headers()`**.
   *
   * `'strict-dynamic'` makes browsers ignore host allowlists in `script-src`,
   * so `'self'` stops covering `/_next/static/chunks/*.js`. Next then has to
   * stamp the nonce onto every script tag it emits — including its own inline
   * bootstrap scripts — and it only does that when the root layout actually
   * reads `x-nonce`. Measured in a real browser on `/`:
   *
   *   - layout does NOT read the nonce: 10 violations, every chunk and inline
   *     script blocked, "host-based allowlisting is disabled ... The action has
   *     been blocked", app renders blank.
   *   - layout DOES read the nonce: 0 violations; 11 of 11 script tags carry
   *     the nonce.
   *
   * So this option is coupled to that read. If the read is ever removed, the
   * app breaks loudly rather than degrading, which is why the coupling is
   * documented here and in docs/security-headers.md.
   */
  strictDynamic?: boolean;
}

/**
 * Normalise an origin for a CSP source expression.
 *
 * Returns `undefined` for anything that is not a usable http(s)/ws(s) origin,
 * so a malformed env var cannot silently widen the policy or emit a directive
 * value the browser will reject wholesale.
 */
function asOrigin(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** WebSocket origins a page may open, derived from its http origins. */
function toWebSocketOrigins(origins: readonly string[]): string[] {
  return origins.map((o) => o.replace(/^http/, 'ws'));
}

/**
 * Build the policy string.
 *
 * `connect-src` is the only directive that varies with configuration: it lists
 * the API, RPC and Horizon origins the app legitimately calls, because those
 * are cross-origin and would otherwise be blocked.
 */
export function buildCsp(options: CspOptions): string {
  const { nonce, dev = false, strictDynamic = true } = options;

  if (!nonce) {
    throw new Error('buildCsp requires a nonce; an empty nonce would make the policy unusable');
  }

  const api = asOrigin(options.apiUrl);
  const rpc = (options.rpcUrls ?? []).map(asOrigin).filter((o): o is string => Boolean(o));
  const horizon = (options.horizonUrls ?? []).map(asOrigin).filter((o): o is string => Boolean(o));

  const connect = ['\'self\'', ...new Set([api, ...rpc, ...horizon].filter(Boolean) as string[])];
  if (dev) {
    // The dev server's HMR channel is a WebSocket back to the same host.
    connect.push(...toWebSocketOrigins(connect.filter((o) => o !== '\'self\'')));
    connect.push('ws://localhost:*', 'http://localhost:*');
  }

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // Requires the root layout to read the nonce; see the option's doc comment.
    ...(strictDynamic ? ["'strict-dynamic'"] : []),
    // Fast Refresh evaluates modules at runtime.
    ...(dev ? ["'unsafe-eval'"] : []),
  ].join(' ');

  const directives: Array<[string, string]> = [
    ['default-src', "'self'"],
    ['script-src', scriptSrc],
    // React's `style={{...}}` attributes are inline styles, which CSP governs
    // through style-src. Removing 'unsafe-inline' here would require dropping
    // every inline style in the app; tracked separately, not part of this change.
    ['style-src', "'self' 'unsafe-inline'"],
    ['img-src', "'self' data: blob:"],
    ['font-src', "'self'"],
    ['connect-src', connect.join(' ')],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ['upgrade-insecure-requests', ''],
  ];

  return directives
    .map(([name, value]) => (value ? `${name} ${value}` : name))
    .join('; ');
}

/** The response header the policy is served under. */
export const CSP_HEADER = 'Content-Security-Policy';

/** The report-only variant, used while rolling the policy out. */
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';

/**
 * Which CSP header to set, honouring the `CSP_REPORT_ONLY=1` rollout switch.
 *
 * A report-only policy is enforced nowhere, so it is the safe way to find
 * violations in production before switching to enforcing.
 */
export function cspHeaderName(reportOnly: string | undefined): string {
  return reportOnly === '1' ? CSP_REPORT_ONLY_HEADER : CSP_HEADER;
}
