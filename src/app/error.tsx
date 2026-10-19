'use client';

import { RouteError } from '@/components/ui/RouteError';

/**
 * Root-level error boundary.
 *
 * Catches render-time failures in any route below the root layout, so a thrown
 * component no longer drops the user onto Next's default error screen with no
 * way back except a full reload. The layout itself (header, footer) stays
 * mounted, which is what makes "the header is still visible" a meaningful
 * assertion in the tests.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      error={error}
      reset={reset}
      title="Something went wrong"
      description="This page failed to load. Trying again often fixes it, and you can always head back home."
    />
  );
}
