-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c2_0276) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0276_societes_fonctions.sql, retour arrière,
-- comparaison. Se termine TOUJOURS par l'erreur volontaire « RÉSULTAT DE L'ESSAI DU RETOUR ARRIÈRE » : tout est annulé.
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

create temp view etat_essai as
  select 'règle' as kind, schemaname || '.' || tablename || '.' || policyname as name,
         md5(concat_ws('|', permissive, roles::text, cmd, qual, with_check)) as v
  from pg_policies where schemaname in ('public', 'storage')
  union all
  select 'fonction', p.oid::regprocedure::text,
         md5(concat_ws('|', pg_get_functiondef(p.oid), p.prosecdef::text, p.proconfig::text,
             (select string_agg(a.grantee::regrole::text || ':' || a.privilege_type, ',' order by a.grantee::regrole::text, a.privilege_type)
              from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)))
  from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.prokind in ('f', 'p')
  union all
  select 'droits table', c.oid::regclass::text,
         md5(coalesce((select string_agg(a.grantee::regrole::text || ':' || a.privilege_type || ':' || a.is_grantable::text, ','
                               order by a.grantee::regrole::text, a.privilege_type)
                       from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a), '') || c.relrowsecurity::text)
  from pg_class c where c.relnamespace in ('public'::regnamespace, 'app'::regnamespace) and c.relkind in ('r', 'v', 'm', 'p')
  union all
  select 'vue', c.oid::regclass::text, md5(pg_get_viewdef(c.oid) || coalesce(c.reloptions::text, ''))
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  union all
  select 'colonne', table_schema || '.' || table_name || '.' || column_name, md5(data_type || is_nullable || coalesce(column_default, ''))
  from information_schema.columns where table_schema in ('public', 'app')
  union all
  select 'contrainte', conrelid::regclass::text || '.' || conname, md5(pg_get_constraintdef(oid))
  from pg_constraint where connamespace in ('public'::regnamespace, 'app'::regnamespace)
  union all
  select 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  from pg_index where indrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'déclencheur', tgrelid::regclass::text || '.' || tgname, md5(tgfoid::regprocedure::text || tgenabled::text)
  from pg_trigger where not tgisinternal
    and tgrelid in (select oid from pg_class where relnamespace in ('public'::regnamespace, 'app'::regnamespace))
  union all
  select 'migrations', 'public.schema_migrations', md5(coalesce(string_agg(version, ',' order by version), ''))
  from public.schema_migrations
  union all
  select 'données', 'organization_settings', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.organization_settings t
  union all
  select 'données', 'profiles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.profiles t
  union all
  select 'données', 'org_modules', md5(coalesce(string_agg(t::text, ',' order by t.key), '')) from public.org_modules t
  union all
  select 'données', 'company_members', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_members t
  union all
  select 'données', 'company_member_roles', md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.company_member_roles t;
create temp table etat_essai_avant as select * from etat_essai;

-- ===== supabase/migrations/0276_societes_fonctions.sql =====
-- 0276_societes_fonctions.sql : fonctions « security definer » rattachées aux sociétés (chantier C2).
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2_fonctions.py à partir des définitions de production. Ne pas modifier.
--
-- Ces fonctions contournent les règles d'accès : elles vérifient désormais la société de l'objet traité (session,
-- visite, stagiaire, facture, devis, client) et ne comptent ou ne listent que les sociétés du compte.
--   app.societe_permise(société, écriture) : société lisible (ou société courante en écriture) ; vrai pour les tâches
--     du serveur (clé de service, tâches planifiées) ;
--   app.exiger_societe(table, id, écriture) : refus si l'objet appartient à une autre société ;
--   app.can_read_session, app.can_edit_session, app.itv_can_edit_visit_parts : condition de société ajoutée (elles
--     gardent les fonctions des feuilles d'émargement, des tests, des pièces de visite et le stockage) ;
--   alertes de complétude rattachées à la société de l'élément concerné.
-- Avec une seule société, rien ne change. Idempotente. Retour arrière : supabase/rollback/0276_societes_fonctions_retour.sql

create or replace function app.societe_permise(p_company uuid, p_ecriture boolean default false)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((select auth.jwt()) ->> 'role', '') in ('', 'service_role') then true
    when p_company is null then false
    when p_ecriture then p_company in (select app.societes_ecriture())
    else p_company in (select app.societes_lisibles())
  end
$$;

create or replace function app.exiger_societe(p_table text, p_id uuid, p_ecriture boolean default false)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_companies uuid[];
  v_partage boolean := exists (select 1 from information_schema.columns
                               where table_schema = 'public' and table_name = p_table and column_name = 'company_ids');
begin
  if p_id is null or coalesce((select auth.jwt()) ->> 'role', '') in ('', 'service_role') then
    return;
  end if;
  if v_partage then
    execute format('select company_id, company_ids from public.%I where id = $1', p_table) into v_company, v_companies using p_id;
    if v_company is null then return; end if;
    if not (v_companies && (case when p_ecriture then array(select app.societes_ecriture()) else array(select app.societes_lisibles()) end)) then
      raise exception 'Accès refusé : cet élément appartient à une autre société' using errcode = '42501';
    end if;
  else
    execute format('select company_id from public.%I where id = $1', p_table) into v_company using p_id;
    if v_company is null then return; end if;
    if not app.societe_permise(v_company, p_ecriture) then
      raise exception 'Accès refusé : cet élément appartient à une autre société' using errcode = '42501';
    end if;
  end if;
end
$$;

revoke all on function app.societe_permise(uuid, boolean), app.exiger_societe(text, uuid, boolean) from public, anon;
grant execute on function app.societe_permise(uuid, boolean), app.exiger_societe(text, uuid, boolean) to authenticated, service_role;

-- Alertes de complétude : société de l'élément concerné (stagiaire, session, non-conformité), pas celle du compte
-- qui a lancé le calcul
create or replace function app.completude_societe()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity_id is not null then
    new.company_id := coalesce(
      (select t.company_id from public.trainees t where t.id = new.entity_id),
      (select s.company_id from public.sessions s where s.id = new.entity_id),
      (select n.company_id from public.non_conformites n where n.id = new.entity_id),
      new.company_id);
  end if;
  return new;
end
$$;
revoke all on function app.completude_societe() from public, anon, authenticated;
do $$
begin
  if to_regclass('public.completude_alerts') is not null
     and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'completude_alerts' and column_name = 'entity_id') then
    drop trigger if exists completude_alerts_societe on public.completude_alerts;
    create trigger completude_alerts_societe before insert on public.completude_alerts
      for each row execute function app.completude_societe();
  end if;
end
$$;


-- app.can_read_session(uuid)
CREATE OR REPLACE FUNCTION app.can_read_session(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    app.a_le_droit('formation.suivi.voir')
    or (app.a_le_droit('formation.sessions.voir_siennes') and p_session_id in (select app.trainer_session_ids())),
  false)
  and app.societe_permise((select s.company_id from public.sessions s where s.id = p_session_id))
$function$;


-- app.can_edit_session(uuid)
CREATE OR REPLACE FUNCTION app.can_edit_session(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    app.a_le_droit('formation.suivi.gerer')
    or (app.a_le_droit('formation.sessions.modifier_siennes') and p_session_id in (select app.trainer_session_ids())),
  false)
  and app.societe_permise((select s.company_id from public.sessions s where s.id = p_session_id), true)
$function$;


-- app.itv_can_edit_visit_parts(uuid)
CREATE OR REPLACE FUNCTION app.itv_can_edit_visit_parts(p_visit uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select app.module_on('interventions'))
    and ((select app.a_le_droit('interventions.visites.gerer'))
         or ((select app.a_le_droit('interventions.missions.realiser'))
             and p_visit in (select app.tech_visit_ids()))), false)
    and app.societe_permise((select v.company_id from public.itv_visits v where v.id = p_visit), true)
$function$;


-- public.billing_compute_totals(uuid)
CREATE OR REPLACE FUNCTION public.billing_compute_totals(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with inv as (
    select i.id, coalesce(i.discount_percent, 0) as dp, coalesce(i.tva_applicable, true) as vat
    from public.invoices i where i.id = p_invoice and app.a_le_droit('facturation.factures.voir') and app.societe_permise(i.company_id)
  ), lignes as (
    select case when inv.vat then coalesce(it.tva_rate, 20) else 0 end as rate,
           round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2) as net
    from public.invoice_items it join inv on inv.id = it.invoice_id
  ), groupes as (
    select l.rate, round(sum(l.net), 2) as lines from lignes l group by l.rate
  ), calc as (
    select g.rate, g.lines,
           case when inv.dp > 0 then round(g.lines * inv.dp / 100, 2) else 0 end as allowance
    from groupes g, inv
  ), fin as (
    select c.rate, c.lines, c.allowance, round(c.lines - c.allowance, 2) as base,
           case when c.rate > 0 then round(round(c.lines - c.allowance, 2) * c.rate / 100, 2) else 0 end as tax
    from calc c
  )
  select jsonb_build_object(
    'total_ht', coalesce((select round(sum(net), 2) from lignes), 0),
    'total_discount', coalesce((select round(sum(allowance), 2) from fin), 0),
    'total_net_ht', coalesce((select round(sum(base), 2) from fin), 0),
    'total_tva', coalesce((select round(sum(tax), 2) from fin), 0),
    'total_ttc', coalesce((select round(sum(base), 2) + round(sum(tax), 2) from fin), 0),
    'par_taux', coalesce((select jsonb_agg(jsonb_build_object('taux', rate, 'base', base, 'tva', tax) order by rate) from fin), '[]'::jsonb))
$function$;


