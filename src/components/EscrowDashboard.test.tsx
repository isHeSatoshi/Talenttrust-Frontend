import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EscrowContract } from '@/lib/api';
import { EscrowDashboard } from './EscrowDashboard';

const contract = (over: Partial<EscrowContract> = {}): EscrowContract => ({
  id: 7,
  title: 'Website redesign',
  client: 'GCLIENT',
  freelancer: 'GFREELANCER',
  token: 'XLM',
  milestones: [
    { index: 0, title: 'Design', amount: 300, released: false },
    { index: 1, title: 'Build', amount: 700, released: false },
  ],
  totalAmount: 1000,
  fundedAmount: 0,
  releasedAmount: 0,
  status: 'Created',
  reputationIssued: false,
  ...over,
});

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/**
 * Mock the API by URL, and count how many times the contract list is fetched —
 * that count is how "the list refreshed" is observed.
 */
const mockApi = (contracts: EscrowContract[], depositResponse: () => unknown) => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    const path = String(url);
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path.includes('/deposit')) return depositResponse();
    return jsonResponse({ data: contracts });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    listFetches: () => calls.filter((c) => c.endsWith('/api/v1/contracts')).length,
  };
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('EscrowDashboard funding', () => {
  it('replaces the whole-remainder Fund button with the funding control', async () => {
    mockApi([contract()], () => jsonResponse({}));
    render(<EscrowDashboard />);

    const card = within(await screen.findByRole('article'));
    // The old button deposited the entire remainder in one click.
    expect(card.queryByRole('button', { name: /^Fund / })).toBeNull();
    expect(card.getByLabelText('Deposit amount (XLM)')).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Deposit' })).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Remaining (1,000 XLM)' })).toBeInTheDocument();
  });

  it('offers no funding control once the escrow is fully funded', async () => {
    mockApi([contract({ fundedAmount: 1000, status: 'Funded' })], () => jsonResponse({}));
    render(<EscrowDashboard />);

    const card = within(await screen.findByRole('article'));
    expect(card.queryByLabelText('Deposit amount (XLM)')).toBeNull();
  });

  it('refreshes the list after a successful deposit', async () => {
    const api = mockApi([contract()], () => jsonResponse({ ...contract(), fundedAmount: 250 }));
    render(<EscrowDashboard />);
    await screen.findByRole('article');
    expect(api.listFetches()).toBe(1);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Deposit amount (XLM)'), '250');
    await user.click(screen.getByRole('button', { name: 'Deposit' }));

    await waitFor(() => expect(api.listFetches()).toBe(2));
    // Asserted on the path, not the host: the base URL comes from
    // NEXT_PUBLIC_API_URL and must not be baked into the test.
    expect(
      api.calls.some((c) => c.startsWith('POST ') && c.endsWith('/api/v1/contracts/7/deposit')),
    ).toBe(true);
  });

  it('posts the typed amount, not the whole remainder', async () => {
    const api = mockApi([contract()], () => jsonResponse({}));
    render(<EscrowDashboard />);
    await screen.findByRole('article');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Deposit amount (XLM)'), '300');
    await user.click(screen.getByRole('button', { name: 'Deposit' }));
    await waitFor(() => expect(api.listFetches()).toBe(2));

    const body = JSON.parse((vi.mocked(fetch).mock.calls.find(([u]) => String(u).includes('/deposit'))![1] as RequestInit).body as string);
    expect(body).toEqual({ amount: 300 });
  });

  it('shows an API 409 inline under the control, not in the global banner', async () => {
    mockApi([contract()], () => jsonResponse({ error: 'over_funded', message: 'deposit exceeds contract total' }, 409));
    render(<EscrowDashboard />);
    await screen.findByRole('article');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Deposit amount (XLM)'), '500');
    await user.click(screen.getByRole('button', { name: 'Deposit' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That deposit would over-fund the escrow.');

    // Exactly one alert, and it is inside the funding control — the dashboard's
    // global banner is not used for a failed deposit.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alert.closest('.fund')).not.toBeNull();
  });

  it('leaves the global banner to the create form, where it belongs', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string }) => {
        calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
        if (init?.method === 'POST') {
          return jsonResponse({ error: 'invalid_contract', message: 'client address is required' }, 400);
        }
        return jsonResponse({ data: [contract()] });
      }),
    );
    render(<EscrowDashboard />);
    await screen.findByRole('article');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Create escrow' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('client address is required');
    expect(alert.closest('.fund')).toBeNull();
  });

  it('does not call the deposit endpoint when the amount is invalid', async () => {
    const api = mockApi([contract()], () => jsonResponse({}));
    render(<EscrowDashboard />);
    await screen.findByRole('article');

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Deposit amount (XLM)'), '1500');
    await user.click(screen.getByRole('button', { name: 'Deposit' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter at most 1,000 XLM, the remaining balance.',
    );
    expect(api.calls.some((c) => c.includes('/deposit'))).toBe(false);
    expect(api.listFetches()).toBe(1);
  });

  it('offers the next milestone only when it is not yet covered', async () => {
    mockApi([contract({ fundedAmount: 300 })], () => jsonResponse({}));
    render(<EscrowDashboard />);

    const card = within(await screen.findByRole('article'));
    expect(card.queryByRole('button', { name: /^Next milestone/ })).toBeNull();
    expect(card.getByRole('button', { name: 'Remaining (700 XLM)' })).toBeInTheDocument();
  });
});
