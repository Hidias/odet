-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c1_0376) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0376_maintenance_nuit.sql, retour arrière,
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

-- ===== supabase/migrations/0376_maintenance_nuit.sql =====
-- 0376_maintenance_nuit.sql : écritures automatiques de la nuit (chantier 1, branche ecrans/maintenance-nuit).
--
-- Avant : le tableau de bord, les Indicateurs et la page Factures écrivaient en base à leur ouverture, pour le
-- compte connecté (sessions passées « terminées », rappels du jour, alertes qualité, factures « dues » ou « en
-- retard »). Pour les comptes Lecture, Formateur ou Comptable externe, ces écritures étaient refusées par la base.
-- Après : une seule fonction de la base, public.daily_maintenance(), lancée chaque nuit par la tâche planifiée
-- (api/maintenance-nuit.js), fait ces écritures. Les pages ne les font plus.
--
-- Idempotente : relancée le même jour, elle ne refait rien. Dates à l'heure de Paris.
-- Exécution réservée à service_role (tâche planifiée) : ni anon ni authenticated.
-- Aucune nouvelle table. Retour arrière : supabase/rollback/0376_maintenance_nuit_retour.sql

create or replace function public.daily_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Paris')::date;
  v_dow int := extract(isodow from v_today)::int; -- 1 = lundi, 6 = samedi
  v_debut timestamptz := (v_today::timestamp at time zone 'Europe/Paris');
  v_sessions int := 0;
  v_notifs int := 0;
  v_alertes int := 0;
  v_retard int := 0;
  v_dues int := 0;
  v_cert int := 0;
  n record;
begin
  -- 1. Sessions passées : « terminée » le lendemain de la fin (sauf statut verrouillé)
  update public.sessions s
     set status = 'completed', updated_at = now()
   where s.status is distinct from 'completed'
     and coalesce(s.status_locked, false) = false
     and s.end_date is not null
     and s.end_date < v_today;
  get diagnostics v_sessions = row_count;

  -- 2. Rappels du jour (une notification par type et par jour)
  for n in
    select * from (values
      (v_dow = 1, 'veille', 'Veille réglementaire à réaliser', 'Rappel hebdomadaire', '/veille-qualiopi'),
      (v_dow = 6, 'materiel', 'Vérification matériel', 'Rappel hebdomadaire', '/parametres'),
      (extract(day from v_today) = 1 and extract(month from v_today) = 7, 'audit', 'Audit interne annuel',
       'Planifiez votre audit', '/qualiopi'),
      (extract(day from v_today) = 1 and extract(month from v_today) = 8, 'revue_direction', 'Revue de direction',
       'Revue annuelle à réaliser', '/qualiopi')
    ) as r(actif, type, title, message, link)
    where r.actif
  loop
    if not exists (select 1 from public.notifications where type = n.type and created_at >= v_debut) then
      insert into public.notifications (type, title, message, link) values (n.type, n.title, n.message, n.link);
      v_notifs := v_notifs + 1;
    end if;
  end loop;

  -- Échéances de certification (NDA, audits, BPF) : fonction existante, une fois par seuil
  if to_regprocedure('public.cert_daily_notifications()') is not null then
    v_cert := public.cert_daily_notifications();
  end if;

  -- 3. Alertes qualité : notes de 1 à 3 dans les évaluations à chaud, une alerte par stagiaire, session et critère
  insert into public.quality_alerts (session_id, trainee_id, criterion_key, criterion_label, score, status)
  select e.session_id, e.trainee_id, c.cle, c.libelle, c.note, 'pending'
  from public.trainee_evaluations e
  cross join lateral (values
    ('q_org_documents', 'Communication des documents', e.q_org_documents),
    ('q_org_accueil', 'Accueil sur le lieu', e.q_org_accueil),
    ('q_org_locaux', 'Qualité des locaux', e.q_org_locaux),
    ('q_org_materiel', 'Adéquation des moyens matériels', e.q_org_materiel),
    ('q_contenu_organisation', 'Organisation et déroulement', e.q_contenu_organisation),
    ('q_contenu_supports', 'Qualité des supports pédagogiques', e.q_contenu_supports),
    ('q_contenu_duree', 'Durée de la formation', e.q_contenu_duree),
    ('q_contenu_programme', 'Respect du programme', e.q_contenu_programme),
    ('q_formateur_pedagogie', 'Pédagogie du formateur', e.q_formateur_pedagogie),
    ('q_formateur_expertise', 'Expertise du formateur', e.q_formateur_expertise),
    ('q_formateur_progression', 'Progression de la formation', e.q_formateur_progression),
    ('q_formateur_moyens', 'Moyens mis à disposition', e.q_formateur_moyens),
    ('q_global_adequation', 'Adéquation formation/métier', e.q_global_adequation),
    ('q_global_competences', 'Amélioration des connaissances', e.q_global_competences)
  ) as c(cle, libelle, note)
  where e.session_id is not null and e.trainee_id is not null
    and c.note between 1 and 3
    and not exists (select 1 from public.quality_alerts a
                    where a.session_id = e.session_id and a.trainee_id = e.trainee_id and a.criterion_key = c.cle);
  get diagnostics v_alertes = row_count;

  -- 4. Factures envoyées : « en retard » après l'échéance, « due » avant (avoirs exclus ; une facture due
  --    aujourd'hui n'est pas en retard)
  update public.invoices
     set status = 'overdue', updated_at = now()
   where coalesce(type, 'invoice') <> 'credit_note'
     and status in ('sent', 'due')
     and due_date is not null and due_date < v_today;
  get diagnostics v_retard = row_count;

  update public.invoices
     set status = 'due', updated_at = now()
   where coalesce(type, 'invoice') <> 'credit_note'
     and status = 'sent'
     and (due_date is null or due_date >= v_today);
  get diagnostics v_dues = row_count;

  return jsonb_build_object('jour', v_today, 'sessions_terminees', v_sessions, 'rappels', v_notifs,
                            'echeances_certification', v_cert, 'alertes_qualite', v_alertes,
                            'factures_en_retard', v_retard, 'factures_dues', v_dues);
end
$$;

revoke all on function public.daily_maintenance() from public, anon, authenticated;
grant execute on function public.daily_maintenance() to service_role;

insert into public.schema_migrations (version) values ('0376_maintenance_nuit') on conflict (version) do nothing;

-- ===== supabase/rollback/0376_maintenance_nuit_retour.sql =====
-- Retour arrière de 0376_maintenance_nuit.sql : retire la fonction des écritures de la nuit.
-- Les lignes déjà écrites (sessions terminées, rappels, alertes, statuts des factures) restent : ce sont les mêmes
-- écritures que faisaient les pages. Après ce retour arrière, revenir aussi au code d'avant (les pages refont ces
-- écritures à leur ouverture). Idempotent.

drop function if exists public.daily_maintenance();

delete from public.schema_migrations where version = '0376_maintenance_nuit';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c1_0376 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
