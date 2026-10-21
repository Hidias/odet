-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (ancien_0390) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0390_sans_ancien_outil.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0390_sans_ancien_outil_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0390_sans_ancien_outil.sql =====
-- 0390 : plus de lien vers l'ancien outil (Campus d'un autre organisme) dans les formations, décisions de H du 21/10.
-- 12 programmes et une signature de formateur pointent vers le stockage de cet outil : adresses vidées.
-- 18 fiches de documents de formation y pointent aussi (adresse obligatoire) : retirées, avec l'accord de H (21/10,
-- 6h23 : « oui retire les », documents à recréer plus tard). L'écran les écartait déjà (fichierDeLInstance).
-- Rien n'est perdu : chaque valeur vidée et chaque fiche retirée est gardée entière dans app.retrait_ancien_outil,
-- que le retour arrière relit. Idempotent.

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

-- Fiches de documents de formation hébergées sur l'ancien outil (personne ne les a ouvertes : aucune trace de
-- téléchargement ni d'accès rattachée)
insert into app.retrait_ancien_outil (company_id, table_name, row_id, donnees)
select d.company_id, 'course_documents', d.id, to_jsonb(d)
from public.course_documents d
where d.file_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%'
on conflict (table_name, row_id) do nothing;
delete from public.course_documents d
where d.file_url like 'https://ibvtdiiwlpocibjvlgxr.supabase.co/%'
  and exists (select 1 from app.retrait_ancien_outil r where r.table_name = 'course_documents' and r.row_id = d.id);

insert into public.schema_migrations (version) values ('0390_sans_ancien_outil') on conflict (version) do nothing;
