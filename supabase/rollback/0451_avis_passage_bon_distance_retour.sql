-- Retour arrière de 0451_avis_passage_bon_distance.sql. Idempotent. Refusé s'il existe des avis de passage, des
-- documents « avis de passage » ou des bons signés à distance (leur trace serait perdue).
do $do$
begin
  if (to_regclass('public.itv_visit_notices') is not null and exists (select 1 from public.itv_visit_notices))
     or exists (select 1 from public.client_shared_documents where kind = 'avis_passage')
     or exists (select 1 from information_schema.columns where table_name = 'itv_visits' and column_name = 'remote_signed_at')
        and exists (select 1 from public.itv_visits where remote_signed_at is not null) then
    raise exception 'Avis de passage ou bons signés à distance enregistrés : retour arrière refusé';
  end if;
end
$do$;
do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
begin
  if position('0451' in v_def) = 0 then return; end if;
  execute replace(replace(replace(v_def, $b$  if d.kind not in ('devis', 'contrat', 'rapport') then raise exception 'Document non signable' using errcode = '22023'; end if;
  -- Bon d'intervention (0451) : seulement le rapport d'une visite terminée, envoyée à signer, pas encore signée
  if d.kind = 'rapport' and not (d.object_type = 'itv_visit' and exists (select 1 from public.itv_visits v where v.id = d.object_id
       and v.status = 'terminee' and v.client_signature is null and v.remote_signature_requested_at is not null and v.remote_signed_at is null)) then
    raise exception 'Ce rapport n''est pas à signer' using errcode = '22023';
  end if;$b$, $a$  if d.kind not in ('devis', 'contrat') then raise exception 'Document non signable' using errcode = '22023'; end if;$a$), $b$  elsif d.kind = 'rapport' and d.object_type = 'itv_visit' then
    -- Bon d'intervention signé à distance (0451) : trace sur la visite, écrite par la base seule
    perform set_config('app.itv_signature', d.object_id::text, true);
    update public.itv_visits set remote_signed_at = now(), remote_signature_id = v_id where id = d.object_id;
    perform set_config('app.itv_signature', '', true);
    v_lien := '/interventions/visite/' || d.object_id;
  else
    v_lien := '/clients/' || p_client;
  end if;$b$, $a$  else
    v_lien := '/clients/' || p_client;
  end if;$a$), $b$case when d.kind = 'devis' then 'devis_signe' when d.kind = 'rapport' then 'bon_intervention_signe' else 'contrat_signe' end,
    case when d.kind = 'devis' then 'Devis signé en ligne' when d.kind = 'rapport' then 'Bon d''intervention signé à distance' else 'Contrat signé en ligne' end,$b$, $a$case when d.kind = 'devis' then 'devis_signe' else 'contrat_signe' end,
    case when d.kind = 'devis' then 'Devis signé en ligne' else 'Contrat signé en ligne' end,$a$);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
drop function if exists public.ent_a_signer();
drop function if exists public.client_portal_a_signer(text, text);
drop function if exists app.rapports_a_signer(uuid);
drop trigger if exists itv_visits_signature_distance on public.itv_visits;
drop function if exists app.itv_signature_distance_garde();
alter table public.itv_visits drop column if exists remote_signature_id;
alter table public.itv_visits drop column if exists remote_signed_at;
alter table public.itv_visits drop column if exists remote_signature_requested_at;
drop table if exists public.itv_visit_notices;
drop function if exists app.itv_avis_garde();
alter table public.client_shared_documents drop constraint if exists client_shared_documents_kind_check;
alter table public.client_shared_documents add constraint client_shared_documents_kind_check
  check (kind in ('rapport', 'facture', 'devis', 'contrat', 'convention', 'attestation', 'autre'));
delete from public.schema_migrations where version = '0451_avis_passage_bon_distance';
