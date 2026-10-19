# Fonction 11 : registre de sécurité numérique du client

Migration `0140_registre_securite.sql`, retour arrière `supabase/rollback/0140_registre_securite_retour.sql`, lot
`f11_0140`. Module « Registre de sécurité du client » (`registre`), actif d'emblée si Formation ou Interventions l'est.

## Ce que fait l'application

Pour chaque client et chaque site, sans recopie : dossier de contrôle (pièces à présenter et leur état),
vérifications du matériel (visites terminées, parc), exercices et essais, personnel formé et ses validités,
échéances, documents déposés, document unique (DUERP). Des faits datés et des échéances calculées, jamais une note de
conformité.

- **Espace entreprise** : onglet « Registre » (les salariés passent dans « Plus ») ; sélecteur de site (un compte
  limité ne voit que ses sites) ; « Ajouter un exercice » ; « Déposer un document » ; « Préparer le dossier (PDF) ».
- **Fiche client** (organisme) : carte « Registre de sécurité », même vue, ouverte à la demande.
- Pièces du dossier de contrôle : consigne incendie (R4227-37, R4227-38), plan d'évacuation, vérification du
  matériel dans les 12 mois (R4224-17), exercices et essais dans les 6 mois (R4227-39), personnes désignées et
  formées (R4227-38), sauveteurs secouristes du travail (R4224-15), DUERP à jour.
- Fichiers dans le bucket privé `registre`, chemin `<société>/<client>/<fichier>` : l'organisme par ses droits sur les
  clients, l'entreprise dans son seul dossier.
- Le registre alimente les registres légaux et fournit le PDF à présenter ; il ne prétend pas les remplacer (tenue sur
  support informatique : L8113-6 et décrets, à vérifier par registre). Les exercices déclarés par l'entreprise
  restent sous sa responsabilité.
- Le zip du dossier (rapports, attestations) n'est pas fait dans cette version : le PDF de synthèse liste tout, les
  pièces s'ouvrent une à une.

## Recette

1. Fiche d'un client fictif : carte « Registre de sécurité », dossier de contrôle, déposer une consigne.
2. Espace entreprise du même client : onglet Registre, ajouter un exercice, préparer le PDF.
