-- Passeport de prévention : mise en route sur l'instance et données de démonstration.
-- À jouer APRÈS la migration 0190, dans l'éditeur SQL de Supabase. Rejouable sans effet.
--
-- 1. Active le module « passeport ».
-- 2. Règle chaque formation du catalogue à partir des valeurs proposées (pp_presets), par code de formation.
--    Réglages de l'instance : ils restent après la purge des données de démonstration.
-- 3. Démonstration seulement (clients inscrits dans demo_records) : SIRET fictifs rendus valides (clé de Luhn),
--    sauf un, gardé faux pour montrer le blocage ; deux stagiaires fictifs refusent de donner leur numéro.
-- Les numéros fictifs sont créés ensuite par l'action « demo-seed » de api/passeport.js (chiffrement côté serveur),
-- lancée par le super administrateur depuis la page (voir la procédure du chantier 16).

-- ── 1. Module ──
update public.org_modules set enabled = true where key = 'passeport';

-- ── 2. Réglages par formation ──
insert into public.pp_course_settings (course_id, declarable, motif, categorie, type_decl, type_jdr, nom_jdr, mode_obtention,
                                       rome, formacodes, nsf, certifiante, validite_mois, preset_code)
select c.id, p.declarable, p.motif, p.categorie, p.type_decl, p.type_jdr, p.nom_jdr, p.mode_obtention,
       p.rome, p.formacodes, p.nsf, p.certifiante, p.validite_mois, p.code
from public.courses c
join (values
  ('SST-FI', 'SST'), ('SST-MAC', 'SST'),
  ('ERG-GP', 'GESTES_POSTURES'),
  ('B0H0V', 'HABILITATION_NON_ELEC'), ('BSBEM', 'HABILITATION_NON_ELEC'),
  ('R489', 'CONDUITE_R489'),
  ('INC-EPI', 'EXCLUE_SECURITE_BIENS'), ('INC-EXT', 'EXCLUE_SECURITE_BIENS'), ('IGPS', 'EXCLUE_SECURITE_BIENS'),
  ('DUERP', 'EXCLUE_AUTRE'), ('FOR', 'EXCLUE_AUTRE')
) m(code, preset) on m.code = c.code
join public.pp_presets p on p.code = m.preset
on conflict (course_id) do nothing;

-- Conduite R485 : déclarable (catégorie 2, ADF), codes à compléter depuis la fiche officielle
insert into public.pp_course_settings (course_id, declarable, categorie, type_decl)
select c.id, true, 2, 'ADF' from public.courses c where c.code = 'R485'
on conflict (course_id) do nothing;

-- ── 3. Démonstration ──
do $$
declare
  r record;
  v_base text; v_digit int; v_sum int; v_n int; i int;
  v_garde uuid;
begin
  -- Client gardé avec un SIRET faux : celui de la dernière session terminée de SST formation initiale
  select s.client_id into v_garde
  from public.sessions s join public.courses c on c.id = s.course_id
  where c.code = 'SST-FI' and s.end_date < current_date
    and s.client_id in (select id from public.demo_records where tbl = 'clients')
  order by s.end_date desc limit 1;

  for r in select cl.id, cl.siret from public.clients cl
           where cl.id in (select id from public.demo_records where tbl = 'clients')
             and cl.siret ~ '^\d{14}$' and cl.id is distinct from v_garde loop
    v_base := left(r.siret, 13);
    for v_digit in 0..9 loop
      v_sum := 0;
      for i in 1..14 loop
        v_n := substr(v_base || v_digit::text, 15 - i, 1)::int;
        if i % 2 = 0 then v_n := v_n * 2; if v_n > 9 then v_n := v_n - 9; end if; end if;
        v_sum := v_sum + v_n;
      end loop;
      if v_sum % 10 = 0 then
        if r.siret <> v_base || v_digit::text then
          update public.clients set siret = v_base || v_digit::text where id = r.id;
        end if;
        exit;
      end if;
    end loop;
  end loop;

  -- Deux stagiaires fictifs refusent de communiquer leur numéro (sessions terminées, formations déclarables)
  update public.trainees set refused_ssn = true
  where id in (
    select st.trainee_id
    from public.session_trainees st
    join public.sessions s on s.id = st.session_id
    join public.pp_course_settings cs on cs.course_id = s.course_id and cs.declarable
    where s.end_date < current_date
      and st.trainee_id in (select id from public.demo_records where tbl = 'trainees')
    order by s.end_date, st.trainee_id
    limit 2
  );
end $$;

-- Contrôle
select
  (select enabled from public.org_modules where key = 'passeport') as module_actif,
  (select count(*) from public.pp_course_settings) as formations_reglees,
  (select count(*) from public.trainees where refused_ssn) as refus;
