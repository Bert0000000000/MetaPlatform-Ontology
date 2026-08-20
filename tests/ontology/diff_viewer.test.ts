/**
 * tests/ontology/diff_viewer.test.ts
 *
 * Verifies ontology diff computation logic.
 */

import { describe, it, expect } from 'vitest';
import { computeDiffRows } from '../apps/web/src/components/OntologyDiff/OntologyDiffViewer.js';

describe('computeDiffRows', () => {
  it('returns added/removed/modified/unchanged correctly', () => {
    const diff = {
      old: { name: 'Old', status: 'draft', removed_field: 'gone' },
      new: { name: 'New', status: 'active', added_field: 'fresh' },
    };

    const rows = computeDiffRows(diff);
    expect(rows).toHaveLength(4);

    const byField = Object.fromEntries(rows.map((r) => [r.field, r]));

    expect(byField['name']?.status).toBe('modified');
    expect(byField['status']?.status).toBe('modified');
    expect(byField['removed_field']?.status).toBe('removed');
    expect(byField['added_field']?.status).toBe('added');
  });

  it('handles empty diff gracefully', () => {
    expect(computeDiffRows({})).toEqual([]);
    expect(computeDiffRows({ old: null, new: null })).toEqual([]);
  });

  it('handles identical old/new as all unchanged', () => {
    const diff = {
      old: { a: 1, b: 2 },
      new: { a: 1, b: 2 },
    };

    const rows = computeDiffRows(diff);
    expect(rows.every((r) => r.status === 'unchanged')).toBe(true);
  });
});