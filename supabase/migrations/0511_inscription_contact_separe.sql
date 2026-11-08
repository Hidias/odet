-- 0511 : contact d'une inscription en ligne en « NOM Prénom » (reste de #352, 0508).
-- Défaut : à la confirmation d'une inscription, la fiche client créée porte contact_name « Prénom Nom » ; le déclencheur
-- client_to_primary_contact crée alors le contact avec ce nom libre, et l'insertion du contact séparé (prénom, nom) est
-- sautée (même adresse e-mail). Le contact restait « Paul Durand », non séparé, au lieu de « DURAND Paul ».
-- Correctif : corps de public.inscription_confirmer repris tel qu'en production (0500) à l'identique ; une mise à jour ajoutée pose le prénom et
-- le nom de la demande sur ce contact (fiche entreprise ou particulier), seulement si son nom désigne la même personne
-- (app.memes_mots) et que rien n'est encore séparé ; la fonction de la demande et le rôle de contact des documents (si aucun
-- autre contact de la fiche ne l'a), perdus depuis 0420 pour la même raison, sont posés aussi (relecture). Le déclencheur client_contacts_nom calcule l'affichage.
-- Retour arrière : supabase/rollback/0511_inscription_contact_separe_retour.sql (corps de 0500).

CREATE OR REPLACE FUNCTION public.inscription_confirmer(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.online_registrations;
  s record;
  v_client uuid;
  v_trainee uuid;
  v_group uuid;
  v_prix numeric;
  v_nom text;
  p jsonb;
  v_n int;
  v_res int;
  v_sess uuid;
begin
  -- Verrous toujours dans le même ordre, session puis demande (0500) : une confirmation à la fois par session, sans
  -- interblocage avec une mise à jour de la session (liste d'attente) ; statut relu après le verrou
  select o.session_id into v_sess from public.online_registrations o where o.id = p_id;
  perform 1 from public.sessions where id = v_sess for update;
  select * into r from public.online_registrations where id = p_id for update;
  if r.id is null then raise exception 'Inscription inconnue' using errcode = '22023'; end if;
  if r.company_id not in (select app.societes_avec_droit('formation.inscriptions.gerer')) then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  if r.status not in ('en_attente', 'place_proposee', 'liste_attente') then raise exception 'Inscription déjà traitée' using errcode = '22023'; end if;
  select se.id, se.course_id, se.public_price_per_person, se.max_participants into s from public.sessions se where se.id = r.session_id;

  -- Client : retrouvé (entreprise par SIRET, sinon par nom et code postal ; particulier par adresse email), sinon créé
  if r.kind = 'entreprise' then
    select c.id into v_client from public.clients c
     where c.company_id = r.company_id and r.siret is not null and c.siret = r.siret limit 1;
    if v_client is null then
      select c.id into v_client from public.clients c
       where c.company_id = r.company_id and lower(btrim(c.name)) = lower(btrim(r.company_name))
         and coalesce(c.postal_code, '') = coalesce(r.postal_code, '') limit 1;
    end if;
    if v_client is null then
      insert into public.clients (company_id, name, siret, siren, address, postal_code, city, client_type, type, email, contact_name, contact_email, contact_phone)
      values (r.company_id, btrim(r.company_name), r.siret, left(r.siret, 9), r.address, r.postal_code, r.city, 'entreprise', 'client',
              r.contact_email, r.contact_first_name || ' ' || r.contact_last_name, r.contact_email, r.contact_phone)
      returning id into v_client;
    end if;
    if not exists (select 1 from public.client_contacts cc where cc.client_id = v_client and lower(cc.email) = r.contact_email) then
      insert into public.client_contacts (client_id, name, first_name, last_name, email, phone, fonction, is_document_contact)
      values (v_client, r.contact_first_name || ' ' || r.contact_last_name, r.contact_first_name, r.contact_last_name, r.contact_email,
              r.contact_phone, r.contact_function, true);
    end if;
  else
    select c.id into v_client from public.clients c
     where c.company_id = r.company_id and c.client_type = 'particulier'
       and (lower(c.email) = r.contact_email or lower(c.contact_email) = r.contact_email) limit 1;
    if v_client is null then
      insert into public.clients (company_id, name, client_type, type, email, contact_name, contact_email, contact_phone, mobile, address, postal_code, city)
      values (r.company_id, r.contact_first_name || ' ' || upper(r.contact_last_name), 'particulier', 'client', r.contact_email,
              r.contact_first_name || ' ' || r.contact_last_name, r.contact_email, r.contact_phone, r.contact_phone, r.address, r.postal_code, r.city)
      returning id into v_client;
    end if;
  end if;

  -- Contact au nom libre créé par la fiche (client_to_primary_contact, 0508) : nom et prénom de la demande posés à part,
  -- avec sa fonction et comme contact des documents (ce que l'insertion sautée aurait écrit), seulement s'il s'agit bien
  -- de la même personne (mêmes mots) et que rien n'est encore séparé
  update public.client_contacts cc set first_name = r.contact_first_name, last_name = r.contact_last_name,
         fonction = coalesce(cc.fonction, r.contact_function),
         is_document_contact = coalesce(cc.is_document_contact, false) or not exists (select 1 from public.client_contacts o
                                 where o.client_id = v_client and o.id <> cc.id and coalesce(o.is_document_contact, false))
   where cc.client_id = v_client and lower(cc.email) = r.contact_email
     and cc.first_name is null and cc.last_name is null
     and nullif(btrim(coalesce(r.contact_last_name, '')), '') is not null
     and app.memes_mots(cc.name, concat_ws(' ', r.contact_first_name, r.contact_last_name));

  -- Groupe inter : prix par personne du tarif du client (0418), sinon prix public de la session
  select g.id into v_group from public.session_groups g where g.session_id = r.session_id and g.client_id = v_client limit 1;
  if v_group is null then
    v_prix := coalesce((app.prix_client(v_client, 'formation', s.course_id)).prix_inter_ht, s.public_price_per_person);
    insert into public.session_groups (session_id, client_id, kind, payer_kind, nb_personnes, price_per_person, status, doc_status, source)
    values (r.session_id, v_client, r.kind, r.kind, jsonb_array_length(r.participants), v_prix, 'confirmed', 'a_envoyer', 'page_publique')
    returning id into v_group;
  end if;

  -- Stagiaires : retrouvés dans le client (adresse email, sinon prénom et nom), sinon créés ; inscrits dans le groupe
  for p in select * from jsonb_array_elements(r.participants) loop
    v_trainee := null;
    if nullif(p->>'email', '') is not null then
      select t.id into v_trainee from public.trainees t where t.client_id = v_client and lower(t.email) = lower(p->>'email') limit 1;
    end if;
    if v_trainee is null then
      select t.id into v_trainee from public.trainees t
       where t.client_id = v_client and lower(btrim(t.first_name)) = lower(p->>'first_name') and lower(btrim(t.last_name)) = lower(p->>'last_name') limit 1;
    end if;
    if v_trainee is null then
      insert into public.trainees (first_name, last_name, email, job_title, client_id)
      values (p->>'first_name', upper(p->>'last_name'), nullif(p->>'email', ''), nullif(p->>'job_title', ''), v_client)
      returning id into v_trainee;
    end if;
    if not exists (select 1 from public.session_trainees st where st.session_id = r.session_id and st.trainee_id = v_trainee) then
      insert into public.session_trainees (session_id, trainee_id, group_id) values (r.session_id, v_trainee, v_group);
    end if;
  end loop;
  -- Effectif maximum de la session (0500) : jamais dépassé par une confirmation, places réservées comprises (places
  -- proposées ; demandes en attente plus anciennes ; pour une demande de la liste d'attente, toutes les demandes en
  -- attente, déjà acceptées au dépôt) ; tout ce qui précède est annulé
  if s.max_participants is not null then
    select count(*) into v_n from public.session_trainees st
     where st.session_id = r.session_id and not coalesce(st.absent, false);
    select coalesce(sum(jsonb_array_length(o.participants)), 0) into v_res from public.online_registrations o
     where o.session_id = r.session_id and o.id <> r.id
       and (o.status = 'place_proposee' or (o.status = 'en_attente' and (r.status = 'liste_attente' or o.created_at < r.created_at)));
    if v_n + v_res > s.max_participants then
      raise exception 'Confirmation impossible : la session dépasserait son effectif maximum (% inscrits, dont cette demande, et % places réservées à d''autres demandes, pour % places). Relevez l''effectif maximum de la session ou refusez une demande.', v_n, v_res, s.max_participants
        using errcode = '23514';
    end if;
  end if;
  update public.session_groups g set nb_personnes = (select count(*) from public.session_trainees st where st.group_id = g.id)
   where g.id = v_group;

  update public.online_registrations
     set status = 'confirmee', client_id = v_client, group_id = v_group, handled_by = auth.uid(), handled_at = now()
   where id = r.id;
  -- Participants déjà inscrits : places libérées proposées à la liste d'attente (0500)
  perform app.liste_attente_avancer(r.session_id);
  return jsonb_build_object('ok', true, 'client_id', v_client, 'group_id', v_group);
end
$function$;

insert into public.schema_migrations (version) values ('0511_inscription_contact_separe') on conflict (version) do nothing;
