/**
 * tests/deploy/applicationset_yaml.test.ts
 *
 * Verifies the ArgoCD ApplicationSet YAML has 3 elements (dev/staging/prod).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const APP_PATH = join(process.cwd(), 'k8s/argoapp/applicationset-mp-platform.yaml');

describe('ArgoCD ApplicationSet', () => {
  const content = readFileSync(APP_PATH, 'utf8');
  const doc = parseYaml(content) as {
    kind: string;
    metadata: { name: string };
    spec: {
      generators: Array<{ list: { elements: Array<{ cluster: string }> } }>;
      template: { spec: { destination: { server: string; namespace: string }; syncPolicy: { automated: { prune: boolean; selfHeal: boolean } } } };
    };
  };

  it('is ApplicationSet', () => {
    expect(doc.kind).toBe('ApplicationSet');
    expect(doc.metadata.name).toBe('mp-platform');
  });

  it('targets 3 clusters: dev, staging, prod', () => {
    const elements = doc.spec.generators[0]?.list.elements ?? [];
    const clusters = elements.map((e) => e.cluster).sort();
    expect(clusters).toEqual(['dev', 'prod', 'staging']);
  });

  it('enables auto-sync with prune + selfHeal', () => {
    const sync = doc.spec.template.spec.syncPolicy;
    expect(sync.automated.prune).toBe(true);
    expect(sync.automated.selfHeal).toBe(true);
  });

  it('creates namespace via CreateNamespace sync option', () => {
    const syncOptions = (doc.spec.template.spec.syncPolicy as { syncOptions: string[] }).syncOptions ?? [];
    expect(syncOptions).toContain('CreateNamespace=true');
  });
});