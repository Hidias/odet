-- Retour arrière de 0444_devis_mentions.sql. Idempotent. Les mentions saisies sur les devis sont perdues.
do $do$
declare
  v_def text := pg_get_functiondef('app.portail_signer_document(uuid,text,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  v_debut int := position('  -- Conditions générales jointes au devis (0444)' in v_def);
  v_fin int;
begin
  if v_debut = 0 then return; end if;
  v_fin := position('  if d.kind = ''devis'' and exists (select 1 from public.quotes q where q.id = d.object_id and q.status in (''refused'', ''expired'')) then' in v_def);
  execute substr(v_def, 1, v_debut - 1) || substr(v_def, v_fin);
end
$do$;
revoke all on function app.portail_signer_document(uuid, text, uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
drop trigger if exists quotes_conditions_figees on public.quotes;
drop function if exists app.devis_conditions_figees();
alter table public.billing_settings drop constraint if exists billing_settings_mentions_devis_check;
alter table public.billing_settings drop column if exists mentions_devis;
alter table public.quote_items drop constraint if exists quote_items_eco_ht_check;
alter table public.quote_items drop column if exists eco_ht;
alter table public.quotes drop constraint if exists quotes_mentions_0444_check;
alter table public.quotes drop column if exists conditions_acceptees;
alter table public.quotes drop column if exists conditions_jointes;
alter table public.quotes drop column if exists dechets;
alter table public.quotes drop column if exists acompte_pct;
alter table public.quotes drop column if exists delai_execution;
alter table public.quotes drop column if exists hors_etablissement;
alter table public.quotes drop column if exists a_distance_infos;
alter table public.quotes drop column if exists a_distance_le;
alter table public.quotes drop column if exists a_distance;
delete from public.schema_migrations where version = '0444_devis_mentions';
