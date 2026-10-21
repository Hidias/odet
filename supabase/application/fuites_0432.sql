-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (fuites_0432) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0432_fuites_documents.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0432_fuites_documents_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0432_fuites_documents.sql =====
-- 0432 : deux fuites corrigées (relevées le 22/10 à 0 h 20, correction validée par H).
--  - Le technicien ne lit plus que les rapports d'intervention de ses clients dans les documents de l'espace client :
--    devis, factures et contrats lui restent cachés (prix masqués au technicien).
--  - Un compte entreprise limité à certains sites ne voit plus les documents des autres sites (visites, contrats,
--    sessions et groupes rattachés à un site) ; les documents sans site (fiche client, devis, factures) restent visibles.
-- Règle redéfinie et fonction redéfinie à partir de la version en production. Idempotente.
-- Retour arrière : supabase/rollback/0432_fuites_documents_retour.sql

create or replace function public.ent_mes_documents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
  v_sites uuid[] := app.ent_sites(v);
begin
  -- Factures seulement si le compte y a droit ; compte limité à des sites : documents de ces sites ou sans site
  return coalesce((select jsonb_agg(e) from jsonb_array_elements(app.portail_documents_client(v.client_id)) e
                   where (v.can_see_invoices or e->>'kind' <> 'facture')
                     and (v_sites is null or case e->>'object_type'
                       when 'itv_visit' then coalesce((select x.site_id = any (v_sites) from public.itv_visits x where x.id = (e->>'object_id')::uuid and x.site_id is not null), true)
                       when 'itv_contract' then coalesce((select x.site_ids && v_sites from public.itv_contracts x where x.id = (e->>'object_id')::uuid and coalesce(cardinality(x.site_ids), 0) > 0), true)
                       when 'session' then coalesce((select x.site_id = any (v_sites) from public.sessions x where x.id = (e->>'object_id')::uuid and x.site_id is not null), true)
                       when 'session_group' then coalesce((select x.site_id = any (v_sites) from public.session_groups x where x.id = (e->>'object_id')::uuid and x.site_id is not null), true)
                       else true end)), '[]'::jsonb);
end
$$;


-- Pose des règles d'une liste de tables : une règle par action, garde du module ajoutée ici.
-- Lecture : module actif, ou super administrateur. Écriture : module actif.
create or replace function pg_temp.regles(p_tables text[], p_module text, p_sel text, p_ins text, p_upd text, p_del text)
returns void
language plpgsql
as $f$
declare
  t text;
  v_on text;
  v_sel text := p_sel; v_ins text := p_ins; v_upd text := p_upd; v_del text := p_del;
begin
  if p_module is not null then
    select '(' || string_agg(format('(select app.module_on(%L))', m), ' or ') || ')' into v_on
    from unnest(string_to_array(p_module, '|')) m;
    if v_sel is not null then v_sel := format('((%s and %s) or (select app.is_superadmin()))', v_on, v_sel); end if;
    if v_ins is not null then v_ins := format('(%s and %s)', v_on, v_ins); end if;
    if v_upd is not null then v_upd := format('(%s and %s)', v_on, v_upd); end if;
    if v_del is not null then v_del := format('(%s and %s)', v_on, v_del); end if;
  end if;
  foreach t in array p_tables loop
    execute format('alter table public.%I enable row level security', t);
    if v_sel is not null then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_lire', t, v_sel);
    end if;
    if v_ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_creer', t, v_ins);
    end if;
    if v_upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_modifier', t, v_upd, v_upd);
    end if;
    if v_del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_supprimer', t, v_del);
    end if;
  end loop;
end
$f$;

-- Suppression des règles nommées du générateur (lire, créer, modifier, supprimer) ; les autres règles
-- (règle restrictive des notifications de 0070, etc.) ne sont pas touchées
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename = any (array['client_shared_documents'])
             and policyname in (tablename || '_lire', tablename || '_creer', tablename || '_modifier', tablename || '_supprimer') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;


-- client_shared_documents
select pg_temp.regles(array['client_shared_documents'], null,
  $r$(company_id in (select app.societes_avec_droit('clients.fiches.voir')) or (company_id in (select app.societes_avec_droit('interventions.missions.voir')) and client_id in (select app.tech_client_ids()) and kind = 'rapport'))$r$,
  null,
  $r$company_id in (select app.societes_avec_droit('clients.fiches.modifier'))$r$,
  null);


insert into public.schema_migrations (version) values ('0432_fuites_documents') on conflict (version) do nothing;
