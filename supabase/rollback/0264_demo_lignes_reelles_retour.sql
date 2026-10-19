-- Retour arrière de 0264_demo_lignes_reelles.sql : retire la lecture des lignes réelles rattachées au fictif.
-- Idempotent ; aucune donnée concernée.

drop function if exists public.demo_real_links();

delete from public.schema_migrations where version = '0264_demo_lignes_reelles';
