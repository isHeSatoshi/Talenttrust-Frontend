import { render, screen } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Header } from '@/components/Header';
import ContractsError from '@/app/contracts/error';
import AppError from '@/app/error';

// `Header` reads the current path to mark the active nav item, which needs the
// App Router context that a bare component test does not have.
vi.mock('next/navigation', () => ({
  usePathname: () => '/contracts',
}));

/**
 * A minimal stand-in for Next's segment error boundary.
 *
 * The nesting is the point: in the App Router the root LAYOUT sits outside the
 * route's error boundary, so a failure in a page replaces only the page
 * subtree and the header survives. This renders the same shape — layout first,
 * boundary inside it — which is what makes "header still visible" meaningful.
 */
class TestBoundary extends Component<
  { children: ReactNode; fallback: (e: Error & { digest?: string }, reset: () => void) => ReactNode },
  { error: (Error & { digest?: string }) | null }
> {
  state: { error: (Error & { digest?: string }) | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch() {
    // Swallowed: the test asserts on what is rendered, and React would
    // otherwise print the error to the console.
  }

  render() {
    if (this.state.error) {
      return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    }
    return this.props.children;
  }
}

function Boom(): never {
  throw new Error('escrow dashboard exploded');
}

/** The layout + boundary + page shape the App Router actually produces. */
function AppShell({ page, fallback }: { page: ReactNode; fallback: (e: Error & { digest?: string }, reset: () => void) => ReactNode }) {
  return (
    <>
      <Header />
      <main id="main">
        <TestBoundary fallback={fallback}>{page}</TestBoundary>
      </main>
    </>
  );
}

/**
 * Render the shell.
 *
 * `onCaughtError` is React 19's hook for errors a boundary handled; without it
 * React re-reports the deliberate throw and Vitest records the test as failed
 * even though the assertions passed.
 */
function renderShell(
  page: ReactNode,
  fallback: (e: Error & { digest?: string }, reset: () => void) => ReactNode,
) {
  return render(<AppShell page={page} fallback={fallback} />, {
    onCaughtError: () => {},
  });
}

describe('a throw inside the /contracts subtree', () => {
  it('renders the contracts boundary instead of crashing the layout, header still visible', () => {
    renderShell(<Boom />, (error, reset) => <ContractsError error={error} reset={reset} />);

    // The boundary rendered...
    expect(
      screen.getByRole('heading', { name: /the escrow dashboard could not load/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();

    // ...and the layout survived it, because it is outside the boundary.
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /talenttrust home/i })).toBeInTheDocument();
  });

  it('recovers when the boundary resets', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onReset = vi.fn();

    // A flag rather than a render counter: React double-renders in development,
    // so counting renders is not deterministic. The reset handler flips this,
    // which is what Next's `reset()` produces once the failure has cleared.
    let broken = true;
    function Flaky() {
      if (broken) throw new Error('transient');
      return <p>dashboard content</p>;
    }

    renderShell(<Flaky />, (error, reset) => (
      <ContractsError
        error={error}
        reset={() => {
          broken = false;
          onReset();
          reset();
        }}
      />
    ));

    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(screen.getByText('dashboard content')).toBeInTheDocument();
    // The layout is still mounted after recovery.
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('the root boundary catches a failure in a route that has no boundary of its own', () => {
    renderShell(<Boom />, (error, reset) => <AppError error={error} reset={reset} />);

    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });
});
