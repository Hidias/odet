-- 0051_interventions_types_depart.sql : jeu de départ des types de matériel et des pièces du module Interventions.
-- Valeurs proposées à partir des textes et normes (source indiquée sur chaque type), toutes « à confirmer » :
-- l'organisme les valide ou les corrige dans Interventions > Réglages. Insérées une seule fois (table vide).
-- Recherche du 12/10/2026 : claude/odet-interventions-reglementation-2026-10.md (projet).

insert into public.itv_equipment_types (name, family, verification_months, operations, lifespan_years, defects, fields, source_note, sort_order)
select * from (values
  ('Extincteur à eau pulvérisée', 'Extincteurs', 12,
   '[{"code":"maa","label":"Maintenance additionnelle (atelier, charge renouvelée)","years":[5,15]},{"code":"revision","label":"Révision en atelier","years":[10]}]'::jsonb,
   20,
   '["Inaccessible, non visible ou non signalé","Mode d''emploi absent ou illisible","Chocs, corrosion ou sérigraphie dégradée","Manomètre hors zone verte","Scellé ou goupille manquant","Diffuseur ou tuyau détérioré","Additif à renouveler","Maintenance additionnelle ou révision en retard","Plus de 20 ans","Étiquette de maintenance absente"]'::jsonb,
   '["Capacité","Pression (permanente ou auxiliaire)"]'::jsonb,
   'Vérification annuelle (NF S 61-919, APSAD R4 ; ERP : MS 73). Maintenance additionnelle années 5 et 15, révision année 10, durée de vie 20 ans (NF S 61-919). Dotation : 1 pour 200 m² et 1 par niveau (Code du travail R4227-29).',
   10),
  ('Extincteur à poudre', 'Extincteurs', 12,
   '[{"code":"maa","label":"Maintenance additionnelle (atelier, charge renouvelée)","years":[5,15]},{"code":"revision","label":"Révision en atelier","years":[10]}]'::jsonb,
   20,
   '["Inaccessible, non visible ou non signalé","Mode d''emploi absent ou illisible","Chocs, corrosion ou sérigraphie dégradée","Manomètre hors zone verte","Scellé ou goupille manquant","Poudre mottée","Cartouche hors date (pression auxiliaire)","Maintenance additionnelle ou révision en retard","Plus de 20 ans","Étiquette de maintenance absente"]'::jsonb,
   '["Capacité","Classe de feux","Pression (permanente ou auxiliaire)"]'::jsonb,
   'Vérification annuelle (NF S 61-919, APSAD R4 ; ERP : MS 73). Maintenance additionnelle années 5 et 15, révision année 10, durée de vie 20 ans (NF S 61-919).',
   20),
  ('Extincteur CO2', 'Extincteurs', 12,
   '[{"code":"revision","label":"Révision en atelier","years":[10,20,30]},{"code":"requalification","label":"Requalification (équipement sous pression)","years":[10,20,30]}]'::jsonb,
   null,
   '["Inaccessible, non visible ou non signalé","Mode d''emploi absent ou illisible","Chocs, corrosion ou sérigraphie dégradée","Pesée hors tolérance","Scellé ou goupille manquant","Diffuseur ou flexible détérioré","Requalification dépassée","Étiquette de maintenance absente"]'::jsonb,
   '["Capacité"]'::jsonb,
   'Vérification annuelle par pesée et révision à 10 ans (NF S 61-919). Requalification au plus tous les 10 ans (arrêté du 20 novembre 2017, art. 18). Pas de durée de vie fixée par un texte.',
   30),
  ('Bloc autonome d''éclairage de sécurité (BAES)', 'Éclairage de sécurité', 12,
   '[]'::jsonb,
   null,
   '["Ne s''allume pas sur coupure","Autonomie inférieure à 1 heure","Lampe ou LED défectueuse","Voyant de défaut allumé","Télécommande inopérante","Pictogramme absent ou illisible","Bloc masqué ou endommagé"]'::jsonb,
   '["Fonction (évacuation ou ambiance)","Autotest"]'::jsonb,
   'Vérification annuelle par un technicien compétent en ERP (EC 15). Essais mensuel et semestriel (autonomie 1 h) à la charge de l''exploitant (arrêté du 14 décembre 2011, art. 11), à consigner au registre.',
   40),
  ('Équipement d''alarme incendie', 'Alarme', 12,
   '[]'::jsonb,
   null,
   '["Déclencheur manuel inopérant, cassé ou masqué","Diffuseur sonore inopérant ou peu audible","Batterie défaillante","Défaut au tableau","Essais semestriels non consignés"]'::jsonb,
   '["Type d''équipement d''alarme"]'::jsonb,
   'ERP : vérification annuelle (MS 73). Lieux de travail : essais et visites périodiques, exercices au moins tous les 6 mois, consignés au registre (Code du travail R4227-39). Maintenance : NF S 61-933.',
   50),
  ('Désenfumage (exutoire, ouvrant, commande)', 'Désenfumage', 12,
   '[]'::jsonb,
   null,
   '["Ne s''ouvre pas ou ouverture incomplète","Commande manuelle inaccessible ou défaillante","Cartouche percutée, vide ou périmée","Fusible thermique défectueux","Réarmement impossible","Treuil ou câble défaillant"]'::jsonb,
   '["Type de commande"]'::jsonb,
   'ERP : vérification annuelle (DF 10). Lieux de travail : périodicité « appropriée » (R4224-17), annuelle en pratique (NF S 61-933, APSAD R17).',
   60),
  ('Robinet d''incendie armé (RIA)', 'RIA', 12,
   '[{"code":"epreuve","label":"Essai hydrostatique et remplacement des joints","years":[5,10,15,20,25,30]}]'::jsonb,
   null,
   '["Inaccessible ou non signalé","Vanne fermée ou grippée","Tuyau craquelé ou poreux, fuite","Lance défectueuse","Pression ou débit insuffisant","Dévidoir bloqué","Pas de protection contre le gel"]'::jsonb,
   '["Diamètre"]'::jsonb,
   'ERP : vérification annuelle (MS 73). Essai d''écoulement annuel, essai hydrostatique tous les 5 ans (NF S 62-201, APSAD R5). Pour un RIA, l''épreuve se compte depuis l''installation.',
   70)
) as v(name, family, verification_months, operations, lifespan_years, defects, fields, source_note, sort_order)
where not exists (select 1 from public.itv_equipment_types);

insert into public.itv_parts (name, unit, price_ht)
select * from (values
  ('Goupille et scellé', 'unité', 0),
  ('Joint de tête', 'unité', 0),
  ('Étiquette de maintenance', 'unité', 0),
  ('Batterie de BAES', 'unité', 0),
  ('Lampe ou module LED de BAES', 'unité', 0),
  ('Cartouche de CO2 pour désenfumage', 'unité', 0)
) as v(name, unit, price_ht)
where not exists (select 1 from public.itv_parts);

insert into public.schema_migrations (version) values ('0051_interventions_types_depart') on conflict (version) do nothing;
