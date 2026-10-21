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
-- déjà faites gardent ce qui a été relevé (rien n'est réécrit). La purge des données de test efface aussi les signatures
-- de ses sessions de test. Idempotent.

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

-- La purge des données de test efface aussi les signatures de ses sessions de test : une signature du client ne
-- s'efface toujours pas, sauf si sa session est une donnée de test (ou n'existe plus)
create or replace function app.signature_client_figee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.signer_type = 'client' and old.session_id is not null
       and exists (select 1 from public.sessions s where s.id = old.session_id)
       and not exists (select 1 from public.demo_records r where r.tbl = 'sessions' and r.id = old.session_id) then
      raise exception 'Signature du client : elle ne s''efface pas' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.signer_type = 'client' and (
       new.signature_data is distinct from old.signature_data or new.document_hash is distinct from old.document_hash
    or new.signed_at is distinct from old.signed_at or new.ip_address is distinct from old.ip_address
    or new.user_agent is distinct from old.user_agent or new.signer_name is distinct from old.signer_name
    or new.signer_role is distinct from old.signer_role or new.document_type is distinct from old.document_type
    or new.session_id is distinct from old.session_id or new.metadata is distinct from old.metadata) then
    raise exception 'Signature du client : elle ne se modifie pas' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.signature_client_figee() from public, anon, authenticated;

insert into public.schema_migrations (version) values ('0405_appareil_complet') on conflict (version) do nothing;
