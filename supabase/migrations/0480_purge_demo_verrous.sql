-- 0480 : la purge des données de démonstration repasse (bloquée depuis les verrous ajoutés après 0385).
-- Constat du 04/11 (lot regles_sst_0479) : le rapport « réel / test » et donc la sortie du mode démonstration
-- échouaient : un devis fictif accepté est « signé » pour le verrou des devis (0435), et l'effacement d'une session
-- fictive met à jour une note de frais, refusée par son verrou (0454). Sans cette correction, la purge prévue à la
-- sortie du mode démonstration était impossible.
-- 1. Réglage app.demo_purge, actif seulement pendant l'exécution de purge_demo_data() (super administrateur
--    seulement, comme avant) : rien ne reste ouvert après la purge.
-- 2. Devis : un devis enregistré comme fictif (demo_records) n'est pas « signé » pendant la purge ; les vrais devis
--    signés restent verrouillés, purge comprise.
-- 3. Notes de frais : le verrou laisse passer les mises à jour en cascade de la purge.
-- Le corps de la purge n'est pas recopié : il est renommé et appelé tel quel.
-- Retour arrière : supabase/rollback/0480_purge_demo_verrous_retour.sql

-- ── 2. Devis fictifs pendant la purge ──
create or replace function app.devis_signe(p_quote uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.quotes q
    where q.id = p_quote and q.status in ('accepted', 'partial', 'invoiced', 'replaced')
      and (q.signature_base64 is not null
        or exists (select 1 from public.document_signatures d
                   where d.status = 'valid' and d.signer_type = 'client' and d.metadata ->> 'object_id' = q.id::text)
        or exists (select 1 from public.client_deposits cd
                   where cd.object_type = 'quote' and cd.object_id = q.id and cd.status = 'valide'))
      and not (coalesce(current_setting('app.demo_purge', true), '') = 'on'
               and exists (select 1 from public.demo_records r where r.tbl = 'quotes' and r.id = q.id)))
$$;

-- ── 3. Notes de frais ──
create or replace function app.frais_garde()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Purge des données de démonstration (0480) : les effacements en cascade passent
  if coalesce(current_setting('app.demo_purge', true), '') = 'on' then return new; end if;
  if (new.company_id, new.trainer_id, new.session_id, new.spent_on, new.category, new.amount_ttc, new.km, new.description, new.receipt_path, new.created_by, new.created_at)
     is distinct from (old.company_id, old.trainer_id, old.session_id, old.spent_on, old.category, old.amount_ttc, old.km, old.description, old.receipt_path, old.created_by, old.created_at) then
    raise exception 'Une note de frais déclarée ne se modifie pas : refusez-la avec un motif' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'soumise' and new.status in ('validee', 'refusee', 'annulee'))
         or (old.status = 'validee' and new.status in ('remboursee', 'soumise'))
         or (old.status = 'refusee' and new.status = 'soumise')) then
      raise exception 'Passage impossible de « % » à « % »', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'refusee' and length(btrim(coalesce(new.decision_note, ''))) < 3 then
      raise exception 'Indiquez le motif du refus' using errcode = '23514';
    end if;
    if new.status = 'remboursee' and new.paid_on is null then new.paid_on := public.paris_today(); end if;
    if new.status = 'soumise' then new.decided_by := null; new.decided_at := null; new.paid_on := null;
    else new.decided_by := (select auth.uid()); new.decided_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function app.frais_garde() from public, anon, authenticated;

-- ── 1. La purge pose le réglage, pour sa seule durée ──
-- Le corps existant devient app.purge_demo_data_corps() (inchangé, plus appelable directement) ; purge_demo_data()
-- l'appelle entre la pose et le retrait du réglage. Une future modification de la purge se fait dans le corps.
do $do$
begin
  if to_regprocedure('app.purge_demo_data_corps()') is null then
    alter function public.purge_demo_data() rename to purge_demo_data_corps;
    alter function public.purge_demo_data_corps() set schema app;
  end if;
end
$do$;
revoke all on function app.purge_demo_data_corps() from public, anon, authenticated;

create or replace function public.purge_demo_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform set_config('app.demo_purge', 'on', true);
  v := app.purge_demo_data_corps();
  perform set_config('app.demo_purge', '', true);
  return v;
end
$$;
comment on function public.purge_demo_data() is 'Purge des données fictives : pose app.demo_purge le temps de app.purge_demo_data_corps() (0480)';
revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

insert into public.schema_migrations (version) values ('0480_purge_demo_verrous') on conflict (version) do nothing;
