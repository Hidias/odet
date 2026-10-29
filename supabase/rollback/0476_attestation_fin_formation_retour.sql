-- Retour arrière de 0476 (attestation de fin de formation)
-- Refuse de tourner si des attestations de fin de formation ont déjà été émises : elles ne s'effacent pas
-- (documents remis), le retour arrière se décide alors avec H.
do $$
begin
  if exists (select 1 from public.training_documents_issued where kind = 'fin_formation') then
    raise exception 'Retour arrière 0476 refusé : des attestations de fin de formation sont déjà émises';
  end if;
end $$;

drop function if exists public.stg_documents_emis();

create or replace function public.client_portal_documents_emis(p_token text, p_code text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with vis as (
    select (s->>'id')::uuid as sid, (st->>'trainee_id')::uuid as tid
    from jsonb_array_elements(coalesce(public.client_portal_data(p_token, p_code)->'sessions', '[]'::jsonb)) s,
         jsonb_array_elements(coalesce(s->'session_trainees', '[]'::jsonb)) st
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_id', d.session_id, 'trainee_id', d.trainee_id, 'kind', d.kind,
      'version', d.version, 'issued_on', d.issued_on, 'hours', d.hours, 'result', d.result, 'absences', d.absences)
    order by d.session_id, d.trainee_id, d.kind, d.version), '[]'::jsonb)
  from public.training_documents_issued d
  join vis on vis.sid = d.session_id and vis.tid = d.trainee_id
$$;
revoke all on function public.client_portal_documents_emis(text, text) from public;
grant execute on function public.client_portal_documents_emis(text, text) to anon, authenticated;

create or replace function public.ent_documents_emis()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  with vis as (
    select (s->>'id')::uuid as sid, (st->>'trainee_id')::uuid as tid
    from jsonb_array_elements(coalesce(public.ent_sessions()->'sessions', '[]'::jsonb)) s,
         jsonb_array_elements(coalesce(s->'session_trainees', '[]'::jsonb)) st
  )
  select coalesce(jsonb_agg(jsonb_build_object('session_id', d.session_id, 'trainee_id', d.trainee_id, 'kind', d.kind,
      'version', d.version, 'issued_on', d.issued_on, 'hours', d.hours, 'result', d.result, 'absences', d.absences)
    order by d.session_id, d.trainee_id, d.kind, d.version), '[]'::jsonb)
  from public.training_documents_issued d
  join vis on vis.sid = d.session_id and vis.tid = d.trainee_id
$$;
revoke all on function public.ent_documents_emis() from public, anon;
grant execute on function public.ent_documents_emis() to authenticated;

alter table public.training_documents_issued drop constraint if exists training_documents_issued_fin_check;
alter table public.training_documents_issued drop constraint if exists training_documents_issued_objectives_check;
alter table public.training_documents_issued drop column if exists objectives;
alter table public.training_documents_issued drop constraint if exists training_documents_issued_kind_check;
alter table public.training_documents_issued add constraint training_documents_issued_kind_check
  check (kind in ('certificat', 'attestation'));
comment on table public.training_documents_issued is 'Versions émises des certificats de réalisation et attestations de présence (une correction ajoute une version)';

delete from public.schema_migrations where version = '0476_attestation_fin_formation';
