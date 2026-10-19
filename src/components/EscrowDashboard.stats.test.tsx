import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EscrowDashboard } from './EscrowDashboard';
import { tile } from '@/test/tile';

const contract = {
  id: 1,
  title: 'Landing page',
  client: 'GCLIENTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  freelancer: 'GFREELANCERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  token: 'XLM',
  milestones: [{ index: 0, title: 'Wireframes', amount: 250, released: false }],
  totalAmount: 1500,
  fundedAmount: 1500,
  releasedAmount: 0,
  status: 'Funded',
  reputationIssued: false,
};

const statsBody = (contracts: number) => ({
  contracts,
  byStatus: contracts > 0 ? { Funded: contracts } : {},
  totalEscrowed: contracts * 10,
  totalReleased: 0,
});

/**
 * Counts calls per path so a test can tell a refetch from the initial load.
 * POSTs to a contract action succeed; the follow-up list refetch returns the
 * post-action contract count.
 */
function mockApi(afterAction: number) {
  const calls = { stats: 0, list: 0, action: 0 };
  let acted = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1/, '/api/v1');
    if (path === '/api/v1/stats') {
      calls.stats += 1;
      return new Response(JSON.stringify(statsBody(acted ? afterAction : 1)), { status: 200 });
    }
    if (path === '/api/v1/contracts' && (init?.method ?? 'GET') === 'GET') {
      calls.list += 1;
      return new Response(JSON.stringify({ data: [contract] }), { status: 200 });
    }
    calls.action += 1;
    acted = true;
    return new Response(JSON.stringify({ data: contract }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('EscrowDashboard stats integration', () => {
  it('refetches stats after a successful action', async () => {
    const calls = mockApi(2);
    const user = userEvent.setup();
    render(<EscrowDashboard />);

    expect(await screen.findByRole('img')).toBeInTheDocument();
    await waitFor(() => expect(tile('Escrows')).toBe('1'));
    expect(calls.stats).toBe(1);

    await user.click(screen.getByRole('button', { name: /^Dispute$/ }));

    // The action ran, the list reloaded, and the stats followed.
    await waitFor(() => expect(calls.action).toBe(1));
    await waitFor(() => expect(calls.stats).toBe(2));
    await waitFor(() => expect(tile('Escrows')).toBe('2'));
  });

  it('does not refetch stats when the action fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, '/api/v1');
      if (path === '/api/v1/stats') {
        return new Response(JSON.stringify(statsBody(1)), { status: 200 });
      }
      if (path === '/api/v1/contracts' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ data: [contract] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: 'dispute failed' }), { status: 409 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const statsCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/stats')).length;

    const user = userEvent.setup();
    render(<EscrowDashboard />);
    await screen.findByRole('img');
    const before = statsCalls();

    await user.click(screen.getByRole('button', { name: /^Dispute$/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('dispute failed');

    expect(statsCalls()).toBe(before);
  });

  it('shows the escrow list even when stats fail', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, '/api/v1');
      if (path === '/api/v1/stats') {
        return new Response('{}', { status: 503 });
      }
      if (path === '/api/v1/contracts' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ data: [contract] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<EscrowDashboard />);

    // The failure is contained to the strip...
    expect(await screen.findByText(/Stats unavailable/)).toBeInTheDocument();
    // ...and the list is unaffected.
    expect(await screen.findByText('#1 Landing page')).toBeInTheDocument();
    expect(screen.queryByText(/Could not reach the API/)).not.toBeInTheDocument();
  });

  it('still lists escrows when the stats request never resolves', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, '/api/v1');
      if (path === '/api/v1/stats') return new Promise<Response>(() => {});
      if (path === '/api/v1/contracts' && (init?.method ?? 'GET') === 'GET') {
        return new Response(JSON.stringify({ data: [contract] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<EscrowDashboard />);

    expect(await screen.findByText('#1 Landing page')).toBeInTheDocument();
    expect(screen.getByText('Loading stats…')).toBeInTheDocument();
  });
});
