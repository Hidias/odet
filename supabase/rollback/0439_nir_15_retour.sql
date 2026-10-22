-- Retour arrière de 0439_nir_15.sql. Idempotent.
CREATE OR REPLACE FUNCTION app.nir_complet(p text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare
  v text := upper(regexp_replace(coalesce(p, ''), '[\s.\-]', '', 'g'));
  v13 text;
  v_cle int;
begin
  if v = '' then return null; end if;
  if length(v) not in (13, 15) then return null; end if;
  v13 := left(v, 13);
  if v13 !~ '^[12][0-9]{4}([0-9]{2}|2A|2B)[0-9]{6}$' then return null; end if;
  v_cle := 97 - (replace(replace(v13, '2A', '19'), '2B', '18')::numeric % 97)::int;
  if length(v) = 15 and substr(v, 14, 2) !~ '^[0-9]{2}$' then return null; end if;
  if length(v) = 15 and substr(v, 14, 2)::int <> v_cle then return null; end if;
  return v13 || lpad(v_cle::text, 2, '0');
end
$function$;
revoke all on function app.nir_complet(text) from public, anon, authenticated;
do $do$
declare
  d text := pg_get_functiondef('app.participants_enregistrer(uuid,text,uuid,uuid,uuid,jsonb)'::regprocedure);
  avant text := $b$    if v_genre is null then
      raise exception 'Genre à indiquer pour % %', v_prenom, v_nom using errcode = '22023';
    end if;
    if v_genre not in ('female', 'male', 'non_binary') then$b$;
  apres text := $a$    if v_genre is not null and v_genre not in ('female', 'male', 'non_binary') then$a$;
begin
  if position(avant in d) = 0 then return; end if;
  execute replace(d, avant, apres);
end
$do$;
delete from public.schema_migrations where version = '0439_nir_15';
