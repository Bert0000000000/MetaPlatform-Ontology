/**
 * tests/observability/otel_config.test.ts
 *
 * Verifies OTel Collector config has required pipelines + processors.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const OTEL_CONFIG_PATH = join(process.cwd(), 'k8s/observability/otel-collector-config.yaml');

describe('OTel Collector config', () => {
  const content = readFileSync(OTEL_CONFIG_PATH, 'utf8');

  it('declares 3 pipelines (traces / metrics / logs)', () => {
    expect(content).toMatch(/pipelines:/);
    expect(content).toMatch(/traces:/);
    expect(content).toMatch(/metrics:/);
    expect(content).toMatch(/logs:/);
  });

  it('includes memory_limiter + batch processors', () => {
    expect(content).toMatch(/memory_limiter:/);
    expect(content).toMatch(/batch:/);
  });

  it('includes k8sattributes + transform processors (platform.mp=v6.0)', () => {
    expect(content).toMatch(/k8sattributes:/);
    expect(content).toMatch(/transform:/);
    expect(content).toMatch(/platform\.mp.*v6\.0/);
  });

  it('configures tail_sampling with error + slow + default policies', () => {
    expect(content).toMatch(/tail_sampling:/);
    expect(content).toMatch(/errors/);
    expect(content).toMatch(/slow-traces/);
    expect(content).toMatch(/probabilistic/);
  });

  it('exports to otlp (tempo) + prometheus + loki', () => {
    expect(content).toMatch(/exporters:/);
    expect(content).toMatch(/otlp:/);
    expect(content).toMatch(/prometheus:/);
    expect(content).toMatch(/loki:/);
  });
});