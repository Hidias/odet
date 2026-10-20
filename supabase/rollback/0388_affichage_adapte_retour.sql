-- Retour arrière de 0388_affichage_adapte.sql. Les réglages déjà enregistrés restent dans les préférences. Idempotent.

drop function if exists public.affichage_adapte_lire(uuid);
drop function if exists public.affichage_adapte_regler(uuid, jsonb);

delete from public.schema_migrations where version = '0388_affichage_adapte';
