import { describe, expect, it } from 'vitest';
import { buildCsp, CSP_HEADER, CSP_REPORT_ONLY_HEADER, cspHeaderName } from './csp';

const nonce = 'dGVzdC1ub25jZS12YWx1ZQ==';

/** Read a directive's value out of a policy string. */
function directive(policy: string, name: string): string | undefined {
  for (const part of policy.split(';')) {
    const trimmed = part.trim();
    if (trimmed === name) return '';
    if (trimmed.startsWith(`${name} `)) return trimmed.slice(name.length + 1);
  }
  return undefined;
}

describe('buildCsp — required directives', () => {
  const policy = buildCsp({ nonce, apiUrl: 'https://api.example.com' });

  it('includes the nonce in script-src', () => {
    expect(directive(policy, 'script-src')).toContain(`'nonce-${nonce}'`);
  });

  it('never allows unsafe-inline in script-src', () => {
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
  });

  it('omits unsafe-eval in production', () => {
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-eval'");
  });

  it('adds unsafe-eval in development for Fast Refresh', () => {
    const dev = buildCsp({ nonce, dev: true });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
  });

  it('sets the hardening directives', () => {
    expect(directive(policy, 'default-src')).toBe("'self'");
    expect(directive(policy, 'object-src')).toBe("'none'");
    expect(directive(policy, 'base-uri')).toBe("'self'");
    expect(directive(policy, 'form-action')).toBe("'self'");
    expect(directive(policy, 'frame-ancestors')).toBe("'none'");
    expect(directive(policy, 'img-src')).toBe("'self' data: blob:");
    expect(directive(policy, 'font-src')).toBe("'self'");
    // A valueless directive must not emit a trailing space.
    expect(policy).toContain('upgrade-insecure-requests');
  });
});

describe('buildCsp — strict-dynamic', () => {
  it('is on by default, because the root layout reads the nonce', () => {
    expect(directive(buildCsp({ nonce }), 'script-src')).toContain("'strict-dynamic'");
  });

  it('can be turned off, which is the escape hatch if Next stops stamping nonces', () => {
    const policy = buildCsp({ nonce, strictDynamic: false });
    expect(directive(policy, 'script-src')).not.toContain("'strict-dynamic'");
    expect(directive(policy, 'script-src')).toContain("'self'");
  });
});

describe('buildCsp — connect-src origins', () => {
  it('lists the API origin', () => {
    const policy = buildCsp({ nonce, apiUrl: 'https://talenttrust-backend.vercel.app' });
    expect(directive(policy, 'connect-src')).toContain('https://talenttrust-backend.vercel.app');
  });

  it('lists RPC and Horizon origins', () => {
    const policy = buildCsp({
      nonce,
      apiUrl: 'https://api.example.com',
      rpcUrls: ['https://soroban-testnet.stellar.org'],
      horizonUrls: ['https://horizon-testnet.stellar.org'],
    });
    const connect = directive(policy, 'connect-src') ?? '';
    expect(connect).toContain('https://soroban-testnet.stellar.org');
    expect(connect).toContain('https://horizon-testnet.stellar.org');
  });

  it('reduces a URL with a path to its origin', () => {
    const policy = buildCsp({ nonce, apiUrl: 'https://api.example.com/v1/contracts?x=1' });
    const connect = directive(policy, 'connect-src') ?? '';
    expect(connect).toContain('https://api.example.com');
    expect(connect).not.toContain('/v1/contracts');
  });

  it('drops malformed origins instead of widening the policy', () => {
    // A bad env var must not become a directive value the browser rejects
    // wholesale, which would silently disable the whole policy.
    const policy = buildCsp({
      nonce,
      apiUrl: 'not a url',
      rpcUrls: ['', 'javascript:alert(1)'],
      horizonUrls: ['ftp://nope.example.com'],
    });
    const connect = directive(policy, 'connect-src') ?? '';
    expect(connect).not.toContain('not a url');
    expect(connect).not.toContain('javascript:');
    expect(connect).not.toContain('ftp://');
    expect(connect).toBe("'self'");
  });

  it('de-duplicates origins', () => {
    const policy = buildCsp({
      nonce,
      apiUrl: 'https://api.example.com',
      rpcUrls: ['https://api.example.com'],
    });
    const occurrences = (directive(policy, 'connect-src') ?? '')
      .split(' ')
      .filter((s) => s === 'https://api.example.com').length;
    expect(occurrences).toBe(1);
  });

  it('adds websocket and localhost origins in development', () => {
    const policy = buildCsp({ nonce, dev: true, apiUrl: 'https://api.example.com' });
    const connect = directive(policy, 'connect-src') ?? '';
    // A secure origin's websocket equivalent is wss:, not ws:.
    expect(connect).toContain('wss://api.example.com');
    expect(connect).toContain('ws://localhost:*');
  });

  it('maps a plain-http origin to ws: in development', () => {
    const policy = buildCsp({ nonce, dev: true, apiUrl: 'http://api.example.com' });
    expect(directive(policy, 'connect-src') ?? '').toContain('ws://api.example.com');
  });
});

describe('buildCsp — nonce handling', () => {
  it('rejects an empty nonce rather than emitting an unusable policy', () => {
    expect(() => buildCsp({ nonce: '' })).toThrow(/nonce/i);
  });

  it('does not reuse a value across calls', () => {
    const a = buildCsp({ nonce: 'aaa' });
    const b = buildCsp({ nonce: 'bbb' });
    expect(a).not.toBe(b);
  });
});

describe('cspHeaderName', () => {
  it('defaults to the enforcing header', () => {
    expect(cspHeaderName(undefined)).toBe(CSP_HEADER);
    expect(cspHeaderName('0')).toBe(CSP_HEADER);
  });

  it('switches to report-only for the rollout', () => {
    expect(cspHeaderName('1')).toBe(CSP_REPORT_ONLY_HEADER);
  });
});
