-- Retour arrière de 0345_journal_audit.sql : retire le déclencheur des tables sensibles, la garde à l'écriture et les
-- colonnes ajoutées ; log_audit revient à sa version d'origine (0001). Idempotent.
-- Les lignes écrites par la base (source « base ») et celles d'un type d'objet inconnu de l'ancienne liste sont
-- retirées (l'ancienne contrainte les refuserait) : ce retour arrière efface donc la partie du journal écrite depuis 0345.

do $$
declare r record;
begin
  for r in select tgrelid::regclass as t from pg_trigger where tgname = 'zz_audit_row' and not tgisinternal loop
    execute format('drop trigger if exists zz_audit_row on %s', r.t);
  end loop;
end $$;
drop function if exists app.audit_row();
drop trigger if exists audit_logs_garde on public.audit_logs;
drop function if exists app.audit_logs_garde();
drop function if exists app.audit_entete(text);

create or replace function public.log_audit(p_user_id uuid, p_user_email text, p_action text, p_entity_type text,
  p_entity_id uuid default null::uuid, p_entity_name text default null::text, p_details jsonb default null::jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit_logs (
    user_id, user_email, action, entity_type, 
    entity_id, entity_name, details
  ) VALUES (
    p_user_id, p_user_email, p_action, p_entity_type,
    p_entity_id, p_entity_name, p_details
  )
  RETURNING id INTO v_id;
  
  RETURN v_id;
END;
$function$;
revoke all on function public.log_audit(uuid, text, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.log_audit(uuid, text, text, text, uuid, text, jsonb) to authenticated, service_role;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'source') then
    execute 'delete from public.audit_logs where source = ''base''';
  end if;
end $$;
delete from public.audit_logs where entity_type not in ('trainee', 'session', 'client', 'trainer', 'course', 'document', 'nc', 'veille', 'evaluation', 'attendance', 'system');
alter table public.audit_logs drop constraint if exists audit_logs_entity_type_check;
alter table public.audit_logs add constraint audit_logs_entity_type_check check (((entity_type)::text = any (array[('trainee'::character varying)::text, ('session'::character varying)::text, ('client'::character varying)::text, ('trainer'::character varying)::text, ('course'::character varying)::text, ('document'::character varying)::text, ('nc'::character varying)::text, ('veille'::character varying)::text, ('evaluation'::character varying)::text, ('attendance'::character varying)::text, ('system'::character varying)::text])));
alter table public.audit_logs drop constraint if exists audit_logs_source_check;
drop index if exists public.audit_logs_company_temps_idx;
alter table public.audit_logs drop column if exists source;
alter table public.audit_logs drop column if exists actor_role;

delete from public.schema_migrations where version = '0345_journal_audit';
