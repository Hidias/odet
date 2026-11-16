-- Retour arrière de 0520 : liste des nouveaux entrants, notes des indicateurs 19 et 20 et note du référentiel
-- au 1er novembre 2026 remises comme avant (état du 16/11/2026).

update public.cert_indicators
   set new_entrant_light = number in (2, 3, 11, 13, 14, 19, 22, 24, 25, 26, 32)
 where referential_code = 'rnq-2026';

update public.cert_indicators
   set change_note = 'Preuve du suivi effectif des modules à distance ; référent pédagogique au-delà d''un seuil d''intervenants fixé par arrêté (non paru au 11 octobre 2026).'
 where referential_code = 'rnq-2026' and number = 19;

update public.cert_indicators
   set change_note = 'Pilotage et gouvernance ; supervision renforcée sous un seuil fixé par arrêté (non paru au 11 octobre 2026).'
 where referential_code = 'rnq-2026' and number = 20;

update public.cert_referentials
   set notes = 'Arrêtés des indicateurs 19 et 20 et guide de lecture v10 non parus au 11 octobre 2026.'
 where code = 'rnq-2026';

delete from public.schema_migrations where version = '0520_qualiopi_arrete_2026';
