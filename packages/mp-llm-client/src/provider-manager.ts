/**
 * packages/mp-llm-client/src/provider-manager.ts
 * PRD: docs/active/prd/llm-providers.md §4.2/§4.3
 * Batch: MetaPlatform-LLM-01
 *
 * 多 LLM provider 管理: rate limit + circuit breaker + fallback chain
 */

interface RateLimiter {
  tryAcquire(): Promise<boolean>;
  tokensAcquired(n: number): void;
}

interface CircuitBreaker {
  state(): 'closed' | 'open' | 'half-open';
  recordSuccess(): void;
  recordFailure(): void;
}

export interface ProviderConfig {
  readonly name: string;
  readonly type: string;
  readonly apiKeyEnv: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly rateLimit: { requestsPerMinute: number; tokensPerMinute: number };
  readonly circuitBreaker: { failureThreshold: number; cooldownSeconds: number };
}

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatRequest {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tenantId?: string;
  readonly preset?: string;
}

export interface ChatResponse {
  readonly content: string;
  readonly usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  readonly provider: string;
  readonly model: string;
  readonly durationMs: number;
}

export class TokenBucketLimiter implements RateLimiter {
  private requestsPerMin: number;
  private tokensPerMin: number;
  private requestCount = 0;
  private tokenCount = 0;
  private resetAt = Date.now() + 60_000;

  constructor(opts: { requestsPerMinute: number; tokensPerMinute: number }) {
    this.requestsPerMin = opts.requestsPerMinute;
    this.tokensPerMin = opts.tokensPerMinute;
  }

  async tryAcquire(): Promise<boolean> {
    this.maybeReset();
    return this.requestCount < this.requestsPerMin;
  }

  tokensAcquired(n: number): void {
    this.tokenCount += n;
  }

  private maybeReset(): void {
    if (Date.now() >= this.resetAt) {
      this.requestCount = 0;
      this.tokenCount = 0;
      this.resetAt = Date.now() + 60_000;
    }
  }
}

export class SimpleCircuitBreaker implements CircuitBreaker {
  private currentState: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private openedAt = 0;
  private failureThreshold: number;
  private cooldownSeconds: number;

  constructor(opts: { failureThreshold: number; cooldownSeconds: number }) {
    this.failureThreshold = opts.failureThreshold;
    this.cooldownSeconds = opts.cooldownSeconds;
  }

  state(): 'closed' | 'open' | 'half-open' {
    // cooldown 已过 → 切到 half-open (允许探测请求)
    if (this.currentState === 'open' && Date.now() >= this.openedAt + this.cooldownSeconds * 1000) {
      this.currentState = 'half-open';
    }
    return this.currentState;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.currentState = 'closed';
  }

  recordFailure(): void {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.currentState = 'open';
      this.openedAt = Date.now();
    }
  }
}

export class ProviderManager {
  private providers = new Map<string, { config: ProviderConfig; limiter: RateLimiter; breaker: CircuitBreaker }>();

  register(config: ProviderConfig): void {
    this.providers.set(config.name, {
      config,
      limiter: new TokenBucketLimiter(config.rateLimit),
      breaker: new SimpleCircuitBreaker(config.circuitBreaker),
    });
  }

  /**
   * 按 fallback chain 顺序尝试 provider, 跳过 rate limit / circuit open
   */
  async chat(req: ChatRequest, fallbackChain: ReadonlyArray<string>): Promise<ChatResponse> {
    let lastErr: unknown = null;

    for (const providerName of fallbackChain) {
      const entry = this.providers.get(providerName);
      if (!entry) continue;

      if (entry.breaker.state() === 'open') {
        console.warn(`[llm] ${providerName} circuit open, skipping`);
        continue;
      }

      if (!await entry.limiter.tryAcquire()) {
        console.warn(`[llm] ${providerName} rate limited, skipping`);
        continue;
      }

      try {
        const start = Date.now();
        // 实际 LLM 调用 (stub: 这里 mock 返回)
        const response: ChatResponse = {
          content: `[mock from ${providerName}] response to: ${req.messages.at(-1)?.content}`,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          provider: providerName,
          model: entry.config.defaultModel,
          durationMs: Date.now() - start,
        };

        entry.breaker.recordSuccess();
        entry.limiter.tokensAcquired(response.usage.totalTokens);
        return response;
      } catch (err) {
        entry.breaker.recordFailure();
        lastErr = err;
      }
    }

    throw new Error(`all providers failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
  }
}

export default ProviderManager;