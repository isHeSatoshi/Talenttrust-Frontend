import { LoadingAnnouncement, Skeleton } from '@/components/ui/Skeleton';

/**
 * Route-level loading UI for `/reputation`.
 *
 * Mirrors the page's layout: the head, the lookup form card, then the
 * three-column result grid — so the result cards land where the placeholders
 * were rather than pushing the footer down.
 */
export default function ReputationLoading() {
  return (
    <div className="container">
      <div className="page-head">
        <h1>Freelancer reputation</h1>
        <p>Loading…</p>
      </div>

      <LoadingAnnouncement label="Loading reputation" />

      <div className="stack" style={{ maxWidth: 720, paddingBottom: 64 }} aria-busy="true">
        <form className="card form" aria-hidden="true">
          <div className="field">
            <span className="skeleton skeleton-line" style={{ width: 130, height: 13, marginBottom: 6 }} />
            <div className="row">
              <span className="skeleton skeleton-block" style={{ flex: '1 1 160px', height: 40, borderRadius: 10 }} />
              <span className="skeleton skeleton-block" style={{ width: 104, height: 40, borderRadius: 10 }} />
            </div>
          </div>
        </form>

        <div className="grid grid-3">
          {[0, 1, 2].map((i) => (
            <div className="card" key={i} aria-hidden="true">
              <Skeleton variant="line" width={110} height={14} />
              <div style={{ marginTop: 10 }}>
                <Skeleton variant="line" width={70} height={30} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
