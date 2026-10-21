-- 0025_reference_session_prefixe.sql : la référence automatique des sessions utilisait le préfixe « AF- »
-- (de l'organisme d'origine) écrit en dur. Le préfixe vient désormais des paramètres (organization_settings.doc_prefix),
-- « SES » à défaut. Format inchangé : {PRÉFIXE}-{CODE FORMATION}-{AAMMJJ}-{NNN}.

create or replace function public.generate_session_reference_v3()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_prefix text;
  v_course_code text;
  v_date_str text;
  v_counter integer;
begin
  select nullif(trim(doc_prefix), '') into v_prefix from organization_settings limit 1;
  v_prefix := upper(coalesce(v_prefix, 'SES'));

  select code into v_course_code from courses where id = new.course_id;
  if v_course_code is null or v_course_code = '' then
    v_course_code := 'FORM';
  end if;

  v_date_str := to_char(new.start_date, 'YYMMDD');

  select coalesce(max(cast(substring(reference from '-(\d{3})$') as integer)), 0) + 1
    into v_counter
  from sessions
  where reference like v_prefix || '-' || v_course_code || '-' || v_date_str || '-%';

  new.reference := v_prefix || '-' || v_course_code || '-' || v_date_str || '-' || lpad(v_counter::text, 3, '0');
  return new;
end;
$function$;

-- Sessions déjà créées avec l'ancien préfixe
update public.sessions s
   set reference = coalesce((select upper(nullif(trim(doc_prefix), '')) from organization_settings limit 1), 'SES') || substring(s.reference from 3)
 where s.reference like 'AF-%';

insert into public.schema_migrations (version) values ('0025_reference_session_prefixe') on conflict (version) do nothing;
