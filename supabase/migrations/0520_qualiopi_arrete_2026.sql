-- 0520 : référentiel au 1er novembre 2026, données de l'arrêté du 28 octobre 2026 relatif aux modalités d'audit
-- (JO du 1er novembre 2026, JORFTEXT000055041105, relu sur Légifrance le 16/11/2026).
--   1. Nouveaux entrants : la formalisation suffit à l'audit initial pour les indicateurs 2, 3, 11, 13, 14, 19, 24,
--      25 et 26 ; 22 et 32 ne sont plus dans la liste (référentiel de 2019 inchangé).
--   2. Seuils fixés par cet arrêté : huit intervenants par formation (indicateur 19), 50 % des heures d'enseignement
--      par des intervenants permanents (indicateur 20). Notes « non paru » remplacées.
--   3. Note du référentiel : guide de lecture V10 en ligne depuis le 30 octobre 2026, arrêté paru au JO du 1er novembre.
-- Données seulement, aucune fonction ni règle.

update public.cert_indicators
   set new_entrant_light = number in (2, 3, 11, 13, 14, 19, 24, 25, 26)
 where referential_code = 'rnq-2026'
   and new_entrant_light is distinct from (number in (2, 3, 11, 13, 14, 19, 24, 25, 26));

update public.cert_indicators
   set change_note = 'Preuve du suivi effectif des modules à distance ; référent pédagogique par formation au-delà de huit intervenants (arrêté du 28 octobre 2026).'
 where referential_code = 'rnq-2026' and number = 19;

update public.cert_indicators
   set change_note = 'Pilotage et gouvernance ; supervision renforcée quand moins de 50 % des heures d''enseignement sont réalisées par des intervenants permanents (arrêté du 28 octobre 2026).'
 where referential_code = 'rnq-2026' and number = 20;

update public.cert_referentials
   set notes = 'Guide de lecture V10 en ligne depuis le 30 octobre 2026. Arrêté du 28 octobre 2026 (JO du 1er novembre 2026) : modalités d''audit, nouveaux entrants (indicateurs 2, 3, 11, 13, 14, 19, 24, 25 et 26), seuils des indicateurs 19 (huit intervenants) et 20 (50 % d''heures par des intervenants permanents).'
 where code = 'rnq-2026';

insert into public.schema_migrations (version) values ('0520_qualiopi_arrete_2026') on conflict (version) do nothing;
