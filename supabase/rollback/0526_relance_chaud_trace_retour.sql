-- Retour arrière de 0526 : refusé s'il existe déjà des relances tracées (les effacer d'abord serait perdre des preuves).
begin;
do $$ begin
  if exists (select 1 from public.session_emails_sent where email_type in ('relance_chaud', 'demande_nir')) then
    raise exception 'Des relances « relance_chaud » sont tracées : retour arrière refusé';
  end if;
end $$;
alter table public.session_emails_sent drop constraint if exists session_emails_sent_email_type_check;
alter table public.session_emails_sent add constraint session_emails_sent_email_type_check
  check (email_type::text = any (array['before', 'after']));
delete from public.schema_migrations where version = '0526_relance_chaud_trace';
commit;
