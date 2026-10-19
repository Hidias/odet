-- 0052_marquage_demo.sql : afficher « Test » sur les fiches de démonstration (demande de H, 19/10, 16h29 :
-- « mettre en évidence les trucs en Test et les réels, pour éviter les bêtises »).
--
-- demo_records (0024) liste les fiches de démonstration, mais seul le super administrateur peut la lire. Cette
-- fonction rend à tout compte connecté la liste (table, identifiant) des fiches de démonstration de quelques tables
-- métier, et rien d'autre : ni nom ni contenu. Les droits de lecture des fiches elles-mêmes ne changent pas : l'écran
-- ne marque que ce que le compte voit déjà.
-- Aucune table nouvelle. Migration additive. Idempotente.
-- Retour arrière : supabase/rollback/0052_marquage_demo_retour.sql

create or replace function public.demo_marques()
returns table (tbl text, id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select d.tbl, d.id
    from public.demo_records d
   where d.tbl in ('clients', 'sessions', 'quotes', 'invoices', 'trainees', 'trainers', 'prospect_rdv')
$$;

revoke all on function public.demo_marques() from public, anon;
grant execute on function public.demo_marques() to authenticated;

comment on function public.demo_marques() is
  'Fiches de démonstration (table, identifiant) des tables métier, pour le badge « Test » des écrans (0052).';

insert into public.schema_migrations (version) values ('0052_marquage_demo') on conflict (version) do nothing;
