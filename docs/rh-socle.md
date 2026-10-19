# Module RH, socle (migration 0290)

Module « rh » coupé par défaut : il s'active société par société (Console › Modules), après la relecture de Léandra.
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
