CREATE OR REPLACE FUNCTION public.insert_image_embedding(
  p_tenant_id uuid, p_image_url text, p_image_hash text,
  p_embedding text, p_metadata jsonb
) RETURNS public.image_embeddings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp, mp_preset_registry
AS $func$ DECLARE v_row public.image_embeddings;
BEGIN
  INSERT INTO public.image_embeddings (tenant_id, image_url, image_hash, embedding, metadata)
  VALUES (p_tenant_id, p_image_url, p_image_hash, p_embedding::vector, p_metadata)
  ON CONFLICT (tenant_id, image_hash) DO UPDATE SET embedding = EXCLUDED.embedding, metadata = EXCLUDED.metadata
  RETURNING * INTO v_row;
  RETURN v_row;
END; $func$;
GRANT EXECUTE ON FUNCTION public.insert_image_embedding TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
