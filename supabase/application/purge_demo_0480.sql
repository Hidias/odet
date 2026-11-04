-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (purge_demo_0480) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0480_purge_demo_verrous.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0480_purge_demo_verrous_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0480_purge_demo_verrous.sql =====
-- 0480 : la purge des données de démonstration repasse (bloquée depuis les verrous ajoutés après 0385).
-- Constat du 04/11 (lot regles_sst_0479) : le rapport « réel / test » et donc la sortie du mode démonstration
-- échouaient : un devis fictif accepté est « signé » pour le verrou des devis (0435), et l'effacement d'une session
-- fictive met à jour une note de frais, refusée par son verrou (0454). Sans cette correction, la purge prévue à la
-- sortie du mode démonstration était impossible.
-- 1. Réglage local app.demo_purge, posé par purge_demo_data() en début de purge, pour la durée de sa transaction
--    (super administrateur seulement, comme avant).
-- 2. Devis : un devis enregistré comme fictif (demo_records) n'est pas « signé » pendant la purge ; les vrais devis
--    signés restent verrouillés, purge comprise.
-- 3. Notes de frais : le verrou laisse passer les mises à jour en cascade de la purge.
-- Le corps de la purge n'est pas recopié : la ligne qui pose le réglage est ajoutée à la version en base.
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

-- ── 1. La purge pose le réglage (ajout à la version en base, idempotent) ──
do $do$
declare
  v_src text := pg_get_functiondef('public.purge_demo_data()'::regprocedure);
begin
  if position('app.demo_purge' in v_src) = 0 then
    if position(E'\nbegin\n' in v_src) = 0 then raise exception 'purge_demo_data : début du corps introuvable'; end if;
    v_src := regexp_replace(v_src, E'\nbegin\n',
      E'\nbegin\n  -- 0480 : les verrous laissent passer la purge des données fictives\n  perform set_config(''app.demo_purge'', ''on'', true);\n', '');
    execute v_src;
  end if;
end
$do$;
revoke all on function public.purge_demo_data() from public, anon;
grant execute on function public.purge_demo_data() to authenticated;

insert into public.schema_migrations (version) values ('0480_purge_demo_verrous') on conflict (version) do nothing;
