import pg from 'pg';
const c = new pg.Client({ host: 'localhost', port: 54322, user: 'postgres', password: 'postgres', database: 'postgres' });
await c.connect();
// Match the working image pattern: p_embedding vector (no explicit cast)
const sql = `
CREATE OR REPLACE FUNCTION public.insert_video_embedding(
    p_tenant_id uuid,
    p_video_url text,
    p_video_hash text,
    p_video_duration_sec numeric,
    p_keyframe_count int,
    p_image_embedding_id uuid,
    p_frame_index int,
    p_frame_timestamp_sec numeric,
    p_embedding vector,
    p_metadata jsonb
) RETURNS public.video_embeddings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp, mp_preset_registry
AS $func$ DECLARE v_row public.video_embeddings;
BEGIN
    INSERT INTO public.video_embeddings (
        tenant_id, video_url, video_hash, video_duration_sec, keyframe_count,
        image_embedding_id, frame_index, frame_timestamp_sec, embedding, metadata
    ) VALUES (
        p_tenant_id, p_video_url, p_video_hash, p_video_duration_sec, p_keyframe_count,
        p_image_embedding_id, p_frame_index, p_frame_timestamp_sec, p_embedding, p_metadata
    )
    ON CONFLICT (tenant_id, video_hash, frame_index) DO UPDATE
        SET video_duration_sec = EXCLUDED.video_duration_sec,
            keyframe_count = EXCLUDED.keyframe_count,
            image_embedding_id = EXCLUDED.image_embedding_id,
            frame_timestamp_sec = EXCLUDED.frame_timestamp_sec,
            embedding = EXCLUDED.embedding,
            metadata = EXCLUDED.metadata
    RETURNING * INTO v_row;
    RETURN v_row;
END; $func$;

GRANT EXECUTE ON FUNCTION public.insert_video_embedding(
    uuid, text, text, numeric, int, uuid, int, numeric, vector, jsonb
) TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
`;
await c.query(sql);
console.log('OK insert_video_embedding re-created with vector type');
const r = await c.query("SELECT proname, pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'insert_video_embedding'");
console.log('updated signature:', r.rows);
await c.end();
