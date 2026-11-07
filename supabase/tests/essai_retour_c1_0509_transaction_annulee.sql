-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (c1_0509) : ne pas modifier à la main.
-- Essai du retour arrière en transaction annulée : photographie, 0509_froid_employeur_par_lien.sql, retour arrière,
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

-- ===== supabase/migrations/0509_froid_employeur_par_lien.sql =====
-- 0509 : évaluation à froid de l'employeur depuis l'espace par lien (même remède que 0504 pour l'avis de l'entreprise).
-- Défaut : le questionnaire à froid de l'employeur (0482) ne se remplissait que depuis l'espace entreprise par compte
-- (ent_froid, ent_froid_repondre). En production, aucun client n'a de compte : tous passent par le lien et le code.
-- Aucun employeur ne pouvait donc répondre, et le mail d'invitation menait à une page de connexion sans compte.
--   1. froid_employeur.repondu_acces : accès par lien qui a donné la réponse (trace d'une réponse sans compte).
--      Pas de clé étrangère : la réponse reçue est figée (app.froid_employeur_figee), une remise à vide par la base
--      la bloquerait. repondu_par (compte), repondu_acces (lien) ou saisi_par (organisme) : un des trois.
--   2. app.froid_employeur_client(client, société) : liste de ent_froid (0482), sortie telle quelle pour servir aux deux
--      espaces. app.froid_employeur_repondre(client, société, session, réponses, profil, accès) : règle de
--      ent_froid_repondre (questionnaire proposé, une seule réponse, réponses complètes, envois préparés ignorés).
--   3. public.ent_froid et public.ent_froid_repondre appellent ces règles (même résultat qu'avant).
--   4. public.client_portal_froid(jeton, code) et public.client_portal_froid_repondre(jeton, code, session, réponses) :
--      mêmes règles depuis l'espace par lien, après client_portal_check (erreurs du lien en JSON { error }), dans la
--      société de l'accès.
--   5. Qui voit quoi (relecture de 0509 ; 0482 ouvrait plus large, sans conséquence tant qu'aucun compte n'existait) :
--      le questionnaire de l'employeur n'est proposé qu'à l'entreprise qui a acheté la formation (client de la session,
--      ou groupe non annulé d'une inter), comme client_portal_data ; une entreprise ne voit une autre formation que pour
--      les salariés que l'organisme lui a demandé de relancer (envoi « contact » à son adresse), avec leur code.
-- Retour arrière : supabase/rollback/0509_froid_employeur_par_lien_retour.sql (corps de 0482, fonctions du lien retirées ;
-- l'accès qui a donné chaque réponse par le lien est recopié dans audit_logs, puis la colonne repondu_acces est retirée).
-- Le code de l'écran et de l'API (lien du mail vers l'espace par lien) se retire avec lui.

-- ── 1. Trace ──
alter table public.froid_employeur add column if not exists repondu_acces uuid;
comment on column public.froid_employeur.repondu_acces is 'Accès par lien (client_portal_access) qui a donné la réponse ; vide si réponse par compte ou saisie (0509)';

-- ── 2. Règles communes ──
create or replace function app.froid_employeur_client(p_client uuid, p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare r public.froid_reglages := app.froid_reglage(p_company);
begin
  if p_client is null or p_company is null then
    raise exception 'Espace entreprise : client inconnu' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'actif', r.actif,
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'session_id', se.id, 'formation', co.title, 'debut', se.start_date, 'fin', coalesce(se.end_date, se.start_date),
        'employeur', case when (se.client_id = p_client
                                or exists (select 1 from public.session_groups g where g.session_id = se.id and g.client_id = p_client and g.status is distinct from 'cancelled'))
                           and (r.employeur_actif or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = p_client and e.cible = 'employeur' and e.statut = 'envoye')) then jsonb_build_object(
            'recue', fe.completed_at is not null, 'recue_le', fe.completed_at,
            'questions', app.froid_questions(se.id, 'employeur')) end,
        'stagiaires', coalesce((select jsonb_agg(jsonb_build_object('prenom', tr.first_name, 'nom', tr.last_name,
              'recue', ec.completed_at is not null, 'code', st.access_code, 'jeton', se.attendance_token) order by tr.last_name, tr.first_name)
            from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
            left join public.evaluations_cold ec on ec.session_id = st.session_id and ec.trainee_id = st.trainee_id
            where st.session_id = se.id and tr.client_id = p_client and not coalesce(st.absent, false)
              and exists (select 1 from public.froid_envois e where e.session_id = se.id and e.trainee_id = st.trainee_id and e.client_id = p_client and e.cible = 'contact')), '[]'::jsonb))
        order by coalesce(se.end_date, se.start_date) desc)
      from public.sessions se left join public.courses co on co.id = se.course_id
      left join public.froid_employeur fe on fe.session_id = se.id and fe.client_id = p_client
      where se.company_id = p_company
        -- questionnaire ouvert par les réglages, ou déjà envoyé à l'employeur (il reste accessible si les réglages changent)
        and ((r.actif
              and se.status = 'completed' and coalesce(se.session_type, 'intra') <> 'subcontract'
       and not exists (select 1 from public.clients oc where oc.id = se.client_id and oc.client_type = 'organisme_formation')
              and coalesce(se.end_date, se.start_date) + coalesce(co.froid_delai_jours, r.premier_envoi_jours) <= public.paris_today()
              and (coalesce(se.end_date, se.start_date) >= public.paris_today() - r.anciennete_max_jours or se.froid_inclure))
             or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = p_client and e.cible = 'employeur' and e.statut = 'envoye'))
        -- formation achetée par l'entreprise (client ou groupe non annulé), ou salarié à relancer par elle (envoi « contact »)
        and (se.client_id = p_client
             or exists (select 1 from public.session_groups g where g.session_id = se.id and g.client_id = p_client and g.status is distinct from 'cancelled')
             or exists (select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
                         where st.session_id = se.id and tr.client_id = p_client and not coalesce(st.absent, false)
                           and exists (select 1 from public.froid_envois e where e.session_id = se.id and e.trainee_id = st.trainee_id
                                        and e.client_id = p_client and e.cible = 'contact')))), '[]'::jsonb));
