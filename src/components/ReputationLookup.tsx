'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, ApiError, Reputation } from '@/lib/api';

export function ReputationLookup() {
  const [address, setAddress] = useState('GFREELANCERDEMOBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  const [result, setResult] = useState<Reputation | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);

  // Every lookup takes a ticket. Only the newest ticket may write state, so a
  // slow response for an earlier address can never overwrite a newer one.
  const latest = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  // Cancel whatever is in flight when the component goes away: an unmounted
  // component must not resolve into a state update.
  useEffect(() => () => inFlight.current?.abort(), []);

  const lookup = async (e: FormEvent) => {
    e.preventDefault();
    const ticket = ++latest.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setLoading(true);
    setError(null);
    try {
      const data = await api<Reputation>(
        `/api/v1/reputation/${encodeURIComponent(address.trim())}`,
        { signal: controller.signal },
      );
      if (ticket !== latest.current) return; // a newer lookup superseded this one
      setResult(data);
    } catch (err) {
      // A cancelled request is not a failure the user needs to see.
      if (err instanceof ApiError && err.isAborted) return;
      if (ticket !== latest.current) return;
      setError(
        err instanceof ApiError
          ? err
          : new ApiError({ kind: 'network', message: (err as Error).message }),
      );
      setResult(null);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 720, paddingBottom: 64 }}>
      <form className="card form" onSubmit={lookup}>
        <div className="field">
          <label htmlFor="address">Freelancer address</label>
          <div className="row">
            <input id="address" className="input mono" value={address} onChange={(e) => setAddress(e.target.value)} required />
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Looking up...' : 'Look up'}
            </button>
          </div>
        </div>
      </form>
      {error && (
        <div className="alert alert-error" role="alert" title={error.message}>
          {error.userMessage}
        </div>
      )}
      {result && (
        <div className="grid grid-3">
          <div className="card">
            <p className="small">Average rating</p>
            <h3 style={{ fontSize: '2rem', margin: '4px 0 0' }}>{result.averageRating ? `${result.averageRating} / 5` : 'No ratings'}</h3>
          </div>
          <div className="card">
            <p className="small">Completed contracts</p>
            <h3 style={{ fontSize: '2rem', margin: '4px 0 0' }}>{result.completedContracts}</h3>
          </div>
          <div className="card">
            <p className="small">Total rating points</p>
            <h3 style={{ fontSize: '2rem', margin: '4px 0 0' }}>{result.totalRating}</h3>
          </div>
        </div>
      )}
    </div>
  );
}
