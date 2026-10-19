import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

/** A Response stand-in: only the fields `api()` reads. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A pending fetch that rejects with AbortError when its signal aborts, the way
 *  a real `fetch` does. A mock that ignores the signal would hang instead of
 *  exercising the timeout/abort paths. */
function abortablePending(): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
    const abort = () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      reject(err);
    };
    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener('abort', abort);
  });
}

const fetchMock = vi.fn();

/** Await a promise that must reject, and hand back the `ApiError` it threw.
 *  Keeps the failure typed without an `as` cast at every call site. */
async function rejection(pending: Promise<unknown>): Promise<ApiError> {
  try {
    await pending;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected api() to reject, but it resolved');
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('api — success path', () => {
  it('returns the parsed body on 2xx', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [1, 2] }));
    await expect(api<{ data: number[] }>('/api/v1/contracts')).resolves.toEqual({ data: [1, 2] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tolerates a body that is not JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    } as unknown as Response);
    await expect(api('/api/v1/contracts')).resolves.toEqual({});
  });
});

describe('api — failure kinds', () => {
  it('reports a timeout when the request outlives its budget', async () => {
    fetchMock.mockImplementationOnce(() => abortablePending());
    const pending = api('/api/v1/contracts', { timeoutMs: 1_000 });
    const caught = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(1_000);
    await caught;
  });

  it('reports a network failure when fetch itself rejects, after exhausting GET retries', async () => {
    // A dropped connection is retryable on GET, so every attempt fails here and
    // the caller sees the last one.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const pending = rejection(api('/api/v1/contracts'));
    await vi.advanceTimersByTimeAsync(400); // backoff 1
    await vi.advanceTimersByTimeAsync(900); // backoff 2
    const err = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
    // The raw browser string must never reach the user.
    expect(err.userMessage).not.toContain('Failed to fetch');
    expect(err.userMessage).toMatch(/could not reach/i);
  });

  it('reports a network failure immediately when retries are disabled', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await rejection(api('/api/v1/contracts', { retries: 0 }));
    expect(err.kind).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports an http failure carrying the backend code', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, { error: 'invalid_status', message: 'escrow is Disputed' }),
    );
    const err = await rejection(api('/api/v1/contracts/1/release', { method: 'POST' }));
    expect(err.kind).toBe('http');
    expect(err.status).toBe(409);
    expect(err.code).toBe('invalid_status');
    // The technical message is preserved for debugging...
    expect(err.message).toBe('escrow is Disputed');
    // ...while the user sees mapped copy.
    expect(err.userMessage).toMatch(/not in a state/i);
  });

  it('falls back to a per-kind message for an unmapped code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'kaboom', message: 'boom' }));
    const err = await rejection(api('/api/v1/contracts'));
    expect(err.code).toBe('kaboom');
    expect(err.userMessage).toMatch(/unexpected response/i);
  });

  it('reports an abort separately from a timeout, and isAborted is true', async () => {
    fetchMock.mockImplementationOnce(() => abortablePending());
    const controller = new AbortController();
    const pending = api('/api/v1/contracts', { signal: controller.signal });
    controller.abort();
    const err = await rejection(pending);
    expect(err.kind).toBe('aborted');
    expect(err.isAborted).toBe(true);
  });
});

describe('api — retries', () => {
  it('retries an idempotent GET on 503 and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const pending = api<{ ok: boolean }>('/api/v1/contracts');
    await vi.advanceTimersByTimeAsync(400); // backoff 1 (250 + jitter)
    await vi.advanceTimersByTimeAsync(900); // backoff 2 (750 + jitter)

    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after the retry budget and surfaces the last failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: 'unavailable', message: 'down' }));
    const pending = api('/api/v1/contracts');
    const caught = expect(pending).rejects.toMatchObject({ kind: 'http', status: 503 });
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(900);
    await caught;
    // 1 initial + 2 retries, then it stops.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never retries a POST', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, { error: 'unavailable', message: 'down' }));
    await expect(
      api('/api/v1/contracts', { method: 'POST', body: { title: 'x' } }),
    ).rejects.toMatchObject({ kind: 'http', status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-retryable status on GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'contract_not_found', message: 'gone' }));
    await expect(api('/api/v1/contracts/9')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts out of a pending backoff instead of retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {}));
    const controller = new AbortController();
    const pending = api('/api/v1/contracts', { signal: controller.signal });
    const caught = expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(400);
    await caught;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
