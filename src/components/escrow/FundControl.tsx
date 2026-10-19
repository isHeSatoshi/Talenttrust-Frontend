'use client';

import { FormEvent, useId, useRef, useState } from 'react';
import type { EscrowContract } from '@/lib/api';
import {
  formatStroops,
  nextMilestoneStroops,
  remainingStroops,
  toDecimalString,
  toStroops,
  validateDeposit,
} from '@/lib/deposit';

/**
 * The API's failure codes, restated in the user's terms. Anything not listed
 * falls through to the message the API sent.
 */
const API_ERRORS: Record<string, string> = {
  over_funded: 'That deposit would over-fund the escrow. Enter the remaining balance or less.',
  invalid_status: 'This escrow is no longer accepting deposits.',
  invalid_amount: 'The API rejected that amount. Enter a positive number.',
};

export interface FundControlProps {
  contract: EscrowContract;
  /** True while any action on this contract is in flight. */
  busy?: boolean;
  /**
   * Perform the deposit. Rejecting surfaces the failure inline, under this
   * control, rather than in the dashboard's global banner.
   */
  onDeposit: (amount: number) => Promise<void>;
}

/**
 * Inline funding control: a funded-vs-total bar, a decimal amount input, the
 * two presets that cover the common cases, and a Deposit submit.
 */
export function FundControl({ contract, busy = false, onDeposit }: FundControlProps) {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const token = contract.token;
  const remaining = remainingStroops(contract);
  const nextMilestone = nextMilestoneStroops(contract);
  const funded = toStroops(contract.fundedAmount);
  const total = toStroops(contract.totalAmount);
  const fundedPercent = total > 0n ? Number((funded * 100n) / total) : 0;
  const disabled = busy || submitting;

  const fill = (stroops: bigint) => {
    setValue(toDecimalString(stroops));
    setError(null);
    inputRef.current?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const check = validateDeposit(value, contract);
    if (!check.ok) {
      setError(check.error);
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onDeposit(check.amount);
      setValue('');
    } catch (err) {
      const failure = err as Error & { code?: string };
      setError(API_ERRORS[failure.code ?? ''] ?? failure.message ?? 'The deposit failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="fund" onSubmit={submit} noValidate>
      <div
        className="fund-bar"
        role="img"
        aria-label={`Funded ${formatStroops(funded)} of ${formatStroops(total)} ${token}, ${fundedPercent}%`}
      >
        <span style={{ width: `${fundedPercent}%` }} />
      </div>
      <p className="small muted fund-meta">
        Funded {formatStroops(funded)} / {formatStroops(total)} {token}
      </p>

      <div className="field">
        <label htmlFor={inputId}>Deposit amount ({token})</label>
        <input
          id={inputId}
          ref={inputRef}
          className="input"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setValue('');
              setError(null);
            }
          }}
        />
      </div>

      <div className="row">
        {nextMilestone > 0n && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => fill(nextMilestone)}
            disabled={disabled}
          >
            Next milestone ({formatStroops(nextMilestone)} {token})
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => fill(remaining)}
          disabled={disabled}
        >
          Remaining ({formatStroops(remaining)} {token})
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={disabled}>
          {submitting ? 'Depositing...' : 'Deposit'}
        </button>
      </div>

      {error && (
        <p className="fund-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