-- public.disability_count(uuid[])
CREATE OR REPLACE FUNCTION public.disability_count(p_trainee_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.is_staff() then
    (select count(*) from public.trainee_disability d
     where d.has_disability and d.company_id in (select app.societes_lisibles()) and (p_trainee_ids is null or d.trainee_id = any (p_trainee_ids)))
  else 0 end
$function$;


-- public.psh_request_count()
CREATE OR REPLACE FUNCTION public.psh_request_count()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select case when app.is_staff() then (select count(*) from public.psh_requests where company_id in (select app.societes_lisibles())) else 0 end $function$;


-- public.get_purge_stats()
CREATE OR REPLACE FUNCTION public.get_purge_stats()
 RETURNS TABLE(total_trainees bigint, trainees_to_purge bigint, oldest_trainee_years numeric, purge_threshold_years integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  /* garde chantier 2 */ perform app.require_right('formation.stagiaires.archives');

  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM trainees WHERE company_id in (select app.societes_lisibles()))::BIGINT as total_trainees,
    (SELECT COUNT(*) FROM trainees_to_purge tp WHERE tp.id in (select t.id from trainees t where t.company_id in (select app.societes_lisibles())))::BIGINT as trainees_to_purge,
    COALESCE((SELECT MAX(tp.years_since_activity) FROM trainees_to_purge tp WHERE tp.id in (select t.id from trainees t where t.company_id in (select app.societes_lisibles()))), 0)::NUMERIC as oldest_trainee_years,
    5::INTEGER as purge_threshold_years;
END;
$function$;


-- public.get_audit_logs(text,uuid,text,text,timestamp with time zone,timestamp with time zone,integer)
CREATE OR REPLACE FUNCTION public.get_audit_logs(p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_user_email text DEFAULT NULL::text, p_from_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, log_timestamp timestamp with time zone, user_email text, action text, entity_type text, entity_id uuid, entity_name text, details jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  /* garde chantier 2 */ perform app.require_right('conformite.journal.voir');

  RETURN QUERY
  SELECT 
    al.id,
    al.timestamp as log_timestamp,
    al.user_email,
    al.action::text,
    al.entity_type::text,
    al.entity_id,
    al.entity_name,
    al.details
  FROM audit_logs al
  WHERE al.company_id in (select app.societes_lisibles())
    AND (p_entity_type IS NULL OR al.entity_type = p_entity_type)
    AND (p_entity_id IS NULL OR al.entity_id = p_entity_id)
    AND (p_action IS NULL OR al.action = p_action)
    AND (p_user_email IS NULL OR al.user_email ILIKE '%' || p_user_email || '%')
    AND (p_from_date IS NULL OR al.timestamp >= p_from_date)
    AND (p_to_date IS NULL OR al.timestamp <= p_to_date)
  ORDER BY al.timestamp DESC
  LIMIT p_limit;
END;
$function$;


-- public.pp_nir_etat(uuid[])
CREATE OR REPLACE FUNCTION public.pp_nir_etat(p_trainee_ids uuid[])
 RETURNS TABLE(trainee_id uuid, present boolean, fin text, source text, saisi_le timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.pp_can_read() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
    select n.trainee_id, true, n.fin, n.source, n.saisi_le
    from public.pp_nir n where n.trainee_id = any(p_trainee_ids) and n.company_id in (select app.societes_lisibles());
end $function$;


-- public.pp_donnees(uuid[],uuid[])
CREATE OR REPLACE FUNCTION public.pp_donnees(p_session_ids uuid[] DEFAULT NULL::uuid[], p_inscription_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not public.pp_can_read() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(r order by r->>'end_date', r->>'reference', r->>'last_name'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'inscription_id', st.id,
      'session_id', s.id,
      'reference', s.reference,
      'start_date', s.start_date,
      'end_date', s.end_date,
      'is_remote', coalesce(s.is_remote, false),
      'course_id', c.id,
      'course_title', c.title,
      'course_code', c.code,
      'client_id', cl.id,
      'client_name', cl.name,
      'client_siret', cl.siret,
      'client_type', cl.client_type,
      'trainee_id', t.id,
      'first_name', t.first_name,
      'last_name', t.last_name,
      'gender', t.gender,
      'birth_date', t.birth_date,
      'nom_naissance', t.nom_naissance,
      'nom_naissance_confirme_le', t.nom_naissance_confirme_le,
      'refused_ssn', coalesce(t.refused_ssn, false),
      'absent', coalesce(st.absent, false),
      'early_departure', coalesce(st.early_departure, false),
      'result', st.result,
      'date_certification', (select sc.date_certification from public.sst_certifications sc
                             where sc.session_id = s.id and sc.trainee_id = t.id order by sc.created_at desc limit 1),
      'nir_present', (n.trainee_id is not null),
      'nir_fin', n.fin,
      'ligne', (select to_jsonb(l) from public.pp_lignes l where l.session_trainee_id = st.id order by l.created_at desc limit 1),
      'dernier_envoi', (select to_jsonb(e) from public.pp_envois e join public.pp_lignes l on l.id = e.ligne_id
                        where l.session_trainee_id = st.id order by e.tentative desc, e.created_at desc limit 1)
    ) as r
    from public.session_trainees st
    join public.sessions s on s.id = st.session_id
    join public.trainees t on t.id = st.trainee_id
    left join public.courses c on c.id = s.course_id
    left join public.clients cl on cl.id = s.client_id
    left join public.pp_nir n on n.trainee_id = t.id
    where s.end_date < current_date
      and s.company_id in (select app.societes_lisibles())
      and s.subcontract_client_ref is null
      and coalesce(s.session_type, '') not in ('subcontract', 'sous-traitance')
      and (p_session_ids is null or s.id = any(p_session_ids))
      and (p_inscription_ids is null or st.id = any(p_inscription_ids))
  ) x;
  return v;
end $function$;


-- public.itv_dashboard()
CREATE OR REPLACE FUNCTION public.itv_dashboard()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'late_equipment', (select count(*) from itv_equipment where company_id in (select app.societes_lisibles()) and status <> 'retire' and next_check_on < current_date),
    'late_sites', (select count(distinct site_id) from itv_equipment where company_id in (select app.societes_lisibles()) and status <> 'retire' and next_check_on < current_date),
    'due_month_sites', (select count(distinct site_id) from itv_equipment where company_id in (select app.societes_lisibles()) and status <> 'retire'
                         and next_check_on >= current_date and next_check_on < (date_trunc('month', current_date) + interval '1 month')::date),
    'to_quote', (select count(*) from itv_visit_items i join itv_visits v on v.id = i.visit_id
                 where v.company_id in (select app.societes_lisibles()) and i.result = 'a_remplacer' and v.status = 'terminee' and v.quote_id is null),
    'today_visits', (select count(*) from itv_visits where company_id in (select app.societes_lisibles()) and planned_on = current_date and status in ('planifiee', 'en_cours')),
    'unplanned_contract_visits', (select count(*) from itv_visits where company_id in (select app.societes_lisibles()) and status = 'a_planifier' and due_on < (current_date + 31))
  )
$function$;


-- public.itv_close_visit(uuid)
CREATE OR REPLACE FUNCTION public.itv_close_visit(p_visit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.itv_visits%rowtype; v_day date; n_ok int; n_ko int; n_rp int; n_other int;
begin
  /* société (C2) */ perform app.exiger_societe('itv_visits', p_visit, true);
  /* garde chantier 2 */ if app.role() = 'technicien' and p_visit not in (select app.tech_visit_ids()) then raise exception 'Accès refusé' using errcode = '42501'; end if;

  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select * into v from public.itv_visits where id = p_visit for update;
  if not found then raise exception 'Visite introuvable'; end if;
  v_day := coalesce((v.started_at at time zone 'Europe/Paris')::date, v.planned_on, current_date);

  update public.itv_equipment e set
    last_check_on = v_day,
    next_check_on = (v_day + make_interval(months => t.verification_months))::date,
    status = case when i.result = 'a_remplacer' then 'a_remplacer' else 'en_service' end,
    manufactured_year = case when i.result = 'remplace' then extract(year from v_day)::int else e.manufactured_year end,
    updated_at = now()
  from public.itv_visit_items i, public.itv_equipment_types t
  where i.visit_id = p_visit and i.equipment_id = e.id and t.id = e.type_id
    and i.result in ('conforme', 'remplace', 'a_remplacer');

  update public.itv_visits set status = 'terminee', finished_at = coalesce(finished_at, now()) where id = p_visit;

  select count(*) filter (where result = 'conforme'), count(*) filter (where result = 'a_remplacer'),
         count(*) filter (where result = 'remplace'), count(*) filter (where result in ('absent', 'inaccessible'))
    into n_ok, n_ko, n_rp, n_other
  from public.itv_visit_items where visit_id = p_visit;
  return jsonb_build_object('conforme', n_ok, 'a_remplacer', n_ko, 'remplace', n_rp, 'autre', n_other);
end $function$;


-- public.itv_generate_contract_visits(uuid,integer)
CREATE OR REPLACE FUNCTION public.itv_generate_contract_visits(p_contract uuid, p_year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.itv_contracts%rowtype; m int; s record; v_due date; n int := 0;
begin
  /* société (C2) */ perform app.exiger_societe('itv_contracts', p_contract, true);
  /* garde chantier 2 */ perform app.require_right('interventions.visites.gerer');

  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select * into c from public.itv_contracts where id = p_contract;
  if not found then raise exception 'Contrat introuvable'; end if;
  foreach m in array coalesce(c.visit_months, '{}') loop
    v_due := make_date(p_year, m, 1);
    if v_due < date_trunc('month', c.start_on)::date or (c.end_on is not null and v_due > c.end_on) then continue; end if;
    for s in select id from public.sites
             where client_id = c.client_id and is_active
               and (c.site_ids is null or cardinality(c.site_ids) = 0 or id = any(c.site_ids)) loop
      if not exists (select 1 from public.itv_visits where contract_id = c.id and site_id = s.id
                     and date_trunc('month', due_on) = date_trunc('month', v_due) and status <> 'annulee') then
        insert into public.itv_visits (client_id, site_id, contract_id, due_on, status)
        values (c.client_id, s.id, c.id, v_due, 'a_planifier');
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $function$;


-- public.client_contact_sync_primary(uuid)
CREATE OR REPLACE FUNCTION public.client_contact_sync_primary(p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  /* société (C2) */ perform app.exiger_societe('clients', p_client_id, true);
  /* garde chantier 2 */ perform app.require_right('clients.fiches.modifier');

  if not exists (select 1 from public.client_contacts where client_id = p_client_id and is_primary) then
    select id into v_id from public.client_contacts where client_id = p_client_id order by created_at limit 1;
    if v_id is null then
      update public.clients set contact_name = null, contact_function = null, contact_email = null, contact_phone = null where id = p_client_id;
    else
      update public.client_contacts set is_primary = true where id = v_id;
    end if;
  end if;
end $function$;


-- public.get_trainee_with_ssn(uuid)
CREATE OR REPLACE FUNCTION public.get_trainee_with_ssn(p_id uuid)
 RETURNS TABLE(id uuid, first_name text, last_name text, email text, phone text, social_security_number text, client_id uuid, notes text, birth_date date, refused_ssn boolean, has_disability boolean, disability_details text, disability_adaptations text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := app.role();
  v_handi boolean := app.can_see_disability();
begin
  /* société (C2) */ perform app.exiger_societe('trainees', p_id, false);
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
  select t.id, t.first_name::text, t.last_name::text, t.email::text, t.phone::text,
         (select repeat('•', greatest(length(s.ssn) - 3, 0)) || right(s.ssn, 3) from public.trainee_ssn s where s.trainee_id = t.id),
         t.client_id, t.notes, t.birth_date, t.refused_ssn,
         case when v_handi then coalesce(d.has_disability, false) end,
         case when v_handi then d.details end,
         case when v_handi then d.adaptations end,
         t.created_at, t.updated_at
  from public.trainees t
  left join public.trainee_disability d on d.trainee_id = t.id
  where t.id = p_id;
end
$function$;


-- public.purge_trainee(uuid,text)
CREATE OR REPLACE FUNCTION public.purge_trainee(p_trainee_id uuid, p_archived_by text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trainee RECORD;
  v_sessions_count INTEGER;
  v_reference TEXT;
BEGIN
  /* société (C2) */ perform app.exiger_societe('trainees', p_trainee_id, true);
  /* garde chantier 2 */ perform app.require_right('formation.stagiaires.archives');

  -- Récupérer le stagiaire
  SELECT * INTO v_trainee FROM trainees WHERE id = p_trainee_id;
  
  IF v_trainee IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Stagiaire non trouvé');
  END IF;
  
  -- Compter les sessions
  SELECT COUNT(*) INTO v_sessions_count
  FROM session_trainees WHERE trainee_id = p_trainee_id;
  
  -- Créer une référence anonymisée
  v_reference := 'ARCH-' || TO_CHAR(NOW(), 'YYYY') || '-' || SUBSTRING(p_trainee_id::TEXT, 1, 8);
  
  -- Archiver
  INSERT INTO trainees_archive (id, reference, last_session_date, sessions_count, archived_by)
  VALUES (p_trainee_id, v_reference, v_trainee.last_session_date, v_sessions_count, p_archived_by)
  ON CONFLICT (id) DO NOTHING;
  
  -- Supprimer les données associées
  DELETE FROM trainee_documents WHERE trainee_id = p_trainee_id;
  DELETE FROM evaluations WHERE trainee_id = p_trainee_id;
  DELETE FROM attendances WHERE trainee_id = p_trainee_id;
  DELETE FROM session_trainees WHERE trainee_id = p_trainee_id;
  DELETE FROM trainees WHERE id = p_trainee_id;
  
  -- Logger la purge
  PERFORM log_audit(
    NULL,
    p_archived_by,
    'delete',
    'trainee',
    p_trainee_id,
    v_reference,
    jsonb_build_object('type', 'RGPD_PURGE', 'original_name', v_trainee.first_name || ' ' || v_trainee.last_name)
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'sessions_count', v_sessions_count
  );
END;
$function$;


-- public.export_trainee_data(uuid)
CREATE OR REPLACE FUNCTION public.export_trainee_data(p_trainee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_trainee JSONB;
  v_sessions JSONB;
  v_attendances JSONB;
  v_evaluations JSONB;
  v_documents JSONB;
BEGIN
  /* société (C2) */ perform app.exiger_societe('trainees', p_trainee_id, false);
  /* garde chantier 2 */ perform app.require_right('formation.stagiaires.archives');

  -- Données personnelles du stagiaire
  SELECT jsonb_build_object(
    'id', t.id,
    'first_name', t.first_name,
    'last_name', t.last_name,
    'email', t.email,
    'phone', t.phone,
    'birth_date', t.birth_date,
    'social_security_number', COALESCE(decrypt_ssn(t.ssn_encrypted), t.social_security_number),
    'has_disability', t.has_disability,
    'disability_details', t.disability_details,
    'disability_adaptations', t.disability_adaptations,
    'notes', t.notes,
    'created_at', t.created_at,
    'client', (SELECT jsonb_build_object('id', c.id, 'name', c.name) FROM clients c WHERE c.id = t.client_id)
  )
  INTO v_trainee
  FROM trainees t
  WHERE t.id = p_trainee_id;
  
  IF v_trainee IS NULL THEN
    RETURN jsonb_build_object('error', 'Stagiaire non trouvé');
  END IF;
  
  -- Sessions suivies
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', s.id,
    'reference', s.reference,
    'course', co.name,
    'start_date', s.start_date,
    'end_date', s.end_date,
    'location', s.location,
    'status', s.status,
    'result', st.result,
    'registration_date', st.registration_date
  )), '[]'::jsonb)
  INTO v_sessions
  FROM session_trainees st
  JOIN sessions s ON s.id = st.session_id
  LEFT JOIN courses co ON co.id = s.course_id
  WHERE st.trainee_id = p_trainee_id;
  
  -- Émargements
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', a.session_id,
    'date', a.date,
    'am_present', a.am_present,
    'pm_present', a.pm_present,
    'signature_am', a.signature_am IS NOT NULL,
    'signature_pm', a.signature_pm IS NOT NULL
  )), '[]'::jsonb)
  INTO v_attendances
  FROM attendances a
  WHERE a.trainee_id = p_trainee_id;
  
  -- Évaluations
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', e.session_id,
    'type', e.type,
    'score', e.score,
    'created_at', e.created_at
  )), '[]'::jsonb)
  INTO v_evaluations
  FROM evaluations e
  WHERE e.trainee_id = p_trainee_id;
  
  -- Documents associés
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'name', d.name,
    'type', d.type,
    'uploaded_at', d.created_at
  )), '[]'::jsonb)
  INTO v_documents
  FROM trainee_documents d
  WHERE d.trainee_id = p_trainee_id;
  
  -- Assembler le résultat
  v_result := jsonb_build_object(
    'export_date', NOW(),
    'export_type', 'RGPD_DATA_EXPORT',
    'trainee', v_trainee,
    'sessions', v_sessions,
    'attendances', v_attendances,
    'evaluations', v_evaluations,
    'documents', v_documents
  );
  
  -- Logger l'export
  PERFORM log_audit(
    NULL,
    'system',
    'export',
    'trainee',
    p_trainee_id,
    v_trainee->>'first_name' || ' ' || v_trainee->>'last_name',
    jsonb_build_object('type', 'RGPD_DATA_EXPORT')
  );
  
  RETURN v_result;
END;
$function$;


