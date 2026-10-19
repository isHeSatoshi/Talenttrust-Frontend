import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reputation } from '@/lib/api';
import { ReputationLookup } from './ReputationLookup';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: apiMock };
});

const reputation = (over: Partial<Reputation>): Reputation => ({
  address: 'G',
  completedContracts: 1,
  totalRating: 5,
  averageRating: 5,
  ...over,
});

beforeEach(() => {
  apiMock.mockReset();
});

describe('ReputationLookup', () => {
  it('a slow response for an earlier address does not overwrite a newer result', async () => {
    const user = userEvent.setup();
    let resolveFirst: (value: Reputation) => void = () => {};
    const slow = new Promise<Reputation>((resolve) => {
      resolveFirst = resolve;
    });

    apiMock
      .mockImplementationOnce(() => slow)
      .mockImplementation(() => Promise.resolve(reputation({ completedContracts: 2 })));

    render(<ReputationLookup />);
    const input = screen.getByLabelText(/freelancer address/i);
    const form = input.closest('form');
    expect(form).not.toBeNull();

    // Request A — deliberately left pending. Submitted with Enter rather than a
    // click: the submit button is disabled while a lookup is in flight, but the
    // form still submits, which is how a real user starts a second lookup.
    await user.clear(input);
    await user.type(input, 'ADDRESS_A');
    fireEvent.submit(form!);

    // Request B — supersedes A and resolves first.
    await user.clear(input);
    await user.type(input, 'ADDRESS_B');
    fireEvent.submit(form!);

    expect(await screen.findByText('2')).toBeInTheDocument();

    // A finally resolves, carrying a different result. It must be discarded.
    resolveFirst(reputation({ completedContracts: 99 }));
    await waitFor(() => {
      expect(screen.queryByText('99')).not.toBeInTheDocument();
    });
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows mapped user copy rather than the raw transport message', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    apiMock.mockRejectedValueOnce(
      new ApiError({ kind: 'http', status: 409, code: 'already_rated', message: 'duplicate rating row' }),
    );

    render(<ReputationLookup />);
    await user.click(screen.getByRole('button', { name: /look up/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already been rated/i);
    expect(alert).not.toHaveTextContent(/duplicate rating row/);
    // The technical message stays available for debugging.
    expect(alert).toHaveAttribute('title', 'duplicate rating row');
  });

  it('does not surface a cancelled request as an error', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    apiMock.mockRejectedValueOnce(
      new ApiError({ kind: 'aborted', message: 'The request was aborted by the caller' }),
    );

    render(<ReputationLookup />);
    await user.click(screen.getByRole('button', { name: /look up/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });
});
