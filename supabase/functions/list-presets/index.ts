// supabase/functions/list-presets/index.ts
// PRD: docs/active/decisions/ADR-0062-v6.1-app-center.md
// Batch: MetaPlatform.1-APP-CENTER-01
// Loop 2/5: GET /functions/v1/list-presets
// Public catalog (RLS):
//   anon: public visibility only
//   authenticated: public + own tenant private
// Query: ?category=&search=&sort=popular|recent|name&page=1&per_page=20

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";

interface ListParams {
  category: string | null;
  search: string | null;
  sort: 'popular' | 'recent' | 'name';
  page: number;
  perPage: number;
}

function parseParams(url: URL): ListParams {
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1') || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(url.searchParams.get('per_page') ?? '20') || 20));
  const sortRaw = url.searchParams.get('sort') ?? 'popular';
  const sort = (sortRaw === 'name' || sortRaw === 'recent') ? sortRaw : 'popular';
  return {
    category: url.searchParams.get('category'),
    search: url.searchParams.get('search'),
    sort: sort as ListParams['sort'],
    page,
    perPage,
  };
}

serve(async (req) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const url = new URL(req.url);
    const params = parseParams(url);
    const auth = req.headers.get('authorization');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // RLS 用 anon + user JWT 让 supabase 自动 filter (public visibility + own tenant private)
    // service_role 只在 admin 端点用
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      auth?.startsWith('Bearer ') ? anonKey : serviceKey,
      { global: { headers: auth ? { Authorization: auth } : {} } }
    );

    // Query: 公开 + 自己租户的私有
    let query = supabase
      .schema('mp_preset_registry')
      .from('presets')
      .select(`
        id, slug, name, description, category, tenant_id, current_version,
        downloads_count, created_at, updated_at
      `, { count: 'exact' });

    if (params.category) {
      query = query.eq('category', params.category);
    }
    if (params.search) {
      query = query.or(`name.ilike.%${params.search}%,description.ilike.%${params.search}%,slug.ilike.%${params.search}%`);
    }

    // Sort
    if (params.sort === 'name') query = query.order('name', { ascending: true });
    else if (params.sort === 'recent') query = query.order('updated_at', { ascending: false });
    else query = query.order('downloads_count', { ascending: false });

    // Pagination
    const from = (params.page - 1) * params.perPage;
    query = query.range(from, from + params.perPage - 1);

    const { data, count, error } = await query;

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      data: data ?? [],
      pagination: {
        page: params.page,
        per_page: params.perPage,
        total: count ?? 0,
        total_pages: Math.ceil((count ?? 0) / params.perPage),
      },
      sort: params.sort,
      category: params.category,
      search: params.search,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
