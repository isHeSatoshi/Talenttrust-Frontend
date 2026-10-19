import { site } from './site';

export interface Milestone {
  index: number;
  title: string;
  amount: number;
  released: boolean;
}

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
  status: 'Created' | 'Funded' | 'Completed' | 'Disputed' | 'Resolved' | 'Cancelled';
  reputationIssued: boolean;
}

export interface Reputation {
  address: string;
  completedContracts: number;
  totalRating: number;
  averageRating: number;
}

/** An error thrown by `api`, carrying the API's own failure code and status. */
export interface ApiFailure extends Error {
  /** HTTP status, when the request reached the API at all. */
  status?: number;
  /** The API's machine-readable code, e.g. `over_funded`. */
  code?: string;
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${site.apiUrl}${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!res.ok) {
    // The API answers failures as `{ error: <code>, message: <text> }`. Carrying
    // the code lets a caller write copy for a specific failure instead of
    // matching on the message text.
    const failure = new Error(data.message || `Request failed (${res.status})`) as ApiFailure;
    failure.status = res.status;
    failure.code = data.error;
    throw failure;
  }
  return data as T;
}
