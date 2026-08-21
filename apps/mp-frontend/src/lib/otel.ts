// observability/otel.ts
// MetaPlatform M10 Loop 3/3 — OTel SDK shim (Deno runtime)
//
// 完整 OTel SDK (@opentelemetry/sdk-node) 在 Deno runtime 不直接支持.
// 这里实现 minimal OTel trace context (W3C traceparent):
//   - generate trace_id (16 bytes hex, 32 chars)
//   - generate span_id (8 bytes hex, 16 chars)
//   - parent 解析 (incoming traceparent header)
//   - OTLP HTTP exporter (JSON protobuf to collector endpoint)
//
// 生产配置: 通过 env OTEL_EXPORTER_OTLP_ENDPOINT 指向 OTel Collector (http://otel-collector:4318/v1/traces)
// 本地 dev: 默认 console exporter (打印 trace_id 到 Deno.stdout)

const OTEL_ENDPOINT = (typeof process !== 'undefined' && process.env?.OTEL_EXPORTER_OTLP_ENDPOINT) || (typeof Deno !== 'undefined' && (Deno as any).env?.get?.('OTEL_EXPORTER_OTLP_ENDPOINT')) || '';
const SERVICE_NAME = (typeof process !== 'undefined' && process.env?.OTEL_SERVICE_NAME) || (typeof Deno !== 'undefined' && (Deno as any).env?.get?.('OTEL_SERVICE_NAME')) || 'mp-frontend';

export interface SpanContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  flags: string;
}

export function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSpanContext(parent?: string | null): SpanContext {
  if (parent) {
    // 解析 W3C traceparent: "00-{trace_id}-{span_id}-{flags}"
    const m = parent.match(/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/);
    if (m) {
      return {
        trace_id: m[1],
        span_id: randomHex(8),
        parent_span_id: m[2],
        flags: m[3],
      };
    }
  }
  return {
    trace_id: randomHex(16),
    span_id: randomHex(8),
    flags: '01',
  };
}

export function traceparentHeader(ctx: SpanContext): string {
  return `00-${ctx.trace_id}-${ctx.span_id}-${ctx.flags}`;
}

export interface SpanData {
  name: string;
  ctx: SpanContext;
  start_ms: number;
  end_ms: number;
  attributes: Record<string, string | number | boolean>;
  status: 'ok' | 'error';
  status_message?: string;
}

// 简单 span recorder (内存池, 周期 flush)
const spanBuffer: SpanData[] = [];

export function startSpan(name: string, parentTraceparent?: string | null): { ctx: SpanContext; finish: (status?: 'ok' | 'error', message?: string, extraAttrs?: Record<string, string | number | boolean>) => void } {
  const ctx = newSpanContext(parentTraceparent);
  const start_ms = Date.now();
  return {
    ctx,
    finish: (status = 'ok', message, extraAttrs) => {
      spanBuffer.push({
        name,
        ctx,
        start_ms,
        end_ms: Date.now(),
        attributes: { 'service.name': SERVICE_NAME, ...(extraAttrs ?? {}) },
        status,
        status_message: message,
      });
    },
  };
}

// 异步 flush spanBuffer 到 OTLP collector (生产) 或 console (本地)
export async function flushSpans(): Promise<{ count: number; exported: boolean; error?: string }> {
  if (spanBuffer.length === 0) return { count: 0, exported: false };
  const spans = spanBuffer.splice(0, spanBuffer.length);

  if (!OTEL_ENDPOINT) {
    // 本地 dev: console export
    for (const s of spans) {
      console.log(`[OTEL] ${s.name} ${s.status} ${s.end_ms - s.start_ms}ms trace=${s.ctx.trace_id} span=${s.ctx.span_id} attrs=${JSON.stringify(s.attributes)}`);
    }
    return { count: spans.length, exported: false };
  }

  // OTLP HTTP/JSON exporter (简化版)
  const otlpPayload = {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: SERVICE_NAME } },
        ],
      },
      scopeSpans: [{
        scope: { name: 'mp-otel', version: '0.1.0' },
        spans: spans.map((s) => ({
          traceId: s.ctx.trace_id,
          spanId: s.ctx.span_id,
          parentSpanId: s.ctx.parent_span_id ?? '',
          name: s.name,
          kind: 1, // INTERNAL
          startTimeUnixNano: (s.start_ms * 1_000_000).toString(),
          endTimeUnixNano: (s.end_ms * 1_000_000).toString(),
          attributes: Object.entries(s.attributes).map(([key, value]) => ({
            key,
            value: { stringValue: String(value) },
          })),
          status: { code: s.status === 'ok' ? 1 : 2, message: s.status_message ?? '' },
        })),
      }],
    }],
  };

  try {
    const resp = await fetch(`${OTEL_ENDPOINT}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(otlpPayload),
    });
    if (!resp.ok) {
      return { count: spans.length, exported: false, error: `HTTP ${resp.status}` };
    }
    return { count: spans.length, exported: true };
  } catch (err) {
    return { count: spans.length, exported: false, error: (err as Error).message };
  }
}

// 定时 flush (每 10s) - Deno runtime only (browser 不需要 setInterval, React 组件自行 flush)
if (typeof Deno !== 'undefined') {
  setInterval(() => {
    flushSpans().catch(() => { /* noop */ });
  }, 10_000);
}