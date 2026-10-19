'use client';

import { RouteError } from '@/components/ui/RouteError';

/**
 * Error boundary for the `/contracts` subtree.
 *
 * Scoped more tightly than the root boundary on purpose: a failure while
 * loading escrows should be recoverable in place, without the reputation and
 * docs routes inheriting the same error UI. Next renders the closest boundary
 * above the failing segment, so this one wins inside `/contracts`.
 */
export default function ContractsError({
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
      title="The escrow dashboard could not load"
      description="We could not reach the TalentTrust API. Your wallet is unaffected, and trying again is safe."
    />
  );
}
