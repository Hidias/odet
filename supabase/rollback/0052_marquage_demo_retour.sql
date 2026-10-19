-- Retour arrière de 0052_marquage_demo.sql. Idempotent. Aucune donnée perdue (fonction de lecture seule).

drop function if exists public.demo_marques();

delete from public.schema_migrations where version = '0052_marquage_demo';
