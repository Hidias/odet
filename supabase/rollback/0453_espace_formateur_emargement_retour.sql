-- Retour arrière de 0453_espace_formateur_emargement.sql. Idempotent. Refusé s'il existe des signatures de formateur
-- (ce sont des preuves d'émargement : elles seraient perdues).
do $do$
begin
  if to_regclass('public.trainer_halfday_signatures') is not null and exists (select 1 from public.trainer_halfday_signatures) then
    raise exception 'Des signatures de formateur existent : retour arrière refusé';
  end if;
end
$do$;

-- Gardes d'avant 0453 sur la feuille de signature
do $do$
declare
  r record;
  v_def text;
begin
  for r in select * from (values
      ('public.get_trainer_sign_data(uuid)', 'IF NOT app.can_read_session(p_session_id) THEN',
       'IF NOT (app.can_read_session(p_session_id) OR app.ext_formateur_de(p_session_id)) /* 0453 */ THEN'),
      ('public.trainer_sign_halfday(uuid, uuid, date, text, text, timestamptz, text)', 'IF NOT app.can_edit_session(p_session_id) THEN',
       'IF NOT (app.can_edit_session(p_session_id) OR app.ext_formateur_de(p_session_id)) /* 0453 */ THEN'),
      ('public.trainer_proxy_sign(uuid, uuid, date, text, text, text, text, text, text, text, text)', 'IF NOT app.can_edit_session(p_session_id) THEN',
       'IF NOT (app.can_edit_session(p_session_id) OR app.ext_formateur_de(p_session_id)) /* 0453 */ THEN')
    ) as t(sig, ancien, nouveau) loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    if position(r.nouveau in v_def) > 0 then
      execute replace(v_def, r.nouveau, r.ancien);
    end if;
  end loop;
end
$do$;

drop function if exists public.formateur_signer(uuid, date, text, text, timestamptz);
drop function if exists public.formateur_signatures(uuid);
drop function if exists app.formateur_de_session(uuid);
drop function if exists app.ext_formateur_de(uuid);
drop table if exists public.trainer_halfday_signatures;
delete from public.schema_migrations where version = '0453_espace_formateur_emargement';
