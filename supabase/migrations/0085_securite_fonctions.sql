-- 0085_securite_fonctions.sql : fonctions du schéma public (chantier 2).
-- 1. search_path fixé sur toutes les fonctions qui n'en avaient pas.
-- 2. Les fonctions de déclencheur s'exécutent avec les droits de leur propriétaire : leurs effets de bord
--    (fiche de renseignements créée à l'inscription, client passé actif, synchronisations) ne dépendent
--    plus des règles d'accès de la personne qui a déclenché l'écriture.
-- 3. Droits d'exécution : anon n'exécute que les fonctions des portails ; les fonctions internes
--    (appelées par d'autres fonctions, des déclencheurs ou le serveur) ne sont plus exécutables par
--    les comptes connectés.
-- 4. Contrôle du rôle ajouté en tête des fonctions SECURITY DEFINER qui lisaient ou modifiaient des
--    données sans le vérifier (marqueur « garde chantier 2 »).
-- Migration idempotente. Retour arrière : supabase/rollback/0080-0087_securite_retour.sql (les huit migrations ensemble)

-- Contrôles par session utilisés par les fonctions de présence et de signature ------------------------

create or replace function app.can_read_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.role() = any (array['superadmin', 'admin', 'direction', 'gestionnaire', 'commercial', 'lecture'])
    or (app.role() = 'formateur' and p_session_id in (select app.trainer_session_ids())),
  false)
$$;

create or replace function app.can_edit_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.role() = any (array['superadmin', 'admin', 'direction', 'gestionnaire'])
    or (app.role() = 'formateur' and p_session_id in (select app.trainer_session_ids())),
  false)
$$;

