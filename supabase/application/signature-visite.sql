-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (signature-visite) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0442_signature_visite.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0442_signature_visite_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0442_signature_visite.sql =====
-- 0442 : signature du client sur place protégée (décision de H du 22/10, 14 h 11, priorité absolue).
-- Avant : la signature dessinée sur le téléphone du technicien s'écrivait directement dans la visite, sans date, sans
-- empreinte, et pouvait être remplacée en silence jusqu'à la clôture. Désormais :
--  - elle ne s'enregistre que par public.itv_visit_signer (droits de la visite vérifiés par la base) ;
--  - chaque signature laisse une preuve dans document_signatures (type « bon_intervention ») : date et heure, adresse IP
--    et appareil (lus par la base), empreinte SHA-256 de la signature et de la visite, auteur de la saisie ; cette preuve
--    ne se modifie ni ne s'efface (même règle que les signatures en ligne) ;
--  - une fois donnée, la signature ne se remplace qu'avec un motif écrit, et la précédente reste en preuve (révoquée) ;
--  - le nom du signataire suit la même règle dès que la visite est signée.
-- Additive. Idempotente. Retour arrière : supabase/rollback/0442_signature_visite_retour.sql

-- ── 1. Garde : signature et nom du signataire seulement par la fonction ──
create or replace function app.itv_signature_protegee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Écritures du système (tâches, migrations) : permises
  if (select auth.uid()) is null then return new; end if;
  if coalesce(current_setting('app.itv_signature', true), '') = new.id::text then return new; end if;
  if new.client_signature is distinct from old.client_signature then
    raise exception 'La signature du client s''enregistre par « Valider la signature » (preuve datée) : rechargez la page' using errcode = '42501';
  end if;
  if old.client_signature is not null and new.signer_name is distinct from old.signer_name then
    raise exception 'Visite signée : le nom du signataire ne se modifie plus (refaire la signature avec un motif)' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke all on function app.itv_signature_protegee() from public, anon, authenticated;
drop trigger if exists itv_visits_signature_protegee on public.itv_visits;
create trigger itv_visits_signature_protegee before update on public.itv_visits
  for each row execute function app.itv_signature_protegee();

-- ── 2. Preuve (serveur) : écrite seulement juste après l'enregistrement par la fonction, dans la même transaction ──
create or replace function app.itv_signature_preuve(p_visit uuid, p_motif text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.itv_visits;
  d_avant public.document_signatures;
  v_id uuid;
begin
  if coalesce(current_setting('app.itv_signature', true), '') <> p_visit::text then
    raise exception 'Preuve de signature : appel refusé' using errcode = '42501';
  end if;
  select * into v from public.itv_visits where id = p_visit;
  select * into d_avant from public.document_signatures
  where document_type = 'bon_intervention' and status = 'valid' and metadata ->> 'visit_id' = p_visit::text
  order by signed_at desc limit 1;
  if d_avant.id is not null then
    update public.document_signatures set status = 'revoked' where id = d_avant.id;
  end if;
  insert into public.document_signatures (document_type, client_id, signer_type, signer_name, signature_data, document_hash,
    signed_at, metadata, status, company_id)
  values ('bon_intervention', v.client_id, 'client', coalesce(nullif(btrim(v.signer_name), ''), 'Client'), v.client_signature,
    encode(sha256(convert_to(concat_ws('|', v.id::text, coalesce(v.reference, ''), coalesce(v.signer_name, ''), v.client_signature,
      coalesce(v.observations, ''), now()::text), 'UTF8')), 'hex'),
    now(),
    jsonb_strip_nulls(jsonb_build_object('document', 'Bon d''intervention signé sur place', 'canal', 'sur place',
      'visit_id', v.id, 'reference', v.reference, 'saisi_par', (select auth.uid()),
      'remplace', d_avant.id, 'motif', nullif(btrim(coalesce(p_motif, '')), ''))),
    'valid', v.company_id)
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function app.itv_signature_preuve(uuid, text) from public, anon, authenticated;
-- Appelée par public.itv_visit_signer avec les droits de l'appelant ; le schéma app n'est pas exposé par l'API et la
-- fonction refuse tout appel hors de l'enregistrement en cours (réglage local à la transaction).
grant execute on function app.itv_signature_preuve(uuid, text) to authenticated;

-- ── 3. Enregistrement de la signature (droits de l'appelant : la mise à jour passe par les règles de la visite) ──
create or replace function public.itv_visit_signer(p_visit uuid, p_signature text, p_signer text, p_motif text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.itv_visits;
  v_nom text := left(btrim(coalesce(p_signer, '')), 200);
  v_preuve uuid;
begin
  if coalesce(p_signature, '') !~ '^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$' or length(p_signature) > 600000 then
    raise exception 'Signature illisible, recommencez' using errcode = '22023';
  end if;
  select * into v from public.itv_visits where id = p_visit;
  if v.id is null then raise exception 'Visite introuvable' using errcode = 'P0002'; end if;
  if v.status = 'terminee' then raise exception 'Visite terminée : le rapport est figé' using errcode = '23514'; end if;
  if v.client_signature is not null and length(btrim(coalesce(p_motif, ''))) < 5 then
    raise exception 'La visite est déjà signée : indiquez pourquoi la signature est refaite' using errcode = '22023';
  end if;
  perform set_config('app.itv_signature', p_visit::text, true);
  update public.itv_visits set client_signature = p_signature, signer_name = coalesce(nullif(v_nom, ''), signer_name)
  where id = p_visit
  returning * into v;
  if v.id is null then raise exception 'Droit insuffisant sur cette visite' using errcode = '42501'; end if;
  v_preuve := app.itv_signature_preuve(p_visit, p_motif);
  perform set_config('app.itv_signature', '', true);
  return jsonb_build_object('ok', true, 'preuve', v_preuve, 'signed_at', now());
end
$$;
revoke all on function public.itv_visit_signer(uuid, text, text, text) from public, anon;
grant execute on function public.itv_visit_signer(uuid, text, text, text) to authenticated;

-- ── 4. Preuve lisible avec la visite (date, IP, empreinte), sans la signature elle-même ──
create or replace function public.itv_visit_preuve_signature(p_visit uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v public.itv_visits;
begin
  select * into v from public.itv_visits where id = p_visit;
  -- Mêmes lecteurs que la visite
  if v.id is null or not (app.is_superadmin() or app.a_le_droit('interventions.visites.voir')
     or (app.a_le_droit('interventions.missions.voir') and v.client_id in (select app.tech_client_ids()))) then
    return null;
  end if;
  return (select jsonb_build_object('signed_at', d.signed_at, 'signer_name', d.signer_name, 'ip_address', d.ip_address,
      'document_hash', d.document_hash, 'refaite', (select count(*) from public.document_signatures r
        where r.document_type = 'bon_intervention' and r.metadata ->> 'visit_id' = p_visit::text and r.status = 'revoked'))
    from public.document_signatures d
    where d.document_type = 'bon_intervention' and d.status = 'valid' and d.metadata ->> 'visit_id' = p_visit::text
    order by d.signed_at desc limit 1);
end
$$;
revoke all on function public.itv_visit_preuve_signature(uuid) from public, anon;
grant execute on function public.itv_visit_preuve_signature(uuid) to authenticated;

-- ── 5. Preuve figée : la signature du client recueillie sur place ne s'efface pas non plus ──
-- (app.signature_client_figee protège déjà les signatures « client » rattachées à un client existant)

insert into public.schema_migrations (version) values ('0442_signature_visite') on conflict (version) do nothing;
