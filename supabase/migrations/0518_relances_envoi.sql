-- 0518 : envoi des relances depuis l'outil (demande de H du 08/11, 14 h 36 ; option A choisie le 08/11, lot 1).
-- Jusqu'ici une relance validée se copiait dans sa messagerie, puis se marquait « envoyée » à la main. Désormais une
-- relance qui porte un vrai message part depuis l'outil, après aperçu, par la boîte de la personne connectée
-- (signature et copie cachée habituelles) :
--   1. app.relance_envoyable(kind, payload) : seule règle de ce qui peut partir. Jamais une note interne (« interne »),
--      un courrier dont le texte attend l'expert (« a_valider_par_expert »), ni une étape du pilote qui se fait depuis la
--      session (convocations, attestations, émargement, évaluations, facture : le texte est une consigne pour l'équipe),
--      ni la mise en demeure (lettre recommandée, texte à faire relire par l'expert avant le premier envoi, 0470).
--      Colonne calculée envoi_possible, lue par l'écran ; si la règle change un jour, recalculer les lignes existantes
--      (update ... set kind = kind). La fonction doit rester exécutable par authenticated et service_role : la colonne
--      calculée l'appelle à chaque écriture, avec les droits de celui qui écrit.
--   2. scheduled_actions : texte_retouche (objet, texte ou destinataire changés par une personne avant validation ; sert
--      au lot suivant, qui proposera le passage en automatique après 5 envois sans retouche d'un même type, sans jamais
--      basculer seul) ; envoi_reserve_at et envoi_reserve_par (envoi en cours) ; envoi_boite et envoi_message_id (trace).
--      Ces colonnes ne s'écrivent que par les fonctions ci-dessous. Une relance validée ne change plus de texte ni de
--      destinataire : on la remet à valider pour la corriger.
--   3. public.relance_envoi_reserver(id, destinataire, validée le) (compte) : relance « à envoyer », envoyable, non
--      bloquée, droit d'envoyer aux stagiaires et aux clients dans sa société, adresse valable et identique à celle vue à
--      l'aperçu, validée au même moment que lors de l'aperçu (sinon le texte a pu changer), texte
--      présent, aucun envoi précédent en suspens. Un envoi resté sans suite (coupure entre le mail et sa trace) n'est
--      jamais repris seul : après 10 minutes, la personne vérifie sa boîte, puis marque la relance envoyée ou la remet
--      à valider, ce qui lève la réservation.
--   4. public.relance_envoi_terminer(id, auteur, ok, ...) (clé de service seule, appelée par la route après l'envoi) :
--      envoyée (auteur = celui qui a réservé) ou erreur notée, la relance reste « à envoyer ».
-- « Marquer envoyée » reste possible (envoi fait depuis sa messagerie). Aucun envoi automatique.
-- Migration additive. Idempotente. Retour arrière : supabase/rollback/0518_relances_envoi_retour.sql

create or replace function app.relance_envoyable(p_kind text, p_payload jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_kind in ('relance_recyclage', 'justificatif_prestataire', 'rappel', 'relance_impaye', 'avis_financeur',
                             'renouvellement_contrat', 'visite_hors_contrat', 'autre'), false)
     and coalesce((p_payload->>'interne')::boolean, false) = false
     and coalesce((p_payload->>'a_valider_par_expert')::boolean, false) = false
     and coalesce(p_payload->>'etape', '') not in ('convocation', 'attestations', 'emargement', 'eval_chaud', 'eval_froid', 'facture', 'mise_en_demeure')
$$;

alter table public.scheduled_actions add column if not exists texte_retouche boolean not null default false;
alter table public.scheduled_actions add column if not exists envoi_reserve_at timestamptz;
alter table public.scheduled_actions add column if not exists envoi_reserve_par uuid;
alter table public.scheduled_actions add column if not exists envoi_boite text;
alter table public.scheduled_actions add column if not exists envoi_message_id text;
alter table public.scheduled_actions add column if not exists envoi_possible boolean
  generated always as (app.relance_envoyable(kind, payload)) stored;

comment on column public.scheduled_actions.texte_retouche is 'Objet, texte ou destinataire changés par une personne avant l''envoi (0518).';
comment on column public.scheduled_actions.envoi_reserve_at is 'Envoi depuis l''outil commencé à cette heure, sans trace de fin (0518).';
comment on column public.scheduled_actions.envoi_possible is 'La relance porte un vrai message, envoyable depuis l''outil (0518, app.relance_envoyable).';

-- 1. Règle des colonnes d'envoi, du texte figé et de la retouche (déclencheur d'avant)
create or replace function app.scheduled_actions_envoi_garde()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_par_fonction boolean := coalesce(current_setting('app.relance_envoi', true), '') = 'on';
  -- Personne qui écrit directement (pas une règle déclenchée par une autre écriture, comme le règlement d'une facture)
  v_personne boolean := (select auth.uid()) is not null and pg_trigger_depth() = 1;
  v_texte_change boolean := (new.payload->>'objet') is distinct from (old.payload->>'objet')
    or (new.payload->>'texte') is distinct from (old.payload->>'texte')
    or (new.payload->>'destinataire') is distinct from (old.payload->>'destinataire');
begin
  if v_par_fonction then return new; end if;
  new.envoi_reserve_at := old.envoi_reserve_at;
  new.envoi_reserve_par := old.envoi_reserve_par;
  new.envoi_boite := old.envoi_boite;
  new.envoi_message_id := old.envoi_message_id;
  new.texte_retouche := old.texte_retouche;
  if v_personne then
    -- Envoi en cours (moins de 10 minutes) : l'état ne change que par la fin de l'envoi
    if old.envoi_reserve_at is not null and old.envoi_reserve_at > now() - interval '10 minutes'
       and new.status is distinct from old.status then
      raise exception 'Envoi en cours : attendez la fin de l''envoi' using errcode = '22023';
    end if;
    -- Nature de la relance (consigne interne, courrier à faire relire, étape du pilote) : posée par la base seulement
    new.payload := (coalesce(new.payload, '{}'::jsonb) - 'interne' - 'a_valider_par_expert' - 'etape')
      || jsonb_strip_nulls(jsonb_build_object('interne', old.payload->'interne',
           'a_valider_par_expert', old.payload->'a_valider_par_expert', 'etape', old.payload->'etape'));
    -- Ce qui a été validé est ce qui part : pour corriger, remettre à valider
    if (v_texte_change or new.title is distinct from old.title) and old.status <> 'a_valider' then
      raise exception 'Relance déjà validée : remettez-la à valider pour changer le texte ou le destinataire' using errcode = '22023';
    end if;
    if v_texte_change then new.texte_retouche := true; end if;
  end if;
  -- Changement d'état par une personne (envoi suspendu vérifié) ou par la base (règlement d'une facture...) :
  -- la réservation tombe ; une fin d'envoi arrivée ensuite est refusée (la relance n'est plus « à envoyer »)
  if new.status is distinct from old.status then
    new.envoi_reserve_at := null;
    new.envoi_reserve_par := null;
  end if;
  return new;
end
$$;

drop trigger if exists scheduled_actions_envoi_garde on public.scheduled_actions;
create trigger scheduled_actions_envoi_garde before update on public.scheduled_actions
  for each row execute function app.scheduled_actions_envoi_garde();

-- 2. Réservation (compte de la personne qui envoie)
create or replace function public.relance_envoi_reserver(p_id uuid, p_destinataire text, p_valide_le timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare a public.scheduled_actions;
begin
  if (select auth.uid()) is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  select * into a from public.scheduled_actions where id = p_id for update;
  if not found or a.company_id not in (select app.societes_avec_droit('formation.convocations.envoyer')) then
    raise exception 'Relance introuvable, ou droit d''envoyer aux stagiaires et aux clients requis' using errcode = '42501';
  end if;
  if a.status <> 'valide' then
    raise exception 'Cette relance n''est plus à envoyer : la liste est mise à jour' using errcode = '22023';
  end if;
  if not a.envoi_possible then
    raise exception 'Cette relance ne s''envoie pas depuis l''outil : faites l''action indiquée, puis marquez-la' using errcode = '22023';
  end if;
  if a.blocked_reason is not null then
    raise exception 'Relance bloquée : %', a.blocked_reason using errcode = '22023';
  end if;
  if a.envoi_reserve_at is not null then
    if a.envoi_reserve_at > now() - interval '10 minutes' then
      raise exception 'Envoi déjà en cours pour cette relance' using errcode = '22023';
    end if;
    raise exception 'Envoi précédent sans suite : vérifiez dans votre boîte d''envoi s''il est parti, puis marquez la relance envoyée ou remettez-la à valider' using errcode = '22023';
  end if;
  if not app.financeur_email_valide(a.payload->>'destinataire') then
    raise exception 'Adresse du destinataire absente ou invalide' using errcode = '22023';
  end if;
  if lower(btrim(a.payload->>'destinataire')) is distinct from lower(btrim(p_destinataire)) then
    raise exception 'Le destinataire a changé depuis l''aperçu : la liste est mise à jour' using errcode = '22023';
  end if;
  -- Validée de nouveau depuis l'aperçu (texte peut-être changé entre-temps) : nouvel aperçu
  if a.validated_at is distinct from p_valide_le then
    raise exception 'La relance a été modifiée depuis l''aperçu : ouvrez de nouveau « Voir le mail »' using errcode = '22023';
  end if;
  if coalesce(btrim(a.payload->>'texte'), '') = '' then
    raise exception 'Texte vide : rien à envoyer' using errcode = '22023';
  end if;
  perform set_config('app.relance_envoi', 'on', true);
  update public.scheduled_actions set envoi_reserve_at = now(), envoi_reserve_par = (select auth.uid()), error = null where id = a.id;
  perform set_config('app.relance_envoi', '', true);
  return jsonb_build_object('id', a.id, 'company_id', a.company_id, 'kind', a.kind,
    'destinataire', btrim(a.payload->>'destinataire'),
    'objet', coalesce(nullif(btrim(a.payload->>'objet'), ''), a.title),
    'texte', a.payload->>'texte');
end
$$;

-- 3. Fin de l'envoi (clé de service seule : la route, après l'envoi réel du mail)
create or replace function public.relance_envoi_terminer(p_id uuid, p_auteur uuid, p_ok boolean, p_erreur text default null,
  p_message_id text default null, p_boite text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare a public.scheduled_actions;
begin
  select * into a from public.scheduled_actions where id = p_id for update;
  -- Second appel après une réponse perdue : déjà noté
  if found and p_ok and a.status = 'envoye' and a.sent_by is not distinct from p_auteur and p_message_id is not null
     and a.envoi_message_id is not distinct from left(p_message_id, 500) then
    return;
  end if;
  if not found or a.envoi_reserve_at is null or a.status <> 'valide' or a.envoi_reserve_par is distinct from p_auteur then
    raise exception 'Aucun envoi en cours pour cette relance' using errcode = '22023';
  end if;
  perform set_config('app.relance_envoi', 'on', true);
  if p_ok then
    update public.scheduled_actions set status = 'envoye', error = null, envoi_reserve_at = null, envoi_reserve_par = null,
      envoi_boite = left(p_boite, 320), envoi_message_id = left(p_message_id, 500)
     where id = a.id;
    -- Auteur : la personne qui a réservé (la règle d'état pose l'utilisateur connecté, absent ici)
    update public.scheduled_actions set sent_by = p_auteur where id = a.id;
  else
    update public.scheduled_actions set envoi_reserve_at = null, envoi_reserve_par = null,
      error = left(coalesce(nullif(btrim(p_erreur), ''), 'Échec de l''envoi'), 300)
     where id = a.id;
  end if;
  perform set_config('app.relance_envoi', '', true);
end
$$;

revoke all on function app.relance_envoyable(text, jsonb) from public, anon;
grant execute on function app.relance_envoyable(text, jsonb) to authenticated, service_role;
revoke all on function public.relance_envoi_reserver(uuid, text, timestamptz) from public, anon;
revoke all on function public.relance_envoi_terminer(uuid, uuid, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.relance_envoi_reserver(uuid, text, timestamptz) to authenticated;
grant execute on function public.relance_envoi_terminer(uuid, uuid, boolean, text, text, text) to service_role;

insert into public.schema_migrations (version) values ('0518_relances_envoi') on conflict (version) do nothing;
