-- Données fictives du module Interventions : sites, parc de matériel, contrats, historique de visites, tournées
-- du vendredi 16 octobre 2026. À appliquer après les migrations 0050 et 0051, après le jeu fictif principal
-- (clients fictifs inscrits dans demo_records) et après demo_interventions_comptes.sql (deux techniciens).
-- Tout est rattaché aux clients fictifs : Console > Données de démonstration efface l'ensemble.
-- Génération dans la base (graine fixe) : le fichier reste court.

do $$
declare
  c record; s record; k record; e record; d date; vids uuid[];
  v_client uuid; v_site uuid; v_contract uuid; v_visit uuid; v_type uuid; v_last date; v_next date;
  v_prefix text := (select coalesce(nullif(trim(doc_prefix), ''), 'APP') from public.organization_settings limit 1);
  v_n int := (select label_next from public.itv_settings where id = 1);
  v_ref int := 0; v_year int; v_tech uuid; v_cnt int; i int; v_res text; v_def text; v_start timestamptz;
  t_ronan uuid := (select id from auth.users where email = 'ronan.gourmelen@gld-demo.fr');
  t_loic uuid := (select id from auth.users where email = 'loic.prigent@gld-demo.fr');
  v_sigs text[] := array(select signature_morning from public.attendance_halfdays where signature_morning like 'data:image%' order by id limit 20);
  streets text[] := array['rue de la Gare', 'route de Quimper', 'ZA de Kerourvois', 'rue du Port', 'impasse des Ajoncs', 'rue Jean Jaurès', 'ZI de Kergonan', 'chemin de Lestonan'];
  signers text[] := array['Gaëlle Le Floc''h, responsable technique', 'Yannick Cariou, directeur', 'Morgane Tanguy, responsable sécurité', 'Erwan Le Goff, chef d''atelier'];
  years int[] := array[2014, 2016, 2016, 2018, 2019, 2020, 2021, 2021, 2022, 2023, 2024];
  plan16 jsonb := '[]'::jsonb;