-- public.pp_enregistrer_nom(uuid,text,boolean)
CREATE OR REPLACE FUNCTION public.pp_enregistrer_nom(p_trainee_id uuid, p_nom text, p_confirme boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  /* société (C2) */ perform app.exiger_societe('trainees', p_trainee_id, true);
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.trainees
     set nom_naissance = nullif(btrim(p_nom), ''),
         nom_naissance_confirme_le = case when p_confirme and nullif(btrim(p_nom), '') is not null then now() else null end
   where id = p_trainee_id;
  update public.pp_lignes set corrige_le = now(), updated_at = now()
   where trainee_id = p_trainee_id and statut = 'rejete';
end $function$;


-- public.pp_enregistrer_refus(uuid,boolean)
CREATE OR REPLACE FUNCTION public.pp_enregistrer_refus(p_trainee_id uuid, p_refus boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  /* société (C2) */ perform app.exiger_societe('trainees', p_trainee_id, true);
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.trainees set refused_ssn = coalesce(p_refus, false) where id = p_trainee_id;
  if coalesce(p_refus, false) then
    delete from public.pp_nir where trainee_id = p_trainee_id;
  end if;
end $function$;


-- public.pp_marquer_fichier(uuid,boolean)
CREATE OR REPLACE FUNCTION public.pp_marquer_fichier(p_fichier_id uuid, p_non_depose boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  /* société (C2) */ perform app.exiger_societe('pp_fichiers', p_fichier_id, true);
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.pp_fichiers set marque_non_depose = coalesce(p_non_depose, false) where id = p_fichier_id;
end $function$;


-- public.detect_client_links(uuid)
CREATE OR REPLACE FUNCTION public.detect_client_links(p_client_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client RECORD;
  v_siren TEXT;
  v_domain TEXT;
  v_dirigeant_nom TEXT;
  v_group_name TEXT;
  v_result JSON;
BEGIN
  /* société (C2) */ perform app.exiger_societe('clients', p_client_id, false);
  /* garde chantier 2 */ perform app.require_right('clients.fiches.voir');

  SELECT id, name, siren, siret, contact_name, contact_email, website, group_name
  INTO v_client
  FROM clients
  WHERE id = p_client_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Client not found');
  END IF;

  v_siren := COALESCE(v_client.siren, LEFT(v_client.siret, 9));
  
  v_domain := NULL;
  IF v_client.website IS NOT NULL AND v_client.website != '' THEN
    v_domain := regexp_replace(
      regexp_replace(v_client.website, '^https?://(www\.)?', ''),
      '/.*$', ''
    );
    v_domain := trim(BOTH '.' FROM trim(BOTH '/' FROM v_domain));
  END IF;
  IF v_domain IS NULL AND v_client.contact_email IS NOT NULL AND v_client.contact_email LIKE '%@%' THEN
    v_domain := split_part(v_client.contact_email, '@', 2);
    IF v_domain IN ('gmail.com','yahoo.fr','hotmail.com','hotmail.fr','outlook.com','outlook.fr','orange.fr','free.fr','sfr.fr','wanadoo.fr','laposte.net','live.fr','aol.com','icloud.com','protonmail.com') THEN
      v_domain := NULL;
    END IF;
  END IF;

  v_dirigeant_nom := NULL;
  IF v_client.contact_name IS NOT NULL AND length(trim(v_client.contact_name)) > 2 THEN
    v_dirigeant_nom := upper(trim(split_part(trim(v_client.contact_name), ' ', 
      array_length(string_to_array(trim(v_client.contact_name), ' '), 1)
    )));
    IF length(v_dirigeant_nom) < 3 THEN v_dirigeant_nom := NULL; END IF;
  END IF;

  v_group_name := v_client.group_name;

  SELECT json_build_object(
    'client_siren', v_siren,
    'client_domain', v_domain,
    'client_dirigeant', v_dirigeant_nom,
    'client_group', v_group_name,
    
    -- 1. SIREN
    'siren_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_siren IS NOT NULL AND siren = v_siren
          AND prospection_status IS DISTINCT FROM 'deja_client'
        ORDER BY quality_score DESC LIMIT 20
      ) sub
    ), '[]'::json),

    -- 2. DOMAINE
    'domain_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_domain IS NOT NULL
          AND (v_siren IS NULL OR siren IS DISTINCT FROM v_siren)
          AND prospection_status IS DISTINCT FROM 'deja_client'
          AND (site_web ILIKE '%' || v_domain || '%' OR email ILIKE '%@' || v_domain)
        ORDER BY quality_score DESC LIMIT 20
      ) sub
    ), '[]'::json),

    -- 3. DIRIGEANT
    'dirigeant_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_dirigeant_nom IS NOT NULL
          AND (v_siren IS NULL OR siren IS DISTINCT FROM v_siren)
          AND prospection_status IS DISTINCT FROM 'deja_client'
          AND upper(dirigeant_nom) = v_dirigeant_nom
        ORDER BY quality_score DESC LIMIT 20
      ) sub
    ), '[]'::json),

    -- 4. GROUPE (autres clients même group_name)
    'group_clients', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siren, siret, city, status, group_name
        FROM clients
        WHERE v_group_name IS NOT NULL AND group_name = v_group_name AND id != p_client_id
        ORDER BY name LIMIT 20
      ) sub
    ), '[]'::json),

    -- 5. NOM GROUPE (prospects dont le nom contient group_name)
    'group_prospect_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT DISTINCT ON (siren) id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_group_name IS NOT NULL
          AND length(v_group_name) >= 4
          AND name ILIKE '%' || v_group_name || '%'
          AND (v_siren IS NULL OR siren IS DISTINCT FROM v_siren)
          AND prospection_status IS DISTINCT FROM 'deja_client'
        ORDER BY siren, quality_score DESC
        LIMIT 30
      ) sub
    ), '[]'::json)
    
  ) INTO v_result;

  RETURN v_result;
END;
$function$;


-- public.billing_issue(uuid)
CREATE OR REPLACE FUNCTION public.billing_issue(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_company uuid := app.billing_company();
  s public.billing_settings;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_prefix text;
  v_last bigint;
  v_ref text;
  t jsonb;
  v_parent public.invoices;
  v_credites numeric;
  v_seller jsonb;
  v_buyer jsonb;
  v_check jsonb;
  v_bloquants text;
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, true);
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  if not app.a_le_droit(case when inv.type = 'credit_note' then 'facturation.avoirs.emettre' else 'facturation.factures.valider' end) then
    raise exception 'Accès refusé : émettre ce document ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  if inv.issued_at is not null then
    raise exception 'Ce document est déjà émis (%)', inv.reference using errcode = '22023';
  end if;
  if inv.client_id is null then
    raise exception 'Client manquant' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_invoice) then
    raise exception 'Document sans ligne' using errcode = '22023';
  end if;

  -- Mentions obligatoires (0363) : un seul point bloquant suffit à refuser l'émission
  v_check := app.billing_check(p_invoice);
  select string_agg(p ->> 'libelle', ' ; ') into v_bloquants
  from jsonb_array_elements(v_check -> 'points') p where (p ->> 'bloquant')::boolean;
  if v_bloquants is not null then
    raise exception 'Émission impossible, à compléter : %', v_bloquants using errcode = '22023';
  end if;

  t := public.billing_compute_totals(p_invoice);
  if inv.type = 'credit_note' then
    select * into v_parent from public.invoices where id = inv.parent_invoice_id;
    if v_parent.id is null or v_parent.issued_at is null then
      raise exception 'Un avoir se rattache à une facture émise' using errcode = '22023';
    end if;
    select coalesce(sum(total_ttc), 0) into v_credites from public.invoices
    where parent_invoice_id = v_parent.id and type = 'credit_note' and issued_at is not null;
    if v_credites + (t ->> 'total_ttc')::numeric > coalesce(v_parent.total_ttc, 0) + 0.01 then
      raise exception 'Avoirs supérieurs au montant de la facture % (% € déjà crédités)', v_parent.reference, v_credites
        using errcode = '22023';
    end if;
  elsif (t ->> 'total_ttc')::numeric <= 0 then
    raise exception 'Facture d''un montant nul ou négatif : utiliser un avoir' using errcode = '22023';
  end if;

  -- Réglages et compteur de la société (ligne verrouillée jusqu'à la fin de la transaction)
  insert into public.billing_settings (company_id) values (v_company) on conflict (company_id) do nothing;
  select * into s from public.billing_settings where company_id = v_company;
  v_prefix := case when inv.type = 'credit_note' then s.credit_prefix else s.invoice_prefix end;
  select q.last_number into v_last from public.billing_sequences q
  where q.company_id = v_company and q.series = inv.type for update;
  if v_last is null then
    v_last := coalesce(case when inv.type = 'credit_note' then s.credit_last_number_before else s.invoice_last_number_before end,
      (select max((regexp_match(i.reference, '([0-9]+)$'))[1]::bigint) from public.invoices i
        where i.issued_at is not null and i.type = inv.type and i.reference like v_prefix || '%'), 0);
    insert into public.billing_sequences (company_id, series, last_number) values (v_company, inv.type, v_last)
    on conflict (company_id, series) do nothing;
    select q.last_number into v_last from public.billing_sequences q
    where q.company_id = v_company and q.series = inv.type for update;
  end if;
  v_ref := app.billing_format(s.number_format, v_prefix, v_today, v_last + 1);
  if exists (select 1 from public.invoices where reference = v_ref) then
    raise exception 'Numéro % déjà utilisé : vérifier le dernier numéro dans les réglages de facturation', v_ref
      using errcode = '23505';
  end if;
  update public.billing_sequences set last_number = v_last + 1, updated_at = now()
  where company_id = v_company and series = inv.type;

  -- Coordonnées figées (vendeur : réglages de l'organisme ; client et payeur : fiches au moment de l'émission)
  select jsonb_strip_nulls(jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'forme_juridique', o.forme_juridique,
           'capital_social', o.capital_social, 'siret', o.siret, 'siren', o.siren, 'naf', o.naf, 'tva_intra', o.tva_intra,
           'rcs', o.rcs, 'nda', o.nda, 'address', o.address, 'postal_code', o.postal_code, 'city', o.city,
           'phone', o.phone, 'email', o.email, 'website', o.website))
    into v_seller from public.organization_settings o limit 1;
  select jsonb_strip_nulls(jsonb_build_object('client', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name,
           'address', c.address, 'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva,
           'client_type', c.client_type)) from public.clients c where c.id = inv.client_id),
         'payeur', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address,
           'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva))
           from public.clients c where c.id = inv.billing_client_id)))
    into v_buyer;

  update public.invoices set
    reference = v_ref,
    issued_at = now(),
    issued_by = (select auth.uid()),
    due_date = case when inv.due_date is not null and inv.invoice_date is not null
                    then v_today + (inv.due_date - inv.invoice_date) else inv.due_date end,
    invoice_date = v_today,
    total_ht = (t ->> 'total_ht')::numeric,
    total_discount = (t ->> 'total_discount')::numeric,
    total_net_ht = (t ->> 'total_net_ht')::numeric,
    total_tva = (t ->> 'total_tva')::numeric,
    total_ttc = (t ->> 'total_ttc')::numeric,
    amount_due = case when inv.type = 'credit_note' then inv.amount_due
                      else greatest(0, (t ->> 'total_ttc')::numeric - coalesce(inv.amount_paid, 0) - coalesce(inv.amount_credited, 0)) end,
    status = 'due',
    seller_snapshot = v_seller,
    buyer_snapshot = v_buyer,
    legal_mentions = v_check -> 'mentions',
    nature_operation = v_check ->> 'nature',
    updated_at = now()
  where id = p_invoice;

  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', p_invoice, v_ref,
          jsonb_build_object('emission', true, 'type', inv.type));

  return jsonb_build_object('reference', v_ref, 'invoice_date', v_today, 'total_ttc', (t ->> 'total_ttc')::numeric);
end
$function$;


