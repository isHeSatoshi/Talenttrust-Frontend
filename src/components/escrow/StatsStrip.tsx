'use client';

import { useCallback, useEffect, useState } from 'react';
import { getStats, STATUSES, type Stats, type Status } from '@/lib/api';

// Counts are whole; token amounts can be fractional (the API returns e.g.
// 2250.3), so they keep up to two decimals instead of being rounded away.
const countFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const amountFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const formatCount = (n: number) => countFormat.format(n);
const formatAmount = (n: number) => amountFormat.format(n);

/** `—` rather than `0%` when there is nothing to divide by. */
export function completionRate(stats: Stats): string {
  if (stats.contracts <= 0) return '—';
  return `${Math.round((stats.byStatus.Completed / stats.contracts) * 100)}%`;
}

/**
 * A plain-language summary of every count, for the breakdown bar's
 * `aria-label`. The bar conveys the same information visually, so it needs one
 * sentence a screen reader can read out instead.
 */
export function breakdownLabel(stats: Stats): string {
  const parts = STATUSES.filter((s) => stats.byStatus[s] > 0).map(
    (s) => `${stats.byStatus[s]} ${s.toLowerCase()}`,
  );
  if (parts.length === 0) return 'No escrows yet';
  return `Status breakdown of ${stats.contracts} escrows: ${parts.join(', ')}`;
}

export function StatsStrip({ refreshToken = 0 }: { refreshToken?: number }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await getStats());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  // Only the first load shows skeletons: a refresh keeps the numbers on screen
  // instead of flashing placeholders over them.
  const showSkeleton = loading && stats === null;

  const tiles: { label: string; value: string }[] = stats
    ? [
        { label: 'Escrows', value: formatCount(stats.contracts) },
        { label: 'In escrow', value: formatAmount(stats.totalEscrowed) },
        { label: 'Released', value: formatAmount(stats.totalReleased) },
        { label: 'Completion rate', value: completionRate(stats) },
      ]
    : [
        { label: 'Escrows', value: '—' },
        { label: 'In escrow', value: '—' },
        { label: 'Released', value: '—' },
        { label: 'Completion rate', value: '—' },
      ];

  return (
    <section className="stats" aria-labelledby="protocol-stats">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 id="protocol-stats" className="stats-title">
          Protocol stats
        </h2>
        {error && (
          <p className="small muted stats-retry">
            Stats unavailable.{' '}
            <button type="button" className="linklike" onClick={load}>
              Retry
            </button>
          </p>
        )}
      </div>

      <ul className="stats-tiles">
        {tiles.map((t) => (
          <li className="stats-tile" key={t.label}>
            <span className="stats-label">{t.label}</span>
            {showSkeleton ? (
              <span className="stats-skeleton" aria-hidden="true" />
            ) : (
              <span className="stats-value">{t.value}</span>
            )}
          </li>
        ))}
      </ul>

      {showSkeleton && <p className="small muted">Loading stats…</p>}

      {stats && stats.contracts === 0 && (
        <p className="small muted">
          No escrows yet. Once one is created its status will show up here.
        </p>
      )}

      {stats && stats.contracts > 0 && (
        <>
          <div className="stats-bar" role="img" aria-label={breakdownLabel(stats)}>
            {STATUSES.filter((s) => stats.byStatus[s] > 0).map((s: Status) => (
              <span
                key={s}
                className={`stats-seg stats-seg-${s}`}
                style={{ flexGrow: stats.byStatus[s] }}
              />
            ))}
          </div>
          <ul className="stats-legend">
            {STATUSES.map((s) => (
              <li key={s}>
                <a className="stats-legend-link" href={`/contracts?status=${s}`}>
                  <span className={`stats-dot stats-seg-${s}`} aria-hidden="true" />
                  {s} <span className="muted">{stats.byStatus[s]}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
