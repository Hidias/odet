# Module RH, socle (migration 0290)

Module « rh » coupé par défaut : il s'active société par société (Console › Modules), après la relecture de la direction.
Menu : section « Personnel ».

## Ce que ça fait

- **Annuaire** : cartes (nom, emploi, équipe, téléphone et email professionnels), recherche, filtres équipe et statut
  (en poste, arrivée prévue, parti). Vue `v_hr_annuaire` : champs professionnels seulement.
- **Fiche** : identité, coordonnées personnelles et contact d'urgence (repliés à la création), contrats (type, dates,
  emploi, équipe, responsable, heures, horaire, essai, qualification), archivage sans effacement.
- **Rémunération** : jamais lue directement ; « Afficher » appelle `hr_remuneration()`, qui exige « Voir les salaires »
  et écrit la consultation au journal d'audit (sans le montant). Saisie avec « Voir les salaires » et « Tenir les
  dossiers ».
- **Équipes** (responsable d'équipe) et **horaires de référence** (par défaut 8h30-12h30, 13h30-17h30, du lundi au
  vendredi ; réglables par société).

## Droits

| Donnée | Droit |
|---|---|
| Annuaire | Voir le personnel (salarié, gestionnaire, RH, direction, administrateur) |
| Fiche complète, contrats | Voir les dossiers du personnel, ou sa propre fiche (compte relié) |
| Création, modification | Tenir les dossiers du personnel |
| Horaires | lecture : Voir le personnel ; écriture : Configurer les RH |
| Rémunération | la sienne ; sinon `hr_remuneration()` avec Voir les salaires (journalisé) |

Aucun numéro de sécurité sociale, aucune donnée de santé ni de handicap (spec § 5).

## Suite (spec § 7)

`rh/absences` (0294-0296), `rh/heures` (0297-0300), `rh/documents-sante` (0301-0303), `rh/mon-espace`.
Une personne présente dans deux sociétés a pour l'instant une fiche par société (la fiche partagée viendra avec C2/C3).

# Absences (migration 0294)

- Types d'absence par société (liste de départ « à confirmer » : congés payés, RTT, récupération, absence autorisée,
  événement familial, sans solde, arrêt maladie et accident du travail saisis par la RH) ; réglages : Personnel ›
  Absences › Types.
- Demande (`hr_absence_demander`) : pour soi (profil « Salarié », fiche reliée au compte) ou par la RH pour une
  personne ; jours ouvrés du lundi au vendredi, demi-journées ; pas de chevauchement ; solde affiché avant l'envoi.
- Circuit commun (`approval_requests`, périmètre « absence », droit « Valider les absences ») ; personne ne valide sa
  propre demande ; refus avec motif ; la décision met la demande à jour et écrit la prise au solde.
- Annulation : la personne, tant que l'absence n'a pas commencé ; la RH, toujours ; une prise annulée revient au solde.
- Soldes calculés (`v_hr_soldes`) depuis les mouvements (acquisition, prise, report, ajustement, annulation) ;
  ajustements par la RH dans la fiche.
- Aucun motif médical : seule la catégorie du type. Jours fériés : à venir (calendrier par société).

# Heures (migration 0297)

- Ma semaine (Personnel › Heures) : lignes par jour (début, fin, pause, observation), « Reprendre mes visites et
  sessions » (`hr_semaine_preparer` : visites terminées du technicien, sessions du formateur relié à la fiche, à
  vérifier), totaux, écart au contrat (35 h par défaut), heures supplémentaires (25 % les 8 premières, 50 % au-delà,
  à défaut d'accord, à confirmer).
- Dépassements signalés, jamais bloqués : plus de 10 h par jour, plus de 48 h par semaine.
- Soumission (`hr_semaine_soumettre`) : circuit commun (« timesheet », « Valider les heures ») ; lignes figées tant que
  la semaine est soumise ou validée ; une semaine renvoyée redevient modifiable. Les heures supplémentaires ne comptent
  qu'après validation. L'outil ne calcule pas la paie.