-- public.billing_create_credit_note(uuid,text,jsonb,numeric)
CREATE OR REPLACE FUNCTION public.billing_create_credit_note(p_invoice uuid, p_mode text, p_lines jsonb DEFAULT NULL::jsonb, p_percent numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_id uuid;
  v_restant numeric;
  l record;
  v_n int := 0;
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, true);
  if not app.a_le_droit('facturation.avoirs.emettre') then
    raise exception 'Accès refusé : émettre un avoir ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  if p_mode not in ('total', 'partiel', 'pourcentage', 'libre') then
    raise exception 'Type d''avoir inconnu : %', p_mode using errcode = '22023';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.type <> 'invoice' then
    raise exception 'Facture introuvable' using errcode = 'P0002';
  end if;
  if inv.issued_at is null then
    raise exception 'Un avoir se rattache à une facture émise (un brouillon se modifie directement)' using errcode = '22023';
  end if;
  v_restant := coalesce(inv.total_ttc, 0) - coalesce((select sum(total_ttc) from public.invoices
    where parent_invoice_id = inv.id and type = 'credit_note' and issued_at is not null), 0);
  if v_restant <= 0.01 then
    raise exception 'Facture % déjà entièrement couverte par des avoirs', inv.reference using errcode = '22023';
  end if;
  if p_mode = 'pourcentage' and (p_percent is null or p_percent <= 0 or p_percent > 100) then
    raise exception 'Pourcentage entre 0 et 100' using errcode = '22023';
  end if;

  insert into public.invoices (reference, type, client_id, contact_id, quote_id, session_id, parent_invoice_id, client_reference,
    invoice_date, service_start_date, service_end_date, object, payment_method, payment_terms, discount_percent, discount_label,
    tva_applicable, notes, created_by, is_formation_pro, billing_client_id, is_subrogation, chorus_service_code, chorus_engagement)
  values ('x', 'credit_note', inv.client_id, inv.contact_id, inv.quote_id, inv.session_id, inv.id, inv.client_reference,
    (now() at time zone 'Europe/Paris')::date, inv.service_start_date, inv.service_end_date,
    case p_mode when 'pourcentage' then 'Réduction de ' || trim(to_char(p_percent, 'FM990D99')) || ' % sur la facture ' || inv.reference
                else 'Avoir sur la facture ' || inv.reference end,
    inv.payment_method, inv.payment_terms, case when p_mode = 'total' then inv.discount_percent else 0 end,
    case when p_mode = 'total' then inv.discount_label end, inv.tva_applicable, null,
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), inv.created_by),
    inv.is_formation_pro, inv.billing_client_id, inv.is_subrogation, inv.chorus_service_code, inv.chorus_engagement)
  returning id into v_id;

  if p_mode = 'total' then
    insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
      tva_rate, total_ht, course_id, nature, vat_regime)
    select v_id, it.position, it.code, it.description_title, it.description_detail, it.quantity, it.unit, it.unit_price_ht,
      it.tva_rate, it.total_ht, it.course_id, it.nature, it.vat_regime
    from public.invoice_items it where it.invoice_id = inv.id;
  elsif p_mode = 'partiel' then
    for l in
      select it.*, least(greatest(coalesce((x ->> 'quantity')::numeric, 0), 0), it.quantity) as q
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
      join public.invoice_items it on it.id = (x ->> 'item_id')::uuid and it.invoice_id = inv.id
    loop
      continue when l.q <= 0;
      insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
        tva_rate, total_ht, course_id, nature, vat_regime)
      values (v_id, v_n, l.code, l.description_title, l.description_detail, l.q, l.unit, l.unit_price_ht,
        l.tva_rate, round(l.q * l.unit_price_ht, 2), l.course_id, l.nature, l.vat_regime);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      raise exception 'Choisir au moins une ligne et une quantité' using errcode = '22023';
    end if;
  elsif p_mode = 'pourcentage' then
    insert into public.invoice_items (invoice_id, position, description_title, description_detail, quantity, unit, unit_price_ht,
      tva_rate, total_ht, nature, vat_regime)
    select v_id, (row_number() over (order by g.tva_rate))::int - 1,
      'Réduction de ' || trim(to_char(p_percent, 'FM990D99')) || ' %', 'Sur la facture ' || inv.reference
        || case when count(*) over () > 1 then ', lignes à ' || trim(to_char(g.tva_rate, 'FM990D99')) || ' % de TVA' else '' end,
      1, 'forfait', round(g.base * p_percent / 100, 2), g.tva_rate, round(g.base * p_percent / 100, 2), g.nature, g.vat_regime
    from (
      select it.tva_rate, min(it.nature) as nature, min(it.vat_regime) as vat_regime,
             round(sum(round(it.quantity * it.unit_price_ht, 2)) * (1 - coalesce(inv.discount_percent, 0) / 100), 2) as base
      from public.invoice_items it where it.invoice_id = inv.id group by it.tva_rate
    ) g
    where g.base > 0;
  end if;

  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'document', v_id, 'Brouillon d''avoir sur ' || inv.reference,
          jsonb_build_object('mode', p_mode));
  return v_id;
end
$function$;


-- public.billing_duplicate_invoice(uuid)
CREATE OR REPLACE FUNCTION public.billing_duplicate_invoice(p_invoice uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_id uuid;
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, true);
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.type <> 'invoice' then
    raise exception 'Facture introuvable' using errcode = 'P0002';
  end if;
  insert into public.invoices (reference, type, client_id, contact_id, quote_id, session_id, client_reference, invoice_date,
    service_start_date, service_end_date, due_date, object, payment_method, payment_terms, discount_percent, discount_label,
    tva_applicable, notes, created_by, is_formation_pro, billing_client_id, is_subrogation, chorus_service_code, chorus_engagement)
  values ('x', 'invoice', inv.client_id, inv.contact_id, inv.quote_id, inv.session_id, inv.client_reference,
    (now() at time zone 'Europe/Paris')::date, inv.service_start_date, inv.service_end_date,
    (now() at time zone 'Europe/Paris')::date + coalesce(inv.due_date - inv.invoice_date, 30), inv.object, inv.payment_method,
    inv.payment_terms, inv.discount_percent, inv.discount_label, inv.tva_applicable, inv.notes,
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), inv.created_by),
    inv.is_formation_pro, inv.billing_client_id, inv.is_subrogation, inv.chorus_service_code, inv.chorus_engagement)
  returning id into v_id;
  insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
    tva_rate, total_ht, course_id, nature, vat_regime)
  select v_id, it.position, it.code, it.description_title, it.description_detail, it.quantity, it.unit, it.unit_price_ht,
    it.tva_rate, it.total_ht, it.course_id, it.nature, it.vat_regime
  from public.invoice_items it where it.invoice_id = inv.id;
  return v_id;
end
$function$;


-- public.billing_request_validation(uuid)
CREATE OR REPLACE FUNCTION public.billing_request_validation(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_net numeric;
  v_id uuid;
  v_client text;
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, true);
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé : préparer les factures ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.type <> 'invoice' then
    raise exception 'Facture introuvable' using errcode = 'P0002';
  end if;
  if inv.issued_at is not null then
    raise exception 'Facture déjà émise' using errcode = '22023';
  end if;
  select id into v_id from public.approval_requests
  where object_table = 'invoices' and object_id = inv.id and status = 'pending';
  if v_id is not null then
    return jsonb_build_object('request_id', v_id, 'required', true, 'deja', true);
  end if;
  v_net := (public.billing_compute_totals(inv.id) ->> 'total_net_ht')::numeric;
  select c.name into v_client from public.clients c where c.id = inv.client_id;
  v_id := public.approval_submit('invoice', 'invoices', inv.id, v_net, inv.client_id, left('Facture ' || coalesce(v_client, ''), 200));
  return jsonb_build_object('request_id', v_id, 'required', v_id is not null, 'deja', false);
end
$function$;


-- public.billing_siret_motif(uuid,text)
CREATE OR REPLACE FUNCTION public.billing_siret_motif(p_invoice uuid, p_motif text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, true);
  if not app.un_des_droits(array['facturation.factures.valider', 'facturation.avoirs.emettre']) then
    raise exception 'Accès refusé : émettre ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  if inv.issued_at is not null then
    raise exception 'Document déjà émis' using errcode = '22023';
  end if;
  if v_motif is not null and length(v_motif) < 5 then
    raise exception 'Motif trop court' using errcode = '22023';
  end if;
  update public.invoices set siret_check_motif = left(v_motif, 500), siret_motif_at = case when v_motif is null then null else now() end
  where id = inv.id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', inv.id,
          'Émission sans contrôle de l''annuaire', jsonb_build_object('motif', left(v_motif, 500)));
  return true;
end
$function$;


-- public.billing_missing_mentions(uuid)
CREATE OR REPLACE FUNCTION public.billing_missing_mentions(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  /* société (C2) */ perform app.exiger_societe('invoices', p_invoice, false);
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return app.billing_check(p_invoice);
end
$function$;


-- public.billing_create_deposit(uuid,numeric,numeric)
CREATE OR REPLACE FUNCTION public.billing_create_deposit(p_quote uuid, p_percent numeric DEFAULT NULL::numeric, p_amount_ttc numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  q public.quotes;
  v_total numeric;
  v_deja numeric;
  v_cible numeric;
  v_id uuid;
  v_libelle text;
begin
  /* société (C2) */ perform app.exiger_societe('quotes', p_quote, true);
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé : préparer les factures ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote;
  if q.id is null then
    raise exception 'Devis introuvable' using errcode = 'P0002';
  end if;
  if q.status not in ('accepted', 'partial', 'invoiced') then
    raise exception 'Un acompte se facture sur un devis accepté' using errcode = '22023';
  end if;
  select coalesce(sum(base + tax), 0) into v_total from app.billing_quote_groups(p_quote);
  if v_total <= 0 then
    raise exception 'Devis sans montant' using errcode = '22023';
  end if;
  v_cible := case when p_percent is not null then round(v_total * p_percent / 100, 2) else round(p_amount_ttc, 2) end;
  if v_cible is null or v_cible <= 0 or (p_percent is not null and p_percent > 100) then
    raise exception 'Pourcentage (jusqu''à 100) ou montant TTC positif attendu' using errcode = '22023';
  end if;
  select coalesce(sum(case when i.issued_at is null then (public.billing_compute_totals(i.id) ->> 'total_ttc')::numeric
                           else coalesce(i.total_ttc, 0) - coalesce(i.amount_credited, 0) end), 0) into v_deja
  from public.invoices i where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte';
  if v_deja + v_cible > v_total + 0.01 then
    raise exception 'Acomptes supérieurs au devis : % € déjà facturés sur % € TTC', v_deja, v_total using errcode = '22023';
  end if;
  v_libelle := case when p_percent is not null then 'Acompte de ' || trim(to_char(p_percent, 'FM990D99')) || ' % sur le devis ' || q.reference
                    else 'Acompte sur le devis ' || q.reference end;

  insert into public.invoices (reference, type, invoice_kind, client_id, contact_id, quote_id, session_id, client_reference, invoice_date,
    due_date, object, payment_method, payment_terms, discount_percent, tva_applicable, created_by, is_formation_pro, status)
  values ('x', 'invoice', 'acompte', q.client_id, q.contact_id, q.id, q.session_id, q.client_reference, (now() at time zone 'Europe/Paris')::date,
    (now() at time zone 'Europe/Paris')::date, v_libelle, coalesce(q.payment_method, 'virement bancaire'), 'à réception', 0,
    coalesce(q.tva_applicable, true),
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), q.created_by), true, 'draft')
  returning id into v_id;

  -- TTC de l'acompte réparti au prorata du TTC de chaque taux du devis ; HT = TTC / (1 + taux)
  insert into public.invoice_items (invoice_id, position, description_title, description_detail, quantity, unit, unit_price_ht,
    tva_rate, total_ht, nature, vat_regime)
  select v_id, (row_number() over (order by g.rate))::int - 1, v_libelle,
    case when count(*) over () > 1 then 'Part au taux de ' || trim(to_char(g.rate, 'FM990D99')) || ' %' else null end,
    1, 'forfait', round(v_cible * (g.base + g.tax) / v_total / (1 + g.rate / 100), 2), g.rate,
    round(v_cible * (g.base + g.tax) / v_total / (1 + g.rate / 100), 2), coalesce(g.nature, 'service'), coalesce(g.vat_regime, 'normal')
  from app.billing_quote_groups(p_quote) g
  where g.base + g.tax > 0;

  perform app.billing_store_totals(v_id);
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'document', v_id, 'Brouillon de facture d''acompte sur ' || q.reference,
          jsonb_build_object('pourcentage', p_percent));
  return v_id;
end
$function$;


-- public.billing_create_final(uuid)
CREATE OR REPLACE FUNCTION public.billing_create_final(p_quote uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  q public.quotes;
  s public.sessions;
  v_id uuid;
  v_pos int;
  d record;
  g record;
  v_ht numeric;
  v_tva numeric;
begin
  /* société (C2) */ perform app.exiger_societe('quotes', p_quote, true);
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé : préparer les factures ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote;
  if q.id is null then
    raise exception 'Devis introuvable' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.invoices i where i.quote_id = p_quote and i.invoice_kind = 'acompte' and i.issued_at is null) then
    raise exception 'Un acompte de ce devis est encore en brouillon : émettez-le ou supprimez-le d''abord' using errcode = '22023';
  end if;
  if q.session_id is not null then
    select * into s from public.sessions where id = q.session_id;
  end if;

  insert into public.invoices (reference, type, invoice_kind, client_id, contact_id, quote_id, session_id, client_reference, invoice_date,
    service_start_date, service_end_date, due_date, object, payment_method, payment_terms, discount_percent, tva_applicable, created_by,
    is_formation_pro, status)
  values ('x', 'invoice', 'solde', q.client_id, q.contact_id, q.id, q.session_id, q.client_reference, (now() at time zone 'Europe/Paris')::date,
    s.start_date, s.end_date, (now() at time zone 'Europe/Paris')::date + 30, coalesce(q.object, 'Facture du devis ' || q.reference),
    coalesce(q.payment_method, 'virement bancaire'), coalesce(q.payment_terms, 'à 30 jours'), 0, coalesce(q.tva_applicable, true),
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), q.created_by), true, 'draft')
  returning id into v_id;

  insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
    tva_rate, total_ht, course_id, nature, vat_regime)
  select v_id, (row_number() over (order by it.position, it.created_at))::int - 1, it.code, it.description_title, it.description_detail,
    it.quantity, it.unit, it.unit_price_ht, it.tva_rate, round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2), it.course_id,
    coalesce(it.nature, 'service'), coalesce(it.vat_regime, 'normal')
  from public.quote_items it where it.quote_id = p_quote and it.accepted is not false;
  select coalesce(max(position), -1) + 1 into v_pos from public.invoice_items where invoice_id = v_id;

  -- Remise du devis : une ligne par taux, au centime près comme le total du devis
  for g in select * from app.billing_quote_groups(p_quote) where allowance > 0 order by rate loop
    insert into public.invoice_items (invoice_id, position, description_title, quantity, unit, unit_price_ht, tva_rate, total_ht, nature, vat_regime)
    values (v_id, v_pos, coalesce(nullif(btrim(q.discount_label), ''), 'Remise') || ' (' || trim(to_char(q.discount_percent, 'FM990D99')) || ' %)',
      1, 'forfait', -g.allowance, g.rate, -g.allowance, coalesce(g.nature, 'service'), coalesce(g.vat_regime, 'normal'));
    v_pos := v_pos + 1;
  end loop;

  -- Acomptes émis, non annulés, pas encore déduits : une ligne de reprise par taux, avec numéro et date
  for d in
    select i.id, i.reference, i.invoice_date from public.invoices i
    where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte' and i.issued_at is not null
      and coalesce(i.amount_credited, 0) <= 0.01
      and not exists (select 1 from public.invoice_deposit_links l where l.deposit_invoice_id = i.id)
    order by i.invoice_date, i.created_at
  loop
    v_ht := 0; v_tva := 0;
    for g in
      select coalesce(it.tva_rate, 20) as rate, round(sum(round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2)), 2) as ht,
             min(it.nature) as nature, min(it.vat_regime) as vat_regime
      from public.invoice_items it where it.invoice_id = d.id group by coalesce(it.tva_rate, 20) order by 1
    loop
      insert into public.invoice_items (invoice_id, position, description_title, description_detail, quantity, unit, unit_price_ht,
        tva_rate, total_ht, nature, vat_regime)
      values (v_id, v_pos, 'Reprise de l''acompte ' || d.reference || ' du ' || to_char(d.invoice_date, 'DD/MM/YYYY'), null, 1, 'forfait',
        -g.ht, g.rate, -g.ht, coalesce(g.nature, 'service'), coalesce(g.vat_regime, 'normal'));
      v_pos := v_pos + 1;
      v_ht := v_ht + g.ht;
      v_tva := v_tva + case when g.rate > 0 then round(g.ht * g.rate / 100, 2) else 0 end;
    end loop;
    insert into public.invoice_deposit_links (company_id, final_invoice_id, deposit_invoice_id, amount_ht, amount_tva)
    values (app.billing_company(), v_id, d.id, v_ht, v_tva);
  end loop;

  perform app.billing_store_totals(v_id);
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'document', v_id, 'Brouillon de facture de solde sur ' || q.reference,
          jsonb_build_object('acomptes', (select count(*) from public.invoice_deposit_links where final_invoice_id = v_id)));
  return v_id;
