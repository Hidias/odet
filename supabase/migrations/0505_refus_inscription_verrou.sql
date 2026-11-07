-- 0505 : refus d'une demande d'inscription en ligne pris sous le verrou de la session (reste de 0500, relevé par la
-- relecture de #325). Défaut : public.inscription_refuser ne verrouillait que la demande ; son déclencheur
-- (liste_attente_refus) fait avancer la liste d'attente, qui comptait les places sans verrou de session. Pendant une
-- confirmation simultanée de la même session (qui tient la session sous verrou et ajoute des inscrits), le refus
-- lisait les places d'avant cette confirmation et pouvait proposer une place qui n'existait plus.
--   Même défaut, relevé par la relecture, quand un inscrit est retiré ou passe absent (déclencheur
--   liste_attente_retrait) : surréservation possible, et interblocage possible avec un refus (chacun tenait une
--   demande et voulait l'autre).
--   Correctifs : 1. app.liste_attente_avancer prend le verrou de la session avant de compter (corps de 0500, une ligne
--   ajoutée) : tous les chemins qui font avancer la liste d'attente passent l'un après l'autre. 2. inscription_refuser
--   prend les verrous comme inscription_confirmer (0500) : session puis demande, demande relue après le verrou (corps
--   de 0421 pour le reste).
-- Aucune donnée modifiée. Production le 07/11 : 0 demande en ligne. Retour arrière :
-- supabase/rollback/0505_refus_inscription_verrou_retour.sql (corps de 0421 et de 0500).

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

CREATE OR REPLACE FUNCTION app.liste_attente_avancer(p_session uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s record;
  v_libres int;
  r record;
  v_faits int := 0;
begin
  -- Verrou de la session (0505) : la liste d'attente avance après toute confirmation, refus, retrait ou passage en
  -- absent en cours sur la même session, jamais sur des places périmées ; ordre session puis demandes partout
  perform 1 from public.sessions where id = p_session for update;
  select se.id, se.company_id, se.max_participants, se.start_date, co.title into s
    from public.sessions se left join public.courses co on co.id = se.course_id where se.id = p_session;
  if s.id is null or s.max_participants is null or s.start_date < (now() at time zone 'Europe/Paris')::date then return 0; end if;
  v_libres := app.places_libres_inter(s.id);
  for r in select o.id, o.kind, o.company_name, o.contact_first_name, o.contact_last_name, jsonb_array_length(o.participants) as n
             from public.online_registrations o where o.session_id = s.id and o.status = 'liste_attente' order by o.created_at loop
    exit when v_libres <= 0;
    continue when r.n > v_libres;
    -- Demande traitée entre-temps (confirmée, refusée) : jamais écrasée (0500)
    update public.online_registrations set status = 'place_proposee', proposed_at = now() where id = r.id and status = 'liste_attente';
    if not found then continue; end if;
    v_libres := v_libres - r.n;
    v_faits := v_faits + 1;
    insert into public.notifications (company_id, type, title, message, link, metadata)
    values (s.company_id, 'liste_attente',
            left('Place libérée : ' || coalesce(s.title, 'session inter') || ' du ' || to_char(s.start_date, 'DD/MM'), 255),
            'Place proposée à ' || case when r.kind = 'entreprise' then coalesce(r.company_name, 'une entreprise')
                                        else r.contact_first_name || ' ' || upper(r.contact_last_name) end
              || ' (liste d''attente, ' || r.n || ' participant' || case when r.n > 1 then 's' else '' end || ') : à confirmer dans la session.',
            '/sessions/' || s.id, jsonb_build_object('session_id', s.id, 'registration_id', r.id));
  end loop;
  return v_faits;
end
$function$;

insert into public.schema_migrations (version) values ('0505_refus_inscription_verrou') on conflict (version) do nothing;
