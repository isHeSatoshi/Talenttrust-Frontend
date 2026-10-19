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

/** How a request failed. Callers branch on this instead of string-matching. */
export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'aborted';

/**
 * Backend `error` codes → copy safe to show a user.
 *
 * The backend returns `{ error: <code>, message: <technical> }` (see its
 * `src/app.ts`); only `message` used to survive, so callers could not tell
 * `over_funded` from `invalid_status` from a dropped connection.
 */
const CODE_MESSAGES: Record<string, string> = {
  contract_not_found: 'That escrow no longer exists. Refresh to see the current list.',
  invalid_status: 'This escrow is not in a state that allows that action.',
  over_funded: 'That deposit would over-fund the escrow. Reduce the amount and try again.',
  insufficient_funds: 'The escrow does not hold enough to release the next milestone.',
  already_released: 'That milestone has already been released.',
  already_rated: 'This freelancer has already been rated for that contract.',
  invalid_split: 'The payout split must add up to 100%.',
  invalid_rating: 'A rating must be a whole number from 1 to 5.',
  unauthorized: 'You do not have permission to do that.',
  invalid_input: 'Some of those details were rejected. Check them and try again.',
};

const KIND_MESSAGES: Record<ApiErrorKind, string> = {
  network: 'We could not reach the TalentTrust API. Check your connection and try again.',
  timeout: 'The TalentTrust API took too long to respond. Try again in a moment.',
  http: 'The TalentTrust API returned an unexpected response.',
  aborted: 'The request was cancelled.',
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  /** The backend's machine-readable `error` code, when it sent one. */
  readonly code?: string;
  /** Copy that is safe to render directly in the UI. */
  readonly userMessage: string;

  constructor(init: {
    kind: ApiErrorKind;
    message: string;
    userMessage?: string;
    status?: number;
    code?: string;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.userMessage =
      init.userMessage ??
      (init.code ? CODE_MESSAGES[init.code] : undefined) ??
      KIND_MESSAGES[init.kind];
    // Preserve `instanceof ApiError` when the output is downlevelled.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  /** True when the caller (or an unmount) cancelled this request. */
  get isAborted(): boolean {
    return this.kind === 'aborted';
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Caller-owned cancellation, e.g. an unmount or a newer request. */
  signal?: AbortSignal;
  /** Per-attempt budget. Defaults to 10s. */
  timeoutMs?: number;
  /** Retry budget for idempotent GETs. Defaults to the backoff table length. */
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** Backoff between GET retries; index = attempt number. */
const RETRY_DELAYS_MS = [250, 750];
/** Statuses worth retrying on an idempotent request. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);
/** Upper bound on the random component added to each backoff. */
const JITTER_MS = 50;

/**
 * Combine the caller's signal with a timeout signal.
 *
 * Uses `AbortSignal.any` where available and falls back to a relay controller,
 * so the behaviour is identical on older runtimes (jsdom, older Safari).
 */
function linkSignals(
  timeoutMs: number,
  caller: AbortSignal | undefined,
): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const timer = new AbortController();
  let timedOut = false;
  const id = setTimeout(() => {
    timedOut = true;
    timer.abort(new DOMException('The request timed out', 'TimeoutError'));
  }, timeoutMs);

  const signals = caller ? [caller, timer.signal] : [timer.signal];
  let signal: AbortSignal;
  let dispose: () => void;

  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') {
    signal = anyFn.call(AbortSignal, signals);
    dispose = () => clearTimeout(id);
  } else {
    const relay = new AbortController();
    const onAbort = () => {
      const source = signals.find((s) => s.aborted);
      relay.abort(source?.reason);
    };
    for (const s of signals) {
      if (s.aborted) {
        onAbort();
        break;
      }
      s.addEventListener('abort', onAbort, { once: true });
    }
    signal = relay.signal;
    dispose = () => {
      clearTimeout(id);
      for (const s of signals) s.removeEventListener('abort', onAbort);
    };
  }

  return { signal, timedOut: () => timedOut, dispose };
}

function backoffMs(attempt: number): number {
  return (RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]) +
    Math.floor(Math.random() * JITTER_MS);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch from the TalentTrust API with a timeout, cancellation, typed errors and
 * retries for idempotent requests.
 *
 * - GET is retried on a network failure or 502/503/504 (up to `retries`, with
 *   exponential backoff and jitter). Mutations are never retried.
 * - Aborting the caller's signal rejects with `kind: 'aborted'` and leaves no
 *   in-flight work behind, so unmounted components cannot `setState`.
 */
export async function api<T>(path: string, init: ApiOptions = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const isIdempotent = method === 'GET' || method === 'HEAD';
  const maxRetries = init.retries ?? (isIdempotent ? RETRY_DELAYS_MS.length : 0);
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let attempt = 0;
  for (;;) {
    const { signal, timedOut, dispose } = linkSignals(timeoutMs, init.signal);
    try {
      const res = await fetch(`${site.apiUrl}${path}`, {
        method,
        headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
        signal,
      });

      const data: unknown = await res.json().catch(() => ({}));

      if (!res.ok) {
        const payload = (data ?? {}) as { error?: string; message?: string };
        throw new ApiError({
          kind: 'http',
          status: res.status,
          code: payload.error,
          message: payload.message || `Request failed (${res.status})`,
        });
      }

      return data as T;
    } catch (err) {
      const failure = toApiError(err, timedOut(), init.signal);
      const retryable =
        isIdempotent &&
        attempt < maxRetries &&
        (failure.kind === 'network' ||
          (failure.kind === 'http' && RETRYABLE_STATUS.has(failure.status ?? 0)));

      if (!retryable) throw failure;

      await sleep(backoffMs(attempt));
      attempt += 1;
      // A caller-side abort during the backoff must win over the retry.
      if (init.signal?.aborted) {
        throw new ApiError({
          kind: 'aborted',
          message: 'The request was aborted by the caller',
        });
      }
    } finally {
      dispose();
    }
  }
}

/** Normalise anything `fetch` can throw into an `ApiError`. */
function toApiError(err: unknown, timedOut: boolean, caller?: AbortSignal): ApiError {
  if (err instanceof ApiError) return err;

  const name = (err as { name?: string } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') {
    // Our own timer fired first => timeout; otherwise the caller cancelled.
    if (timedOut) {
      return new ApiError({ kind: 'timeout', message: 'The request timed out' });
    }
    return new ApiError({
      kind: 'aborted',
      message: caller?.aborted ? 'The request was aborted by the caller' : 'The request was aborted',
    });
  }

  // `fetch` rejects with a TypeError for offline, DNS failure and CORS.
  return new ApiError({
    kind: 'network',
    message: (err as Error)?.message || 'Network request failed',
  });
}