end
$function$;


-- public.billing_deposit_summary(uuid)
CREATE OR REPLACE FUNCTION public.billing_deposit_summary(p_quote uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_total numeric;
begin
  /* société (C2) */ perform app.exiger_societe('quotes', p_quote, false);
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select coalesce(sum(base + tax), 0) into v_total from app.billing_quote_groups(p_quote);
  return jsonb_build_object(
    'devis_ttc', v_total,
    'acomptes', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'reference', i.reference, 'emise', i.issued_at is not null,
                   'ttc', i.total_ttc, 'credite', coalesce(i.amount_credited, 0), 'date', i.invoice_date,
                   'deduite', exists (select 1 from public.invoice_deposit_links l where l.deposit_invoice_id = i.id)) order by i.created_at)
                 from public.invoices i where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte'), '[]'::jsonb),
    'acomptes_ttc', coalesce((select sum(coalesce(i.total_ttc, 0) - coalesce(i.amount_credited, 0)) from public.invoices i
                              where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte'), 0),
    'solde', (select jsonb_build_object('id', i.id, 'reference', i.reference, 'emise', i.issued_at is not null) from public.invoices i
              where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'solde' order by i.created_at desc limit 1));
end
$function$;


insert into public.schema_migrations (version) values ('0276_societes_fonctions') on conflict (version) do nothing;

-- ===== supabase/rollback/0276_societes_fonctions_retour.sql =====
-- Retour arrière de 0276_societes_fonctions.sql : définitions d'avant C2 remises, aides et déclencheur retirés.
-- FICHIER GÉNÉRÉ par scripts/securite/societes_c2_fonctions.py. Idempotent.


-- app.can_read_session(uuid)
CREATE OR REPLACE FUNCTION app.can_read_session(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    app.a_le_droit('formation.suivi.voir')
    or (app.a_le_droit('formation.sessions.voir_siennes') and p_session_id in (select app.trainer_session_ids())),
  false)
$function$;


-- app.can_edit_session(uuid)
CREATE OR REPLACE FUNCTION app.can_edit_session(p_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    app.a_le_droit('formation.suivi.gerer')
    or (app.a_le_droit('formation.sessions.modifier_siennes') and p_session_id in (select app.trainer_session_ids())),
  false)
$function$;


-- app.itv_can_edit_visit_parts(uuid)
CREATE OR REPLACE FUNCTION app.itv_can_edit_visit_parts(p_visit uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce((select app.module_on('interventions'))
    and ((select app.a_le_droit('interventions.visites.gerer'))
         or ((select app.a_le_droit('interventions.missions.realiser'))
             and p_visit in (select app.tech_visit_ids()))), false)
$function$;


-- public.billing_compute_totals(uuid)
CREATE OR REPLACE FUNCTION public.billing_compute_totals(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with inv as (
    select i.id, coalesce(i.discount_percent, 0) as dp, coalesce(i.tva_applicable, true) as vat
    from public.invoices i where i.id = p_invoice and app.a_le_droit('facturation.factures.voir')
  ), lignes as (
    select case when inv.vat then coalesce(it.tva_rate, 20) else 0 end as rate,
           round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2) as net
    from public.invoice_items it join inv on inv.id = it.invoice_id
  ), groupes as (
    select l.rate, round(sum(l.net), 2) as lines from lignes l group by l.rate
  ), calc as (
    select g.rate, g.lines,
           case when inv.dp > 0 then round(g.lines * inv.dp / 100, 2) else 0 end as allowance
    from groupes g, inv
  ), fin as (
    select c.rate, c.lines, c.allowance, round(c.lines - c.allowance, 2) as base,
           case when c.rate > 0 then round(round(c.lines - c.allowance, 2) * c.rate / 100, 2) else 0 end as tax
    from calc c
  )
  select jsonb_build_object(
    'total_ht', coalesce((select round(sum(net), 2) from lignes), 0),
    'total_discount', coalesce((select round(sum(allowance), 2) from fin), 0),
    'total_net_ht', coalesce((select round(sum(base), 2) from fin), 0),
    'total_tva', coalesce((select round(sum(tax), 2) from fin), 0),
    'total_ttc', coalesce((select round(sum(base), 2) + round(sum(tax), 2) from fin), 0),
    'par_taux', coalesce((select jsonb_agg(jsonb_build_object('taux', rate, 'base', base, 'tva', tax) order by rate) from fin), '[]'::jsonb))
$function$;


-- public.disability_count(uuid[])
CREATE OR REPLACE FUNCTION public.disability_count(p_trainee_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when app.is_staff() then
    (select count(*) from public.trainee_disability d
     where d.has_disability and (p_trainee_ids is null or d.trainee_id = any (p_trainee_ids)))
  else 0 end
$function$;


-- public.psh_request_count()
CREATE OR REPLACE FUNCTION public.psh_request_count()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select case when app.is_staff() then (select count(*) from public.psh_requests) else 0 end $function$;


-- public.get_purge_stats()
CREATE OR REPLACE FUNCTION public.get_purge_stats()
 RETURNS TABLE(total_trainees bigint, trainees_to_purge bigint, oldest_trainee_years numeric, purge_threshold_years integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  /* garde chantier 2 */ perform app.require_right('formation.stagiaires.archives');

  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM trainees)::BIGINT as total_trainees,
    (SELECT COUNT(*) FROM trainees_to_purge)::BIGINT as trainees_to_purge,
    COALESCE((SELECT MAX(years_since_activity) FROM trainees_to_purge), 0)::NUMERIC as oldest_trainee_years,
    5::INTEGER as purge_threshold_years;
END;
$function$;


-- public.get_audit_logs(text,uuid,text,text,timestamp with time zone,timestamp with time zone,integer)
CREATE OR REPLACE FUNCTION public.get_audit_logs(p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_user_email text DEFAULT NULL::text, p_from_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, log_timestamp timestamp with time zone, user_email text, action text, entity_type text, entity_id uuid, entity_name text, details jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  /* garde chantier 2 */ perform app.require_right('conformite.journal.voir');

  RETURN QUERY
  SELECT 
    al.id,
    al.timestamp as log_timestamp,
    al.user_email,
    al.action::text,
    al.entity_type::text,
    al.entity_id,
    al.entity_name,
    al.details
  FROM audit_logs al
  WHERE 
    (p_entity_type IS NULL OR al.entity_type = p_entity_type)
    AND (p_entity_id IS NULL OR al.entity_id = p_entity_id)
    AND (p_action IS NULL OR al.action = p_action)
    AND (p_user_email IS NULL OR al.user_email ILIKE '%' || p_user_email || '%')
    AND (p_from_date IS NULL OR al.timestamp >= p_from_date)
    AND (p_to_date IS NULL OR al.timestamp <= p_to_date)
  ORDER BY al.timestamp DESC
  LIMIT p_limit;
END;
$function$;


-- public.pp_nir_etat(uuid[])
CREATE OR REPLACE FUNCTION public.pp_nir_etat(p_trainee_ids uuid[])
 RETURNS TABLE(trainee_id uuid, present boolean, fin text, source text, saisi_le timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.pp_can_read() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
    select n.trainee_id, true, n.fin, n.source, n.saisi_le
    from public.pp_nir n where n.trainee_id = any(p_trainee_ids);
end $function$;


-- public.pp_donnees(uuid[],uuid[])
CREATE OR REPLACE FUNCTION public.pp_donnees(p_session_ids uuid[] DEFAULT NULL::uuid[], p_inscription_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not public.pp_can_read() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(r order by r->>'end_date', r->>'reference', r->>'last_name'), '[]'::jsonb) into v
  from (
    select jsonb_build_object(
      'inscription_id', st.id,
      'session_id', s.id,
      'reference', s.reference,
      'start_date', s.start_date,
      'end_date', s.end_date,
      'is_remote', coalesce(s.is_remote, false),
      'course_id', c.id,
      'course_title', c.title,
      'course_code', c.code,
      'client_id', cl.id,
      'client_name', cl.name,
      'client_siret', cl.siret,
      'client_type', cl.client_type,
      'trainee_id', t.id,
      'first_name', t.first_name,
      'last_name', t.last_name,
      'gender', t.gender,
      'birth_date', t.birth_date,
      'nom_naissance', t.nom_naissance,
      'nom_naissance_confirme_le', t.nom_naissance_confirme_le,
      'refused_ssn', coalesce(t.refused_ssn, false),
      'absent', coalesce(st.absent, false),
      'early_departure', coalesce(st.early_departure, false),
      'result', st.result,
      'date_certification', (select sc.date_certification from public.sst_certifications sc
                             where sc.session_id = s.id and sc.trainee_id = t.id order by sc.created_at desc limit 1),
      'nir_present', (n.trainee_id is not null),
      'nir_fin', n.fin,
      'ligne', (select to_jsonb(l) from public.pp_lignes l where l.session_trainee_id = st.id order by l.created_at desc limit 1),
      'dernier_envoi', (select to_jsonb(e) from public.pp_envois e join public.pp_lignes l on l.id = e.ligne_id
                        where l.session_trainee_id = st.id order by e.tentative desc, e.created_at desc limit 1)
    ) as r
    from public.session_trainees st
    join public.sessions s on s.id = st.session_id
    join public.trainees t on t.id = st.trainee_id
    left join public.courses c on c.id = s.course_id
    left join public.clients cl on cl.id = s.client_id
    left join public.pp_nir n on n.trainee_id = t.id
    where s.end_date < current_date
      and s.subcontract_client_ref is null
      and coalesce(s.session_type, '') not in ('subcontract', 'sous-traitance')
      and (p_session_ids is null or s.id = any(p_session_ids))
      and (p_inscription_ids is null or st.id = any(p_inscription_ids))
  ) x;
  return v;
end $function$;


-- public.itv_dashboard()
CREATE OR REPLACE FUNCTION public.itv_dashboard()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'late_equipment', (select count(*) from itv_equipment where status <> 'retire' and next_check_on < current_date),
    'late_sites', (select count(distinct site_id) from itv_equipment where status <> 'retire' and next_check_on < current_date),
    'due_month_sites', (select count(distinct site_id) from itv_equipment where status <> 'retire'
                         and next_check_on >= current_date and next_check_on < (date_trunc('month', current_date) + interval '1 month')::date),
    'to_quote', (select count(*) from itv_visit_items i join itv_visits v on v.id = i.visit_id
                 where i.result = 'a_remplacer' and v.status = 'terminee' and v.quote_id is null),
    'today_visits', (select count(*) from itv_visits where planned_on = current_date and status in ('planifiee', 'en_cours')),
    'unplanned_contract_visits', (select count(*) from itv_visits where status = 'a_planifier' and due_on < (current_date + 31))
  )
$function$;


-- public.itv_close_visit(uuid)
CREATE OR REPLACE FUNCTION public.itv_close_visit(p_visit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v public.itv_visits%rowtype; v_day date; n_ok int; n_ko int; n_rp int; n_other int;
begin
  /* garde chantier 2 */ if app.role() = 'technicien' and p_visit not in (select app.tech_visit_ids()) then raise exception 'Accès refusé' using errcode = '42501'; end if;

  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select * into v from public.itv_visits where id = p_visit for update;
  if not found then raise exception 'Visite introuvable'; end if;
  v_day := coalesce((v.started_at at time zone 'Europe/Paris')::date, v.planned_on, current_date);

  update public.itv_equipment e set
    last_check_on = v_day,
    next_check_on = (v_day + make_interval(months => t.verification_months))::date,
    status = case when i.result = 'a_remplacer' then 'a_remplacer' else 'en_service' end,
    manufactured_year = case when i.result = 'remplace' then extract(year from v_day)::int else e.manufactured_year end,
    updated_at = now()
  from public.itv_visit_items i, public.itv_equipment_types t
  where i.visit_id = p_visit and i.equipment_id = e.id and t.id = e.type_id
    and i.result in ('conforme', 'remplace', 'a_remplacer');

  update public.itv_visits set status = 'terminee', finished_at = coalesce(finished_at, now()) where id = p_visit;

  select count(*) filter (where result = 'conforme'), count(*) filter (where result = 'a_remplacer'),
         count(*) filter (where result = 'remplace'), count(*) filter (where result in ('absent', 'inaccessible'))
    into n_ok, n_ko, n_rp, n_other
  from public.itv_visit_items where visit_id = p_visit;
  return jsonb_build_object('conforme', n_ok, 'a_remplacer', n_ko, 'remplace', n_rp, 'autre', n_other);
end $function$;


-- public.itv_generate_contract_visits(uuid,integer)
CREATE OR REPLACE FUNCTION public.itv_generate_contract_visits(p_contract uuid, p_year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c public.itv_contracts%rowtype; m int; s record; v_due date; n int := 0;
begin
  /* garde chantier 2 */ perform app.require_right('interventions.visites.gerer');

  if not public.itv_can_write() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select * into c from public.itv_contracts where id = p_contract;
  if not found then raise exception 'Contrat introuvable'; end if;
  foreach m in array coalesce(c.visit_months, '{}') loop
    v_due := make_date(p_year, m, 1);
    if v_due < date_trunc('month', c.start_on)::date or (c.end_on is not null and v_due > c.end_on) then continue; end if;
    for s in select id from public.sites
             where client_id = c.client_id and is_active
               and (c.site_ids is null or cardinality(c.site_ids) = 0 or id = any(c.site_ids)) loop
      if not exists (select 1 from public.itv_visits where contract_id = c.id and site_id = s.id
                     and date_trunc('month', due_on) = date_trunc('month', v_due) and status <> 'annulee') then
        insert into public.itv_visits (client_id, site_id, contract_id, due_on, status)
        values (c.client_id, s.id, c.id, v_due, 'a_planifier');
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $function$;


-- public.client_contact_sync_primary(uuid)
CREATE OR REPLACE FUNCTION public.client_contact_sync_primary(p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  /* garde chantier 2 */ perform app.require_right('clients.fiches.modifier');

  if not exists (select 1 from public.client_contacts where client_id = p_client_id and is_primary) then
    select id into v_id from public.client_contacts where client_id = p_client_id order by created_at limit 1;
    if v_id is null then
      update public.clients set contact_name = null, contact_function = null, contact_email = null, contact_phone = null where id = p_client_id;
    else
      update public.client_contacts set is_primary = true where id = v_id;
    end if;
  end if;
end $function$;


-- public.get_trainee_with_ssn(uuid)
CREATE OR REPLACE FUNCTION public.get_trainee_with_ssn(p_id uuid)
 RETURNS TABLE(id uuid, first_name text, last_name text, email text, phone text, social_security_number text, client_id uuid, notes text, birth_date date, refused_ssn boolean, has_disability boolean, disability_details text, disability_adaptations text, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := app.role();
  v_handi boolean := app.can_see_disability();
begin
  if not (v_role = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
          or (v_role = 'formateur' and p_id in (select app.trainer_trainee_ids()))) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return query
  select t.id, t.first_name::text, t.last_name::text, t.email::text, t.phone::text,
         (select repeat('•', greatest(length(s.ssn) - 3, 0)) || right(s.ssn, 3) from public.trainee_ssn s where s.trainee_id = t.id),
         t.client_id, t.notes, t.birth_date, t.refused_ssn,
         case when v_handi then coalesce(d.has_disability, false) end,
         case when v_handi then d.details end,
         case when v_handi then d.adaptations end,
         t.created_at, t.updated_at
  from public.trainees t
  left join public.trainee_disability d on d.trainee_id = t.id
  where t.id = p_id;
end
$function$;


-- public.purge_trainee(uuid,text)
CREATE OR REPLACE FUNCTION public.purge_trainee(p_trainee_id uuid, p_archived_by text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trainee RECORD;
  v_sessions_count INTEGER;
  v_reference TEXT;
BEGIN
  /* garde chantier 2 */ perform app.require_right('formation.stagiaires.archives');

  -- Récupérer le stagiaire
  SELECT * INTO v_trainee FROM trainees WHERE id = p_trainee_id;
  
  IF v_trainee IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Stagiaire non trouvé');
  END IF;
  
  -- Compter les sessions
  SELECT COUNT(*) INTO v_sessions_count
  FROM session_trainees WHERE trainee_id = p_trainee_id;
  
  -- Créer une référence anonymisée
  v_reference := 'ARCH-' || TO_CHAR(NOW(), 'YYYY') || '-' || SUBSTRING(p_trainee_id::TEXT, 1, 8);
  
  -- Archiver
  INSERT INTO trainees_archive (id, reference, last_session_date, sessions_count, archived_by)
  VALUES (p_trainee_id, v_reference, v_trainee.last_session_date, v_sessions_count, p_archived_by)
  ON CONFLICT (id) DO NOTHING;
  
  -- Supprimer les données associées
  DELETE FROM trainee_documents WHERE trainee_id = p_trainee_id;
  DELETE FROM evaluations WHERE trainee_id = p_trainee_id;
  DELETE FROM attendances WHERE trainee_id = p_trainee_id;
  DELETE FROM session_trainees WHERE trainee_id = p_trainee_id;
  DELETE FROM trainees WHERE id = p_trainee_id;
  
  -- Logger la purge
  PERFORM log_audit(
    NULL,
    p_archived_by,
    'delete',
    'trainee',
    p_trainee_id,
    v_reference,
    jsonb_build_object('type', 'RGPD_PURGE', 'original_name', v_trainee.first_name || ' ' || v_trainee.last_name)
  );
  
  RETURN jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'sessions_count', v_sessions_count
  );
END;
$function$;


-- public.export_trainee_data(uuid)
CREATE OR REPLACE FUNCTION public.export_trainee_data(p_trainee_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
  v_trainee JSONB;
  v_sessions JSONB;
  v_attendances JSONB;
  v_evaluations JSONB;
  v_documents JSONB;
BEGIN
  /* garde chantier 2 */ perform app.require_right('formation.stagiaires.archives');

  -- Données personnelles du stagiaire
  SELECT jsonb_build_object(
    'id', t.id,
    'first_name', t.first_name,
    'last_name', t.last_name,
    'email', t.email,
    'phone', t.phone,
    'birth_date', t.birth_date,
    'social_security_number', COALESCE(decrypt_ssn(t.ssn_encrypted), t.social_security_number),
    'has_disability', t.has_disability,
    'disability_details', t.disability_details,
    'disability_adaptations', t.disability_adaptations,
    'notes', t.notes,
    'created_at', t.created_at,
    'client', (SELECT jsonb_build_object('id', c.id, 'name', c.name) FROM clients c WHERE c.id = t.client_id)
  )
  INTO v_trainee
  FROM trainees t
  WHERE t.id = p_trainee_id;
  
  IF v_trainee IS NULL THEN
    RETURN jsonb_build_object('error', 'Stagiaire non trouvé');
  END IF;
  
  -- Sessions suivies
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', s.id,
    'reference', s.reference,
    'course', co.name,
    'start_date', s.start_date,
    'end_date', s.end_date,
    'location', s.location,
    'status', s.status,
    'result', st.result,
    'registration_date', st.registration_date
  )), '[]'::jsonb)
  INTO v_sessions
  FROM session_trainees st
  JOIN sessions s ON s.id = st.session_id
  LEFT JOIN courses co ON co.id = s.course_id
  WHERE st.trainee_id = p_trainee_id;
  
  -- Émargements
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', a.session_id,
    'date', a.date,
    'am_present', a.am_present,
    'pm_present', a.pm_present,
    'signature_am', a.signature_am IS NOT NULL,
    'signature_pm', a.signature_pm IS NOT NULL
  )), '[]'::jsonb)
  INTO v_attendances
  FROM attendances a
  WHERE a.trainee_id = p_trainee_id;
  
  -- Évaluations
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'session_id', e.session_id,
    'type', e.type,
    'score', e.score,
    'created_at', e.created_at
  )), '[]'::jsonb)
  INTO v_evaluations
  FROM evaluations e
  WHERE e.trainee_id = p_trainee_id;
  
  -- Documents associés
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'name', d.name,
    'type', d.type,
    'uploaded_at', d.created_at
  )), '[]'::jsonb)
  INTO v_documents
  FROM trainee_documents d
  WHERE d.trainee_id = p_trainee_id;
  
  -- Assembler le résultat
  v_result := jsonb_build_object(
    'export_date', NOW(),
    'export_type', 'RGPD_DATA_EXPORT',
    'trainee', v_trainee,
    'sessions', v_sessions,
    'attendances', v_attendances,
    'evaluations', v_evaluations,
    'documents', v_documents
  );
  
  -- Logger l'export
  PERFORM log_audit(
    NULL,
    'system',
    'export',
    'trainee',
    p_trainee_id,
    v_trainee->>'first_name' || ' ' || v_trainee->>'last_name',
    jsonb_build_object('type', 'RGPD_DATA_EXPORT')
  );
  
  RETURN v_result;
