-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (signataire_0496) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0496_signataire_prevu.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0496_signataire_prevu_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0496_signataire_prevu.sql =====
-- 0496 : espace client, signataire prévu proposé à la signature d'un document (reste du 05/11, décision de H du 06/11).
-- Dans l'espace ouvert par lien et code, le nom du signataire était un champ vide et libre, même quand le document
-- imprime « Représenté par » une autre personne. La base donne désormais le signataire prévu par le document lui-même,
-- jamais un nom envoyé par le navigateur : pour la convention ou le contrat d'un groupe inter (object_type
-- 'session_group'), le contact choisi dans le groupe (même client), ou le particulier. Rien pour les autres documents.
-- Le signataire est figé à la publication du document (colonne client_shared_documents.signataire_prevu, remplie
-- par un déclencheur à l'insertion) : changer ensuite le contact du groupe ne change pas ce que le PDF publié imprime,
-- donc pas non plus le nom proposé ni ce que la preuve écrit. Groupe annulé : rien proposé.
-- L'écran pré-remplit ce nom, modifiable ; un nom différent est signalé et écrit dans la preuve.
-- Aucune donnée existante touchée (0 document de groupe publié en production le 06/11).

alter table public.client_shared_documents add column if not exists signataire_prevu jsonb;

-- Signataire d'un groupe, calculé comme l'écran (conventionGroupe.js, signataireDuGroupe) : le particulier, ou le
-- contact choisi dans le groupe s'il appartient au client du groupe ; null sans nom
create or replace function app.signataire_du_groupe(p_group uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when r->>'name' is not null and r->>'name' <> '' then r end
  from (
    select case when g.kind = 'particulier'
      then jsonb_build_object('name', btrim(coalesce(cl.name, '')), 'role', '')
      else (
        select jsonb_build_object(
          'name', coalesce(nullif(btrim(c.name), ''), btrim(concat_ws(' ', nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')))),
          'role', btrim(coalesce(nullif(btrim(c.fonction), ''), c.role, '')))
        from public.client_contacts c
        where c.id = g.contact_id and c.client_id = g.client_id)
      end as r
    from public.session_groups g
    join public.clients cl on cl.id = g.client_id
    where g.id = p_group
  ) x
$$;
revoke all on function app.signataire_du_groupe(uuid) from public, anon, authenticated;

-- Figé à la publication : le document publié ne se modifie plus ensuite (seul le retrait est possible)
create or replace function app.document_signataire_prevu()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.object_type = 'session_group' then
    new.signataire_prevu := app.signataire_du_groupe(new.object_id);
  else
    new.signataire_prevu := null;
  end if;
  return new;
end
$$;
revoke all on function app.document_signataire_prevu() from public, anon, authenticated;
drop trigger if exists client_shared_documents_signataire_prevu on public.client_shared_documents;
create trigger client_shared_documents_signataire_prevu before insert on public.client_shared_documents
  for each row execute function app.document_signataire_prevu();

-- Lecture : le signataire figé du document, pour ce client, document actif, groupe non annulé
create or replace function app.signataire_prevu(p_client uuid, p_document uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select d.signataire_prevu
    from public.client_shared_documents d
    join public.session_groups g on g.id = d.object_id
    where d.id = p_document and d.client_id = p_client and d.object_type = 'session_group'
      and d.withdrawn_at is null and g.client_id = p_client and g.status is distinct from 'cancelled'
  ), '{}'::jsonb)
$$;
revoke all on function app.signataire_prevu(uuid, uuid) from public, anon, authenticated;

-- Espace par lien et code
create or replace function public.client_portal_signataire_prevu(p_token text, p_code text, p_document uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check jsonb := public.client_portal_check(p_token, p_code);
begin
  if v_check ? 'error' then return v_check; end if;
  return app.signataire_prevu((v_check->>'client_id')::uuid, p_document);
end
$$;
revoke all on function public.client_portal_signataire_prevu(text, text, uuid) from public;
grant execute on function public.client_portal_signataire_prevu(text, text, uuid) to anon, authenticated;

-- Espace avec compte
create or replace function public.ent_signataire_prevu(p_document uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.client_accounts := app.ent_compte();
begin
  return app.signataire_prevu(v.client_id, p_document);
end
$$;
revoke all on function public.ent_signataire_prevu(uuid) from public, anon;
grant execute on function public.ent_signataire_prevu(uuid) to authenticated;

insert into public.schema_migrations (version) values ('0496_signataire_prevu') on conflict (version) do nothing;
