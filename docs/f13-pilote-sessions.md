# Fonction 13 : pilote automatique des sessions

Migration `0160_pilote_sessions.sql`, retour arrière `supabase/rollback/0160_pilote_sessions_retour.sql`, lot
`f13_0160`. Module « Pilote des sessions » (`pilote`), **inactif par défaut** : à activer depuis « Relances à
valider » > « Pilote des sessions » (ou Paramètres > Modules).

## Ce que fait l'application

Chaque nuit (tâche `maintenance-nuit`, après les relances), `pilote_generate()` prépare dans « Relances à valider » :

| Étape | Quand (réglable) | Condition, sinon raison du blocage |
|---|---|---|
| Convocation | J-7 | stagiaires inscrits, lieu, horaires, au moins un email |
| Rappel | J-1 | convocations parties |
| Émargement incomplet | fin de session, 7 jours | demi-journées non signées |
| Évaluation à chaud | J+1 | questionnaire non rempli (indicateur 30) |
| Attestations et certificats | fin de session | émargement complet, résultats saisis |
| Évaluation à froid | J+60 | non envoyée |
| Facture | fin de session | prix et client facturé connus ; rien pour une sous-traitance pour le compte d'un autre |
| Relance d'impayé | échéance + 7 puis + 30 jours | facture émise non soldée |

- Une seule action par session (ou facture), étape et palier : un passage rejoué ne prépare jamais deux fois.
- Une action bloquée reste visible avec sa raison et se débloque à la nuit suivante quand la session est complétée.
- Session annulée : ses actions à valider sont ignorées.
- **Rien n'est envoyé par l'application** (décision du 11/10) : l'action validée se fait depuis la session (envois
  existants) ou la messagerie, puis se marque « envoyée ». L'envoi automatique par type est réservé (toujours non).

## Écrans

- Relances à valider : filtre par type, « Tout valider » par type (hors actions bloquées), lien « Ouvrir la session »,
  raison du blocage ; bouton « Pilote des sessions » (réglages : étapes actives, délais, paliers d'impayé).
- Fiche session, onglet principal : frise « Pilote de la session » (faite, à valider, bloquée parce que…).