end
$$;
revoke all on function app.froid_employeur_client(uuid, uuid) from public, anon, authenticated;

create or replace function app.froid_employeur_repondre(p_client uuid, p_company uuid, p_session uuid, p_reponses jsonb, p_profile uuid, p_acces uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_q jsonb; v_ok boolean;
begin
  -- session visible dans l'espace entreprise, avec un questionnaire employeur proposé (réglage actif ou déjà envoyé)
  select exists (select 1 from jsonb_array_elements(app.froid_employeur_client(p_client, p_company) -> 'sessions') x
                  where (x ->> 'session_id')::uuid = p_session and jsonb_typeof(x -> 'employeur') = 'object') into v_ok;
  if not v_ok then raise exception 'Questionnaire non disponible pour cette formation' using errcode = '22023'; end if;
  if exists (select 1 from public.froid_employeur fe where fe.session_id = p_session and fe.client_id = p_client and fe.completed_at is not null) then
    raise exception 'Votre réponse est déjà enregistrée : merci' using errcode = '23505';
  end if;
  v_q := app.froid_questions(p_session, 'employeur');
  if not app.froid_reponses_valides(v_q, p_reponses) then raise exception 'Merci de répondre à toutes les questions' using errcode = '22023'; end if;
  insert into public.froid_employeur (company_id, session_id, client_id, reponses, completed_at, repondu_par, repondu_acces)
  values (p_company, p_session, p_client, p_reponses, now(), p_profile, p_acces)
  on conflict (session_id, client_id) do update set reponses = excluded.reponses, completed_at = excluded.completed_at,
    repondu_par = excluded.repondu_par, repondu_acces = excluded.repondu_acces;
  update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue'
   where session_id = p_session and client_id = p_client and cible = 'employeur' and statut = 'prepare';
  return jsonb_build_object('success', true);
end
$$;
revoke all on function app.froid_employeur_repondre(uuid, uuid, uuid, jsonb, uuid, uuid) from public, anon, authenticated;

-- ── 3. Espace entreprise par compte ──
create or replace function public.ent_froid()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.froid_employeur_client(v.client_id, v.company_id);
end
$$;
revoke all on function public.ent_froid() from public, anon;
grant execute on function public.ent_froid() to authenticated;

create or replace function public.ent_froid_repondre(p_session uuid, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte();
begin
  return app.froid_employeur_repondre(v.client_id, v.company_id, p_session, p_reponses, (select auth.uid()), null);
end
$$;
revoke all on function public.ent_froid_repondre(uuid, jsonb) from public, anon;
grant execute on function public.ent_froid_repondre(uuid, jsonb) to authenticated;

-- ── 4. Espace par lien ──
create or replace function public.client_portal_froid(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code); a public.client_portal_access;
begin
  if v_check ? 'error' then return v_check; end if;
  select * into a from public.client_portal_access where token = p_token;
  return app.froid_employeur_client(a.client_id, a.company_id);
end
$$;
revoke all on function public.client_portal_froid(text, text) from public;
grant execute on function public.client_portal_froid(text, text) to anon, authenticated;

create or replace function public.client_portal_froid_repondre(p_token text, p_code text, p_session uuid, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_check jsonb := public.client_portal_check(p_token, p_code); a public.client_portal_access;
begin
  if v_check ? 'error' then return v_check; end if;
  select * into a from public.client_portal_access where token = p_token;
  return app.froid_employeur_repondre(a.client_id, a.company_id, p_session, p_reponses, null, a.id);
end
$$;
revoke all on function public.client_portal_froid_repondre(text, text, uuid, jsonb) from public;
grant execute on function public.client_portal_froid_repondre(text, text, uuid, jsonb) to anon, authenticated;

comment on table public.froid_employeur is 'Évaluation à froid de l''employeur (0482) : réponse figée dès sa réception ; donnée par compte (repondu_par), par lien (repondu_acces, 0509) ou saisie (saisi_par)';

insert into public.schema_migrations (version) values ('0509_froid_employeur_par_lien') on conflict (version) do nothing;

-- ===== supabase/rollback/0509_froid_employeur_par_lien_retour.sql =====
-- Retour arrière de 0509 : ent_froid et ent_froid_repondre remises au corps de 0482, fonctions de l'espace par lien et
-- règles communes retirées (le questionnaire de l'employeur ne se remplit plus que par compte). Les réponses déjà
-- reçues par le lien restent ; l'accès qui les a données est recopié dans le journal d'audit avant le retrait de la
-- colonne repondu_acces. À retirer avec le code de l'écran et de l'API de la même PR (le mail mènerait sinon à un espace
-- par lien sans la rubrique).

-- Rejouable : la recopie n'a lieu que si la colonne existe encore
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'froid_employeur' and column_name = 'repondu_acces') then
    execute $q$
      insert into public.audit_logs (action, entity_type, entity_id, entity_name, details, company_id, source)
      select 'update', 'evaluation', fe.id, 'Réponse de l''employeur reçue par l''espace par lien (retour arrière de 0509)',
             jsonb_build_object('table', 'froid_employeur', 'repondu_acces', fe.repondu_acces, 'completed_at', fe.completed_at), fe.company_id, 'base'
        from public.froid_employeur fe where fe.repondu_acces is not null$q$;
  end if;
end
$$;

drop function if exists public.client_portal_froid_repondre(text, text, uuid, jsonb);
drop function if exists public.client_portal_froid(text, text);

create or replace function public.ent_froid()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte(); r public.froid_reglages := app.froid_reglage(v.company_id);
begin
  return jsonb_build_object(
    'actif', r.actif,
    'sessions', coalesce((select jsonb_agg(jsonb_build_object(
        'session_id', se.id, 'formation', co.title, 'debut', se.start_date, 'fin', coalesce(se.end_date, se.start_date),
        'employeur', case when r.employeur_actif or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = v.client_id and e.cible = 'employeur' and e.statut = 'envoye') then jsonb_build_object(
            'recue', fe.completed_at is not null, 'recue_le', fe.completed_at,
            'questions', app.froid_questions(se.id, 'employeur')) end,
        'stagiaires', coalesce((select jsonb_agg(jsonb_build_object('prenom', tr.first_name, 'nom', tr.last_name,
              'recue', ec.completed_at is not null, 'code', st.access_code, 'jeton', se.attendance_token) order by tr.last_name, tr.first_name)
            from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
            left join public.evaluations_cold ec on ec.session_id = st.session_id and ec.trainee_id = st.trainee_id
            where st.session_id = se.id and tr.client_id = v.client_id and not coalesce(st.absent, false)
              and exists (select 1 from public.froid_envois e where e.session_id = se.id and e.trainee_id = st.trainee_id and e.cible = 'contact')), '[]'::jsonb))
        order by coalesce(se.end_date, se.start_date) desc)
      from public.sessions se left join public.courses co on co.id = se.course_id
      left join public.froid_employeur fe on fe.session_id = se.id and fe.client_id = v.client_id
      where se.company_id = v.company_id
        -- questionnaire ouvert par les réglages, ou déjà envoyé à l'employeur (il reste accessible si les réglages changent)
        and ((r.actif
              and se.status = 'completed' and coalesce(se.session_type, 'intra') <> 'subcontract'
       and not exists (select 1 from public.clients oc where oc.id = se.client_id and oc.client_type = 'organisme_formation')
              and coalesce(se.end_date, se.start_date) + coalesce(co.froid_delai_jours, r.premier_envoi_jours) <= public.paris_today()
              and (coalesce(se.end_date, se.start_date) >= public.paris_today() - r.anciennete_max_jours or se.froid_inclure))
             or exists (select 1 from public.froid_envois e where e.session_id = se.id and e.client_id = v.client_id and e.cible = 'employeur' and e.statut = 'envoye'))
        and (se.client_id = v.client_id or exists (select 1 from public.session_trainees st join public.trainees tr on tr.id = st.trainee_id
                                                    where st.session_id = se.id and tr.client_id = v.client_id))), '[]'::jsonb));
end
$$;
revoke all on function public.ent_froid() from public, anon;
grant execute on function public.ent_froid() to authenticated;

create or replace function public.ent_froid_repondre(p_session uuid, p_reponses jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.client_accounts := app.ent_compte(); r public.froid_reglages := app.froid_reglage(v.company_id); v_q jsonb; v_ok boolean;
begin
  -- session visible dans l'espace entreprise, avec un questionnaire employeur proposé (réglage actif ou déjà envoyé)
  select exists (select 1 from jsonb_array_elements(public.ent_froid() -> 'sessions') x
                  where (x ->> 'session_id')::uuid = p_session and jsonb_typeof(x -> 'employeur') = 'object') into v_ok;
  if not v_ok then raise exception 'Questionnaire non disponible pour cette formation' using errcode = '22023'; end if;
  if exists (select 1 from public.froid_employeur fe where fe.session_id = p_session and fe.client_id = v.client_id and fe.completed_at is not null) then
    raise exception 'Votre réponse est déjà enregistrée : merci' using errcode = '23505';
  end if;
  v_q := app.froid_questions(p_session, 'employeur');
  if not app.froid_reponses_valides(v_q, p_reponses) then raise exception 'Merci de répondre à toutes les questions' using errcode = '22023'; end if;
  insert into public.froid_employeur (company_id, session_id, client_id, reponses, completed_at, repondu_par)
  values (v.company_id, p_session, v.client_id, p_reponses, now(), (select auth.uid()))
  on conflict (session_id, client_id) do update set reponses = excluded.reponses, completed_at = excluded.completed_at, repondu_par = excluded.repondu_par;
  update public.froid_envois set statut = 'ignore', motif = 'Réponse reçue'
   where session_id = p_session and client_id = v.client_id and cible = 'employeur' and statut = 'prepare';
  return jsonb_build_object('success', true);
end
$$;
revoke all on function public.ent_froid_repondre(uuid, jsonb) from public, anon;
grant execute on function public.ent_froid_repondre(uuid, jsonb) to authenticated;

drop function if exists app.froid_employeur_repondre(uuid, uuid, uuid, jsonb, uuid, uuid);
drop function if exists app.froid_employeur_client(uuid, uuid);

alter table public.froid_employeur drop column if exists repondu_acces;
comment on table public.froid_employeur is 'Évaluation à froid de l''employeur (0482) : réponse figée dès sa réception';

delete from public.schema_migrations where version = '0509_froid_employeur_par_lien';

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
  raise exception E'RÉSULTAT DE L''ESSAI DU RETOUR ARRIÈRE c1_0509 (tout est annulé)\n% écart(s) avec l''état d''avant (%)\n%',
    v_n, coalesce(v_par, 'aucun'), coalesce(array_to_string(v_diff, E'\n'), '');
end
$verif$;
