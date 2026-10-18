-- Retour arrière des migrations 0270 à 0273 (socle multi-sociétés, chantier C1a), en une fois.
-- Retire les recopies, les fonctions, les règles et les tables des sociétés. Aucune table métier n'avait été modifiée.
-- Les lignes écrites au journal d'audit par l'accès de support sont gardées (historique).
-- Essayé en transaction annulée : supabase/tests/essai_retour_c1a_transaction_annulee.sql (écart attendu : 0).

drop trigger if exists org_modules_sync_company on public.org_modules;
drop trigger if exists profiles_sync_company_member on public.profiles;
drop trigger if exists organization_settings_sync_company on public.organization_settings;

drop table if exists app.tables_avant_societes;

drop function if exists public.my_companies();
drop function if exists public.support_trace(text[], text);
drop function if exists public.support_access_open(uuid, text, integer);
drop function if exists public.support_access_close(uuid);
drop function if exists public.company_set_support_mode(uuid, text, integer);

drop table if exists public.support_access_grants;
drop table if exists public.company_modules;
drop table if exists public.company_member_roles;
drop table if exists public.company_members;
drop table if exists public.company_establishments;
drop table if exists public.companies;

drop function if exists app.sync_owner_modules();
drop function if exists app.sync_profile_member();
drop function if exists app.sync_owner_company();
drop function if exists app.copy_settings_to_owner(public.organization_settings);
drop function if exists app.member_role(text);
drop function if exists app.companies_guard();
drop function if exists app.support_platform_tables();
drop function if exists app.is_company_admin(uuid);
drop function if exists app.company_role(uuid);
drop function if exists app.current_company();
drop function if exists app.visible_companies();
drop function if exists app.support_open(uuid);
drop function if exists app.header_company();

delete from public.schema_migrations
 where version in ('0270_societes_tables', '0271_societes_fonctions', '0272_societes_reprise', '0273_societes_regles');
