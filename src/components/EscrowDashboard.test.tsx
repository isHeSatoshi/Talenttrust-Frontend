import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EscrowContract } from '@/lib/api';
import { EscrowDashboard } from './EscrowDashboard';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: apiMock };
});

/** The regression fixture from issue #1468: milestones 0.1 and 0.2, funded 0.3. */
const escrow: EscrowContract = {
  id: 7,
  title: 'Fractional escrow',
  client: 'GCLIENTX',
  freelancer: 'GFREELANCERY',
  token: 'XLM',
  milestones: [
    { index: 0, title: 'First', amount: 0.1, released: false },
    { index: 1, title: 'Second', amount: 0.2, released: false },
  ],
  totalAmount: 0.3,
  fundedAmount: 0.3,
  releasedAmount: 0,
  status: 'Funded',
  reputationIssued: false,
};

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue({ data: [escrow] });
});

describe('EscrowDashboard amounts', () => {
  it('renders 0.3 with no float artefact', async () => {
    render(<EscrowDashboard />);

    const inEscrow = await screen.findByText(/In escrow/i);
    // The bug printed 0.30000000000000004 here.
    expect(inEscrow.textContent).toContain('0.3 XLM');
    expect(inEscrow.textContent).not.toMatch(/0\.3000/);
    expect(inEscrow.textContent).not.toMatch(/e-/i);
  });

  it('shows every milestone amount exactly', async () => {
    render(<EscrowDashboard />);

    const first = await screen.findByText('0.1 XLM');
    const second = screen.getByText('0.2 XLM');
    expect(first).toBeInTheDocument();
    expect(second).toBeInTheDocument();
    // No float artefacts anywhere in the rendered output.
    expect(document.body.textContent).not.toMatch(/0\.30000000000000004/);
    expect(document.body.textContent).not.toMatch(/\d\.\d{8,}/);
  });

  it('offers the release action: the guard is true for the 0.2 milestone', async () => {
    render(<EscrowDashboard />);

    // funded 0.3 - released 0 >= 0.2 must hold. With doubles it could be false,
    // because 0.1 + 0.2 > 0.3.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /release next/i })).toBeEnabled();
    });
  });

  it('does not offer Fund when the escrow is already fully funded', async () => {
    render(<EscrowDashboard />);
    await screen.findByText(/In escrow/i);
    expect(screen.queryByRole('button', { name: /^Fund /i })).not.toBeInTheDocument();
  });

  it('shows the exact remaining amount when partially funded', async () => {
    apiMock.mockResolvedValue({
      data: [{ ...escrow, fundedAmount: 0.1 }],
    });
    render(<EscrowDashboard />);

    // total 0.3 - funded 0.1 = 0.2 exactly.
    const fund = await screen.findByRole('button', { name: /^Fund /i });
    expect(fund.textContent).toContain('0.2 XLM');
  });

  it('computes the released percentage without a float artefact', async () => {
    apiMock.mockResolvedValue({
      data: [{ ...escrow, releasedAmount: 0.1, status: 'Funded' as const }],
    });
    render(<EscrowDashboard />);

    const bar = await screen.findByLabelText(/released/i);
    // 0.1 / 0.3 = 33%, not 33.33333333333333
    expect(bar.getAttribute('aria-label')).toBe('33% released');
  });
});
