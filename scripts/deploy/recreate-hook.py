import asyncio
import asyncpg

async def main():
    c = await asyncpg.connect(host='localhost', port=54322, user='postgres', password='postgres', database='postgres')
    await c.execute('DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb)')
    await c.execute('''
    CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp, auth
    AS $func$
    DECLARE
        v_user_id uuid := (event->>'user_id')::uuid;
        claims jsonb;
        v_tenant_id uuid;
        v_role text;
    BEGIN
        RAISE LOG 'hook_event=%', event::text;
        v_tenant_id := NULLIF((event->'app_metadata'->>'tenant_id'), '')::uuid;
        IF v_tenant_id IS NULL THEN
            v_tenant_id := NULLIF((event->'claims'->>'tenant_id'), '')::uuid;
        END IF;
        IF v_tenant_id IS NULL THEN
            SELECT p.tenant_id INTO v_tenant_id FROM public.profiles p WHERE p.id = v_user_id;
        END IF;
        v_role := COALESCE(event->'app_metadata'->>'role', event->'claims'->>'role', 'member');
        v_tenant_id := COALESCE(v_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid);
        claims := event->'claims';
        claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id::text));
        claims := jsonb_set(claims, '{role}', to_jsonb(v_role));
        RETURN jsonb_set(event, '{claims}', claims);
    END;
    $func$
    ''')
    await c.execute('GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin')
    print('Hook re-created')
    await c.close()

asyncio.run(main())
