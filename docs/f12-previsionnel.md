# Fonction 12 : chiffre d'affaires récurrent prévu

Migration `0150_previsionnel.sql`, retour arrière `supabase/rollback/0150_previsionnel_retour.sql`, lot `f12_0150`.
Module « Prévisionnel récurrent » (`previsionnel`), actif d'emblée si Formation l'est.

## Calcul (vue `v_recurring_revenue`, rien n'est stocké)

Sur 12 mois glissants, par mois, client et nature :
- **Formation** : échéances de recyclage du personnel (un stagiaire compté une fois par groupe de validité), au prix
  du catalogue **par stagiaire** de la première formation de l'obligation ; une échéance dépassée compte dans le mois
  en cours. Part planifiée : stagiaire déjà inscrit à une session à venir de cette formation. Part devisée : devis
  envoyés ou acceptés des 6 derniers mois pour ces formations, plafonnée à l'attendu.
- **Maintenance** : vérifications du matériel d'un client sans contrat actif, une visite par client, site et mois, au
  tarif de visite des réglages Interventions.
- **Contrats** : renouvellement à la fin du contrat, à son prix annuel.
- Aucun montant inventé : une échéance sans prix est comptée à part. Client inactif ou « ne pas solliciter » : gardé
  avec la mention, exclu des relances.

## Relances (moteur commun)

Nouveaux types, à valider dans « Relances à valider » : renouvellement d'un contrat qui se termine dans les 60 jours,
visite à proposer quand une vérification est due dans les 60 jours chez un client sans contrat et sans visite
planifiée. Les recyclages restent préparés comme avant (délai de l'obligation, 90 jours par défaut).

## Écrans

- Tableau de bord : encart « Chiffre d'affaires attendu » (12 barres, formation et maintenance, part devisée).
- Commerce > Prévisionnel : totaux, mois par mois avec le détail par client, filtre par nature, export tableur.
- Fiche client : ligne « Attendu sur 12 mois ».

## Choix

- Prix du catalogue compris comme un prix par stagiaire (le prix par jour sert aux groupes dans le devis de piste).
  À confirmer par H ; un écart se corrige dans la vue sans toucher aux données.
