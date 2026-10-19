'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, EscrowContract } from '@/lib/api';
import { StatsStrip } from './escrow/StatsStrip';

const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a);

export function EscrowDashboard() {
  const [contracts, setContracts] = useState<EscrowContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | 'new' | null>(null);
  // Bumped after every successful action so the stats strip refetches.
  const [statsToken, setStatsToken] = useState(0);
  const [form, setForm] = useState({
    title: 'Website redesign',
    client: 'GCLIENT' + 'X'.repeat(49),
    freelancer: 'GFREELANCER' + 'Y'.repeat(45),
    milestones: 'Design: 300, Build: 700',
  });

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: EscrowContract[] }>('/api/v1/contracts');
      setContracts(res.data.sort((a, b) => b.id - a.id));
      setError(null);
    } catch (e) {
      setError(`Could not reach the API: ${(e as Error).message}`);
      setContracts([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: number | 'new', fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await load();
      setStatsToken((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    const milestones = form.milestones
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part, i) => {
        const [title, amount] = part.includes(':') ? part.split(':') : [`Milestone ${i + 1}`, part];
        return { title: title.trim(), amount: Number(amount) };
      });
    act('new', () =>
      api('/api/v1/contracts', {
        method: 'POST',
        body: { title: form.title, client: form.client, freelancer: form.freelancer, milestones },
      }),
    );
  };

  return (
    <div className="dash">
      <StatsStrip refreshToken={statsToken} />
      <form className="card form" onSubmit={create} aria-labelledby="new-escrow">
        <h3 id="new-escrow">New escrow</h3>
        <div className="field">
          <label htmlFor="title">Title</label>
          <input id="title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="client">Client address</label>
          <input id="client" className="input mono" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="freelancer">Freelancer address</label>
          <input id="freelancer" className="input mono" value={form.freelancer} onChange={(e) => setForm({ ...form, freelancer: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="milestones">Milestones</label>
          <input id="milestones" className="input" value={form.milestones} onChange={(e) => setForm({ ...form, milestones: e.target.value })} required />
          <span className="small muted">Comma separated, as Title: amount</span>
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy === 'new'}>
          {busy === 'new' ? 'Creating...' : 'Create escrow'}
        </button>
      </form>

      <div className="stack" style={{ minWidth: 0 }}>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {contracts === null && <div className="card muted">Loading escrows...</div>}
        {contracts?.length === 0 && !error && <div className="card muted">No escrows yet. Create the first one.</div>}
        {contracts?.map((c) => {
          const next = c.milestones.find((m) => !m.released);
          const active = c.status === 'Created' || c.status === 'Funded';
          const pct = c.totalAmount ? Math.round((c.releasedAmount / c.totalAmount) * 100) : 0;
          return (
            <article className="card" key={c.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>
                  #{c.id} {c.title}
                </h3>
                <span className={`badge badge-${c.status}`}>{c.status}</span>
              </div>
              <p className="small muted" style={{ margin: '6px 0 12px' }}>
                Client <span className="mono">{short(c.client)}</span> &rarr; Freelancer{' '}
                <span className="mono">{short(c.freelancer)}</span>
              </p>
              <div className="progress" aria-label={`${pct}% released`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                Released {c.releasedAmount} / {c.totalAmount} {c.token} &middot; In escrow{' '}
                {c.fundedAmount - c.releasedAmount} {c.token}
              </p>
              <ul className="milestones">
                {c.milestones.map((m) => (
                  <li key={m.index}>
                    <span className="truncate">
                      {m.released ? '[x]' : '[ ]'} {m.title}
                    </span>
                    <span className="mono">
                      {m.amount} {c.token}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="row">
                {active && c.fundedAmount < c.totalAmount && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === c.id}
                    onClick={() =>
                      act(c.id, () =>
                        api(`/api/v1/contracts/${c.id}/deposit`, { method: 'POST', body: { amount: c.totalAmount - c.fundedAmount } }),
                      )
                    }
                  >
                    Fund {c.totalAmount - c.fundedAmount} {c.token}
                  </button>
                )}
                {active && next && c.fundedAmount - c.releasedAmount >= next.amount && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === c.id}
                    onClick={() => act(c.id, () => api(`/api/v1/contracts/${c.id}/milestones/${next.index}/release`, { method: 'POST' }))}
                  >
                    Release next
                  </button>
                )}
                {active && (
                  <>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy === c.id}
                      onClick={() =>
                        act(c.id, () =>
                          api(`/api/v1/contracts/${c.id}/dispute`, { method: 'POST', body: { raisedBy: c.client, reason: 'Raised from dashboard' } }),
                        )
                      }
                    >
                      Dispute
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy === c.id}
                      onClick={() => act(c.id, () => api(`/api/v1/contracts/${c.id}/cancel`, { method: 'POST' }))}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {c.status === 'Disputed' && (
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === c.id}
                    onClick={() =>
                      act(c.id, () => api(`/api/v1/contracts/${c.id}/resolve`, { method: 'POST', body: { freelancerBps: 5000 } }))
                    }
                  >
                    Resolve 50/50
                  </button>
                )}
                {c.status === 'Completed' && !c.reputationIssued && (
                  <>
                    <span className="small muted">Rate freelancer:</span>
                    {[1, 2, 3, 4, 5].map((r) => (
                      <button
                        key={r}
                        className="btn btn-secondary btn-sm"
                        disabled={busy === c.id}
                        onClick={() => act(c.id, () => api(`/api/v1/contracts/${c.id}/reputation`, { method: 'POST', body: { rating: r } }))}
                      >
                        {r}
                      </button>
                    ))}
                  </>
                )}
                {c.status === 'Completed' && c.reputationIssued && <span className="small muted">Rated. Thanks!</span>}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
