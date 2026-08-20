/**
 * @mp/web — Frontend application shell entry
 *
 * Per docs/active/specs/2026-08-19-mp-v6-application-architecture.md
 * Frontend category: app-web is the Semi Design-based React shell that hosts
 * dsh-web / mate-studio / admin-web micro-frontends.
 *
 * NOTE: This is the Phase A scaffold. Full implementation lands in
 * MP-V6-DSH-DOCKER-01 + MP-V6-AUTH-01 batches.
 */

export interface AppConfig {
  readonly port: number;
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly temporalAddress: string;
  readonly otelEndpoint: string;
}

export const DEFAULT_CONFIG: AppConfig = Object.freeze({
  port: Number(process.env.PORT ?? 3080),
  supabaseUrl: process.env.SUPABASE_URL ?? 'http://localhost:54321',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
  temporalAddress: process.env.TEMPORAL_ADDRESS ?? 'localhost:7233',
  otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
});

export function createApp(config: AppConfig = DEFAULT_CONFIG): { readonly version: string; readonly port: number } {
  return Object.freeze({
    version: '6.0.0-scaffold',
    port: config.port,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  console.info(`[mp/web] v${app.version} listening on :${app.port}`);
}