'use client';

import { useEffect, useRef } from 'react';

/**
 * Last-resort error boundary.
 *
 * This replaces the root layout when the layout itself fails to render, so it
 * must supply its own `<html>` and `<body>` and cannot rely on anything the
 * layout provides — `globals.css` is not guaranteed to have loaded, which is
 * why the styles here are inline rather than class-based. That is the whole
 * reason this file is not a thin wrapper around `RouteError`.
 *
 * Deliberately dependency-free: no `Link`, no shared components, no context.
 * Anything imported here could be the thing that failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const dev = process.env.NODE_ENV === 'development';

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#f7f8fc',
          color: '#0f172a',
        }}
      >
        <main style={{ maxWidth: 520, width: '100%' }}>
          <p
            style={{
              display: 'inline-flex',
              margin: 0,
              padding: '5px 12px',
              borderRadius: 999,
              border: '1px solid #e3e7f0',
              fontSize: '0.78rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#5b6478',
            }}
          >
            Error
          </p>
          <h1
            ref={headingRef}
            tabIndex={-1}
            style={{ fontSize: '1.9rem', margin: '16px 0 8px', outline: 'none' }}
          >
            TalentTrust could not start
          </h1>
          <p style={{ color: '#5b6478', marginBottom: 24, lineHeight: 1.6 }}>
            The application failed before it finished loading. Reloading is the
            usual fix. If it keeps happening, the API may be unavailable.
          </p>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: '11px 18px',
                borderRadius: 10,
                border: '1px solid transparent',
                background: '#4f46e5',
                color: '#ffffff',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            {/*
              A plain anchor, not `next/link`: this boundary can render when the
              router itself is the broken part, and a full document load is the
              recovery we actually want here.
            */}
            <a
              href="/"
              style={{
                padding: '11px 18px',
                borderRadius: 10,
                border: '1px solid #e3e7f0',
                background: '#ffffff',
                color: '#0f172a',
                fontSize: '0.95rem',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Go home
            </a>
          </div>

          {dev && (
            <pre
              style={{
                marginTop: 24,
                padding: 14,
                borderRadius: 10,
                background: '#f1f3fa',
                border: '1px solid #e3e7f0',
                fontSize: '0.82rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {error.message || 'No message'}
              {error.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
          )}
        </main>
      </body>
    </html>
  );
}
