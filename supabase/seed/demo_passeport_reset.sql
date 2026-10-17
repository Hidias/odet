-- Passeport de prévention : remise à zéro de la démonstration après une répétition.
-- À coller dans l'éditeur SQL de Supabase. Ne touche qu'aux données de démonstration :
-- lignes de déclaration, envois, fichiers et accusés des stagiaires fictifs, noms de naissance saisis pendant
-- la répétition. Ensuite : relancer « Créer les numéros fictifs » (action demo-seed) pour recréer les numéros
-- effacés par un accusé en succès.

begin;

delete from public.pp_envois e using public.pp_lignes l
 where l.id = e.ligne_id and l.trainee_id in (select id from public.demo_records where tbl = 'trainees');
delete from public.pp_lignes where trainee_id in (select id from public.demo_records where tbl = 'trainees');

-- Fichiers et accusés de démonstration (le déclencheur les retire aussi de leurs tables)
delete from public.demo_records where tbl in ('pp_fichiers', 'pp_accuses');

update public.trainees set nom_naissance = null, nom_naissance_confirme_le = null
 where id in (select id from public.demo_records where tbl = 'trainees');

commit;

select
  (select count(*) from public.pp_lignes) as lignes,
  (select count(*) from public.pp_fichiers) as fichiers,
  (select count(*) from public.pp_accuses) as accuses,
  (select count(*) from public.pp_nir) as numeros;
