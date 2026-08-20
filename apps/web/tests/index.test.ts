import { describe, it, expect } from 'vitest';
import { createApp, DEFAULT_CONFIG } from '../src/index.js';

describe('@mp/web scaffold', () => {
  it('returns a frozen app descriptor', () => {
    const app = createApp();
    expect(app.version).toBe('6.0.0-scaffold');
    expect(typeof app.port).toBe('number');
    expect(Object.isFrozen(app)).toBe(true);
  });

  it('DEFAULT_CONFIG provides safe defaults', () => {
    expect(DEFAULT_CONFIG.port).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.supabaseUrl).toMatch(/^https?:\/\//);
    expect(DEFAULT_CONFIG.temporalAddress).toMatch(/:7233$/);
  });

  it('accepts overrides', () => {
    const app = createApp({ ...DEFAULT_CONFIG, port: 9999 });
    expect(app.port).toBe(9999);
  });
});