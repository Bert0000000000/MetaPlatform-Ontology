// src/lib/frontend-obs.ts — 浏览器 OTel 风格前端埋点 SDK
// mp-frontend-obs Loop 2/3 — 自动追踪 page_view + 提供 click/error/performance API
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const API_URL = 'http://127.0.0.1:54321/functions/v1/mp-frontend-obs-events';
const SESSION_ID = `sess-${Math.random().toString(36).slice(2, 10)}`;

type EventType = 'page_view' | 'click' | 'error' | 'performance';

interface ObsEvent {
  event_type: EventType;
  page?: string;
  data?: Record<string, unknown>;
  session_id?: string;
}

async function send(event: ObsEvent): Promise<void> {
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' },
      body: JSON.stringify(event),
    });
  } catch { /* ignore */ }
}

/** Auto-track page_view on route change */
export function useFrontendObs() {
  const location = useLocation();
  const startRef = useRef<number>(performance.now());

  useEffect(() => {
    const page = location.pathname;
    const duration = Math.round(performance.now() - startRef.current);
    startRef.current = performance.now();
    void send({
      event_type: 'page_view',
      page,
      session_id: SESSION_ID,
      data: { route: page, from: document.referrer || 'direct' },
    });
    // Performance metric
    void send({
      event_type: 'performance',
      page,
      session_id: SESSION_ID,
      data: { metric: 'page_load_ms', value: duration },
    });
  }, [location.pathname]);
}

/** Track a custom event */
export function trackEvent(event_type: EventType, data: Record<string, unknown> = {}, page?: string) {
  void send({ event_type, page: page ?? window.location.pathname, session_id: SESSION_ID, data });
}

/** Track error */
export function trackError(message: string, stack?: string, page?: string) {
  trackEvent('error', { message, stack: stack?.slice(0, 1000) }, page);
}

export { SESSION_ID };