END;
$function$;


-- public.pp_enregistrer_nom(uuid,text,boolean)
CREATE OR REPLACE FUNCTION public.pp_enregistrer_nom(p_trainee_id uuid, p_nom text, p_confirme boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.trainees
     set nom_naissance = nullif(btrim(p_nom), ''),
         nom_naissance_confirme_le = case when p_confirme and nullif(btrim(p_nom), '') is not null then now() else null end
   where id = p_trainee_id;
  update public.pp_lignes set corrige_le = now(), updated_at = now()
   where trainee_id = p_trainee_id and statut = 'rejete';
end $function$;


-- public.pp_enregistrer_refus(uuid,boolean)
CREATE OR REPLACE FUNCTION public.pp_enregistrer_refus(p_trainee_id uuid, p_refus boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.trainees set refused_ssn = coalesce(p_refus, false) where id = p_trainee_id;
  if coalesce(p_refus, false) then
    delete from public.pp_nir where trainee_id = p_trainee_id;
  end if;
end $function$;


-- public.pp_marquer_fichier(uuid,boolean)
CREATE OR REPLACE FUNCTION public.pp_marquer_fichier(p_fichier_id uuid, p_non_depose boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.pp_can() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  update public.pp_fichiers set marque_non_depose = coalesce(p_non_depose, false) where id = p_fichier_id;
end $function$;


-- public.detect_client_links(uuid)
CREATE OR REPLACE FUNCTION public.detect_client_links(p_client_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_client RECORD;
  v_siren TEXT;
  v_domain TEXT;
  v_dirigeant_nom TEXT;
  v_group_name TEXT;
  v_result JSON;
BEGIN
  /* garde chantier 2 */ perform app.require_right('clients.fiches.voir');

  SELECT id, name, siren, siret, contact_name, contact_email, website, group_name
  INTO v_client
  FROM clients
  WHERE id = p_client_id;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Client not found');
  END IF;

  v_siren := COALESCE(v_client.siren, LEFT(v_client.siret, 9));
  
  v_domain := NULL;
  IF v_client.website IS NOT NULL AND v_client.website != '' THEN
    v_domain := regexp_replace(
      regexp_replace(v_client.website, '^https?://(www\.)?', ''),
      '/.*$', ''
    );
    v_domain := trim(BOTH '.' FROM trim(BOTH '/' FROM v_domain));
  END IF;
  IF v_domain IS NULL AND v_client.contact_email IS NOT NULL AND v_client.contact_email LIKE '%@%' THEN
    v_domain := split_part(v_client.contact_email, '@', 2);
    IF v_domain IN ('gmail.com','yahoo.fr','hotmail.com','hotmail.fr','outlook.com','outlook.fr','orange.fr','free.fr','sfr.fr','wanadoo.fr','laposte.net','live.fr','aol.com','icloud.com','protonmail.com') THEN
      v_domain := NULL;
    END IF;
  END IF;

  v_dirigeant_nom := NULL;
  IF v_client.contact_name IS NOT NULL AND length(trim(v_client.contact_name)) > 2 THEN
    v_dirigeant_nom := upper(trim(split_part(trim(v_client.contact_name), ' ', 
      array_length(string_to_array(trim(v_client.contact_name), ' '), 1)
    )));
    IF length(v_dirigeant_nom) < 3 THEN v_dirigeant_nom := NULL; END IF;
  END IF;

  v_group_name := v_client.group_name;

  SELECT json_build_object(
    'client_siren', v_siren,
    'client_domain', v_domain,
    'client_dirigeant', v_dirigeant_nom,
    'client_group', v_group_name,
    
    -- 1. SIREN
    'siren_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_siren IS NOT NULL AND siren = v_siren
          AND prospection_status IS DISTINCT FROM 'deja_client'
        ORDER BY quality_score DESC LIMIT 20
      ) sub
    ), '[]'::json),

    -- 2. DOMAINE
    'domain_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_domain IS NOT NULL
          AND (v_siren IS NULL OR siren IS DISTINCT FROM v_siren)
          AND prospection_status IS DISTINCT FROM 'deja_client'
          AND (site_web ILIKE '%' || v_domain || '%' OR email ILIKE '%@' || v_domain)
        ORDER BY quality_score DESC LIMIT 20
      ) sub
    ), '[]'::json),

    -- 3. DIRIGEANT
    'dirigeant_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_dirigeant_nom IS NOT NULL
          AND (v_siren IS NULL OR siren IS DISTINCT FROM v_siren)
          AND prospection_status IS DISTINCT FROM 'deja_client'
          AND upper(dirigeant_nom) = v_dirigeant_nom
        ORDER BY quality_score DESC LIMIT 20
      ) sub
    ), '[]'::json),

    -- 4. GROUPE (autres clients même group_name)
    'group_clients', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT id, name, siren, siret, city, status, group_name
        FROM clients
        WHERE v_group_name IS NOT NULL AND group_name = v_group_name AND id != p_client_id
        ORDER BY name LIMIT 20
      ) sub
    ), '[]'::json),

    -- 5. NOM GROUPE (prospects dont le nom contient group_name)
    'group_prospect_matches', COALESCE((
      SELECT json_agg(row_to_json(sub))
      FROM (
        SELECT DISTINCT ON (siren) id, name, siret, siren, city, postal_code, phone, email, site_web,
               dirigeant_nom, dirigeant_prenom, prospection_status, contacted, quality_score
        FROM prospection_massive
        WHERE v_group_name IS NOT NULL
          AND length(v_group_name) >= 4
          AND name ILIKE '%' || v_group_name || '%'
          AND (v_siren IS NULL OR siren IS DISTINCT FROM v_siren)
          AND prospection_status IS DISTINCT FROM 'deja_client'
        ORDER BY siren, quality_score DESC
        LIMIT 30
      ) sub
    ), '[]'::json)
    
  ) INTO v_result;

  RETURN v_result;
