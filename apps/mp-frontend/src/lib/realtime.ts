// src/lib/realtime.ts — Supabase Realtime 订阅 (W3C trace context propagation)
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: { eventsPerSecond: 5 },
  },
  auth: { persistSession: false },
});

export type RealtimeHandler = (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Record<string, unknown>; old: Record<string, unknown> }) => void;

export function subscribeTable(
  table: string,
  onChange: RealtimeHandler,
  filter?: string,
): { unsubscribe: () => void } {
  const channel = supabaseClient
    .channel(`${table}-changes`)
    .on(
      'postgres_changes' as never,
      { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) } as never,
      onChange as never,
    )
    .subscribe();
  return {
    unsubscribe: () => {
      void supabaseClient.removeChannel(channel);
    },
  };
}