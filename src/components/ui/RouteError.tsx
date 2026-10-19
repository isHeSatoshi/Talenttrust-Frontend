'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

export interface RouteErrorProps {
  error: Error & { digest?: string };
  /** Provided by Next's error boundary; re-renders the segment. */
  reset: () => void;
  title?: string;
  description?: string;
  /**
   * Show the raw message and digest. Defaults to development only.
   *
   * Exposed as a prop so the visibility rule is testable without rebuilding
   * with a different `NODE_ENV`.
   */
  showDetails?: boolean;
}

/**
 * The shared body of the route error boundaries.
 *
 * Behaviour worth noting:
 *
 * - The heading takes focus on mount, so a keyboard or screen-reader user lands
 *   on the error rather than at the top of an unchanged page.
 * - The raw error is shown only outside production. In production a stack or a
 *   digest is not useful to a user and can leak internals.
 * - `reset()` is offered rather than a reload, so a transient failure does not
 *   cost the user their in-progress work.
 */
export function RouteError({
  error,
  reset,
  title = 'Something went wrong',
  description = 'This section failed to load. Trying again often fixes it.',
  showDetails,
}: RouteErrorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Read at render time, not module scope, so the value is the one the build
  // actually shipped and so tests can stub it.
  const dev = showDetails ?? process.env.NODE_ENV === 'development';

  return (
    <div className="container" style={{ padding: '72px 20px', maxWidth: 640 }}>
      <p className="eyebrow">Error</p>
      <h1 ref={headingRef} tabIndex={-1} style={{ fontSize: '2rem', margin: '16px 0 8px' }}>
        {title}
      </h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        {description}
      </p>

      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/" className="btn btn-secondary">
          Go home
        </Link>
      </div>

      {dev && (
        <div className="alert" style={{ marginTop: 24 }}>
          <p className="small muted" style={{ marginBottom: 6 }}>
            Development only
          </p>
          <p className="mono" style={{ margin: 0, wordBreak: 'break-word' }}>
            {error.message || 'No message'}
          </p>
          {error.digest && (
            <p className="small muted" style={{ marginTop: 6 }}>
              digest: {error.digest}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
