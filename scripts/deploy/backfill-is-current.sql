ALTER TABLE mp_preset_registry.versions ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;

UPDATE mp_preset_registry.versions v
SET is_current = true
WHERE v.id = (
  SELECT id FROM mp_preset_registry.versions v2
  WHERE v2.preset_id = v.preset_id
  ORDER BY v2.created_at DESC LIMIT 1
);

UPDATE mp_preset_registry.versions v
SET is_current = true
WHERE v.is_current = false
  AND NOT EXISTS (
    SELECT 1 FROM mp_preset_registry.versions v2
    WHERE v2.preset_id = v.preset_id AND v2.is_current = true
  );

UPDATE mp_preset_registry.presets p
SET current_version = v.version
FROM mp_preset_registry.versions v
WHERE v.preset_id = p.id AND v.is_current = true AND p.current_version IS NULL;

NOTIFY pgrst, 'reload config';
