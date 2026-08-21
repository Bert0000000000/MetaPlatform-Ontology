// src/lib/api.ts — 通用 API 客户端 (Supabase Edge Functions + OTel trace propagation)
import { newSpanContext, traceparentHeader } from './otel';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export async function authedFetch(path: string, opts: RequestInit = {}): Promise<unknown> {
  const url = path.startsWith('http') ? path : `${SUPABASE_URL}${path}`;
  // M10 Loop 3/3: 每请求生成 OTel trace context, 发 traceparent header
  const ctx = newSpanContext();
  const headers = new Headers(opts.headers);
  headers.set('apikey', SUPABASE_ANON_KEY);
  headers.set('Authorization', `Bearer ${SERVICE_KEY}`);
  headers.set('traceparent', traceparentHeader(ctx));
  if (!headers.has('Content-Type') && opts.body && typeof opts.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  const r = await fetch(url, { ...opts, headers });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}