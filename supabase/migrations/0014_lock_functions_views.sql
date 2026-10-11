-- 0014_lock_functions_views.sql : fonctions et vues accessibles aux visiteurs non connectés.
-- Avant : toutes les fonctions SECURITY DEFINER (déchiffrement du n° de sécurité sociale,
-- export et purge de stagiaires...) étaient appelables avec la seule clé publique.
-- Après : les visiteurs n'appellent que les fonctions du portail, de la marque et du formulaire de réclamation.

do $$
declare
  r record;
  allow text[] := array[
    'get_public_branding', 'get_portal_session', 'verify_trainee_access_code', 'load_trainee_data',
    'update_trainee_data', 'save_trainee_info', 'portal_set_email_refused', 'portal_sign_halfday',
    'save_evaluation', 'save_positioning_test_answers', 'portal_quiz_questions', 'portal_quiz_check',
    'portal_quiz_finish', 'portal_quiz_summary', 'is_admin', 'is_superadmin', 'current_profile_role'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    if r.proname = any(allow) then
      execute format('grant execute on function %s to anon', r.sig);
    end if;
  end loop;

  -- Les vues appliquent désormais les droits de l'utilisateur qui les interroge
  for r in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', r.relname);
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;
end $$;

-- Les nouvelles fonctions ne sont plus exécutables par tous par défaut
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;

insert into public.schema_migrations (version) values ('0014_lock_functions_views') on conflict (version) do nothing;