create or replace function app.require_roles(p_roles text[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce(app.role() = any (p_roles), false) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
end
$$;

revoke all on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke all on function app.portal_session_for(text, uuid, text) from authenticated;

-- 1 et 2. search_path et déclencheurs --------------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.prorettype = 'trigger'::regtype as is_trigger, p.prosecdef,
           exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as has_path
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      -- Suivi formatif (0250) : fonctions sf_* et save_formative_batch gardées telles quelles
      and p.proname not like 'sf\_%' and p.proname <> 'save_formative_batch'
  loop
    if not r.has_path then
      execute format('alter function %s set search_path = public', r.sig);
    end if;
    if r.is_trigger and not r.prosecdef then
      execute format('alter function %s security definer', r.sig);
    end if;
  end loop;
end $$;

-- 4. Contrôles du rôle ----------------------------------------------------------------------------------

-- Insère p_guard juste après le premier BEGIN du corps d'une fonction plpgsql (une seule fois)
create or replace function app.inject_guard(p_sig regprocedure, p_guard text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def text := pg_get_functiondef(p_sig);
  v_body_start int;
  v_pos int;
begin
  if position('garde chantier 2' in v_def) > 0 then
    return;
  end if;
  v_body_start := strpos(v_def, '$function$');
  v_pos := regexp_instr(v_def, '\mbegin\M', v_body_start, 1, 1, 'i');
  if v_body_start = 0 or v_pos = 0 then
    raise exception 'Garde impossible à poser sur %', p_sig;
  end if;
  v_def := substr(v_def, 1, v_pos - 1) || E'\n  /* garde chantier 2 */ ' || p_guard || E'\n' || substr(v_def, v_pos);
  execute v_def;
end
$$;
revoke all on function app.inject_guard(regprocedure, text) from public, anon, authenticated;

-- Remplace une portion exacte du corps (une seule fois, erreur si le texte attendu est absent)
create or replace function app.replace_in_function(p_sig regprocedure, p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def text := pg_get_functiondef(p_sig);
begin
  if position('garde chantier 2' in v_def) > 0 then
    return;
  end if;
  if position(p_old in v_def) = 0 then
    raise exception 'Texte attendu absent de %', p_sig;
  end if;
  execute replace(v_def, p_old, p_new);
end
$$;
revoke all on function app.replace_in_function(regprocedure, text, text) from public, anon, authenticated;

do $$
declare
  v_auth_check text := E'IF auth.uid() IS NULL THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Connexion Campus requise'');\n  END IF;';
  v_mgr text := 'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'']);';
  v_def text;
begin
  -- Présence et signatures : formateur de la session ou gestion
  perform app.replace_in_function('public.set_trainee_absent(uuid, uuid, boolean, text, text)'::regprocedure, v_auth_check,
    E'/* garde chantier 2 */ IF NOT app.can_edit_session(p_session_id) THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Accès refusé à cette session'');\n  END IF;');
  perform app.replace_in_function('public.trainer_proxy_sign(uuid, uuid, date, text, text, text, text, text, text, text, text)'::regprocedure, v_auth_check,
    E'/* garde chantier 2 */ IF NOT app.can_edit_session(p_session_id) THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Accès refusé à cette session'');\n  END IF;');
  perform app.replace_in_function('public.trainer_sign_halfday(uuid, uuid, date, text, text, timestamptz, text)'::regprocedure, v_auth_check,
    E'/* garde chantier 2 */ IF NOT app.can_edit_session(p_session_id) THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Accès refusé à cette session'');\n  END IF;');
  perform app.replace_in_function('public.get_trainer_sign_data(uuid)'::regprocedure, v_auth_check,
    E'/* garde chantier 2 */ IF NOT app.can_read_session(p_session_id) THEN\n    RETURN json_build_object(''ok'', false, ''error'', ''Accès refusé à cette session'');\n  END IF;');
  perform app.inject_guard('public.admin_regenerate_access_code(uuid)'::regprocedure,
    'if not app.can_edit_session((select st.session_id from public.session_trainees st where st.id = p_session_trainee_id)) then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');
  perform app.inject_guard('public.get_trainee_positioning_test(uuid, uuid)'::regprocedure,
    'if not app.can_read_session(p_session_id) then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');

  -- Données personnelles et purge : direction et gestion
  perform app.inject_guard('public.export_trainee_data(uuid)'::regprocedure, v_mgr);
  perform app.inject_guard('public.purge_trainee(uuid, text)'::regprocedure, v_mgr);
  perform app.inject_guard('public.get_purge_stats()'::regprocedure, v_mgr);

  -- Journal d'audit et déconnexion forcée : administrateurs
  perform app.inject_guard('public.get_audit_logs(text, uuid, text, text, timestamptz, timestamptz, integer)'::regprocedure,
    'perform app.require_roles(array[''superadmin'', ''admin'']);');
  perform app.inject_guard('public.admin_logout_user(text)'::regprocedure,
    'perform app.require_roles(array[''superadmin'', ''admin'']);');
  -- get_audit_logs ne répondait plus (colonnes action et entity_type en varchar, résultat déclaré en text) :
  -- l'écran du journal d'audit restait vide. Conversion explicite.
  v_def := pg_get_functiondef('public.get_audit_logs(text, uuid, text, text, timestamptz, timestamptz, integer)'::regprocedure);
  if position('al.action::text' in v_def) = 0 then
    execute replace(replace(v_def, 'al.action,', 'al.action::text,'), 'al.entity_type,', 'al.entity_type::text,');
  end if;

  -- Clients : personnel commercial
  perform app.inject_guard('public.detect_client_links(uuid)'::regprocedure,
    'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'', ''commercial'', ''comptable'', ''formateur'', ''lecture'']);');
  perform app.inject_guard('public.client_contact_sync_primary(uuid)'::regprocedure,
    'perform app.require_roles(array[''superadmin'', ''admin'', ''direction'', ''gestionnaire'', ''commercial'']);');

  -- Tableau de bord : seulement pour soi
  perform app.inject_guard('public.init_dashboard_widgets(uuid)'::regprocedure,
    'if p_user_id is distinct from auth.uid() then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');
  perform app.inject_guard('public.save_widget_configs(uuid, jsonb)'::regprocedure,
    'if p_user_id is distinct from auth.uid() then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');

  -- Interventions : le technicien ne clôt que ses visites ; la génération des visites d'un contrat
  -- est réservée à la gestion
  perform app.inject_guard('public.itv_close_visit(uuid)'::regprocedure,
    'if app.role() = ''technicien'' and p_visit not in (select app.tech_visit_ids()) then raise exception ''Accès refusé'' using errcode = ''42501''; end if;');
  perform app.inject_guard('public.itv_generate_contract_visits(uuid, integer)'::regprocedure, v_mgr);
end $$;

-- Budget : lu avec les droits de l'utilisateur (règles du budget, transactions privées comprises)
alter function public.get_budget_kpis() security invoker;

-- Données de démonstration : résumé pour la direction et la gestion seulement
create or replace function public.demo_data_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(app.role() = any (array['superadmin', 'admin', 'direction', 'gestionnaire']), false)
    then (select coalesce(jsonb_object_agg(tbl, n), '{}'::jsonb) from (select tbl, count(*) n from demo_records group by tbl) x)
    else '{}'::jsonb
  end
$$;

-- 3. Droits d'exécution ---------------------------------------------------------------------------------

do $$
declare
  r record;
  anon_ok text[] := array[
    'get_public_branding', 'get_portal_session', 'verify_trainee_access_code', 'load_trainee_data',
    'update_trainee_data', 'save_trainee_info', 'portal_set_email_refused', 'portal_sign_halfday',
    'save_evaluation', 'save_positioning_test_answers', 'portal_quiz_questions', 'portal_quiz_check',
    'portal_quiz_finish', 'portal_quiz_summary', 'portal_documents', 'portal_log_download',
    'public_reclamation_session', 'public_reclamation_submit', 'client_portal_data', 'client_portal_org',
    'published_quality_doc', 'referent_handicap_info', 'quality_demo_names_active'
  ];
  internal text[] := array[
    'cron_call_vercel', 'mailing_tick', 'signature_tick', 'signature_weekly_tick', 'social_tick',
    'decrypt_ssn', 'encrypt_ssn', 'write_halfday_signature', 'refresh_presence_complete', 'signature_refusal',
    'session_missing_signatures', 'signature_alert_mark_sent', 'signature_alerts_due', 'signature_weekly_report',
    'recompute_invoice_credits', 'generate_access_code', 'mailing_claim_next_send', 'mailing_claim_campaign_slot',
    'get_ungeo_postal_codes', 'rls_auto_enable', 'client_portal_check'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname, p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype) as is_trigger,
           -- exécutable aujourd'hui par les comptes connectés (directement ou par PUBLIC) : on ne redonne
           -- jamais une fonction qu'une migration a volontairement retirée (Passeport, suivi formatif...)
           exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.privilege_type = 'EXECUTE' and a.grantee in (0, 'authenticated'::regrole)) as auth_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and p.proname not like 'sf\_%' and p.proname <> 'save_formative_batch'
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.is_trigger or r.proname = any (internal) then
      execute format('revoke execute on function %s from authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    elsif r.auth_ok then
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
    else
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
    if r.proname = any (anon_ok) then
      execute format('grant execute on function %s to anon', r.sig);
    end if;
  end loop;
  -- Le planificateur exécute les tâches avec le rôle postgres
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('cron_call_vercel', 'mailing_tick', 'signature_tick', 'signature_weekly_tick', 'social_tick')
  loop
    execute format('grant execute on function %s to postgres', r.sig);
  end loop;
end $$;

alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

insert into public.schema_migrations (version) values ('0085_securite_fonctions') on conflict (version) do nothing;
