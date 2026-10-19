import { screen } from '@testing-library/react';

/**
 * Reads a KPI tile by its label.
 *
 * A bare `screen.getByText('1')` is ambiguous on this page: the same digits
 * appear in the legend counts, the escrow headings and the milestone amounts.
 * Scoping to the tile keeps the assertions about the tile's own value.
 */
export function tile(label: string): string {
  const el = screen.getByText(label).closest('.stats-tile');
  if (!el) throw new Error(`no KPI tile labelled ${label}`);
  const value = el.querySelector('.stats-value');
  if (!value) throw new Error(`tile ${label} has no value element`);
  return value.textContent ?? '';
}

/** Whether a tile is currently showing its loading placeholder. */
export function tileIsSkeleton(label: string): boolean {
  const el = screen.getByText(label).closest('.stats-tile');
  if (!el) throw new Error(`no KPI tile labelled ${label}`);
  return el.querySelector('.stats-skeleton') !== null;
}

export const KPI_LABELS = ['Escrows', 'In escrow', 'Released', 'Completion rate'] as const;
