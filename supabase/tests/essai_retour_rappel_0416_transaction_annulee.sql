-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (rappel_0416) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0416_rappel_matin.sql, retour arrière,
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

-- ===== supabase/migrations/0416_rappel_matin.sql =====
-- 0416 : rappel du matin (suggestion validée par H le 21/10 : « relances automatiques vers H »). Chaque jour vers
-- 7 h 45 (heure de Paris), une notification par société résume ce qu'il y a à faire, comme « Ma journée » sur le
-- tableau de bord : sessions et visites du jour, relances à valider, actions de l'équipe, affaires et devis à
-- relancer, factures en retard. Elle arrive aussi sur les téléphones où les alertes sont actives (0411), juste après
-- les heures calmes. Rien quand il n'y a rien à faire. Aucun email.
--   1. app.rappel_matin() : prépare la notification du jour, une seule fois par société et par jour.
--   2. Tâche planifiée de la base odet_rappel_matin (5 h 45 et 6 h 45 UTC : la fonction ne fait rien hors de 7 h à
--      Paris, ce qui couvre l'heure d'été et l'heure d'hiver).
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0416_rappel_matin_retour.sql

create or replace function app.rappel_matin(p_force boolean default false)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_maintenant timestamp := now() at time zone 'Europe/Paris';
  v_jour date := v_maintenant::date;
  c record;
  n_ses int; n_vis int; n_rel int; n_act int; n_aff int; n_dev int; n_fac int;
  v_lignes text[];
  v_faits int := 0;
begin
  if not p_force and extract(hour from v_maintenant) <> 7 then return 0; end if;
  for c in select co.id from public.companies co where coalesce(co.status, 'active') = 'active' loop
    if exists (select 1 from public.notifications n where n.type = 'rappel_matin' and n.company_id = c.id
               and n.metadata->>'jour' = v_jour::text) then
      continue;
    end if;
    select count(*) into n_ses from public.sessions s
     where s.company_id = c.id and s.start_date <= v_jour and coalesce(s.end_date, s.start_date) >= v_jour
       and coalesce(s.status, '') not in ('cancelled', 'annulee');
    n_vis := 0;
    if to_regclass('public.itv_visits') is not null then
      execute 'select count(*) from public.itv_visits v where v.company_id = $1 and v.planned_on = $2
               and coalesce(v.status, '''') not in (''terminee'', ''annulee'')' into n_vis using c.id, v_jour;
    end if;
    select count(*) into n_rel from public.scheduled_actions a where a.company_id = c.id and a.status = 'a_valider';
    select count(*) into n_act from public.team_actions t where t.company_id = c.id and t.status = 'a_faire' and t.due_on <= v_jour;
    select count(*) into n_aff from public.opportunities o
     where o.company_id = c.id and o.stage not in ('gagnee', 'perdue') and o.next_action_on <= v_jour;
    select count(*) into n_dev from public.quotes q where q.company_id = c.id and q.status = 'sent' and q.next_followup_date <= v_jour;
    select count(*) into n_fac from public.invoices i
     where i.company_id = c.id and i.type = 'invoice' and i.issued_at is not null and i.due_date < v_jour and i.amount_due > 0;
    v_lignes := array_remove(array[
      case when n_ses > 0 then format('%s session%s aujourd''hui', n_ses, case when n_ses > 1 then 's' else '' end) end,
      case when n_vis > 0 then format('%s visite%s prévue%s', n_vis, case when n_vis > 1 then 's' else '' end, case when n_vis > 1 then 's' else '' end) end,
      case when n_rel > 0 then format('%s relance%s à valider', n_rel, case when n_rel > 1 then 's' else '' end) end,
      case when n_act > 0 then format('%s action%s de l''équipe à faire', n_act, case when n_act > 1 then 's' else '' end) end,
      case when n_aff > 0 then format('%s affaire%s à relancer', n_aff, case when n_aff > 1 then 's' else '' end) end,
      case when n_dev > 0 then format('%s devis à relancer', n_dev) end,
      case when n_fac > 0 then format('%s facture%s en retard de paiement', n_fac, case when n_fac > 1 then 's' else '' end) end
    ], null);
    if coalesce(array_length(v_lignes, 1), 0) = 0 then continue; end if;
    insert into public.notifications (type, title, message, link, company_id, metadata)
    values ('rappel_matin', 'Votre journée', array_to_string(v_lignes, ', ') || '.', '/', c.id,
            jsonb_build_object('jour', v_jour, 'sessions', n_ses, 'visites', n_vis, 'relances', n_rel, 'actions', n_act,
                               'affaires', n_aff, 'devis', n_dev, 'factures', n_fac));
    v_faits := v_faits + 1;
  end loop;
  return v_faits;
end
$$;
revoke all on function app.rappel_matin(boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_rappel_matin';
    perform cron.schedule('odet_rappel_matin', '45 5,6 * * *', 'select app.rappel_matin()');
  end if;
end $$;

insert into public.schema_migrations (version) values ('0416_rappel_matin') on conflict (version) do nothing;

-- ===== supabase/rollback/0416_rappel_matin_retour.sql =====
-- Retour arrière de 0416_rappel_matin.sql. Les notifications déjà créées restent. Idempotent.

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'odet_rappel_matin';
  end if;
end $$;
drop function if exists app.rappel_matin(boolean);

delete from public.schema_migrations where version = '0416_rappel_matin';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE rappel_0416 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
