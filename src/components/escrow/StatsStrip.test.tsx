import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsStrip } from './StatsStrip';
import { site } from '@/lib/site';
import { KPI_LABELS, tile, tileIsSkeleton } from '@/test/tile';

const stats = (over: Record<string, unknown> = {}) => ({
  contracts: 4,
  byStatus: { Funded: 2, Completed: 1, Disputed: 1 },
  totalEscrowed: 1250,
  totalReleased: 2250,
  ...over,
});

/** Responds to the stats path with `body`, and to anything else with 404. */
function mockStats(body: unknown, init: { status?: number } = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    if (!String(url).endsWith('/api/v1/stats')) {
      return new Response(JSON.stringify({}), { status: 404 });
    }
    const status = init.status ?? 200;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('StatsStrip', () => {
  it('renders the four KPIs from the API, formatted', async () => {
    mockStats(stats({ contracts: 1234, totalEscrowed: 9876543, totalReleased: 2000 }));
    render(<StatsStrip />);

    await waitFor(() => expect(tile('Escrows')).toBe('1,234'));
    expect(tile('In escrow')).toBe('9,876,543');
    expect(tile('Released')).toBe('2,000');
    // 1 completed of 1234 contracts rounds to 0%, not NaN.
    expect(tile('Completion rate')).toBe('0%');
    for (const label of KPI_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('keeps fractional token amounts instead of rounding them away', async () => {
    // The live API returns e.g. totalEscrowed: 2250.3, which a 0-decimal
    // formatter would silently turn into 2,250.
    mockStats(stats({ contracts: 7, totalEscrowed: 2250.3, totalReleased: 2250 }));
    render(<StatsStrip />);

    await waitFor(() => expect(tile('In escrow')).toBe('2,250.3'));
    expect(tile('Released')).toBe('2,250');
    // Counts stay whole.
    expect(tile('Escrows')).toBe('7');
  });

  it('computes the completion rate from completed over total', async () => {
    mockStats(stats({ contracts: 4, byStatus: { Funded: 2, Completed: 3 } }));
    render(<StatsStrip />);
    // 3/4 is 75%, even though the breakdown sums to 5.
    await waitFor(() => expect(tile('Completion rate')).toBe('75%'));
  });

  it('shows no NaN when there are zero contracts', async () => {
    mockStats({ contracts: 0, byStatus: {}, totalEscrowed: 0, totalReleased: 0 });
    render(<StatsStrip />);

    expect(await screen.findByText(/No escrows yet/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    // Real zeros for the counts, and an em dash only for the rate, which has
    // nothing to divide by.
    expect(tile('Escrows')).toBe('0');
    expect(tile('In escrow')).toBe('0');
    expect(tile('Released')).toBe('0');
    expect(tile('Completion rate')).toBe('—');
    // No breakdown bar is rendered when there is nothing to break down.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders a skeleton before the first response arrives', () => {
    // A promise that never settles keeps the first-load state on screen.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<StatsStrip />);

    expect(screen.getByText('Loading stats…')).toBeInTheDocument();
    for (const label of KPI_LABELS) {
      expect(tileIsSkeleton(label)).toBe(true);
    }
    // Placeholders, not zeros that could be mistaken for real data.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('shows an error with a retry that recovers, and keeps the tiles', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<StatsStrip />);

    expect(await screen.findByText(/Stats unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // The strip degrades to placeholders; it does not throw or blank out.
    for (const label of KPI_LABELS) {
      expect(tile(label)).toBe('—');
    }

    // A later successful retry replaces the error.
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify(stats({ contracts: 7 })), { status: 200 }),
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(tile('Escrows')).toBe('7'));
    await waitFor(() => expect(screen.queryByText(/Stats unavailable/)).not.toBeInTheDocument());
  });

  it('treats a malformed payload as an error rather than rendering NaN', async () => {
    mockStats({ contracts: 'four', byStatus: {}, totalEscrowed: 0, totalReleased: 0 });
    render(<StatsStrip />);

    expect(await screen.findByText(/Stats unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('treats a non-JSON body as an error', async () => {
    mockStats('<html>gateway timeout</html>');
    render(<StatsStrip />);
    expect(await screen.findByText(/Stats unavailable/)).toBeInTheDocument();
  });

  it('labels the breakdown bar with every count for screen readers', async () => {
    mockStats(stats({ contracts: 4, byStatus: { Funded: 2, Completed: 1, Disputed: 1 } }));
    render(<StatsStrip />);

    const bar = await screen.findByRole('img');
    expect(bar).toHaveAccessibleName(
      'Status breakdown of 4 escrows: 2 funded, 1 completed, 1 disputed',
    );
    expect(bar.querySelectorAll('.stats-seg')).toHaveLength(3);
  });

  it('omits the bar entirely when nothing has a count', async () => {
    mockStats({ contracts: 0, byStatus: {}, totalEscrowed: 0, totalReleased: 0 });
    render(<StatsStrip />);
    await screen.findByText(/No escrows yet/);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('links every legend entry to the filtered dashboard', async () => {
    mockStats(stats({ contracts: 4, byStatus: { Funded: 2, Completed: 1, Disputed: 1 } }));
    render(<StatsStrip />);

    const link = await screen.findByRole('link', { name: /Funded/ });
    expect(link).toHaveAttribute('href', '/contracts?status=Funded');
    // Every status is listed, including the ones at zero, so the legend is a
    // complete index rather than only what happens to be non-empty.
    expect(screen.getAllByRole('link')).toHaveLength(6);
    expect(screen.getByRole('link', { name: /Cancelled 0/ })).toBeInTheDocument();
  });

  it('is operable by keyboard alone', async () => {
    mockStats(stats());
    const user = userEvent.setup();
    render(<StatsStrip />);
    await screen.findByRole('img');

    await user.tab();
    expect(screen.getByRole('link', { name: /Created/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('link', { name: /Funded/ })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('link', { name: /Created/ })).toHaveFocus();
  });

  it('refetches when the refresh token changes', async () => {
    const fetchMock = mockStats(stats({ contracts: 1 }));
    const { rerender } = render(<StatsStrip refreshToken={0} />);
    await waitFor(() => expect(tile('Escrows')).toBe('1'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify(stats({ contracts: 5 })), { status: 200 }),
    );
    rerender(<StatsStrip refreshToken={1} />);

    await waitFor(() => expect(tile('Escrows')).toBe('5'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the previous numbers on screen while refreshing', async () => {
    const fetchMock = mockStats(stats({ contracts: 3 }));
    const { rerender } = render(<StatsStrip refreshToken={0} />);
    await waitFor(() => expect(tile('Escrows')).toBe('3'));

    // A refresh that hangs must not replace the numbers with skeletons.
    fetchMock.mockImplementation(() => new Promise(() => {}));
    rerender(<StatsStrip refreshToken={1} />);

    expect(tile('Escrows')).toBe('3');
    for (const label of KPI_LABELS) {
      expect(tileIsSkeleton(label)).toBe(false);
    }
  });

  it('requests the stats endpoint on the configured API host', async () => {
    const fetchMock = mockStats(stats());
    render(<StatsStrip />);
    await screen.findByRole('img');
    expect(fetchMock).toHaveBeenCalledWith(`${site.apiUrl}/api/v1/stats`, expect.anything());
  });
});
