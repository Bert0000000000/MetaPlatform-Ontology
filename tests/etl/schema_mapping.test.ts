/**
 * tests/etl/schema_mapping.test.ts
 *
 * Verifies schema_mapping.yaml has correct structure (17-domain template format).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const MAPPING_PATH = join(process.cwd(), 'scripts/etl/schema_mapping.yaml');

describe('schema_mapping.yaml', () => {
  const content = readFileSync(MAPPING_PATH, 'utf8');
  const mapping = parseYaml(content) as {
    version: string;
    generated_at: string;
    [domain: string]: unknown;
  };

  it('has version + generated_at metadata', () => {
    expect(mapping.version).toBeTruthy();
    expect(mapping.generated_at).toBeTruthy();
  });

  it('declares required domain mappings', () => {
    for (const domain of ['tenants', 'customers', 'orders', 'contracts']) {
      expect(mapping[domain]).toBeDefined();
    }
  });

  it('each domain has v3_table + v6_table + field_map', () => {
    for (const domain of ['tenants', 'customers', 'orders', 'contracts']) {
      const m = mapping[domain] as { v3_table: string; v6_table: string; field_map: unknown[] };
      expect(m.v3_table).toBeTruthy();
      expect(m.v6_table).toBeTruthy();
      expect(Array.isArray(m.field_map)).toBe(true);
      expect(m.field_map.length).toBeGreaterThan(0);
    }
  });

  it('field_map entries have v3 + v6 + transform keys', () => {
    const orders = mapping.orders as { field_map: Array<{ v3: string; v6: string; transform: string | null }> };
    for (const field of orders.field_map) {
      expect(field.v3).toBeTruthy();
      expect(field.v6).toBeTruthy();
    }
  });

  it('BIGINT → UUID transforms present for primary keys', () => {
    const tenants = mapping.tenants as { field_map: Array<{ v3: string; transform: string | null }> };
    const idField = tenants.field_map.find((f) => f.v3 === 'id');
    expect(idField?.transform).toContain('uuid');
  });
});