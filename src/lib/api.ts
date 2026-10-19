import { site } from './site';

export interface Milestone {
  index: number;
  title: string;
  amount: number;
  released: boolean;
}

export type Status = 'Created' | 'Funded' | 'Completed' | 'Disputed' | 'Resolved' | 'Cancelled';

/** Every status, in lifecycle order. `byStatus` omits statuses with no contracts. */
export const STATUSES: readonly Status[] = [
  'Created',
  'Funded',
  'Completed',
  'Disputed',
  'Resolved',
  'Cancelled',
];

export interface EscrowContract {
  id: number;
  title: string;
  client: string;
  freelancer: string;
  token: string;
  milestones: Milestone[];
  totalAmount: number;
  fundedAmount: number;
  releasedAmount: number;
  status: Status;
  reputationIssued: boolean;
}

export interface Stats {
  contracts: number;
  byStatus: Record<Status, number>;
  totalEscrowed: number;
  totalReleased: number;
}

export interface Reputation {
  address: string;
  completedContracts: number;
  totalRating: number;
  averageRating: number;
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${site.apiUrl}${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { message?: string }).message || `Request failed (${res.status})`);
  }
  return data as T;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Validates the `/api/v1/stats` payload before it reaches the UI.
 *
 * The endpoint returns a bare object (not wrapped in `data`) and only includes
 * statuses that actually have contracts, so absent statuses are filled with 0
 * rather than left `undefined` — otherwise the breakdown bar would silently drop
 * segments. Anything else malformed throws, so a bad payload surfaces as the
 * strip's error state instead of rendering `NaN`.
 */
export function parseStats(raw: unknown): Stats {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Stats response was not an object');
  }
  const r = raw as Record<string, unknown>;
  if (!isCount(r.contracts) || !isCount(r.totalEscrowed) || !isCount(r.totalReleased)) {
    throw new Error('Stats response is missing numeric totals');
  }
  const rawByStatus = r.byStatus;
  if (typeof rawByStatus !== 'object' || rawByStatus === null) {
    throw new Error('Stats response is missing a status breakdown');
  }
  const source = rawByStatus as Record<string, unknown>;
  const byStatus = {} as Record<Status, number>;
  for (const status of STATUSES) {
    const value = source[status];
    if (value === undefined) {
      byStatus[status] = 0;
    } else if (isCount(value)) {
      byStatus[status] = value;
    } else {
      throw new Error(`Stats response has a non-numeric count for ${status}`);
    }
  }
  return {
    contracts: r.contracts,
    byStatus,
    totalEscrowed: r.totalEscrowed,
    totalReleased: r.totalReleased,
  };
}

export async function getStats(): Promise<Stats> {
  return parseStats(await api<unknown>('/api/v1/stats'));
}
