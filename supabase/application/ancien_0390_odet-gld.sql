-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (ancien_0390) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0390_sans_ancien_outil.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0390_sans_ancien_outil_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0390_sans_ancien_outil.sql =====
-- 0390 : plus d'adresse vers l'ancien outil (Campus d'un autre organisme) dans les formations, demande de H du 21/10.
-- 12 programmes de formation et une signature de formateur pointent encore vers le stockage de cet outil. L'écran les
-- écartait déjà (fichierDeLInstance) ; ici les adresses sont vidées. Rien n'est supprimé : chaque valeur vidée est
-- gardée dans app.retrait_ancien_outil, que le retour arrière relit. Idempotent.
-- Les 18 fiches de documents de formation qui pointent vers cet outil restent (adresse obligatoire) : décision à part.

create table if not exists app.retrait_ancien_outil (
  id bigserial primary key,
  company_id uuid,
  table_name text not null,
  row_id uuid not null,
  donnees jsonb not null,
  retire_le timestamptz not null default now(),
  unique (table_name, row_id)
);
revoke all on app.retrait_ancien_outil from public;
revoke all on sequence app.retrait_ancien_outil_id_seq from public;

insert into app.retrait_ancien_outil (company_id, table_name, row_id, donnees)
select c.company_id, 'courses', c.id, jsonb_build_object('program_url', c.program_url)
from public.courses c
where c.program_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%'
on conflict (table_name, row_id) do nothing;
update public.courses set program_url = null where program_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%';

insert into app.retrait_ancien_outil (company_id, table_name, row_id, donnees)
select t.company_id, 'trainers', t.id, jsonb_build_object('signature_url', t.signature_url)
from public.trainers t
where t.signature_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%'
on conflict (table_name, row_id) do nothing;
update public.trainers set signature_url = null where signature_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%';

insert into public.schema_migrations (version) values ('0390_sans_ancien_outil') on conflict (version) do nothing;
