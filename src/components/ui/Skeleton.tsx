/**
 * Loading placeholders.
 *
 * Two rules drive this component:
 *
 * 1. **Placeholders are decorative.** Every skeleton is `aria-hidden`, so a
 *    screen reader never announces a pile of empty boxes. The *container* is
 *    responsible for announcing loading once, via `role="status"` — see the
 *    route `loading.tsx` files and `EscrowDashboard`.
 * 2. **Motion is optional.** The shimmer is disabled under
 *    `prefers-reduced-motion: reduce` (in `globals.css`), leaving a static
 *    block. The layout still holds its space either way, so the CLS benefit
 *    does not depend on the animation.
 */

import type { CSSProperties } from 'react';

export type SkeletonVariant = 'block' | 'line';

export interface SkeletonProps {
  /** `block` for card/box shapes, `line` for a run of text. */
  variant?: SkeletonVariant;
  /** CSS width. A line defaults to `100%`. */
  width?: number | string;
  /** CSS height. Defaults per variant. */
  height?: number | string;
  /** Extra classes, e.g. spacing utilities. */
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({
  variant = 'block',
  width,
  height,
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      // Decorative: the loading state is announced by the container, not here.
      aria-hidden="true"
      className={['skeleton', `skeleton-${variant}`, className].filter(Boolean).join(' ')}
      style={{
        width: width ?? (variant === 'line' ? '100%' : undefined),
        height,
        ...style,
      }}
    />
  );
}

/**
 * A placeholder shaped like a real escrow card.
 *
 * Sized to match `EscrowDashboard`'s card: a title line, a metadata line, the
 * progress bar, an amount line and two milestone rows. The point is that the
 * layout does not shift when the real card replaces it.
 */
export function EscrowCardSkeleton() {
  return (
    <article className="card" aria-hidden="true">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Skeleton variant="line" width="45%" height={22} />
        <Skeleton variant="block" width={78} height={22} style={{ borderRadius: 999 }} />
      </div>
      <div style={{ margin: '10px 0 12px' }}>
        <Skeleton variant="line" width="60%" height={14} />
      </div>
      <Skeleton variant="block" width="100%" height={8} />
      <div style={{ margin: '10px 0 0' }}>
        <Skeleton variant="line" width="70%" height={14} />
      </div>
      <ul className="milestones">
        {[0, 1].map((i) => (
          <li key={i}>
            <Skeleton variant="line" width="55%" height={14} />
            <Skeleton variant="line" width={72} height={14} />
          </li>
        ))}
      </ul>
      <div className="row">
        <Skeleton variant="block" width={120} height={32} style={{ borderRadius: 10 }} />
        <Skeleton variant="block" width={104} height={32} style={{ borderRadius: 10 }} />
      </div>
    </article>
  );
}

/**
 * The visible "Loading…" announcement.
 *
 * Rendered once per region so assistive technology hears the state change
 * exactly once rather than once per skeleton.
 */
export function LoadingAnnouncement({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="visually-hidden" role="status">
      {label}
    </p>
  );
}
