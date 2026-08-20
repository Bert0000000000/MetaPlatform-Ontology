CREATE OR REPLACE FUNCTION public.insert_image_embedding(
  p_tenant_id uuid,
  p_image_url text,
  p_image_hash text,
  p_embedding vector(512),
  p_metadata jsonb
) RETURNS public.image_embeddings LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp, mp_preset_registry
AS $func$ BEGIN
  RETURN QUERY
  INSERT INTO public.image_embeddings (tenant_id, image_url, image_hash, embedding, metadata)
  VALUES (p_tenant_id, p_image_url, p_image_hash, p_embedding, p_metadata)
  ON CONFLICT (tenant_id, image_hash) DO UPDATE SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata
  RETURNING *;
END; $func$;
GRANT EXECUTE ON FUNCTION public.insert_image_embedding TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload config';