END;
$function$;


-- public.billing_issue(uuid)
CREATE OR REPLACE FUNCTION public.billing_issue(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_company uuid := app.billing_company();
  s public.billing_settings;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_prefix text;
  v_last bigint;
  v_ref text;
  t jsonb;
  v_parent public.invoices;
  v_credites numeric;
  v_seller jsonb;
  v_buyer jsonb;
  v_check jsonb;
  v_bloquants text;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  if not app.a_le_droit(case when inv.type = 'credit_note' then 'facturation.avoirs.emettre' else 'facturation.factures.valider' end) then
    raise exception 'Accès refusé : émettre ce document ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  if inv.issued_at is not null then
    raise exception 'Ce document est déjà émis (%)', inv.reference using errcode = '22023';
  end if;
  if inv.client_id is null then
    raise exception 'Client manquant' using errcode = '22023';
  end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_invoice) then
    raise exception 'Document sans ligne' using errcode = '22023';
  end if;

  -- Mentions obligatoires (0363) : un seul point bloquant suffit à refuser l'émission
  v_check := app.billing_check(p_invoice);
  select string_agg(p ->> 'libelle', ' ; ') into v_bloquants
  from jsonb_array_elements(v_check -> 'points') p where (p ->> 'bloquant')::boolean;
  if v_bloquants is not null then
    raise exception 'Émission impossible, à compléter : %', v_bloquants using errcode = '22023';
  end if;

  t := public.billing_compute_totals(p_invoice);
  if inv.type = 'credit_note' then
    select * into v_parent from public.invoices where id = inv.parent_invoice_id;
    if v_parent.id is null or v_parent.issued_at is null then
      raise exception 'Un avoir se rattache à une facture émise' using errcode = '22023';
    end if;
    select coalesce(sum(total_ttc), 0) into v_credites from public.invoices
    where parent_invoice_id = v_parent.id and type = 'credit_note' and issued_at is not null;
    if v_credites + (t ->> 'total_ttc')::numeric > coalesce(v_parent.total_ttc, 0) + 0.01 then
      raise exception 'Avoirs supérieurs au montant de la facture % (% € déjà crédités)', v_parent.reference, v_credites
        using errcode = '22023';
    end if;
  elsif (t ->> 'total_ttc')::numeric <= 0 then
    raise exception 'Facture d''un montant nul ou négatif : utiliser un avoir' using errcode = '22023';
  end if;

  -- Réglages et compteur de la société (ligne verrouillée jusqu'à la fin de la transaction)
  insert into public.billing_settings (company_id) values (v_company) on conflict (company_id) do nothing;
  select * into s from public.billing_settings where company_id = v_company;
  v_prefix := case when inv.type = 'credit_note' then s.credit_prefix else s.invoice_prefix end;
  select q.last_number into v_last from public.billing_sequences q
  where q.company_id = v_company and q.series = inv.type for update;
  if v_last is null then
    v_last := coalesce(case when inv.type = 'credit_note' then s.credit_last_number_before else s.invoice_last_number_before end,
      (select max((regexp_match(i.reference, '([0-9]+)$'))[1]::bigint) from public.invoices i
        where i.issued_at is not null and i.type = inv.type and i.reference like v_prefix || '%'), 0);
    insert into public.billing_sequences (company_id, series, last_number) values (v_company, inv.type, v_last)
    on conflict (company_id, series) do nothing;
    select q.last_number into v_last from public.billing_sequences q
    where q.company_id = v_company and q.series = inv.type for update;
  end if;
  v_ref := app.billing_format(s.number_format, v_prefix, v_today, v_last + 1);
  if exists (select 1 from public.invoices where reference = v_ref) then
    raise exception 'Numéro % déjà utilisé : vérifier le dernier numéro dans les réglages de facturation', v_ref
      using errcode = '23505';
  end if;
  update public.billing_sequences set last_number = v_last + 1, updated_at = now()
  where company_id = v_company and series = inv.type;

  -- Coordonnées figées (vendeur : réglages de l'organisme ; client et payeur : fiches au moment de l'émission)
  select jsonb_strip_nulls(jsonb_build_object('name', o.name, 'legal_name', o.legal_name, 'forme_juridique', o.forme_juridique,
           'capital_social', o.capital_social, 'siret', o.siret, 'siren', o.siren, 'naf', o.naf, 'tva_intra', o.tva_intra,
           'rcs', o.rcs, 'nda', o.nda, 'address', o.address, 'postal_code', o.postal_code, 'city', o.city,
           'phone', o.phone, 'email', o.email, 'website', o.website))
    into v_seller from public.organization_settings o limit 1;
  select jsonb_strip_nulls(jsonb_build_object('client', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name,
           'address', c.address, 'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva,
           'client_type', c.client_type)) from public.clients c where c.id = inv.client_id),
         'payeur', (select jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name, 'address', c.address,
           'postal_code', c.postal_code, 'city', c.city, 'siret', c.siret, 'siren', c.siren, 'tva', c.tva))
           from public.clients c where c.id = inv.billing_client_id)))
    into v_buyer;

  update public.invoices set
    reference = v_ref,
    issued_at = now(),
    issued_by = (select auth.uid()),
    due_date = case when inv.due_date is not null and inv.invoice_date is not null
                    then v_today + (inv.due_date - inv.invoice_date) else inv.due_date end,
    invoice_date = v_today,
    total_ht = (t ->> 'total_ht')::numeric,
    total_discount = (t ->> 'total_discount')::numeric,
    total_net_ht = (t ->> 'total_net_ht')::numeric,
    total_tva = (t ->> 'total_tva')::numeric,
    total_ttc = (t ->> 'total_ttc')::numeric,
    amount_due = case when inv.type = 'credit_note' then inv.amount_due
                      else greatest(0, (t ->> 'total_ttc')::numeric - coalesce(inv.amount_paid, 0) - coalesce(inv.amount_credited, 0)) end,
    status = 'due',
    seller_snapshot = v_seller,
    buyer_snapshot = v_buyer,
    legal_mentions = v_check -> 'mentions',
    nature_operation = v_check ->> 'nature',
    updated_at = now()
  where id = p_invoice;

  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', p_invoice, v_ref,
          jsonb_build_object('emission', true, 'type', inv.type));

  return jsonb_build_object('reference', v_ref, 'invoice_date', v_today, 'total_ttc', (t ->> 'total_ttc')::numeric);
end
$function$;


-- public.billing_create_credit_note(uuid,text,jsonb,numeric)
CREATE OR REPLACE FUNCTION public.billing_create_credit_note(p_invoice uuid, p_mode text, p_lines jsonb DEFAULT NULL::jsonb, p_percent numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_id uuid;
  v_restant numeric;
  l record;
  v_n int := 0;
begin
  if not app.a_le_droit('facturation.avoirs.emettre') then
    raise exception 'Accès refusé : émettre un avoir ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  if p_mode not in ('total', 'partiel', 'pourcentage', 'libre') then
    raise exception 'Type d''avoir inconnu : %', p_mode using errcode = '22023';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.type <> 'invoice' then
    raise exception 'Facture introuvable' using errcode = 'P0002';
  end if;
  if inv.issued_at is null then
    raise exception 'Un avoir se rattache à une facture émise (un brouillon se modifie directement)' using errcode = '22023';
  end if;
  v_restant := coalesce(inv.total_ttc, 0) - coalesce((select sum(total_ttc) from public.invoices
    where parent_invoice_id = inv.id and type = 'credit_note' and issued_at is not null), 0);
  if v_restant <= 0.01 then
    raise exception 'Facture % déjà entièrement couverte par des avoirs', inv.reference using errcode = '22023';
  end if;
  if p_mode = 'pourcentage' and (p_percent is null or p_percent <= 0 or p_percent > 100) then
    raise exception 'Pourcentage entre 0 et 100' using errcode = '22023';
  end if;

  insert into public.invoices (reference, type, client_id, contact_id, quote_id, session_id, parent_invoice_id, client_reference,
    invoice_date, service_start_date, service_end_date, object, payment_method, payment_terms, discount_percent, discount_label,
    tva_applicable, notes, created_by, is_formation_pro, billing_client_id, is_subrogation, chorus_service_code, chorus_engagement)
  values ('x', 'credit_note', inv.client_id, inv.contact_id, inv.quote_id, inv.session_id, inv.id, inv.client_reference,
    (now() at time zone 'Europe/Paris')::date, inv.service_start_date, inv.service_end_date,
    case p_mode when 'pourcentage' then 'Réduction de ' || trim(to_char(p_percent, 'FM990D99')) || ' % sur la facture ' || inv.reference
                else 'Avoir sur la facture ' || inv.reference end,
    inv.payment_method, inv.payment_terms, case when p_mode = 'total' then inv.discount_percent else 0 end,
    case when p_mode = 'total' then inv.discount_label end, inv.tva_applicable, null,
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), inv.created_by),
    inv.is_formation_pro, inv.billing_client_id, inv.is_subrogation, inv.chorus_service_code, inv.chorus_engagement)
  returning id into v_id;

  if p_mode = 'total' then
    insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
      tva_rate, total_ht, course_id, nature, vat_regime)
    select v_id, it.position, it.code, it.description_title, it.description_detail, it.quantity, it.unit, it.unit_price_ht,
      it.tva_rate, it.total_ht, it.course_id, it.nature, it.vat_regime
    from public.invoice_items it where it.invoice_id = inv.id;
  elsif p_mode = 'partiel' then
    for l in
      select it.*, least(greatest(coalesce((x ->> 'quantity')::numeric, 0), 0), it.quantity) as q
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
      join public.invoice_items it on it.id = (x ->> 'item_id')::uuid and it.invoice_id = inv.id
    loop
      continue when l.q <= 0;
      insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
        tva_rate, total_ht, course_id, nature, vat_regime)
      values (v_id, v_n, l.code, l.description_title, l.description_detail, l.q, l.unit, l.unit_price_ht,
        l.tva_rate, round(l.q * l.unit_price_ht, 2), l.course_id, l.nature, l.vat_regime);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      raise exception 'Choisir au moins une ligne et une quantité' using errcode = '22023';
    end if;
  elsif p_mode = 'pourcentage' then
    insert into public.invoice_items (invoice_id, position, description_title, description_detail, quantity, unit, unit_price_ht,
      tva_rate, total_ht, nature, vat_regime)
    select v_id, (row_number() over (order by g.tva_rate))::int - 1,
      'Réduction de ' || trim(to_char(p_percent, 'FM990D99')) || ' %', 'Sur la facture ' || inv.reference
        || case when count(*) over () > 1 then ', lignes à ' || trim(to_char(g.tva_rate, 'FM990D99')) || ' % de TVA' else '' end,
      1, 'forfait', round(g.base * p_percent / 100, 2), g.tva_rate, round(g.base * p_percent / 100, 2), g.nature, g.vat_regime
    from (
      select it.tva_rate, min(it.nature) as nature, min(it.vat_regime) as vat_regime,
             round(sum(round(it.quantity * it.unit_price_ht, 2)) * (1 - coalesce(inv.discount_percent, 0) / 100), 2) as base
      from public.invoice_items it where it.invoice_id = inv.id group by it.tva_rate
    ) g
    where g.base > 0;
  end if;

  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'document', v_id, 'Brouillon d''avoir sur ' || inv.reference,
          jsonb_build_object('mode', p_mode));
  return v_id;
end
$function$;


-- public.billing_duplicate_invoice(uuid)
CREATE OR REPLACE FUNCTION public.billing_duplicate_invoice(p_invoice uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_id uuid;
begin
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.type <> 'invoice' then
    raise exception 'Facture introuvable' using errcode = 'P0002';
  end if;
  insert into public.invoices (reference, type, client_id, contact_id, quote_id, session_id, client_reference, invoice_date,
    service_start_date, service_end_date, due_date, object, payment_method, payment_terms, discount_percent, discount_label,
    tva_applicable, notes, created_by, is_formation_pro, billing_client_id, is_subrogation, chorus_service_code, chorus_engagement)
  values ('x', 'invoice', inv.client_id, inv.contact_id, inv.quote_id, inv.session_id, inv.client_reference,
    (now() at time zone 'Europe/Paris')::date, inv.service_start_date, inv.service_end_date,
    (now() at time zone 'Europe/Paris')::date + coalesce(inv.due_date - inv.invoice_date, 30), inv.object, inv.payment_method,
    inv.payment_terms, inv.discount_percent, inv.discount_label, inv.tva_applicable, inv.notes,
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), inv.created_by),
    inv.is_formation_pro, inv.billing_client_id, inv.is_subrogation, inv.chorus_service_code, inv.chorus_engagement)
  returning id into v_id;
  insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
    tva_rate, total_ht, course_id, nature, vat_regime)
  select v_id, it.position, it.code, it.description_title, it.description_detail, it.quantity, it.unit, it.unit_price_ht,
    it.tva_rate, it.total_ht, it.course_id, it.nature, it.vat_regime
  from public.invoice_items it where it.invoice_id = inv.id;
  return v_id;
