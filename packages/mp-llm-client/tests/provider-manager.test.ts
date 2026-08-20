/**
 * packages/mp-llm-client/tests/provider-manager.test.ts
 *
 * Verifies rate limit + circuit breaker + fallback chain logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TokenBucketLimiter,
  SimpleCircuitBreaker,
  ProviderManager,
  type ProviderConfig,
  type ChatRequest,
} from '../src/provider-manager.js';

describe('TokenBucketLimiter', () => {
  it('allows requests up to limit', async () => {
    const limiter = new TokenBucketLimiter({ requestsPerMinute: 3, tokensPerMinute: 1000 });
    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(false);  // 第 4 个被拒
  });
});

describe('SimpleCircuitBreaker', () => {
  it('opens after failureThreshold failures', () => {
    const cb = new SimpleCircuitBreaker({ failureThreshold: 3, cooldownSeconds: 60 });
    expect(cb.state()).toBe('closed');
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state()).toBe('closed');
    cb.recordFailure();
    expect(cb.state()).toBe('open');
  });

  it('resets failures on success', () => {
    const cb = new SimpleCircuitBreaker({ failureThreshold: 3, cooldownSeconds: 60 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state()).toBe('closed');  // 还没到 3
  });
});

describe('ProviderManager', () => {
  let manager: ProviderManager;

  const deepseekConfig: ProviderConfig = {
    name: 'deepseek-primary',
    type: 'deepseek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    rateLimit: { requestsPerMinute: 100, tokensPerMinute: 100000 },
    circuitBreaker: { failureThreshold: 3, cooldownSeconds: 60 },
  };

  const openaiConfig: ProviderConfig = {
    name: 'openai-secondary',
    type: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    rateLimit: { requestsPerMinute: 50, tokensPerMinute: 50000 },
    circuitBreaker: { failureThreshold: 3, cooldownSeconds: 60 },
  };

  beforeEach(() => {
    manager = new ProviderManager();
    manager.register(deepseekConfig);
    manager.register(openaiConfig);
  });

  it('uses primary on success', async () => {
    const req: ChatRequest = { messages: [{ role: 'user', content: 'hi' }] };
    const resp = await manager.chat(req, ['deepseek-primary', 'openai-secondary']);
    expect(resp.provider).toBe('deepseek-primary');
  });

  it('rate limit triggers fallback to secondary', async () => {
    const req: ChatRequest = { messages: [{ role: 'user', content: 'hi' }] };

    // 用光 deepseek 的 rate limit
    const limiterEntry = (manager as unknown as {
      providers: Map<string, { limiter: TokenBucketLimiter }>;
    }).providers.get('deepseek-primary');
    if (limiterEntry) {
      for (let i = 0; i < 100; i++) await limiterEntry.limiter.tryAcquire();
    }

    const resp = await manager.chat(req, ['deepseek-primary', 'openai-secondary']);
    expect(resp.provider).toBe('openai-secondary');
  });
});