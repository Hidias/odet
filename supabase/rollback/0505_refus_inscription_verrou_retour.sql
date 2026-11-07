-- Retour arrière de 0505 : inscription_refuser remise au corps de 0421 (verrou de la demande seulement) et
-- app.liste_attente_avancer à celui de 0500 (sans verrou de session). Aucune donnée touchée.

create or replace function public.inscription_refuser(p_id uuid, p_motif text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.online_registrations;
begin
  select * into r from public.online_registrations where id = p_id for update;
  if r.id is null then raise exception 'Inscription inconnue' using errcode = '22023'; end if;
  if r.company_id not in (select app.societes_avec_droit('formation.inscriptions.gerer')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
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

delete from public.schema_migrations where version = '0505_refus_inscription_verrou';
