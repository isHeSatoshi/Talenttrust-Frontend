import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EscrowContract } from '@/lib/api';
import { FundControl } from './FundControl';

const contract = (over: Partial<EscrowContract> = {}): EscrowContract => ({
  id: 1,
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

/** The API's failure shape: `{ error: <code>, message: <text> }`. */
const apiFailure = (code: string, message: string, status = 409) => {
  const failure = new Error(message) as Error & { code?: string; status?: number };
  failure.code = code;
  failure.status = status;
  return failure;
};

const setup = (over: Partial<EscrowContract> = {}, onDeposit = vi.fn().mockResolvedValue(undefined)) => {
  render(<FundControl contract={contract(over)} onDeposit={onDeposit} />);
  return {
    onDeposit,
    input: screen.getByLabelText('Deposit amount (XLM)'),
    deposit: screen.getByRole('button', { name: 'Deposit' }),
    remaining: screen.getByRole('button', { name: /^Remaining/ }),
    nextMilestone: screen.queryByRole('button', { name: /^Next milestone/ }),
    user: userEvent.setup(),
  };
};

describe('FundControl', () => {
  it('labels the amount input and names every control', () => {
    const { input, deposit, remaining } = setup();
    expect(input).toBeInTheDocument();
    expect(deposit).toBeInTheDocument();
    expect(remaining).toBeInTheDocument();
    expect(remaining).toHaveAccessibleName('Remaining (1,000 XLM)');
  });

  it('summarises funded vs. total on the bar, separately from the released bar', () => {
    setup({ fundedAmount: 250 });
    expect(screen.getByRole('img')).toHaveAccessibleName('Funded 250 of 1,000 XLM, 25%');
  });

  describe('presets', () => {
    it('offers Next milestone when the next milestone is not yet covered', async () => {
      const { user, input, nextMilestone } = setup({ fundedAmount: 100 });
      expect(nextMilestone).toHaveAccessibleName('Next milestone (200 XLM)');
      await user.click(nextMilestone!);
      expect(input).toHaveValue('200');
    });

    it('hides Next milestone once it is already covered', () => {
      const { nextMilestone } = setup({ fundedAmount: 300 });
      expect(nextMilestone).toBeNull();
    });

    it('hides Next milestone when nothing is left to release', () => {
      const { nextMilestone } = setup({
        fundedAmount: 1000,
        milestones: [{ index: 0, title: 'Design', amount: 300, released: true }],
      });
      expect(nextMilestone).toBeNull();
    });

    it('fills the remaining balance', async () => {
      const { user, input, remaining } = setup({ fundedAmount: 300 });
      expect(remaining).toHaveAccessibleName('Remaining (700 XLM)');
      await user.click(remaining);
      expect(input).toHaveValue('700');
    });

    it('moves focus to the input so the next keystroke edits the amount', async () => {
      const { user, input, remaining } = setup();
      await user.click(remaining);
      expect(input).toHaveFocus();
    });

    it('clears a previous error when a preset is used', async () => {
      const { user, input, deposit, remaining } = setup();
      await user.type(input, 'nonsense');
      await user.click(deposit);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      await user.click(remaining);
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('invalid input', () => {
    it.each([
      ['', 'Enter an amount to deposit.'],
      ['abc', 'Enter a number, for example 0.5.'],
      ['0', 'Enter an amount greater than 0.'],
      ['1.12345678', 'Use at most 7 decimal places.'],
      ['1000.1', 'Enter at most 1,000 XLM, the remaining balance.'],
    ])('shows %s inline and does not call the API', async (value, message) => {
      const { user, input, deposit, onDeposit } = setup();
      if (value) await user.type(input, value);
      await user.click(deposit);

      expect(screen.getByRole('alert')).toHaveTextContent(message);
      expect(onDeposit).not.toHaveBeenCalled();
    });

    it('links the error to the input and marks it invalid', async () => {
      const { user, input, deposit } = setup();
      await user.type(input, '0');
      await user.click(deposit);

      expect(input).toHaveAttribute('aria-invalid', 'true');
      const describedBy = input.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)).toHaveTextContent(
        'Enter an amount greater than 0.',
      );
    });

    it('clears the error as soon as the user edits the amount', async () => {
      const { user, input, deposit } = setup();
      await user.type(input, '0');
      await user.click(deposit);
      expect(screen.getByRole('alert')).toBeInTheDocument();

      await user.type(input, '5');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(input).not.toHaveAttribute('aria-invalid');
    });

    it('clears the amount and the error on Escape', async () => {
      const { user, input, deposit } = setup();
      await user.type(input, '0');
      await user.click(deposit);
      expect(screen.getByRole('alert')).toBeInTheDocument();

      await user.type(input, '{Escape}');
      expect(input).toHaveValue('');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('blocks a deposit against a fully funded escrow', async () => {
      const { user, input, deposit, onDeposit } = setup({ fundedAmount: 1000 });
      await user.type(input, '10');
      await user.click(deposit);
      expect(screen.getByRole('alert')).toHaveTextContent('This escrow is already fully funded.');
      expect(onDeposit).not.toHaveBeenCalled();
    });
  });

  describe('successful deposit', () => {
    it('passes the parsed amount and clears the field', async () => {
      const { user, input, deposit, onDeposit } = setup();
      await user.type(input, '250');
      await user.click(deposit);

      await waitFor(() => expect(onDeposit).toHaveBeenCalledWith(250));
      expect(input).toHaveValue('');
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('accepts exactly the remaining balance', async () => {
      const { user, input, deposit, onDeposit } = setup({ fundedAmount: 300 });
      await user.type(input, '700');
      await user.click(deposit);
      await waitFor(() => expect(onDeposit).toHaveBeenCalledWith(700));
    });

    it('submits on Enter without touching the mouse', async () => {
      const { user, input, onDeposit } = setup();
      await user.type(input, '150{Enter}');
      await waitFor(() => expect(onDeposit).toHaveBeenCalledWith(150));
    });

    it('reaches every control by keyboard alone', async () => {
      const { user, input, onDeposit } = setup();
      await user.tab();
      expect(input).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: /^Next milestone/ })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: /^Remaining/ })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Deposit' })).toHaveFocus();

      // Shift+Tab back onto Remaining and activate it with Space. Filling a
      // preset returns focus to the input, so Enter submits from there.
      await user.tab({ shift: true });
      expect(screen.getByRole('button', { name: /^Remaining/ })).toHaveFocus();
      await user.keyboard(' ');
      expect(input).toHaveValue('1000');
      expect(input).toHaveFocus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(onDeposit).toHaveBeenCalledWith(1000));
    });
  });

  describe('API failures surface inline', () => {
    it('maps an over_funded 409 to specific copy', async () => {
      const onDeposit = vi.fn().mockRejectedValue(
        apiFailure('over_funded', 'deposit exceeds contract total'),
      );
      const { user, input, deposit } = setup({}, onDeposit);
      await user.type(input, '250');
      await user.click(deposit);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('That deposit would over-fund the escrow.');
      expect(alert).not.toHaveTextContent('deposit exceeds contract total');
      // The message belongs to this control, so it is described by the input.
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('maps an invalid_status 409', async () => {
      const onDeposit = vi.fn().mockRejectedValue(apiFailure('invalid_status', 'Contract is Completed'));
      const { user, input, deposit } = setup({}, onDeposit);
      await user.type(input, '10');
      await user.click(deposit);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'This escrow is no longer accepting deposits.',
      );
    });

    it('falls back to the API message for an unmapped code', async () => {
      const onDeposit = vi.fn().mockRejectedValue(apiFailure('teapot', 'I am a teapot', 418));
      const { user, input, deposit } = setup({}, onDeposit);
      await user.type(input, '10');
      await user.click(deposit);
      expect(await screen.findByRole('alert')).toHaveTextContent('I am a teapot');
    });

    it('reports a network failure, which has no status or code', async () => {
      const onDeposit = vi.fn().mockRejectedValue(new Error('Failed to fetch'));
      const { user, input, deposit } = setup({}, onDeposit);
      await user.type(input, '10');
      await user.click(deposit);
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch');
    });

    it('reports a non-JSON error body, which surfaces as a bare status message', async () => {
      const onDeposit = vi.fn().mockRejectedValue(new Error('Request failed (500)'));
      const { user, input, deposit } = setup({}, onDeposit);
      await user.type(input, '10');
      await user.click(deposit);
      expect(await screen.findByRole('alert')).toHaveTextContent('Request failed (500)');
    });

    it('keeps the typed amount so the user can correct it', async () => {
      const onDeposit = vi.fn().mockRejectedValue(apiFailure('over_funded', 'nope'));
      const { user, input, deposit } = setup({}, onDeposit);
      await user.type(input, '250');
      await user.click(deposit);
      await screen.findByRole('alert');
      expect(input).toHaveValue('250');
    });

    it('recovers on the next successful attempt', async () => {
      const onDeposit = vi
        .fn()
        .mockRejectedValueOnce(apiFailure('over_funded', 'nope'))
        .mockResolvedValueOnce(undefined);
      const { user, input, deposit } = setup({}, onDeposit);
      await user.type(input, '250');
      await user.click(deposit);
      await screen.findByRole('alert');

      await user.click(deposit);
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(onDeposit).toHaveBeenCalledTimes(2);
    });
  });

  describe('busy state', () => {
    it('disables every control while another action is in flight', () => {
      render(<FundControl contract={contract()} busy onDeposit={vi.fn()} />);
      expect(screen.getByLabelText('Deposit amount (XLM)')).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Deposit' })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^Remaining/ })).toBeDisabled();
    });

    it('shows progress on the submit while the deposit is in flight', async () => {
      let resolve!: () => void;
      const onDeposit = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
      const { user, input, deposit } = setup({}, onDeposit);
      await user.type(input, '100');
      await user.click(deposit);

      expect(await screen.findByRole('button', { name: 'Depositing...' })).toBeDisabled();
      resolve();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Deposit' })).toBeEnabled());
    });
  });
});
