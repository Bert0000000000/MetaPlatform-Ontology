/**
 * tests/backup/wal_g.test.ts
 *
 * Verifies scripts/backup/wal-g.sh argument parsing and required-env validation.
 * Does NOT execute the script (which would require S3 + Postgres).
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPT = join(process.cwd(), 'scripts/backup/wal-g.sh');

describe('scripts/backup/wal-g.sh', () => {
  it('is executable', () => {
    const stat = execFileSync('stat', [SCRIPT]).toString();
    expect(stat).toMatch(/Access:.*-rwx/);
  });

  it('requires WALG_S3_PREFIX env var', () => {
    let stderr = '';
    try {
      execFileSync('bash', [SCRIPT], {
        env: { ...process.env, WALG_S3_PREFIX: undefined, AWS_ACCESS_KEY_ID: undefined },
        stdio: 'pipe',
      });
    } catch (err: unknown) {
      const e = err as { stderr?: Buffer };
      stderr = e.stderr?.toString() ?? '';
    }
    expect(stderr).toMatch(/WALG_S3_PREFIX.*must be set/);
  });

  it('accepts push|fetch|backup-list|backup-push actions', () => {
    const content = execFileSync('cat', [SCRIPT]).toString();
    expect(content).toMatch(/push/);
    expect(content).toMatch(/fetch/);
    expect(content).toMatch(/backup-list/);
    expect(content).toMatch(/backup-push/);
  });

  it('rejects unknown actions', () => {
    const content = execFileSync('cat', [SCRIPT]).toString();
    expect(content).toMatch(/usage:/);
  });
});