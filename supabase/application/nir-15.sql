-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (nir-15) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0439_nir_15.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0439_nir_15_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0439_nir_15.sql =====
-- 0439 : n° de sécurité sociale et genre (décision de H du 22/10, 12 h 54).
--  - app.nir_complet n'accepte plus que les 15 caractères (13 + clé), et les numéros provisoires (7 ou 8) ;
--  - le genre de chaque participant saisi par le client devient obligatoire.
-- Fonctions seulement. Idempotente. Retour arrière : supabase/rollback/0439_nir_15_retour.sql

create or replace function app.nir_complet(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := upper(regexp_replace(coalesce(p, ''), '[\s.\-_]', '', 'g'));
  v13 text;
begin
  if length(v) <> 15 then return null; end if;
  v13 := left(v, 13);
  if v13 !~ '^[1278][0-9]{4}([0-9]{2}|2A|2B)[0-9]{6}$' or substr(v, 14, 2) !~ '^[0-9]{2}$' then return null; end if;
  if substr(v, 14, 2)::int <> 97 - (replace(replace(v13, '2A', '19'), '2B', '18')::numeric % 97)::int then return null; end if;
  return v;
end
$$;
revoke all on function app.nir_complet(text) from public, anon, authenticated;

do $do$
declare
  d text := pg_get_functiondef('app.participants_enregistrer(uuid,text,uuid,uuid,uuid,jsonb)'::regprocedure);
  avant text := $a$    if v_genre is not null and v_genre not in ('female', 'male', 'non_binary') then$a$;
  apres text := $b$    if v_genre is null then
      raise exception 'Genre à indiquer pour % %', v_prenom, v_nom using errcode = '22023';
    end if;
    if v_genre not in ('female', 'male', 'non_binary') then$b$;
begin
  if position('Genre à indiquer' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, avant, ''))) / length(avant) <> 1 then raise exception 'Contrôle du genre introuvable'; end if;
  execute replace(d, avant, apres);
end
$do$;

insert into public.schema_migrations (version) values ('0439_nir_15') on conflict (version) do nothing;
