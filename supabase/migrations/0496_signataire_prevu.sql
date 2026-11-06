-- 0496 : espace client, signataire prévu proposé à la signature d'un document (reste du 05/11, décision de H du 06/11).
-- Dans l'espace ouvert par lien et code, le nom du signataire était un champ vide et libre, même quand le document
-- imprime « Représenté par » une autre personne. La base donne désormais le signataire prévu par le document lui-même,
-- jamais un nom envoyé par le navigateur : pour la convention ou le contrat d'un groupe inter (object_type
-- 'session_group'), le contact choisi dans le groupe (même client), ou le particulier. Rien pour les autres documents.
-- L'écran pré-remplit ce nom, modifiable ; un nom différent est signalé et écrit dans la preuve.
-- Trois fonctions ajoutées, en lecture seule ; aucune donnée touchée.

create or replace function app.signataire_prevu(p_client uuid, p_document uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
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
      from public.client_shared_documents d
      join public.session_groups g on g.id = d.object_id
      join public.clients cl on cl.id = g.client_id
      where d.id = p_document and d.client_id = p_client and d.object_type = 'session_group'
        and d.withdrawn_at is null and g.client_id = p_client
    ) x
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
