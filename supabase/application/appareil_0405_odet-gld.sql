-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (appareil_0405) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur odet-gld : 0405_appareil_complet.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0405_appareil_complet_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0405_appareil_complet.sql =====
-- 0405 : l'appareil d'une signature est gardé en entier.
-- La lecture des en-têtes de la requête (0346) coupait à la première virgule, utile pour l'adresse IP (liste
-- « client, relais ») mais fausse pour l'appareil : « Mozilla/5.0 (Macintosh; …) AppleWebKit/537.36 (KHTML » au lieu de
-- l'identifiant complet, d'où « navigateur, Mac » sur le dossier de preuve. L'appareil est désormais lu en entier pour
-- les signatures (stagiaires, formateurs, clients) et pour le journal des signatures de l'espace client. Les signatures
-- déjà faites gardent ce qui a été relevé (rien n'est réécrit). Idempotent.

create or replace function app.entete_complet(p_nom text)
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(left(btrim(coalesce((nullif(current_setting('request.headers', true), '')::jsonb) ->> p_nom, '')), 400), '')
$$;
revoke all on function app.entete_complet(text) from public, anon, authenticated;

create or replace function app.signature_ip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.ip_address := coalesce(app.audit_entete('x-forwarded-for'), app.audit_entete('x-real-ip'), nullif(new.ip_address, 'unknown'));
  new.user_agent := coalesce(app.entete_complet('user-agent'), new.user_agent);
  return new;
end
$$;
revoke all on function app.signature_ip() from public, anon, authenticated;

-- Journal des signatures de l'espace client (0402) : même lecture complète
do $patch$
declare
  v_def text := pg_get_functiondef('app.portail_signer(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text,text)'::regprocedure);
  v_anc text := $a$left(app.audit_entete('user-agent'), 400)$a$;
  v_nouv text := $n$left(app.entete_complet('user-agent'), 400)$n$;
begin
  if position(v_nouv in v_def) > 0 then return; end if;
  if position(v_anc in v_def) = 0 then raise exception 'portail_signer : lecture de l''appareil introuvable, rien n''est modifié'; end if;
  execute replace(v_def, v_anc, v_nouv);
end
$patch$;

insert into public.schema_migrations (version) values ('0405_appareil_complet') on conflict (version) do nothing;
