import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, cspHeaderName } from '@/lib/csp';
import { site } from '@/lib/site';

/**
 * Per-request Content Security Policy.
 *
 * Next 16 renamed the `middleware` convention to `proxy`; this file is the
 * proxy entry point. It generates a fresh nonce for every request, sets the CSP
 * response header, and forwards the nonce to the render pass as `x-nonce` so
 * the root layout can attach it to inline scripts.
 *
 * Nothing is cached or shared between requests: a nonce that repeats is not a
 * nonce, and a shared one would let an injected script reuse it.
 */

/** CSP nonces must be base64 and unpredictable; 16 random bytes is the common floor. */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();

  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    apiUrl: site.apiUrl,
    // Configured rather than hard-coded: adding an endpoint is an env change,
    // not a code change. See docs/security-headers.md.
    rpcUrls: [process.env.NEXT_PUBLIC_SOROBAN_RPC_URL].filter(Boolean) as string[],
    horizonUrls: [process.env.NEXT_PUBLIC_HORIZON_URL].filter(Boolean) as string[],
  });

  // Forward the nonce on the REQUEST as well as the response.
  //
  // `x-nonce` is the documented handoff for application code (the root layout
  // reads it). The `Content-Security-Policy` request header is what Next's own
  // renderer reads to stamp the nonce onto the framework's <script> tags —
  // and that stamping is load-bearing here: `'strict-dynamic'` makes browsers
  // ignore `'self'` in `script-src`, so without it every `/_next/static` chunk
  // is blocked and the app renders blank.
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set(cspHeaderName(process.env.CSP_REPORT_ONLY), csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set(cspHeaderName(process.env.CSP_REPORT_ONLY), csp);
  return response;
}

export const config = {
  /**
   * Skip static assets. The policy only matters for documents the browser
   * parses, and running the proxy over every image and chunk costs a function
   * invocation for no benefit.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff|woff2|ttf|otf)$).*)',
  ],
};