begin
  if t_ronan is null or t_loic is null then raise exception 'Comptes des techniciens fictifs absents : appliquer demo_interventions_comptes.sql d''abord'; end if;
  if exists (select 1 from public.itv_equipment eq join public.demo_records r on r.id = eq.client_id and r.tbl = 'clients') then
    raise exception 'Le parc fictif existe déjà';
  end if;
  perform setseed(0.161026);

  for c in
    select * from (values
      (1, 'Hôtel Kastell Mor', 'Bénodet', '29950', 47.875, -4.106, 'Bâtiment principal:hotel|Annexe piscine:small', 640, '{10}'::int[], 10, 0),
      (2, 'Supermarché Ty Marc''had', 'Bénodet', '29950', 47.875, -4.106, 'Magasin et réserve:shop', null, null, 10, 0),
      (3, 'Résidence Ar Steredenn', 'Fouesnant', '29170', 47.894, -4.012, 'Tous bâtiments:ehpad', 980, '{3,9}'::int[], 9, 0),
      (4, 'Transports Le Bihannic', 'Briec', '29510', 48.102, -3.997, 'Dépôt et ateliers:warehouse', 520, '{9}'::int[], 9, 1),
      (5, 'Scierie du Steïr', 'Quimper', '29000', 47.996, -4.102, 'Scierie:industry', null, null, 9, 1),
      (6, 'Glenan Marine', 'Loctudy', '29750', 47.834, -4.170, 'Atelier naval:industry_small', null, null, 8, 1),
      (7, 'Mareyage Ty Ar Mor', 'Penmarch', '29760', 47.812, -4.338, 'Halle de mareyage:warehouse', 450, '{10}'::int[], 10, 1),
      (8, 'Cornouaille Usinage', 'Pont-l''Abbé', '29120', 47.866, -4.222, 'Usine:industry', null, null, 11, 0),
      (9, 'Agri-Équipements du Pays Bigouden', 'Plonéour-Lanvern', '29720', 47.904, -4.285, 'Magasin et atelier:shop_small', null, null, 10, 1),
      (10, 'Kervéguen Logistique', 'Quimper', '29000', 47.996, -4.102, 'Entrepôt A:warehouse|Entrepôt B:warehouse_small', 1150, '{4,11}'::int[], 11, 0),
      (11, 'Imprimerie Kemper Graphik', 'Quimper', '29000', 47.996, -4.102, 'Imprimerie:industry_small', null, null, 3, 0),
      (12, 'Plasturgie de l''Isole', 'Quimperlé', '29300', 47.873, -3.549, 'Usine:industry', 890, '{6}'::int[], 6, 1),
      (13, 'Micro-crèche Bugale Mad', 'Plomelin', '29700', 47.932, -4.150, 'Crèche:small', null, null, 5, 0),
      (14, 'Fromagerie Ker Laëz', 'Châteaulin', '29150', 48.197, -4.090, 'Fromagerie:industry_small', null, null, 2, 1)
    ) as x(n, name, town, cp, lat, lng, sites, price, months, last_month, tech)
    order by n
  loop
    select cl.id into v_client from public.clients cl join public.demo_records r on r.id = cl.id and r.tbl = 'clients' where cl.name = c.name;
    if v_client is null then continue; end if;
    v_tech := case when c.tech = 0 then t_ronan else t_loic end;
    v_contract := null;
    if c.price is not null then
      insert into public.itv_contracts (client_id, reference, label, start_on, annual_price_ht, visit_months, status)
      values (v_client, 'CM-2025-' || lpad(c.n::text, 3, '0'), 'Contrat de maintenance annuel', '2025-01-01', c.price, c.months, 'actif')
      returning id into v_contract;
    end if;

    i := 0;
    for s in select split_part(p, ':', 1) as sname, split_part(p, ':', 2) as profile from unnest(string_to_array(c.sites, '|')) as p loop
      i := i + 1;
      insert into public.sites (kind, name, address, postal_code, city, client_id, is_active, is_default, latitude, longitude, access_notes)
      values ('client', s.sname, (2 + floor(random() * 46))::int || ' ' || streets[1 + floor(random() * 8)::int], c.cp, c.town, v_client, true, i = 1,
              round((c.lat + (random() - 0.5) * 0.024)::numeric, 5), round((c.lng + (random() - 0.5) * 0.032)::numeric, 5),
              (array[null, 'Se présenter à l''accueil', 'Clés au poste de garde', 'Accès par le portail arrière, code donné par le client'])[1 + floor(random() * 4)::int])
      returning id into v_site;

      -- Parc du site selon son profil
      for k in
        select * from (values
          ('eau', 'Extincteur à eau pulvérisée', '{"hotel":9,"ehpad":8,"shop":6,"shop_small":3,"warehouse":6,"warehouse_small":3,"industry":5,"industry_small":3,"small":3}'::jsonb, array['6 L', '9 L'], array['Sicli', 'Desautel', 'Eurofeu'], array['Accueil', 'Couloir rez-de-chaussée', 'Couloir 1er étage', 'Bureau', 'Salle de pause', 'Escalier principal', 'Vestiaires', 'Réserve', 'Atelier, entrée', 'Quai de chargement']),
          ('poudre', 'Extincteur à poudre', '{"hotel":2,"ehpad":1,"shop":2,"shop_small":1,"warehouse":4,"warehouse_small":2,"industry":4,"industry_small":2}'::jsonb, array['6 kg', '9 kg'], array['Sicli', 'Eurofeu'], array['Local technique', 'Chaufferie', 'Garage', 'Atelier, machine', 'Local poubelles', 'Zone de stockage']),
          ('co2', 'Extincteur CO2', '{"hotel":3,"ehpad":2,"shop":2,"shop_small":1,"warehouse":2,"warehouse_small":1,"industry":3,"industry_small":2,"small":1}'::jsonb, array['2 kg', '5 kg'], array['Sicli', 'Desautel'], array['Cuisine', 'Local électrique', 'Tableau général', 'Salle serveur', 'Atelier, armoire électrique']),
          ('baes', 'Bloc autonome d''éclairage de sécurité (BAES)', '{"hotel":12,"ehpad":14,"shop":8,"shop_small":4,"warehouse":6,"warehouse_small":3,"industry":7,"industry_small":4,"small":4}'::jsonb, array[null::text], array['Legrand', 'Kaufel', 'Luminox'], array['Sortie principale', 'Sortie de secours', 'Couloir', 'Escalier', 'Dégagement', 'Salle commune', 'Réserve']),
          ('alarme', 'Équipement d''alarme incendie', '{"hotel":1,"ehpad":1,"industry":1}'::jsonb, array[null::text], array['Nugelec', 'Legrand'], array['Accueil, centrale']),
          ('desenf', 'Désenfumage (exutoire, ouvrant, commande)', '{"hotel":1,"ehpad":2,"warehouse":1}'::jsonb, array[null::text], array['Souchier', 'Madrid'], array['Cage d''escalier', 'Toiture, exutoire']),
          ('ria', 'Robinet d''incendie armé (RIA)', '{"shop":1,"warehouse":2,"industry":1}'::jsonb, array[null::text], array['Desautel', 'Sicli'], array['Hall', 'Atelier'])
        ) as t(code, tname, counts, caps, brands, places)
      loop
        v_cnt := coalesce((k.counts ->> s.profile)::int, 0);
        select id into v_type from public.itv_equipment_types where name = k.tname limit 1;
        for e in select g from generate_series(0, v_cnt - 1) g loop
          v_year := years[1 + floor(random() * 11)::int];
          if k.code in ('eau', 'poudre') and random() < 0.06 then v_year := 2006; end if;
          insert into public.itv_equipment (client_id, site_id, type_id, label_code, location, brand, manufactured_year, installed_on, details, status)
          values (v_client, v_site, v_type, v_prefix || '-' || lpad(v_n::text, 5, '0'),
                  k.places[1 + (e.g % cardinality(k.places))] || case when e.g >= cardinality(k.places) then ' ' || (e.g / cardinality(k.places) + 1) else '' end,
                  k.brands[1 + floor(random() * cardinality(k.brands))::int], v_year, case when v_year > 2010 then make_date(v_year, 1 + floor(random() * 12)::int, 1) end,
                  case when k.caps[1] is null then '{}'::jsonb else jsonb_build_object('Capacité', k.caps[1 + floor(random() * cardinality(k.caps))::int]) end, 'en_service');
          v_n := v_n + 1;
        end loop;
      end loop;

      -- Historique : visite de 2025 (mois de la dernière visite), visites de 2026 déjà passées
      v_last := null;
      for d in
        select x from (
          select make_date(2025, c.last_month, 8 + floor(random() * 16)::int) as x
          union all
          select make_date(2026, m, 6 + floor(random() * 16)::int) from unnest(coalesce(c.months, array[c.last_month])) m
          where m <= 7
        ) q order by x
      loop
        v_ref := v_ref + 1;
        v_start := (d + make_time(8 + floor(random() * 3)::int, (array[0, 15, 30])[1 + floor(random() * 3)::int], 0)) at time zone 'Europe/Paris';
        insert into public.itv_visits (reference, client_id, site_id, contract_id, technician_id, due_on, planned_on, route_order, status, started_at, finished_at,
                                       signer_name, client_signature, observations, site_observations)
        values ('ITV-' || extract(year from d) || '-' || lpad(v_ref::text, 4, '0'), v_client, v_site, v_contract,
                case when random() < 0.5 then t_ronan else t_loic end, date_trunc('month', d)::date, d, 1, 'terminee', v_start, v_start + interval '2 hours 10 minutes',
                signers[1 + floor(random() * 4)::int], v_sigs[1 + floor(random() * greatest(cardinality(v_sigs), 1))::int],
                (array[null, null, 'Accès au local technique encombré, signalé au responsable.', 'RAS.'])[1 + floor(random() * 4)::int],
                (array['[]', '[]', '["Signalétique de sécurité manquante ou dégradée"]', '["Plan d''évacuation absent ou à mettre à jour"]'])[1 + floor(random() * 4)::int]::jsonb)
        returning id into v_visit;
        insert into public.itv_visit_items (visit_id, equipment_id, operation, result, defect, checked_at)
        select v_visit, x.id, 'verification', x.res,
               case when x.res = 'conforme' then null else x.defects ->> floor(random() * greatest(jsonb_array_length(x.defects), 1))::int end, v_start
        from (select q.id, t.defects,
                     case when extract(year from d) = 2026 and q.rnd < 0.05 then 'a_remplacer' when q.rnd > 0.97 then 'remplace' else 'conforme' end as res
              from (select eq.id, eq.type_id, random() as rnd from public.itv_equipment eq where eq.site_id = v_site) q
              join public.itv_equipment_types t on t.id = q.type_id) x;
        if random() < 0.5 then
          insert into public.itv_visit_parts (visit_id, label, quantity, unit_price_ht) values (v_visit, 'Goupille et scellé', 1 + floor(random() * 4)::int, 4.5);
        end if;
        v_last := d;
      end loop;

      -- Dernière et prochaine vérification ; « à remplacer » repris de la dernière visite
      update public.itv_equipment eq set last_check_on = v_last, next_check_on = (v_last + make_interval(months => t.verification_months))::date
        from public.itv_equipment_types t where t.id = eq.type_id and eq.site_id = v_site;
      update public.itv_equipment eq set status = 'a_remplacer'
        from public.itv_visit_items it join public.itv_visits v on v.id = it.visit_id
        where it.equipment_id = eq.id and v.site_id = v_site and v.planned_on = v_last and it.result = 'a_remplacer';

      -- Prochaine échéance de visite ; contrat à deux visites : visite de septembre manquée
      v_next := make_date(extract(year from v_last)::int + 1, extract(month from v_last)::int, 1);
      if c.months is not null and cardinality(c.months) > 1 and 9 = any(c.months) then v_next := '2026-09-01'; end if;

      if (c.n, i) in ((1, 1), (2, 1), (3, 1)) then
        plan16 := plan16 || jsonb_build_object('client', v_client, 'site', v_site, 'contract', v_contract, 'due', v_next, 'tech', t_ronan, 'n', c.n);
      elsif (c.n, i) in ((7, 1), (9, 1)) then
        plan16 := plan16 || jsonb_build_object('client', v_client, 'site', v_site, 'contract', v_contract, 'due', v_next, 'tech', t_loic, 'n', c.n);
      elsif v_contract is not null then
        insert into public.itv_visits (client_id, site_id, contract_id, due_on, status)
        select v_client, v_site, v_contract, make_date(2026, m, 1), 'a_planifier' from unnest(c.months) m where m > 10;
      end if;
    end loop;
  end loop;

  -- Tournées du vendredi 16 octobre (visite 1 de Ronan : celle de la démonstration)
  insert into public.itv_visits (client_id, site_id, contract_id, technician_id, due_on, planned_on, planned_time, route_order, status)
  select (p ->> 'client')::uuid, (p ->> 'site')::uuid, nullif(p ->> 'contract', '')::uuid, (p ->> 'tech')::uuid, (p ->> 'due')::date, '2026-10-16',
         (array['08:30', '11:00', '14:00'])[(row_number() over (partition by p ->> 'tech' order by (p ->> 'n')::int))::int]::time,
         row_number() over (partition by p ->> 'tech' order by (p ->> 'n')::int), 'planifiee'
  from jsonb_array_elements(plan16) p;

  -- Pour la démonstration : sur le site de la première visite de Ronan, deux extincteurs à eau de 2016 (révision
  -- à 10 ans proposée) et un de 2006 (fin de vie à 20 ans proposée)
  update public.itv_equipment e set manufactured_year = case when x.n = 3 then 2006 else 2016 end,
         installed_on = case when x.n = 3 then null else '2016-05-01'::date end
  from (select eq.id, row_number() over (order by eq.label_code) as n from public.itv_equipment eq
        join public.itv_equipment_types t on t.id = eq.type_id
        where t.name = 'Extincteur à eau pulvérisée'
          and eq.site_id = (select site_id from public.itv_visits where planned_on = '2026-10-16' and technician_id = t_ronan and route_order = 1)) x
  where e.id = x.id and x.n <= 3;

  -- Compteur d'étiquettes, prix d'exemple des pièces et forfait de visite (à régler dans Réglages), module actif
  update public.itv_settings set label_next = v_n where id = 1;
  update public.itv_parts set price_ht = v.p from (values ('Goupille et scellé', 4.5), ('Joint de tête', 6), ('Étiquette de maintenance', 1.5), ('Batterie de BAES', 24), ('Lampe ou module LED de BAES', 18), ('Cartouche de CO2 pour désenfumage', 32)) as v(n, p)
    where itv_parts.name = v.n and itv_parts.price_ht = 0;
  update public.itv_settings set visit_fee_ht = 85 where id = 1 and visit_fee_ht = 0;
  update public.org_modules set enabled = true where key = 'interventions';
end $$;
