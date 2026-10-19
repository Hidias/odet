# Fonction 10 : pont formation et maintenance

Migration `0130_pont_formation_maintenance.sql`, retour arrière `supabase/rollback/0130_pont_formation_maintenance_retour.sql`,
lot `f10_0130`. Module « Pont formation et maintenance » (`pont`), actif d'emblée seulement si Formation et
Interventions le sont ; réglages dans `org_modules.settings` : domaines suivis (incendie), création automatique,
responsable par défaut.

## Ce que fait l'application

- **Visite, étape clôture** (technicien) : bloc « Personnel du site » : salariés formés (domaines suivis) sur les
  salariés connus du site, prochaine échéance, dernier exercice d'évacuation, salariés sans site. Des nombres, jamais
  de noms ni de prix. Deux gestes : « Le client a fait un exercice » (enregistré comme déclaré par le client) et
  « Signaler un besoin de formation » (piste transmise au bureau, notification).
- **Fin de session** : une session terminée d'une formation d'un domaine suivi (formation reliée à l'obligation
  dans le référentiel), chez un client actif sans contrat de maintenance actif, crée une piste « vers la
  maintenance ». Client inactif ou à ne pas solliciter : rien. Une erreur de piste n'empêche jamais de terminer la
  session.
- **Commerce > Pistes** : liste filtrable ; « Préparer le devis » ouvre un brouillon (formation de l'obligation, prix
  du catalogue, quantité = salariés du site sans formation valide, à défaut un groupe ; maintenance : une ligne sans
  prix) ; gagnée, perdue, ignorée, notes. Encart « Pistes » sur la fiche client.
- Une seule piste ouverte par client, sens et domaine ; un nouveau signalement s'ajoute en note.

## Droits

- Pistes : lues avec les clients, tenues par qui modifie les clients. Le technicien n'écrit que par ses deux gestes
  (fonctions), sur ses visites seulement (ou qui gère les visites).

## Réglementation

- R4227-38 : la consigne désigne les personnes chargées du matériel de premier secours et de l'évacuation.
- R4227-39 : exercices et essais au moins tous les six mois, consignés.
- Aucune durée de validité fixée par un texte pour la manipulation des extincteurs : valeur vide par défaut.

## Recette

1. Visite d'un client fictif (technicien) : étape clôture, bloc « Personnel du site » ; déclarer un exercice ;
   signaler un besoin.
2. Commerce > Pistes : la piste ; « Préparer le devis » ouvre un brouillon.
3. Terminer une session incendie d'un client fictif sans contrat : piste « vers la maintenance ».
