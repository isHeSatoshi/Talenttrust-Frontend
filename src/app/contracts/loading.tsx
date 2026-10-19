import { EscrowCardSkeleton, LoadingAnnouncement } from '@/components/ui/Skeleton';

/**
 * Route-level loading UI for `/contracts`.
 *
 * Mirrors the page's own layout — the page head, then the dashboard's
 * form-plus-list grid — so the first paint already occupies the final
 * dimensions and the real content does not shift it.
 */
export default function ContractsLoading() {
  return (
    <div className="container">
      <div className="page-head">
        <h1>Escrow dashboard</h1>
        <p>Loading escrows…</p>
      </div>

      <LoadingAnnouncement label="Loading escrows" />

      <div className="dash" aria-busy="true">
        {/* The create form's footprint: five labelled fields and a button. */}
        <form className="card form" aria-hidden="true">
          <h3>New escrow</h3>
          {[0, 1, 2, 3].map((i) => (
            <div className="field" key={i}>
              <span className="skeleton skeleton-line" style={{ width: 90, height: 13, marginBottom: 6 }} />
              <span className="skeleton skeleton-block" style={{ height: 40, borderRadius: 10 }} />
            </div>
          ))}
          <span className="skeleton skeleton-block" style={{ height: 40, borderRadius: 10, width: 150 }} />
        </form>

        <div className="stack">
          {[0, 1, 2].map((i) => (
            <EscrowCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
