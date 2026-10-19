-- Retour arrière de 0045_sous_traitance.sql : retire prestataires, justificatifs, bons de commande et la relance des
-- justificatifs (la génération des relances revient à sa version de 0043). Idempotent.
-- Refusé si des prestataires, justificatifs ou bons de commande ont été saisis.

do $$
begin
  if to_regclass('public.subcontractors') is not null then
    if exists (select 1 from public.subcontractors) or exists (select 1 from public.subcontractor_documents)
       or exists (select 1 from public.subcontract_orders) then
      raise exception 'Retour arrière refusé : des prestataires, justificatifs ou bons de commande ont été saisis';
    end if;
  end if;
end $$;

delete from public.scheduled_actions where kind = 'justificatif_prestataire' and status = 'a_valider';

drop policy if exists prestataires_lire on storage.objects;
drop policy if exists prestataires_creer on storage.objects;
drop policy if exists prestataires_supprimer on storage.objects;
do $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'prestataires') then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'prestataires';
  end if;
exception when others then
  raise notice 'Bucket « prestataires » laissé en place (%), à retirer depuis le tableau de bord', sqlerrm;
end $$;

drop trigger if exists companies_referentiels_depart on public.companies;
drop function if exists app.societe_referentiels_depart();
drop view if exists public.v_subcontractor_compliance;
alter table public.trainers drop column if exists subcontractor_id;
drop table if exists public.subcontract_orders;
drop table if exists public.subcontractor_documents;
drop table if exists public.subcontractor_doc_types;
drop table if exists public.subcontractors;
drop function if exists app.sous_traitance_maj();
drop function if exists app.subcontractor_doc_types_depart(uuid);

-- Génération des relances : version de 0043 (recyclages seulement)
create or replace function public.scheduled_actions_generate()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
begin
  if coalesce((select auth.role()), '') not in ('service_role', '') and not app.a_le_droit('plateforme.administrer') then
    raise exception 'Réservé à la tâche de nuit' using errcode = '42501';
  end if;

  with echeances as (
    select d.company_id, d.client_id, d.rule_id, d.rule_label, d.due_on, d.objet_label, d.status
    from public.v_obligation_deadlines d
    where d.kind = 'formation' and d.status in ('a_prevoir', 'depasse') and d.client_id is not null and d.rule_id is not null
  ), par_client as (
    select e.company_id, e.client_id, e.rule_id, min(e.rule_label) as rule_label, min(e.due_on) as premiere,
           count(*) as nb, bool_or(e.status = 'depasse') as depasse,
           jsonb_agg(jsonb_build_object('nom', e.objet_label, 'echeance', e.due_on) order by e.due_on) as personnes
    from echeances e
    group by e.company_id, e.client_id, e.rule_id
  ), avec_client as (
    select p.*, c.name as client_name,
           coalesce(nullif(btrim(c.contact_email), ''), nullif(btrim(c.email), ''),
                    (select nullif(btrim(cc.email), '') from public.client_contacts cc
                      where cc.client_id = c.id and cc.email is not null order by cc.is_primary desc nulls last limit 1)) as email
    from par_client p
    join public.clients c on c.id = p.client_id
    where coalesce(c.status, 'actif') not in ('archive', 'archived', 'inactif')
      and not coalesce((to_jsonb(c) ->> 'do_not_mail')::boolean, false)
  )
  insert into public.scheduled_actions (company_id, kind, target_table, target_id, client_id, rule_id, due_on, title, payload, dedup_key)
  select a.company_id, 'relance_recyclage', 'clients', a.client_id, a.client_id, a.rule_id, a.premiere,
         a.rule_label || ' : ' || a.nb || ' salarié' || case when a.nb > 1 then 's' else '' end || ' à recycler chez ' || a.client_name,
         jsonb_build_object(
           'destinataire', a.email,
           'objet', 'Recyclage ' || a.rule_label || ' à prévoir',
           'texte', 'Bonjour,' || E'\n\n'
             || case when a.depasse then 'La validité de la formation « ' || a.rule_label || ' » est dépassée ou arrive à échéance pour une partie de votre personnel :'
                     else 'La validité de la formation « ' || a.rule_label || ' » arrive à échéance pour une partie de votre personnel :' end
             || E'\n' || (select string_agg('- ' || coalesce(x ->> 'nom', 'salarié') || ' : ' || to_char((x ->> 'echeance')::date, 'DD/MM/YYYY'), E'\n')
                          from jsonb_array_elements(a.personnes) x)
             || E'\n\n' || 'Nous pouvons organiser le recyclage dans vos locaux ou dans les nôtres. Souhaitez-vous que nous vous proposions des dates ?'
             || E'\n\n' || 'Bien cordialement,',
           'personnes', a.personnes,
           'depasse', a.depasse),
         'recyclage:' || a.client_id || ':' || a.rule_id || ':' || to_char(a.premiere, 'YYYY-MM')
  from avec_client a
  on conflict (company_id, dedup_key) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('relance_recyclage', v_n);
end
$$;
revoke all on function public.scheduled_actions_generate() from public, anon;
grant execute on function public.scheduled_actions_generate() to authenticated, service_role;

delete from public.schema_migrations where version = '0045_sous_traitance';
