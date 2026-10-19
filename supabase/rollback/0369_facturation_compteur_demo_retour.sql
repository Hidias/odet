-- Retour arrière de 0369_facturation_compteur_demo.sql : retire la remise à zéro du compteur. Idempotent.

drop function if exists public.billing_counter_reset();

delete from public.schema_migrations where version = '0369_facturation_compteur_demo';
