import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EscrowCardSkeleton, LoadingAnnouncement, Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('is decorative: hidden from assistive technology', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the line variant with a full width by default', () => {
    const { container } = render(<Skeleton variant="line" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('skeleton-line');
    expect(el.style.width).toBe('100%');
  });

  it('honours explicit dimensions', () => {
    const { container } = render(<Skeleton variant="block" width={120} height={32} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.width).toBe('120px');
    expect(el.style.height).toBe('32px');
  });
});

describe('EscrowCardSkeleton', () => {
  it('mirrors the real card structure so the layout does not shift', () => {
    const { container } = render(<EscrowCardSkeleton />);
    const card = container.querySelector('article.card');
    expect(card).not.toBeNull();
    // The real card renders a progress bar and a milestone list; the
    // placeholder reserves the same boxes.
    expect(card!.querySelector('.milestones')).not.toBeNull();
    expect(card!.querySelectorAll('.skeleton').length).toBeGreaterThan(4);
  });

  it('is hidden from assistive technology', () => {
    const { container } = render(<EscrowCardSkeleton />);
    expect(container.querySelector('article.card')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('LoadingAnnouncement', () => {
  it('announces loading exactly once via a live status role', () => {
    render(<LoadingAnnouncement label="Loading escrows" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading escrows');
  });

  it('defaults the label', () => {
    render(<LoadingAnnouncement />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });
});

describe('reduced-motion support', () => {
  // The shimmer is CSS, so this asserts the rule rather than a computed style:
  // jsdom does not evaluate media queries, and the requirement is that the
  // animation is switched off under `prefers-reduced-motion: reduce`.
  const css = readFileSync(
    join(process.cwd(), 'src', 'app', 'globals.css'),
    'utf8',
  );

  it('disables the shimmer animation under prefers-reduced-motion: reduce', () => {
    const block = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(block, 'expected a prefers-reduced-motion: reduce block').not.toBeNull();
    const body = block![1];
    expect(body).toMatch(/\.skeleton::after/);
    expect(body).toMatch(/animation:\s*none/);
  });

  it('still reserves space when motion is reduced', () => {
    // The skeleton keeps its background and dimensions, so the CLS benefit does
    // not depend on the animation.
    expect(css).toMatch(/\.skeleton\s*\{[^}]*background:\s*var\(--surface-2\)/);
  });
});
