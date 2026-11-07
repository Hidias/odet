-- FICHIER GÉNÉRÉ par scripts/migrations/fabriquer_lot.py (refus_verrou_0505) : ne pas modifier à la main.
-- APPLICATION RÉELLE sur l'instance : 0505_refus_inscription_verrou.sql. Une seule transaction : si une instruction échoue,
-- rien n'est appliqué. Retour arrière : supabase/rollback/0505_refus_inscription_verrou_retour.sql
select set_config('lock_timeout', '5s', true), set_config('statement_timeout', '300s', true);

-- ===== supabase/migrations/0505_refus_inscription_verrou.sql =====
-- 0505 : refus d'une demande d'inscription en ligne pris sous le verrou de la session (reste de 0500, relevé par la
-- relecture de #325). Défaut : public.inscription_refuser ne verrouillait que la demande ; son déclencheur
-- (liste_attente_refus) fait avancer la liste d'attente, qui comptait les places sans verrou de session. Pendant une
-- confirmation simultanée de la même session (qui tient la session sous verrou et ajoute des inscrits), le refus
-- lisait les places d'avant cette confirmation et pouvait proposer une place qui n'existait plus.
--   Correctif : mêmes verrous et même ordre que public.inscription_confirmer (0500) : session puis demande, statut et
--   session relus après le verrou. Le reste du corps est celui de 0421.
-- Aucune donnée modifiée. Production le 07/11 : 0 demande en ligne. Retour arrière :
-- supabase/rollback/0505_refus_inscription_verrou_retour.sql (corps de 0421).

create or replace function public.inscription_refuser(p_id uuid, p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.online_registrations;
  v_sess uuid;
begin
  -- Verrous dans l'ordre session puis demande (0505, comme inscription_confirmer) : la liste d'attente avancée par
  -- le déclencheur du refus compte les places après toute confirmation en cours sur la même session
  select o.session_id into v_sess from public.online_registrations o where o.id = p_id;
  perform 1 from public.sessions where id = v_sess for update;
  select * into r from public.online_registrations where id = p_id for update;
  if r.id is null then raise exception 'Inscription inconnue' using errcode = '22023'; end if;
  if r.company_id not in (select app.societes_avec_droit('formation.inscriptions.gerer')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if r.session_id is distinct from v_sess then raise exception 'Inscription modifiée entre-temps, réessayez' using errcode = '40001'; end if;
  if r.status not in ('en_attente', 'place_proposee', 'liste_attente') then raise exception 'Inscription déjà traitée' using errcode = '22023'; end if;
  update public.online_registrations
     set status = 'refusee', response = nullif(btrim(left(coalesce(p_motif, ''), 1000)), ''), handled_by = auth.uid(), handled_at = now()
   where id = r.id;
  return jsonb_build_object('ok', true);
end
$$;

insert into public.schema_migrations (version) values ('0505_refus_inscription_verrou') on conflict (version) do nothing;
