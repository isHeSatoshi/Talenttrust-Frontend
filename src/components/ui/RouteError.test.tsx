import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RouteError } from './RouteError';

describe('RouteError', () => {
  const error = Object.assign(new Error('boom: connection refused'), { digest: 'abc123' });

  it('renders the heading, description and both actions', () => {
    render(<RouteError error={error} reset={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute('href', '/');
  });

  it('calls reset() when Try again is pressed', async () => {
    const reset = vi.fn();
    const user = userEvent.setup();
    render(<RouteError error={error} reset={reset} />);

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('focuses the heading on mount so keyboard users land on the error', () => {
    render(<RouteError error={error} reset={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('hides the error details in production', () => {
    render(<RouteError error={error} reset={vi.fn()} showDetails={false} />);
    expect(screen.queryByText(/boom: connection refused/)).not.toBeInTheDocument();
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument();
    // The user-facing copy is still there.
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('shows the message and digest in development', () => {
    render(<RouteError error={error} reset={vi.fn()} showDetails />);
    expect(screen.getByText(/boom: connection refused/)).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
    expect(screen.getByText(/development only/i)).toBeInTheDocument();
  });

  it('hides details by default outside development', () => {
    // Vitest sets NODE_ENV=test, which is not 'development', so this exercises
    // the real default path: `showDetails` unset must resolve to hidden.
    expect(process.env.NODE_ENV).not.toBe('development');
    render(<RouteError error={error} reset={vi.fn()} />);
    expect(screen.queryByText(/boom: connection refused/)).not.toBeInTheDocument();
    expect(screen.queryByText(/abc123/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('accepts route-specific copy', () => {
    render(
      <RouteError
        error={error}
        reset={vi.fn()}
        title="The escrow dashboard could not load"
        description="Your wallet is unaffected."
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /the escrow dashboard could not load/i,
    );
    expect(screen.getByText(/your wallet is unaffected/i)).toBeInTheDocument();
  });
});