end
$function$;


-- public.billing_request_validation(uuid)
CREATE OR REPLACE FUNCTION public.billing_request_validation(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_net numeric;
  v_id uuid;
  v_client text;
begin
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé : préparer les factures ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.type <> 'invoice' then
    raise exception 'Facture introuvable' using errcode = 'P0002';
  end if;
  if inv.issued_at is not null then
    raise exception 'Facture déjà émise' using errcode = '22023';
  end if;
  select id into v_id from public.approval_requests
  where object_table = 'invoices' and object_id = inv.id and status = 'pending';
  if v_id is not null then
    return jsonb_build_object('request_id', v_id, 'required', true, 'deja', true);
  end if;
  v_net := (public.billing_compute_totals(inv.id) ->> 'total_net_ht')::numeric;
  select c.name into v_client from public.clients c where c.id = inv.client_id;
  v_id := public.approval_submit('invoice', 'invoices', inv.id, v_net, inv.client_id, left('Facture ' || coalesce(v_client, ''), 200));
  return jsonb_build_object('request_id', v_id, 'required', v_id is not null, 'deja', false);
end
$function$;


-- public.billing_siret_motif(uuid,text)
CREATE OR REPLACE FUNCTION public.billing_siret_motif(p_invoice uuid, p_motif text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices;
  v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if not app.un_des_droits(array['facturation.factures.valider', 'facturation.avoirs.emettre']) then
    raise exception 'Accès refusé : émettre ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null then
    raise exception 'Document introuvable' using errcode = 'P0002';
  end if;
  if inv.issued_at is not null then
    raise exception 'Document déjà émis' using errcode = '22023';
  end if;
  if v_motif is not null and length(v_motif) < 5 then
    raise exception 'Motif trop court' using errcode = '22023';
  end if;
  update public.invoices set siret_check_motif = left(v_motif, 500), siret_motif_at = case when v_motif is null then null else now() end
  where id = inv.id;
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'update', 'document', inv.id,
          'Émission sans contrôle de l''annuaire', jsonb_build_object('motif', left(v_motif, 500)));
  return true;
end
$function$;


-- public.billing_missing_mentions(uuid)
CREATE OR REPLACE FUNCTION public.billing_missing_mentions(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  return app.billing_check(p_invoice);
end
$function$;


-- public.billing_create_deposit(uuid,numeric,numeric)
CREATE OR REPLACE FUNCTION public.billing_create_deposit(p_quote uuid, p_percent numeric DEFAULT NULL::numeric, p_amount_ttc numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  q public.quotes;
  v_total numeric;
  v_deja numeric;
  v_cible numeric;
  v_id uuid;
  v_libelle text;
begin
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé : préparer les factures ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote;
  if q.id is null then
    raise exception 'Devis introuvable' using errcode = 'P0002';
  end if;
  if q.status not in ('accepted', 'partial', 'invoiced') then
    raise exception 'Un acompte se facture sur un devis accepté' using errcode = '22023';
  end if;
  select coalesce(sum(base + tax), 0) into v_total from app.billing_quote_groups(p_quote);
  if v_total <= 0 then
    raise exception 'Devis sans montant' using errcode = '22023';
  end if;
  v_cible := case when p_percent is not null then round(v_total * p_percent / 100, 2) else round(p_amount_ttc, 2) end;
  if v_cible is null or v_cible <= 0 or (p_percent is not null and p_percent > 100) then
    raise exception 'Pourcentage (jusqu''à 100) ou montant TTC positif attendu' using errcode = '22023';
  end if;
  select coalesce(sum(case when i.issued_at is null then (public.billing_compute_totals(i.id) ->> 'total_ttc')::numeric
                           else coalesce(i.total_ttc, 0) - coalesce(i.amount_credited, 0) end), 0) into v_deja
  from public.invoices i where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte';
  if v_deja + v_cible > v_total + 0.01 then
    raise exception 'Acomptes supérieurs au devis : % € déjà facturés sur % € TTC', v_deja, v_total using errcode = '22023';
  end if;
  v_libelle := case when p_percent is not null then 'Acompte de ' || trim(to_char(p_percent, 'FM990D99')) || ' % sur le devis ' || q.reference
                    else 'Acompte sur le devis ' || q.reference end;

  insert into public.invoices (reference, type, invoice_kind, client_id, contact_id, quote_id, session_id, client_reference, invoice_date,
    due_date, object, payment_method, payment_terms, discount_percent, tva_applicable, created_by, is_formation_pro, status)
  values ('x', 'invoice', 'acompte', q.client_id, q.contact_id, q.id, q.session_id, q.client_reference, (now() at time zone 'Europe/Paris')::date,
    (now() at time zone 'Europe/Paris')::date, v_libelle, coalesce(q.payment_method, 'virement bancaire'), 'à réception', 0,
    coalesce(q.tva_applicable, true),
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), q.created_by), true, 'draft')
  returning id into v_id;

  -- TTC de l'acompte réparti au prorata du TTC de chaque taux du devis ; HT = TTC / (1 + taux)
  insert into public.invoice_items (invoice_id, position, description_title, description_detail, quantity, unit, unit_price_ht,
    tva_rate, total_ht, nature, vat_regime)
  select v_id, (row_number() over (order by g.rate))::int - 1, v_libelle,
    case when count(*) over () > 1 then 'Part au taux de ' || trim(to_char(g.rate, 'FM990D99')) || ' %' else null end,
    1, 'forfait', round(v_cible * (g.base + g.tax) / v_total / (1 + g.rate / 100), 2), g.rate,
    round(v_cible * (g.base + g.tax) / v_total / (1 + g.rate / 100), 2), coalesce(g.nature, 'service'), coalesce(g.vat_regime, 'normal')
  from app.billing_quote_groups(p_quote) g
  where g.base + g.tax > 0;

  perform app.billing_store_totals(v_id);
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'document', v_id, 'Brouillon de facture d''acompte sur ' || q.reference,
          jsonb_build_object('pourcentage', p_percent));
  return v_id;
end
$function$;


-- public.billing_create_final(uuid)
CREATE OR REPLACE FUNCTION public.billing_create_final(p_quote uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  q public.quotes;
  s public.sessions;
  v_id uuid;
  v_pos int;
  d record;
  g record;
  v_ht numeric;
  v_tva numeric;
begin
  if not app.a_le_droit('facturation.factures.modifier') then
    raise exception 'Accès refusé : préparer les factures ne fait pas partie de vos accès' using errcode = '42501';
  end if;
  select * into q from public.quotes where id = p_quote;
  if q.id is null then
    raise exception 'Devis introuvable' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.invoices i where i.quote_id = p_quote and i.invoice_kind = 'acompte' and i.issued_at is null) then
    raise exception 'Un acompte de ce devis est encore en brouillon : émettez-le ou supprimez-le d''abord' using errcode = '22023';
  end if;
  if q.session_id is not null then
    select * into s from public.sessions where id = q.session_id;
  end if;

  insert into public.invoices (reference, type, invoice_kind, client_id, contact_id, quote_id, session_id, client_reference, invoice_date,
    service_start_date, service_end_date, due_date, object, payment_method, payment_terms, discount_percent, tva_applicable, created_by,
    is_formation_pro, status)
  values ('x', 'invoice', 'solde', q.client_id, q.contact_id, q.id, q.session_id, q.client_reference, (now() at time zone 'Europe/Paris')::date,
    s.start_date, s.end_date, (now() at time zone 'Europe/Paris')::date + 30, coalesce(q.object, 'Facture du devis ' || q.reference),
    coalesce(q.payment_method, 'virement bancaire'), coalesce(q.payment_terms, 'à 30 jours'), 0, coalesce(q.tva_applicable, true),
    coalesce((select coalesce(p.display_name, p.email) from public.profiles p where p.id = (select auth.uid())), q.created_by), true, 'draft')
  returning id into v_id;

  insert into public.invoice_items (invoice_id, position, code, description_title, description_detail, quantity, unit, unit_price_ht,
    tva_rate, total_ht, course_id, nature, vat_regime)
  select v_id, (row_number() over (order by it.position, it.created_at))::int - 1, it.code, it.description_title, it.description_detail,
    it.quantity, it.unit, it.unit_price_ht, it.tva_rate, round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2), it.course_id,
    coalesce(it.nature, 'service'), coalesce(it.vat_regime, 'normal')
  from public.quote_items it where it.quote_id = p_quote and it.accepted is not false;
  select coalesce(max(position), -1) + 1 into v_pos from public.invoice_items where invoice_id = v_id;

  -- Remise du devis : une ligne par taux, au centime près comme le total du devis
  for g in select * from app.billing_quote_groups(p_quote) where allowance > 0 order by rate loop
    insert into public.invoice_items (invoice_id, position, description_title, quantity, unit, unit_price_ht, tva_rate, total_ht, nature, vat_regime)
    values (v_id, v_pos, coalesce(nullif(btrim(q.discount_label), ''), 'Remise') || ' (' || trim(to_char(q.discount_percent, 'FM990D99')) || ' %)',
      1, 'forfait', -g.allowance, g.rate, -g.allowance, coalesce(g.nature, 'service'), coalesce(g.vat_regime, 'normal'));
    v_pos := v_pos + 1;
  end loop;

  -- Acomptes émis, non annulés, pas encore déduits : une ligne de reprise par taux, avec numéro et date
  for d in
    select i.id, i.reference, i.invoice_date from public.invoices i
    where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte' and i.issued_at is not null
      and coalesce(i.amount_credited, 0) <= 0.01
      and not exists (select 1 from public.invoice_deposit_links l where l.deposit_invoice_id = i.id)
    order by i.invoice_date, i.created_at
  loop
    v_ht := 0; v_tva := 0;
    for g in
      select coalesce(it.tva_rate, 20) as rate, round(sum(round(coalesce(it.quantity, 0) * coalesce(it.unit_price_ht, 0), 2)), 2) as ht,
             min(it.nature) as nature, min(it.vat_regime) as vat_regime
      from public.invoice_items it where it.invoice_id = d.id group by coalesce(it.tva_rate, 20) order by 1
    loop
      insert into public.invoice_items (invoice_id, position, description_title, description_detail, quantity, unit, unit_price_ht,
        tva_rate, total_ht, nature, vat_regime)
      values (v_id, v_pos, 'Reprise de l''acompte ' || d.reference || ' du ' || to_char(d.invoice_date, 'DD/MM/YYYY'), null, 1, 'forfait',
        -g.ht, g.rate, -g.ht, coalesce(g.nature, 'service'), coalesce(g.vat_regime, 'normal'));
      v_pos := v_pos + 1;
      v_ht := v_ht + g.ht;
      v_tva := v_tva + case when g.rate > 0 then round(g.ht * g.rate / 100, 2) else 0 end;
    end loop;
    insert into public.invoice_deposit_links (company_id, final_invoice_id, deposit_invoice_id, amount_ht, amount_tva)
    values (app.billing_company(), v_id, d.id, v_ht, v_tva);
  end loop;

  perform app.billing_store_totals(v_id);
  insert into public.audit_logs (user_id, user_email, action, entity_type, entity_id, entity_name, details)
  values ((select auth.uid()), (select auth.jwt()) ->> 'email', 'create', 'document', v_id, 'Brouillon de facture de solde sur ' || q.reference,
          jsonb_build_object('acomptes', (select count(*) from public.invoice_deposit_links where final_invoice_id = v_id)));
  return v_id;
end
$function$;


-- public.billing_deposit_summary(uuid)
CREATE OR REPLACE FUNCTION public.billing_deposit_summary(p_quote uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_total numeric;
begin
  if not app.a_le_droit('facturation.factures.voir') then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select coalesce(sum(base + tax), 0) into v_total from app.billing_quote_groups(p_quote);
  return jsonb_build_object(
    'devis_ttc', v_total,
    'acomptes', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'reference', i.reference, 'emise', i.issued_at is not null,
                   'ttc', i.total_ttc, 'credite', coalesce(i.amount_credited, 0), 'date', i.invoice_date,
                   'deduite', exists (select 1 from public.invoice_deposit_links l where l.deposit_invoice_id = i.id)) order by i.created_at)
                 from public.invoices i where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte'), '[]'::jsonb),
    'acomptes_ttc', coalesce((select sum(coalesce(i.total_ttc, 0) - coalesce(i.amount_credited, 0)) from public.invoices i
                              where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'acompte'), 0),
    'solde', (select jsonb_build_object('id', i.id, 'reference', i.reference, 'emise', i.issued_at is not null) from public.invoices i
              where i.quote_id = p_quote and i.type = 'invoice' and i.invoice_kind = 'solde' order by i.created_at desc limit 1));
end
$function$;


drop trigger if exists completude_alerts_societe on public.completude_alerts;
drop function if exists app.completude_societe();
drop function if exists app.exiger_societe(text, uuid, boolean);
drop function if exists app.societe_permise(uuid, boolean);

delete from public.schema_migrations where version = '0276_societes_fonctions';

do $verif$
declare
  v_diff text[];
  v_n int;
  v_par text;
begin
  select count(*), (array_agg(coalesce(a.kind, b.kind) || ' ' || coalesce(a.name, b.name) || case
           when a.name is null then ' (en trop après retour)' when b.name is null then ' (manquant après retour)'
           else ' (différent)' end order by coalesce(a.kind, b.kind) desc, coalesce(a.name, b.name)))[1:40]
    into v_n, v_diff
  from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
  where a.v is distinct from b.v;
  select string_agg(k || ' ' || n, ', ') into v_par from (
    select coalesce(a.kind, b.kind) k, count(*) n
    from etat_essai_avant a full join etat_essai b on a.kind = b.kind and a.name = b.name
    where a.v is distinct from b.v group by 1) z;
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c2_0276 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
