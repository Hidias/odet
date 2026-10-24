// Modèles par défaut des documents qualité (procédures et documents d'organisation), validés le 12/10/2026.
// Champs {{org.*}} et {{role.*}} remplis à l'affichage ; les passages entre crochets restent à compléter par l'organisme.
// Fichier généré à partir du document de relecture : ne pas modifier à la main sans reporter la modification dans la relecture.

const TEMPLATES = {
 "proc-recl": {
  "id": "proc-recl",
  "num": "P01",
  "code": "QUAL-RECL",
  "name": "Réclamations, difficultés et aléas",
  "family": "procedures",
  "indicators": [
   31,
   32
  ],
  "pilote": "le référent réclamations",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Toute insatisfaction, difficulté ou imprévu est recueilli, traité dans un délai connu, répondu par écrit et transformé en amélioration quand il révèle un défaut. Personne ne doit avoir à insister pour être entendu."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Couvre** : les réclamations, difficultés et aléas venant d'un stagiaire, d'un client, d'un donneur d'ordre, d'un financeur ou d'un formateur, sur toute la prestation : demande d'information, devis, convention, convocation, déroulement, évaluation, documents de fin, facturation.",
       "**Ne couvre pas** : les violences, le harcèlement et les discriminations (procédure P11, traitement immédiat et confidentiel) ; les écarts constatés en interne sans plainte (procédure P02)."
      ]
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité (décret n° 2026-728) : indicateur 31 (traitement des difficultés, réclamations et aléas), indicateur 32 (amélioration continue).",
       "Documents liés : règlement intérieur, livret d'accueil, conditions générales de vente, information publique « Comment faire une réclamation »."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Définition",
       "Exemple"
      ],
      "rows": [
       [
        "Réclamation",
        "Expression d'un mécontentement, par n'importe quel moyen, qui attend une réponse.",
        "« Personne ne nous a prévenus du changement de salle. »"
       ],
       [
        "Difficulté",
        "Problème rencontré par une partie prenante, sans mécontentement exprimé.",
        "Un stagiaire ne parvient pas à suivre le rythme."
       ],
       [
        "Aléa",
        "Événement imprévu pendant la prestation, quelle qu'en soit l'origine.",
        "Formateur malade, salle inaccessible, matériel en panne."
       ],
       [
        "Demande d'information",
        "Question sans mécontentement. Elle n'est pas enregistrée ici.",
        "« Quand recevrai-je l'attestation ? »"
       ]
      ]
     },
     {
      "t": "p",
      "text": "En cas de doute entre demande d'information et réclamation, on enregistre une réclamation."
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Rôle",
       "Responsabilités"
      ],
      "rows": [
       [
        "Toute personne de l'organisme, formateurs sous-traitants compris",
        "Recueille, ne conteste pas sur le moment, transmet le jour même."
       ],
       [
        "Référent réclamations",
        "Enregistre, accuse réception, analyse, répond, suit l'action, clôture."
       ],
       [
        "Suppléant : la direction",
        "Remplace le référent absent plus de 2 jours ouvrés."
       ],
       [
        "Direction",
        "Valide la réponse quand elle comporte un geste commercial, met en cause une personne ou engage l'organisme."
       ],
       [
        "Formateur",
        "Traite sur place ce qui peut l'être (aléa, difficulté) et le note."
       ],
       [
        "Responsable qualité",
        "Fait le bilan annuel en revue de direction."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Entrées** : message oral, appel, email, courrier, formulaire en ligne, commentaire dans une évaluation, note de 1 à 3 sur 5 signalée par l'outil, remarque d'un financeur ou d'un donneur d'ordre.",
       "**Sorties** : réponse écrite au réclamant, action corrective si nécessaire, enregistrement complet.",
       "**Liens** : une réclamation fondée qui révèle un défaut ouvre une non-conformité (P02), qui alimente le plan d'actions et la revue de direction. Un aléa répété alimente la cartographie des risques."
      ]
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Délai",
       "Trace dans l'outil"
      ],
      "rows": [
       [
        "1. Recevoir",
        "Toute personne",
        "Transmission le jour même",
        "Fiche réclamation créée"
       ],
       [
        "2. Accuser réception",
        "Référent",
        "48 h ouvrées après réception",
        "Date d'accusé"
       ],
       [
        "3. Analyser",
        "Référent",
        "5 jours ouvrés",
        "Analyse des causes"
       ],
       [
        "4. Répondre",
        "Référent, validé par la direction si besoin",
        "10 jours ouvrés après réception",
        "Solution proposée, date de réponse"
       ],
       [
        "5. Agir",
        "Responsable désigné",
        "Fixé dans la réponse",
        "Action menée, lien vers la non-conformité"
       ],
       [
        "6. Clôturer",
        "Référent",
        "Dès l'action faite",
        "Date de clôture, réclamant satisfait ou non"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Recevoir.** La réclamation peut arriver par tout canal ; aucun canal n'est imposé. Si elle est orale, la personne qui la reçoit la reformule devant le réclamant pour vérifier qu'elle a compris, note les faits avec ses mots à lui, sans les interpréter, et demande à quelle adresse il souhaite la réponse. Elle la transmet au référent le jour même ; reçue un vendredi après 16 h ou une veille de jour férié, elle est transmise le jour ouvré suivant avant 10 h. Un commentaire d'évaluation qui exprime un mécontentement est traité comme une réclamation, même sans le mot. On ne conteste pas les faits sur le moment, on n'exige pas d'écrit, on ne promet pas de solution avant l'analyse."
     },
     {
      "t": "p",
      "text": "**Étape 2. Accuser réception.** Le référent crée la fiche dans Qualité > Réclamations : date et canal, réclamant (ou « anonyme »), session concernée, catégorie (réclamation, difficulté, aléa), faits rapportés. Il envoie un accusé de réception écrit qui indique le nom du référent, le numéro de la réclamation et la date de réponse au plus tard. Une réclamation anonyme est traitée, sans accusé ni réponse individuelle."
     },
     {
      "t": "p",
      "text": "**Étape 3. Analyser.** Le référent établit les faits : documents de la session, émargements, échanges écrits, et il entend chaque personne concernée, séparément, en commençant par le réclamant si un point reste flou. Il cherche la cause, pas un responsable : à quelle étape du processus le défaut est-il né ? Il conclut : fondée, partiellement fondée ou non fondée, avec la raison."
     },
     {
      "t": "p",
      "text": "**Étape 4. Répondre.** La réponse est écrite, dans un langage simple, et dit : ce qui a été vérifié, la conclusion, ce que l'organisme fait (geste, correction, rien et pourquoi), le nom de la personne à contacter si le réclamant n'est pas satisfait. La direction la valide avant envoi dans les cas prévus au point 5. Si le délai de 10 jours ouvrés ne peut pas être tenu, le réclamant en est informé par écrit avant son terme, avec une nouvelle date."
     },
     {
      "t": "p",
      "text": "**Étape 5. Agir.** Si la réclamation révèle un défaut, le référent ouvre une non-conformité (P02) depuis la fiche : l'action corrective, son responsable et son échéance y sont suivis, et son efficacité y est vérifiée."
     },
     {
      "t": "p",
      "text": "**Étape 6. Clôturer.** Le référent demande au réclamant s'il est satisfait de la réponse et note la réponse. Il clôture quand la réponse est envoyée et l'action faite ou transférée en non-conformité."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Pendant une session** : le formateur traite ce qui peut l'être tout de suite (salle, pause, matériel), le note dans la session et le signale le jour même. La réclamation suit quand même les étapes 2 à 6.",
       "**Aléa qui empêche la formation** (formateur absent, lieu fermé) : le client et les stagiaires sont prévenus dès que possible par téléphone puis par écrit ; une nouvelle date ou un remplaçant est proposé sous 2 jours ouvrés ; l'aléa est enregistré en catégorie « aléa ».",
       "**Session sous-traitée** : si l'organisme est sous-traitant, il transmet la réclamation au donneur d'ordre le jour même et applique aussi la procédure du donneur d'ordre. S'il est donneur d'ordre, le sous-traitant doit lui transmettre toute réclamation le jour même (clause du contrat).",
       "**Réclamation qui vise une personne de l'équipe** : elle est traitée par quelqu'un d'autre que la personne visée ; si le référent est visé, c'est la direction.",
       "**Faits de violence, de harcèlement ou de discrimination** : on arrête cette procédure et on applique immédiatement P11. Ces faits ne vont pas dans le registre des réclamations.",
       "**Réclamation d'un financeur** : réponse dans le délai du financeur s'il est plus court."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Personne n'est obligé d'écrire : l'oral suffit.",
       "Une personne en situation de handicap, ou qui maîtrise mal le français ou l'écrit, peut se faire aider par le référent handicap ou par la personne de son choix pour formuler sa réclamation et comprendre la réponse. La réponse lui est expliquée de vive voix si elle le souhaite.",
       "Aucune conséquence pour le réclamant : ni sur son évaluation, ni sur son inscription, ni sur la relation commerciale.",
       "Confidentialité : seules les personnes qui traitent la réclamation y ont accès."
      ]
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Fiche dans Qualité > Réclamations : toutes les dates, les faits, l'analyse, la réponse, l'action, la satisfaction du réclamant, les pièces jointes.",
       "Conservation : 5 ans après la clôture, puis suppression ou anonymisation."
      ]
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Nombre de réclamations, par catégorie et par cause",
        "Suivi, sans objectif",
        "Revue de direction annuelle"
       ],
       [
        "Accusés de réception envoyés sous 48 h ouvrées",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Réponses envoyées sous 10 jours ouvrés",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Réclamants satisfaits de la réponse",
        "80 % au moins",
        "Revue de direction"
       ],
       [
        "Réclamations fondées suivies d'une action",
        "100 %",
        "Revue de direction"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Réclamation orale oubliée : transmission le jour même, rappel dans la liste de clôture de session.",
       "Délai dépassé : échéances visibles dans l'outil, suppléant désigné.",
       "Réponse défensive ou jargonneuse : relecture par la direction quand une personne est en cause."
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Les canaux sont connus des stagiaires et des clients (livret, CGV, site, convocation).",
       "Chaque réclamation a un accusé, une analyse, une réponse datée et, si besoin, une action.",
       "Les réclamations nourrissent l'amélioration (lien vers P02 et la revue de direction).",
       "« Aucune réclamation » ne suffit pas : l'auditeur vérifie que le dispositif existe et qu'il est connu."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Diffusée à toute l'équipe et aux formateurs sous-traitants. Version publique : livret d'accueil, CGV, site internet, lien vers le formulaire en ligne.",
       "Révisée chaque année en revue de direction, et après toute réclamation qui révèle une faille de la procédure."
      ]
     }
    ]
   }
  ]
 },
 "proc-nc": {
  "id": "proc-nc",
  "num": "P02",
  "code": "QUAL-NC",
  "name": "Non-conformités et amélioration continue",
  "family": "procedures",
  "indicators": [
   31,
   32
  ],
  "pilote": "responsable qualité",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Traiter chaque écart de façon structurée : le corriger tout de suite, en chercher la cause, empêcher qu'il revienne, et vérifier que la mesure prise a vraiment marché. Alimenter le plan d'amélioration continue avec toutes les sources disponibles, pas seulement les réclamations."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Tout écart constaté dans les activités de l'organisme : prestations de formation, documents remis, accueil, accessibilité, sous-traitance, gestion administrative, outils. Toute personne de l'organisme, salariée, formatrice ou sous-traitante, peut et doit signaler un écart."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité, critère 7, indicateurs 31 et 32.",
       "Règles de l'organisme certificateur : non-conformité majeure à lever sous 3 mois, mineure sous 6 mois, 5 mineures sur un même audit valent 1 majeure.",
       "Procédure P01 Réclamations, difficultés et aléas.",
       "Procédure P03 Recueil des appréciations."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens dans cette procédure"
      ],
      "rows": [
       [
        "Non-conformité (NC)",
        "Écart entre ce qui est prévu (règle, procédure, engagement) et ce qui est réellement fait."
       ],
       [
        "NC interne",
        "Écart repéré par l'organisme lui-même : contrôle, revue, signalement d'un formateur."
       ],
       [
        "NC d'audit",
        "Écart relevé par l'auditeur de l'organisme certificateur, classé majeur ou mineur."
       ],
       [
        "Correction",
        "Action immédiate qui règle le cas présent (refaire un document, rappeler un stagiaire)."
       ],
       [
        "Action corrective",
        "Action sur la cause, pour que l'écart ne se reproduise pas."
       ],
       [
        "Action préventive",
        "Action sur un risque repéré avant qu'un écart ne survienne."
       ],
       [
        "Piste d'amélioration",
        "Idée de progrès qui ne répond à aucun écart (suggestion, retour positif à généraliser)."
       ],
       [
        "Efficacité",
        "Constat, à une date fixée, que l'écart ne s'est pas reproduit."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Toute personne",
        "Signale l'écart dans l'outil ou au responsable qualité dans la journée."
       ],
       [
        "Responsable qualité",
        "Enregistre, qualifie, anime l'analyse de cause, suit le plan d'actions, vérifie l'efficacité."
       ],
       [
        "Responsable de l'action",
        "Réalise l'action dans le délai fixé et le confirme dans l'outil."
       ],
       [
        "Direction",
        "Valide les actions qui engagent des moyens, arbitre les priorités, revoit le bilan en revue de direction."
       ],
       [
        "Référent pédagogique",
        "Participe à l'analyse quand l'écart touche le contenu ou l'animation d'une formation."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : réclamations et aléas (P01), appréciations des stagiaires, financeurs, entreprises et formateurs (P03), constats d'audit interne ou externe, contrôles de dossiers de session, veille (P04), signalements des formateurs et sous-traitants, alertes de l'outil (documents manquants, délais dépassés)."
     },
     {
      "t": "p",
      "text": "**Sorties** : fiche de non-conformité, plan d'actions d'amélioration, bilan annuel présenté en revue de direction, mise à jour des procédures ou des documents concernés."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Délai"
      ],
      "rows": [
       [
        "1. Signaler",
        "Toute personne",
        "Dans la journée"
       ],
       [
        "2. Enregistrer et qualifier",
        "Responsable qualité",
        "2 jours ouvrés"
       ],
       [
        "3. Corriger le cas présent",
        "Responsable désigné",
        "Immédiat ou 5 jours ouvrés"
       ],
       [
        "4. Analyser la cause",
        "Responsable qualité, avec les personnes concernées",
        "10 jours ouvrés"
       ],
       [
        "5. Décider et planifier l'action",
        "Responsable qualité, validation direction si moyens",
        "10 jours ouvrés"
       ],
       [
        "6. Réaliser",
        "Responsable de l'action",
        "Selon l'échéance fixée"
       ],
       [
        "7. Vérifier l'efficacité",
        "Responsable qualité",
        "3 mois après la réalisation"
       ],
       [
        "8. Clore et capitaliser",
        "Responsable qualité",
        "À la vérification"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Signaler.** La personne décrit les faits, sans jugement : ce qui était prévu, ce qui s'est passé, quand, pour quelle session ou quel client. Un signalement n'est jamais reproché à son auteur."
     },
     {
      "t": "p",
      "text": "**Étape 2. Enregistrer et qualifier.** Le responsable qualité crée la fiche, lui donne un numéro, rattache la session, le client ou le sous-traitant concerné, et choisit la gravité :"
     },
     {
      "t": "ul",
      "items": [
       "**critique** : atteinte à la sécurité d'une personne, au droit d'un stagiaire, ou risque de perte de la certification ; traité le jour même, direction informée immédiatement ;",
       "**importante** : impact direct sur un stagiaire ou un client ;",
       "**mineure** : écart interne sans impact constaté."
      ]
     },
     {
      "t": "p",
      "text": "Une NC d'audit reprend le classement de l'auditeur (majeure ou mineure) et son échéance officielle."
     },
     {
      "t": "p",
      "text": "**Étape 3. Corriger le cas présent.** Avant toute analyse, on règle la situation de la personne concernée : document refait et renvoyé, stagiaire recontacté, session reprogrammée. La correction est notée sur la fiche."
     },
     {
      "t": "p",
      "text": "**Étape 4. Analyser la cause.** On cherche pourquoi l'écart a pu se produire, pas qui l'a commis. Méthode simple : se demander « pourquoi » jusqu'à trouver une cause sur laquelle on peut agir (5 fois au plus). On vérifie aussi si le même écart existe ailleurs (autres sessions, autres formateurs)."
     },
     {
      "t": "p",
      "text": "**Étape 5. Décider et planifier.** Une action, un responsable, une échéance, un critère d'efficacité mesurable (« aucune convention non signée au démarrage sur les 3 prochains mois »). Si l'action change une procédure ou un modèle, la mise à jour est prévue dans l'action."
     },
     {
      "t": "p",
      "text": "**Étape 6. Réaliser.** Le responsable de l'action la mène et la confirme dans l'outil, avec la preuve (document modifié, compte rendu, message envoyé)."
     },
     {
      "t": "p",
      "text": "**Étape 7. Vérifier l'efficacité.** À l'échéance, le responsable qualité contrôle le critère. Si l'écart est revenu, la fiche est rouverte et l'analyse refaite."
     },
     {
      "t": "p",
      "text": "**Étape 8. Clore et capitaliser.** La fiche est close avec la date et le constat. Les enseignements utiles sont partagés à l'équipe et aux formateurs lors de la réunion suivante."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**NC d'audit** : la réponse à l'organisme certificateur (analyse, actions, preuves) est envoyée dans le délai indiqué par l'auditeur ; l'échéance de levée (3 ou 6 mois) est suivie dans le module Certification.",
       "**Écart chez un sous-traitant** : la fiche est ouverte par l'organisme, qui reste responsable vis-à-vis du client ; l'action est demandée au sous-traitant par écrit et son suivi entre dans l'évaluation du sous-traitant (P13).",
       "**Écart répété** : trois fiches de même nature en douze mois déclenchent une action de fond validée par la direction.",
       "**Piste d'amélioration sans écart** : enregistrée directement dans le plan d'amélioration, sans fiche de NC."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "p",
      "text": "Tout écart touchant une personne en situation de handicap (adaptation non mise en place, support illisible, lieu inaccessible) est classé au moins **importante** et le référent handicap participe à l'analyse. Un écart pouvant relever d'une discrimination est traité aussi selon la procédure P11."
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Fiches de NC et leurs pièces, plan d'amélioration à jour, réponses aux audits, comptes rendus de revue de direction. Conservation 5 ans."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Délai moyen de qualification",
        "2 jours ouvrés",
        "Trimestrielle"
       ],
       [
        "Actions réalisées dans le délai",
        "90 %",
        "Trimestrielle"
       ],
       [
        "Actions jugées efficaces à 3 mois",
        "80 %",
        "Revue de direction"
       ],
       [
        "NC d'audit levées dans le délai officiel",
        "100 %",
        "À chaque audit"
       ],
       [
        "Écarts répétés",
        "0",
        "Revue de direction"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Les écarts ne sont pas signalés par peur d'être mis en cause",
        "Analyse centrée sur la cause, jamais sur la personne ; rappel en réunion."
       ],
       [
        "Actions décidées mais jamais faites",
        "Échéance et responsable obligatoires, relance par l'outil."
       ],
       [
        "Action faite mais sans effet",
        "Vérification d'efficacité obligatoire avant clôture."
       ],
       [
        "Plan d'amélioration qui ne s'appuie que sur les réclamations",
        "Revue trimestrielle de toutes les sources de l'étape « Entrées »."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Que les appréciations et réclamations sont réellement analysées (ind. 32).",
       "Qu'un plan d'actions existe, daté, avec des actions mises en place et suivies.",
       "Que les causes sont recherchées et que l'efficacité est vérifiée.",
       "Que les NC des audits précédents sont levées dans les délais."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à l'équipe permanente et aux formateurs, y compris sous-traitants. Revue chaque année en revue de direction et après chaque audit."
     }
    ]
   }
  ]
 },
 "proc-sat": {
  "id": "proc-sat",
  "num": "P03",
  "code": "QUAL-APPR",
  "name": "Recueil des appréciations",
  "family": "procedures",
  "indicators": [
   30
  ],
  "pilote": "responsable qualité",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Recueillir de façon systématique l'avis de toutes les parties prenantes (stagiaires, entreprises, financeurs, formateurs), à chaud et à froid, puis exploiter ces avis pour améliorer les prestations et publier des résultats exacts."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Toutes les sessions, intra, inter et sous-traitées, quel que soit le financement. Les quatre publics :"
     },
     {
      "t": "table",
      "head": [
       "Public",
       "Quand",
       "Support"
      ],
      "rows": [
       [
        "Stagiaire, à chaud",
        "Dernière demi-journée de la session",
        "Questionnaire en ligne (QR code) ou papier"
       ],
       [
        "Stagiaire, à froid",
        "90 jours après la fin",
        "Questionnaire en ligne envoyé par courriel"
       ],
       [
        "Entreprise ou donneur d'ordre",
        "Dans les 5 jours ouvrés après la fin",
        "Formulaire prérempli, remplissable à l'écran ou imprimé, signé et renvoyé"
       ],
       [
        "Formateur",
        "Le jour de la fin de session",
        "Bilan formateur dans l'outil"
       ],
       [
        "Financeur (OPCO, France Travail, autre)",
        "À réception de leurs propres enquêtes, ou une fois par an",
        "Leur questionnaire ou un échange tracé"
       ]
      ]
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité, indicateur 30 ; indicateur 2 pour la publication des résultats.",
       "RGPD : information des répondants, durée de conservation (P12).",
       "Procédure P02 Non-conformités et amélioration continue."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "À chaud",
        "Avis donné en fin de formation, sur le déroulement et le ressenti."
       ],
       [
        "À froid",
        "Avis donné après retour au poste, sur la mise en pratique."
       ],
       [
        "Taux de retour",
        "Nombre de questionnaires reçus divisé par le nombre de personnes sollicitées."
       ],
       [
        "Avis négatif",
        "Note globale inférieure ou égale à 2 sur 5, ou commentaire signalant un problème."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Formateur",
        "Fait remplir le questionnaire à chaud en séance, en laissant le temps nécessaire, sans lire les réponses en présence du stagiaire. Remplit son bilan."
       ],
       [
        "Gestion administrative",
        "Vérifie l'envoi du questionnaire entreprise et des questionnaires à froid ; relance une fois."
       ],
       [
        "Responsable qualité",
        "Lit tous les avis négatifs, déclenche les suites, produit la synthèse trimestrielle et les résultats publiés."
       ],
       [
        "Direction",
        "Revoit la synthèse annuelle en revue de direction."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : liste des stagiaires et contacts de la session, modèles de questionnaires."
     },
     {
      "t": "p",
      "text": "**Sorties** : réponses enregistrées par session, alertes sur avis négatifs, synthèse trimestrielle, résultats publiés (ind. 2), actions dans le plan d'amélioration (P02)."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Délai"
      ],
      "rows": [
       [
        "1. Préparer",
        "Gestion administrative",
        "À la création de la session"
       ],
       [
        "2. Recueillir à chaud",
        "Formateur",
        "Dernière demi-journée"
       ],
       [
        "3. Bilan formateur",
        "Formateur",
        "Jour de fin"
       ],
       [
        "4. Recueillir l'avis de l'entreprise",
        "Gestion administrative",
        "5 jours ouvrés après la fin"
       ],
       [
        "5. Recueillir à froid",
        "Outil, contrôle par la gestion",
        "90 jours après la fin, relance à J+104"
       ],
       [
        "6. Traiter les avis négatifs",
        "Responsable qualité",
        "5 jours ouvrés après réception"
       ],
       [
        "7. Analyser et publier",
        "Responsable qualité",
        "Chaque trimestre"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Préparer.** Les contacts (courriel stagiaire, contact entreprise) sont vérifiés. Pour une session sous-traitée, on convient avec le donneur d'ordre de qui recueille quoi ; à défaut, l'organisme recueille lui-même."
     },
     {
      "t": "p",
      "text": "**Étape 2. Recueillir à chaud.** Le formateur prévoit 10 minutes en fin de session. Il explique que le questionnaire est anonyme dans sa lecture par le formateur et sert à améliorer la formation. Un stagiaire qui ne peut pas utiliser le téléphone reçoit la version papier, ou est aidé par une personne de son choix autre que le formateur."
     },
     {
      "t": "p",
      "text": "**Étape 3. Bilan formateur.** Le formateur note le niveau du groupe, les conditions matérielles, les difficultés et les réussites."
     },
     {
      "t": "p",
      "text": "**Étape 4. Avis de l'entreprise.** Le formulaire prérempli (session, dates, stagiaires) est envoyé au contact. Il peut être rempli à l'écran et signé à la souris, ou imprimé, signé et numérisé. Le document retourné est déposé dans la session."
     },
     {
      "t": "p",
      "text": "**Étape 5. À froid.** L'envoi part automatiquement à 90 jours. Sans réponse, une relance unique 14 jours plus tard. On ne relance pas davantage."
     },
     {
      "t": "p",
      "text": "**Étape 6. Avis négatifs.** Tout avis négatif est lu sous 5 jours ouvrés. S'il signale un problème précis, il est traité comme une réclamation ou un aléa (P01) ; la personne est recontactée si elle s'est identifiée."
     },
     {
      "t": "p",
      "text": "**Étape 7. Analyser et publier.** Chaque trimestre, synthèse par formation et par formateur : notes moyennes, taux de retour, thèmes des commentaires. Les résultats publiés (satisfaction, recommandation, objectifs atteints, assiduité) sont recalculés dans le module Certification, page Méthode de calcul, puis mis à jour sur le site."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Session d'une demi-journée** : questionnaire à chaud simplifié, même contenu essentiel.",
       "**Stagiaire parti avant la fin** : questionnaire proposé à son départ ; le motif du départ est noté (P15).",
       "**Taux de retour faible** (moins de 50 % à chaud sur une session) : le formateur est interrogé sur les conditions de passation.",
       "**Résultats sur moins de 10 réponses** : publiés avec la mention « effectif réduit »."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Questionnaires rédigés en phrases courtes, échelle de 1 à 5 avec libellés, lisibles sur téléphone et compatibles avec le zoom.",
       "Version papier en gros caractères disponible sur demande ; lecture à voix haute possible par une personne choisie par le stagiaire.",
       "Pour un stagiaire qui maîtrise mal le français, le formateur reformule les questions sans orienter les réponses.",
       "Aucune question sur l'origine, la religion, la santé ou toute caractéristique personnelle sans lien avec la formation."
      ]
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Réponses aux questionnaires, formulaires entreprises signés, bilans formateurs, synthèses trimestrielles, versions publiées des résultats. Conservation 5 ans."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Taux de retour à chaud",
        "95 %",
        "Trimestrielle"
       ],
       [
        "Taux de retour à froid",
        "40 %",
        "Trimestrielle"
       ],
       [
        "Taux de retour entreprises",
        "60 %",
        "Trimestrielle"
       ],
       [
        "Satisfaction globale",
        "4,5 sur 5",
        "Trimestrielle"
       ],
       [
        "Avis négatifs traités sous 5 jours ouvrés",
        "100 %",
        "Trimestrielle"
       ]
      ]
     },
     {
      "t": "p",
      "text": "Ces objectifs sont internes ; ils ne sont pas exigés par le référentiel."
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Réponses biaisées par la présence du formateur",
        "Le formateur ne lit pas les réponses en séance ; questionnaire en ligne."
       ],
       [
        "Oubli de l'avis entreprise",
        "Contrôle dans la check-list de clôture de session."
       ],
       [
        "Avis collectés mais jamais lus",
        "Alerte sur chaque avis négatif, synthèse trimestrielle obligatoire."
       ],
       [
        "Résultats publiés inexacts",
        "Calcul automatique, méthode publiée avec les résultats, données de démonstration effacées avant publication."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Que l'avis de toutes les parties prenantes est recueilli, pas seulement celui des stagiaires (ind. 30).",
       "Que les avis sont analysés et donnent lieu à des actions (ind. 32).",
       "Que les résultats publiés correspondent aux données et que la méthode est expliquée (ind. 2)."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée aux formateurs, y compris sous-traitants, et à l'équipe. Questionnaires revus chaque année en revue de direction."
     }
    ]
   }
  ]
 },
 "proc-veille": {
  "id": "proc-veille",
  "num": "P04",
  "code": "QUAL-VEIL",
  "name": "Veille",
  "family": "procedures",
  "indicators": [
   23,
   24,
   25
  ],
  "pilote": "direction",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Se tenir informé de façon organisée des évolutions qui touchent l'activité, et surtout **les exploiter** : chaque information utile doit aboutir à une décision tracée (adapter un programme, un document, une pratique) ou à un constat « sans impact »."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Trois domaines de veille, imposés par le référentiel :"
     },
     {
      "t": "table",
      "head": [
       "Domaine",
       "Ind.",
       "Ce qu'on surveille"
      ],
      "rows": [
       [
        "Légale et réglementaire",
        "23",
        "Code du travail (formation professionnelle, santé et sécurité), référentiel qualité, obligations des organismes, financements (OPCO, CPF, France Travail), référentiels techniques des formations (INRS, CNAM, normes)."
       ],
       [
        "Compétences, métiers et emplois",
        "24",
        "Évolution des métiers des clients, besoins des branches, accidents et risques émergents, évolution des équipements."
       ],
       [
        "Innovations pédagogiques et technologiques",
        "25",
        "Méthodes d'animation, outils numériques, simulation, accessibilité numérique, nouveaux matériels de formation."
       ]
      ]
     },
     {
      "t": "p",
      "text": "Le handicap et l'accessibilité sont suivis dans les trois domaines (réglementation, adaptations métiers, outils de compensation)."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité, critère 6, indicateurs 23 à 25.",
       "Procédure P02 (actions issues de la veille), P06 (mise à jour des programmes)."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Source",
        "Site, publication, réseau ou personne qui fournit l'information."
       ],
       [
        "Information de veille",
        "Fait nouveau daté et sourcé (texte publié, recommandation, nouvel outil)."
       ],
       [
        "Exploitation",
        "Décision prise à partir de l'information, avec son résultat."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Direction",
        "Pilote, tient à jour la liste des sources, décide des suites, fait le bilan annuel."
       ],
       [
        "Référent pédagogique",
        "Veille compétences et pédagogie ; met à jour les programmes concernés."
       ],
       [
        "Formateurs",
        "Veille sur leur spécialité (obligatoire pour garder la qualification, voir P14) ; remontent ce qu'ils observent chez les clients."
       ],
       [
        "Référent handicap",
        "Veille sur l'accessibilité et les aides à la compensation."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : sources listées dans le registre, retours terrain des formateurs, échanges avec les clients et financeurs, salons et réseaux professionnels."
     },
     {
      "t": "p",
      "text": "**Sorties** : registre de veille daté, décisions tracées, programmes et documents mis à jour (avec version), informations partagées à l'équipe et aux formateurs."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Rythme"
      ],
      "rows": [
       [
        "1. Tenir la liste des sources",
        "Direction",
        "Revue annuelle"
       ],
       [
        "2. Consulter les sources",
        "Chacun dans son domaine",
        "Au moins une fois par mois"
       ],
       [
        "3. Enregistrer l'information utile",
        "Celui qui l'a repérée",
        "Sous 5 jours ouvrés"
       ],
       [
        "4. Analyser l'impact",
        "Direction et référent concerné",
        "Sous 1 mois, ou avant l'entrée en vigueur"
       ],
       [
        "5. Mettre en œuvre",
        "Responsable désigné",
        "Selon l'échéance"
       ],
       [
        "6. Informer",
        "Direction",
        "Réunion d'équipe suivante"
       ],
       [
        "7. Faire le bilan",
        "Direction",
        "Revue de direction"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Liste des sources.** Le registre liste, par domaine, les sources suivies et qui les suit (exemples : Légifrance et le site du ministère du Travail, INRS, réseau des formateurs SST, sites des OPCO, Agefiph, réseaux professionnels). On privilégie les sources officielles."
     },
     {
      "t": "p",
      "text": "**Étape 2. Consulter.** Chacun consulte ses sources au rythme fixé. Les abonnements (lettres d'information, alertes) sont préférés à la recherche manuelle."
     },
     {
      "t": "p",
      "text": "**Étape 3. Enregistrer.** On ne note que ce qui peut avoir un effet sur l'organisme : date, source, résumé en une ou deux phrases, domaine, date d'effet si elle existe."
     },
     {
      "t": "p",
      "text": "**Étape 4. Analyser l'impact.** Pour chaque information : quels programmes, documents, pratiques ou clients sont concernés ? Décision : action à mener, ou « sans impact » avec la raison. Une obligation nouvelle est traitée avant sa date d'effet."
     },
     {
      "t": "p",
      "text": "**Étape 5. Mettre en œuvre.** L'action est suivie comme une action d'amélioration (P02). Un programme modifié change de version (P06)."
     },
     {
      "t": "p",
      "text": "**Étape 6. Informer.** Les informations qui changent la pratique sont expliquées à l'équipe et aux formateurs concernés, sous-traitants compris, avec trace de la diffusion."
     },
     {
      "t": "p",
      "text": "**Étape 7. Bilan.** Nombre d'informations, décisions prises, sources à ajouter ou à retirer."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Changement urgent** (texte d'application immédiate, alerte sécurité sur un équipement) : analyse sous 5 jours ouvrés, formateurs prévenus avant leur prochaine session.",
       "**Information reçue d'un client** : enregistrée comme les autres, en citant la source."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "p",
      "text": "La veille couvre explicitement les aides au handicap (Agefiph, FIPHFP, ressources handicap formation), les outils de compensation (lecture d'écran, sous-titrage, supports adaptés) et l'évolution des règles de non-discrimination et de lutte contre les violences. Les résultats alimentent P09, P10 et P11."
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Registre de veille avec décisions, versions successives des programmes, comptes rendus de diffusion. Conservation 5 ans."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Informations enregistrées dans chacun des trois domaines",
        "Au moins 1 par trimestre et par domaine",
        "Trimestrielle"
       ],
       [
        "Informations analysées sous 1 mois",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Obligations nouvelles traitées avant leur date d'effet",
        "100 %",
        "Revue de direction"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Veille faite mais non tracée",
        "Enregistrement court et obligatoire, rythme mensuel."
       ],
       [
        "Informations accumulées sans suite",
        "Décision obligatoire pour chaque information, même « sans impact »."
       ],
       [
        "Formateurs sous-traitants non informés",
        "Diffusion tracée, rappel avant chaque session."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Qu'une veille existe dans les trois domaines (ind. 23, 24, 25).",
       "Qu'elle est **exploitée** : exemples concrets de programmes ou pratiques modifiés.",
       "Que l'équipe et les formateurs sont informés."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à l'équipe et aux formateurs. Liste des sources revue chaque année."
     }
    ]
   }
  ]
 },
 "proc-besoin": {
  "id": "proc-besoin",
  "num": "P05",
  "code": "QUAL-BES",
  "name": "Analyse des besoins",
  "family": "procedures",
  "indicators": [
   4,
   8
  ],
  "pilote": "direction",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Avant toute proposition, comprendre précisément ce dont le client et les futurs stagiaires ont besoin, pour proposer une formation adaptée (contenu, durée, modalités, lieu) ou dire honnêtement qu'on n'est pas le bon interlocuteur."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Toute demande de formation : entreprise (intra ou inter), particulier, financeur, donneur d'ordre en sous-traitance. Le niveau d'analyse est proportionné :"
     },
     {
      "t": "table",
      "head": [
       "Situation",
       "Analyse attendue"
      ],
      "rows": [
       [
        "Formation réglementaire standard en inter (SST, habilitation)",
        "Fiche de besoin courte : public, prérequis, contraintes, besoins d'adaptation."
       ],
       [
        "Intra standard",
        "Fiche de besoin complète, échange avec le référent de l'entreprise."
       ],
       [
        "Formation sur mesure ou nouveau besoin",
        "Entretien approfondi, visite si utile, proposition construite (P06)."
       ],
       [
        "Sous-traitance",
        "Besoin transmis par le donneur d'ordre, complété si nécessaire auprès de lui."
       ]
      ]
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité, indicateur 4 (analyse du besoin), indicateur 8 (positionnement à l'entrée).",
       "Procédure P06 Conception, P09 Handicap."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Besoin",
        "Écart entre la situation actuelle et la situation visée, exprimé en compétences."
       ],
       [
        "Demande",
        "Ce que le client formule au départ (souvent un intitulé de formation)."
       ],
       [
        "Positionnement",
        "Évaluation du niveau de chaque stagiaire avant ou au début de la formation."
       ],
       [
        "Prérequis",
        "Ce que le stagiaire doit savoir ou pouvoir faire pour suivre la formation."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Direction ou chargé de relation client",
        "Mène l'échange, remplit la fiche de besoin, rédige la proposition."
       ],
       [
        "Référent pédagogique",
        "Valide la proposition quand elle sort du catalogue."
       ],
       [
        "Formateur",
        "Fait le positionnement des stagiaires et adapte en début de session."
       ],
       [
        "Référent handicap",
        "Intervient dès qu'un besoin d'adaptation est signalé (P09)."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : demande du client (téléphone, courriel, formulaire, rendez-vous), informations sur l'entreprise, éventuel document unique (DUERP)."
     },
     {
      "t": "p",
      "text": "**Sorties** : fiche d'analyse du besoin datée, proposition ou devis, programme adapté, résultats du positionnement."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Délai"
      ],
      "rows": [
       [
        "1. Accuser réception de la demande",
        "Direction",
        "2 jours ouvrés"
       ],
       [
        "2. Recueillir le besoin",
        "Direction",
        "Au premier échange"
       ],
       [
        "3. Vérifier qu'on peut y répondre",
        "Direction, référent pédagogique",
        "Avant la proposition"
       ],
       [
        "4. Proposer",
        "Direction",
        "5 jours ouvrés après le recueil"
       ],
       [
        "5. Positionner les stagiaires",
        "Formateur",
        "Avant ou au début de la session"
       ],
       [
        "6. Ajuster",
        "Formateur",
        "Dès le positionnement"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 2. Recueillir le besoin.** La fiche de besoin couvre au minimum :"
     },
     {
      "t": "ul",
      "items": [
       "le contexte : activité de l'entreprise, événement déclencheur (obligation, accident, nouvel équipement, recrutement) ;",
       "l'objectif visé, formulé en ce que les stagiaires sauront faire après ;",
       "le public : nombre, postes, expérience, niveau de français, formations déjà suivies et dates de validité (recyclages) ;",
       "les besoins d'adaptation : handicap, maîtrise de la lecture, horaires décalés, contraintes religieuses ou familiales exprimées, toujours sur une base déclarative et sans demander de diagnostic ;",
       "les contraintes : dates, lieu, salle, équipements disponibles, budget, financement ;",
       "les attendus particuliers : risques propres au site, matériel de l'entreprise à utiliser."
      ]
     },
     {
      "t": "p",
      "text": "**Étape 3. Vérifier qu'on peut y répondre.** Formateur qualifié disponible, matériel, lieu accessible, délai réaliste. Si ce n'est pas le cas, on le dit et on oriente vers un autre organisme ou une autre solution."
     },
     {
      "t": "p",
      "text": "**Étape 4. Proposer.** La proposition reprend le besoin tel qu'il a été compris, les objectifs, le programme, les modalités, la durée, le prix, les conditions d'accessibilité. Le client confirme que le besoin est bien compris en acceptant la proposition."
     },
     {
      "t": "p",
      "text": "**Étape 5. Positionner.** Selon la formation : questionnaire de positionnement en ligne avant la session, tour de table structuré, ou vérification des prérequis (carte SST en cours de validité pour un recyclage). Le résultat est enregistré par stagiaire."
     },
     {
      "t": "p",
      "text": "**Étape 6. Ajuster.** Le formateur adapte le rythme, les exemples et les exercices aux résultats, dans le respect des objectifs et de la durée. Un stagiaire qui ne remplit pas un prérequis obligatoire est signalé immédiatement à la direction, qui décide avec l'entreprise."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Demande urgente** : le recueil peut être fait par téléphone, mais la fiche est remplie et datée avant la session.",
       "**Client récurrent** : la fiche est reprise et mise à jour, pas recopiée telle quelle.",
       "**Besoin réel différent de la demande** : on le dit au client et on argumente, la décision lui revient."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "La question des besoins d'adaptation est **toujours** posée, au client et à chaque stagiaire (fiche de renseignement), avec une formulation neutre : « Avez-vous besoin d'un aménagement pour suivre la formation dans de bonnes conditions ? ».",
       "Aucune information de santé n'est demandée ; seul l'aménagement utile est noté.",
       "Les prérequis sont limités à ce qui est strictement nécessaire et ne doivent pas exclure sans raison (exemple : exiger la lecture d'un écrit long alors que la formation est pratique)."
      ]
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Fiches de besoin, propositions et devis, résultats de positionnement. Conservation 5 ans."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Sessions avec fiche de besoin datée avant le démarrage",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Stagiaires positionnés",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Proposition envoyée sous 5 jours ouvrés",
        "90 %",
        "Trimestrielle"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Devis envoyé sans comprendre le besoin",
        "Fiche de besoin obligatoire avant tout devis hors catalogue standard."
       ],
       [
        "Besoin d'adaptation découvert le jour J",
        "Question systématique au client et sur la fiche stagiaire."
       ],
       [
        "Stagiaire sans les prérequis",
        "Vérification avant la session, décision tracée."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Une analyse du besoin tracée pour les sessions de l'échantillon (ind. 4), cohérente avec le programme livré.",
       "Le positionnement des stagiaires et son usage (ind. 8).",
       "La prise en compte des besoins d'adaptation."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à l'équipe commerciale et aux formateurs. Fiche de besoin revue chaque année."
     }
    ]
   }
  ]
 },
 "proc-concep": {
  "id": "proc-concep",
  "num": "P06",
  "code": "QUAL-CONC",
  "name": "Conception et mise à jour des formations",
  "family": "procedures",
  "indicators": [
   5,
   6
  ],
  "pilote": "référent pédagogique",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Concevoir chaque formation de façon rigoureuse (objectifs évaluables, contenus, méthodes, évaluation, durée cohérente) et tenir les programmes à jour, avec un historique des versions."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Toute formation du catalogue et toute formation sur mesure. Toute modification d'un programme existant (contenu, durée, méthode, évaluation, référentiel technique)."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité, indicateurs 5 (objectifs) et 6 (contenus et modalités) ; indicateur 1 pour l'information publiée.",
       "Référentiels techniques des formations réglementées (exemples : document de référence SST de l'INRS, recommandations CNAM pour la conduite d'engins, norme NF C 18-510 pour l'habilitation électrique).",
       "Procédures P04 Veille, P05 Analyse des besoins, P08 Évaluation des acquis."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Objectif opérationnel",
        "Ce que le stagiaire saura faire à la fin, formulé avec un verbe d'action observable (« réaliser », « identifier », « conduire »), jamais « connaître » ou « comprendre » seuls."
       ],
       [
        "Programme",
        "Document qui décrit objectifs, public, prérequis, durée, contenu, méthodes, moyens, évaluation, accessibilité, prix et délai d'accès."
       ],
       [
        "Version",
        "Numéro et date d'un programme ; toute modification crée une nouvelle version."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Référent pédagogique",
        "Conçoit ou fait concevoir, vérifie la cohérence, valide et date la version."
       ],
       [
        "Formateur spécialiste",
        "Rédige les contenus techniques, propose les exercices et les évaluations."
       ],
       [
        "Direction",
        "Valide les nouvelles formations (prix, moyens, positionnement commercial)."
       ],
       [
        "Référent handicap",
        "Relit la rubrique accessibilité et les adaptations possibles."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : besoin analysé (P05), référentiel technique, veille (P04), appréciations et résultats des sessions précédentes (P03, P08)."
     },
     {
      "t": "p",
      "text": "**Sorties** : programme daté et versionné, déroulé pédagogique, supports, outils d'évaluation, liste du matériel, registre des versions."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Quand"
      ],
      "rows": [
       [
        "1. Partir du besoin et du référentiel",
        "Référent pédagogique",
        "Au lancement"
       ],
       [
        "2. Écrire les objectifs",
        "Référent pédagogique, formateur",
        "Avant tout contenu"
       ],
       [
        "3. Construire le déroulé",
        "Formateur",
        "Ensuite"
       ],
       [
        "4. Prévoir l'évaluation",
        "Formateur",
        "En même temps que le déroulé"
       ],
       [
        "5. Prévoir l'accessibilité",
        "Référent handicap",
        "Avant validation"
       ],
       [
        "6. Relire et valider",
        "Référent pédagogique, direction",
        "Avant la première session"
       ],
       [
        "7. Publier",
        "Direction",
        "Après validation"
       ],
       [
        "8. Revoir",
        "Référent pédagogique",
        "Chaque année et à chaque déclencheur"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 2. Écrire les objectifs.** Chaque objectif est observable et évaluable. Exemple : « Mettre la victime en position latérale de sécurité » plutôt que « Connaître les gestes de secours »."
     },
     {
      "t": "p",
      "text": "**Étape 3. Construire le déroulé.** Pour chaque séquence : objectif visé, durée, méthode (apport, démonstration, mise en situation, étude de cas), support, matériel. La part de pratique est adaptée à l'objectif ; une formation au geste comporte une majorité de pratique."
     },
     {
      "t": "p",
      "text": "**Étape 4. Prévoir l'évaluation.** Chaque objectif a une modalité d'évaluation et un critère de réussite (P08). Pour une formation certifiante ou réglementée, on applique la grille officielle."
     },
     {
      "t": "p",
      "text": "**Étape 5. Accessibilité.** Le programme indique les adaptations possibles (rythme, supports, matériel), les limites réelles s'il en existe (exemple : aptitude médicale exigée pour la conduite d'engins) et le contact du référent handicap."
     },
     {
      "t": "p",
      "text": "**Étape 6. Relire et valider.** Contrôle : objectifs évaluables, durée cohérente avec le contenu, conformité au référentiel technique, mentions obligatoires présentes, langage clair. Le programme reçoit un numéro de version, une date et le nom du valideur."
     },
     {
      "t": "p",
      "text": "**Étape 7. Publier.** Mise à jour du catalogue, du site et de l'outil. Les formateurs reçoivent la nouvelle version."
     },
     {
      "t": "p",
      "text": "**Étape 8. Revoir.** Revue annuelle de chaque programme, et revue immédiate en cas de changement de référentiel, d'écart constaté, de résultats d'évaluation faibles ou d'appréciations négatives répétées. La raison du changement est notée dans le registre des versions."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Formation sur mesure** : le programme est construit à partir de la fiche de besoin et remis au client avec la proposition ; il suit les mêmes règles.",
       "**Formation à distance ou mixte** : le programme précise les outils, l'assistance technique et pédagogique, les délais de réponse et la manière dont l'assiduité est vérifiée.",
       "**Formation sous-traitée** : le programme du donneur d'ordre s'applique ; on vérifie qu'il est conforme avant d'accepter."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Supports conçus lisibles : police sans empattement, taille suffisante, contraste fort, pas d'information portée par la couleur seule, images accompagnées d'un texte.",
       "Langage clair, phrases courtes, vocabulaire technique expliqué.",
       "Exemples et visuels variés : femmes et hommes, âges, origines, personnes en situation de handicap, dans tous les rôles, sans stéréotype."
      ]
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Programmes datés et versionnés, registre des versions (date, raison, valideur), déroulés, supports, outils d'évaluation. Conservation de toutes les versions pendant 5 ans après leur remplacement."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Programmes revus dans l'année",
        "100 %",
        "Revue de direction"
       ],
       [
        "Programmes conformes à la liste de contrôle",
        "100 %",
        "À chaque version"
       ],
       [
        "Délai entre changement de référentiel et mise à jour",
        "Avant la date d'effet",
        "À chaque cas"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Objectifs flous, non évaluables",
        "Relecture avec la liste de contrôle avant validation."
       ],
       [
        "Formateur qui utilise une ancienne version",
        "Diffusion de chaque version, version visible sur les supports."
       ],
       [
        "Programme publié différent du programme réalisé",
        "Une seule source (l'outil), publication après validation."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Des objectifs opérationnels et évaluables (ind. 5).",
       "Des contenus et modalités cohérents avec les objectifs et le public (ind. 6).",
       "L'historique des mises à jour et leur lien avec la veille."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée au référent pédagogique et à tous les formateurs. Revue chaque année."
     }
    ]
   }
  ]
 },
 "proc-real": {
  "id": "proc-real",
  "num": "P07",
  "code": "QUAL-REAL",
  "name": "Réalisation des formations",
  "family": "procedures",
  "indicators": [
   9,
   10,
   12,
   17,
   18,
   19
  ],
  "pilote": "direction",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Garantir que chaque session se déroule comme prévu, de la confirmation jusqu'à l'envoi des documents de fin : stagiaires informés, formateur préparé, lieu et matériel prêts, présence et progression suivies, documents complets."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Toutes les sessions : intra, inter, sous-traitées, en présentiel, à distance ou mixtes."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité : ind. 9 (information sur les conditions de déroulement), 10 (adaptation), 12 (engagement), 17 (moyens humains et techniques), 18 (coordination des intervenants), 19 (ressources pédagogiques).",
       "Code du travail : convention ou contrat de formation (L6353-1 et suivants), feuilles d'émargement, attestation de fin de formation (L6353-1), règlement intérieur (L6352-3 et suivants).",
       "Procédures P01, P03, P08, P10, P15."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Convocation",
        "Document envoyé à chaque stagiaire : dates, horaires, adresse exacte, accès, contact, équipement à apporter, règlement intérieur et livret d'accueil."
       ],
       [
        "Dossier de session",
        "Ensemble des documents d'une session, tenu dans l'outil."
       ],
       [
        "Check-list de session",
        "Liste des contrôles avant, pendant et après, cochée dans l'outil."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Direction ou gestion administrative",
        "Planifie, contractualise, convoque, prépare les documents, clôture."
       ],
       [
        "Formateur",
        "Prépare, anime, fait émarger, évalue, remplit son bilan, signale les aléas."
       ],
       [
        "Référent pédagogique",
        "Briefe le formateur, surtout s'il est nouveau ou sous-traitant."
       ],
       [
        "Référent handicap",
        "Vérifie que les adaptations prévues sont en place."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : proposition acceptée, programme validé, liste des stagiaires, besoins d'adaptation."
     },
     {
      "t": "p",
      "text": "**Sorties** : convention signée, convocations, feuilles d'émargement par demi-journée, évaluations, appréciations, attestations, certificats le cas échéant, facture, dossier de session complet."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Délai"
      ],
      "rows": [
       [
        "1. Contractualiser",
        "Direction",
        "Avant le début, convention signée"
       ],
       [
        "2. Affecter formateur, lieu, matériel",
        "Direction",
        "Dès confirmation"
       ],
       [
        "3. Convoquer",
        "Gestion administrative",
        "Dès confirmation, au plus tard 7 jours avant si possible"
       ],
       [
        "4. Préparer la session",
        "Formateur, gestion",
        "La semaine précédente"
       ],
       [
        "5. Accueillir",
        "Formateur",
        "Première demi-journée"
       ],
       [
        "6. Animer et suivre",
        "Formateur",
        "Pendant la session"
       ],
       [
        "7. Clôturer en séance",
        "Formateur",
        "Dernière demi-journée"
       ],
       [
        "8. Envoyer les documents de fin",
        "Gestion administrative",
        "5 jours ouvrés après la fin"
       ],
       [
        "9. Contrôler le dossier",
        "Responsable qualité",
        "10 jours ouvrés après la fin"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Contractualiser.** Convention avec l'entreprise, ou contrat avec le particulier qui finance lui-même : délai de rétractation de 10 jours, aucune somme exigée avant son expiration, puis acompte limité à 30 % du prix (L6353-5 et L6353-6). Le programme est annexé."
     },
     {
      "t": "p",
      "text": "**Étape 2. Affecter.** Formateur qualifié pour cette formation (P14), salle adaptée et accessible (P10), matériel réservé et en bon état, en nombre suffisant pour l'effectif."
     },
     {
      "t": "p",
      "text": "**Étape 3. Convoquer.** La convocation est envoyée dès la confirmation. Elle rappelle la possibilité de signaler un besoin d'adaptation et donne le contact du référent handicap. Pour l'intra, l'entreprise peut la relayer ; l'organisme vérifie qu'elle l'a fait."
     },
     {
      "t": "p",
      "text": "**Étape 4. Préparer.** Le formateur reçoit le dossier : programme à jour, liste des stagiaires, résultats du positionnement, besoins d'adaptation, informations sur le site (contact, consignes de sécurité). Un formateur nouveau ou sous-traitant reçoit en plus un brief avec le référent pédagogique (ind. 18)."
     },
     {
      "t": "p",
      "text": "**Étape 5. Accueillir.** Présentation du formateur, des objectifs, du déroulé, des règles (règlement intérieur, sécurité, pauses), de la manière de signaler une difficulté ou une réclamation, du référent signalements. Recueil des attentes."
     },
     {
      "t": "p",
      "text": "**Étape 6. Animer et suivre.** Émargement à chaque demi-journée, par chaque stagiaire et par le formateur. Absence ou retard signalé le jour même (P15). Le formateur adapte au groupe (ind. 10) et note les adaptations faites."
     },
     {
      "t": "p",
      "text": "**Étape 7. Clôturer en séance.** Évaluation des acquis (P08), questionnaire à chaud (P03), bilan oral."
     },
     {
      "t": "p",
      "text": "**Étape 8. Documents de fin.** Attestation de fin de formation à chaque stagiaire, certificat le cas échéant, copie des émargements et facture à l'entreprise ou au financeur, demande d'avis entreprise. Pour une formation en santé et sécurité au travail, saisie dans le passeport de prévention (L4141-5) dès que le service est ouvert pour cette formation (ouverture aux salariés le 16 novembre 2026, toutes les formations éligibles au 1er janvier 2027)."
     },
     {
      "t": "p",
      "text": "**Étape 9. Contrôler le dossier.** La check-list de clôture vérifie la présence de chaque pièce. Toute pièce manquante est réclamée ; un manque répété ouvre une non-conformité (P02)."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Formateur empêché** : remplaçant qualifié ou report, client prévenu sans délai (P01, aléas).",
       "**Effectif inférieur au minimum en inter** : décision au plus tard 7 jours avant ; stagiaires inscrits prévenus et une autre date proposée.",
       "**Formation à distance** : lien et consignes de connexion envoyés avec la convocation, test technique proposé, assistance joignable pendant toute la session, assiduité vérifiée par connexion et contrôles en séance.",
       "**Session chez le client** : vérification préalable de la salle, du matériel fourni et des consignes de sécurité du site."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Les adaptations convenues (P09) sont vérifiées avant la session et confirmées au stagiaire.",
       "Horaires et pauses adaptables pour raison de santé, de handicap, de contraintes familiales ou de pratique religieuse, dans la limite du respect de la durée et des objectifs.",
       "Le formateur veille à la participation de chacun, sans laisser s'installer de moquerie ou de mise à l'écart ; tout propos ou comportement discriminant est traité selon P11."
      ]
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Dossier de session complet : convention, programme, convocations, émargements, positionnement, évaluations, appréciations, bilan formateur, attestations, facture, check-list. Conservation 5 ans, émargements et conventions compris."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Conventions signées avant le début",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Demi-journées émargées",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Documents de fin envoyés sous 5 jours ouvrés",
        "95 %",
        "Trimestrielle"
       ],
       [
        "Dossiers complets au contrôle",
        "100 %",
        "Trimestrielle"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Session démarrée sans convention signée",
        "Alerte dans l'outil, départ conditionné par la direction."
       ],
       [
        "Émargement oublié",
        "Émargement numérique par demi-journée, contrôle le soir même."
       ],
       [
        "Matériel défectueux",
        "Vérification la veille, liste du matériel par session."
       ],
       [
        "Sous-traitant mal informé",
        "Brief obligatoire, dossier formateur complet."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Dossiers de session complets sur l'échantillon.",
       "Information des stagiaires avant l'entrée (ind. 9) et adaptation constatée (ind. 10).",
       "Suivi de l'assiduité (ind. 12), moyens et ressources adaptés (ind. 17, 19), coordination des formateurs (ind. 18)."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à l'équipe et à tous les formateurs. Check-list revue chaque année."
     }
    ]
   }
  ]
 },
 "proc-eval": {
  "id": "proc-eval",
  "num": "P08",
  "code": "QUAL-EVAL",
  "name": "Évaluation des acquis",
  "family": "procedures",
  "indicators": [
   8,
   11
  ],
  "pilote": "référent pédagogique",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Mesurer, pour chaque stagiaire, l'atteinte des objectifs de la formation, de façon objective et identique pour tous, et en tirer les conséquences : attestation, certificat, proposition de remédiation."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Toutes les formations. Trois temps d'évaluation :"
     },
     {
      "t": "table",
      "head": [
       "Temps",
       "But",
       "Exemples"
      ],
      "rows": [
       [
        "Positionnement (entrée)",
        "Connaître le niveau de départ",
        "Questionnaire en ligne, vérification d'une carte en cours de validité"
       ],
       [
        "Formative (pendant)",
        "Ajuster l'animation, rassurer le stagiaire",
        "Questions, exercices corrigés, mises en situation commentées"
       ],
       [
        "Sommative (fin)",
        "Décider si les objectifs sont atteints",
        "Épreuve certificative SST, test théorique et pratique de conduite, QCM et mise en situation"
       ]
      ]
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité, ind. 8 (positionnement) et 11 (évaluation de l'atteinte des objectifs).",
       "Référentiels techniques et grilles officielles des formations réglementées ou certifiantes.",
       "Procédure P06 (outils d'évaluation), P15 (remédiation et suivi)."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Critère de réussite",
        "Ce qui doit être observé pour dire que l'objectif est atteint."
       ],
       [
        "Objectif atteint, partiellement atteint, non atteint",
        "Les trois résultats possibles par objectif."
       ],
       [
        "Remédiation",
        "Proposition faite au stagiaire et à l'entreprise quand un objectif n'est pas atteint : complément, nouvelle session, accompagnement."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Formateur",
        "Fait passer les évaluations, note les résultats par objectif, explique le résultat au stagiaire, propose la remédiation."
       ],
       [
        "Référent pédagogique",
        "Valide les outils d'évaluation, traite les contestations, analyse les résultats."
       ],
       [
        "Direction",
        "Informe l'entreprise des résultats et des remédiations proposées."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : objectifs et critères du programme, grilles officielles, résultats du positionnement."
     },
     {
      "t": "p",
      "text": "**Sorties** : résultat par objectif et par stagiaire, attestation de fin de formation mentionnant les résultats, certificat le cas échéant, proposition de remédiation, statistiques d'atteinte des objectifs (publiées, ind. 2)."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Quand"
      ],
      "rows": [
       [
        "1. Informer des modalités",
        "Formateur",
        "À l'accueil"
       ],
       [
        "2. Positionner",
        "Formateur",
        "Avant ou au début"
       ],
       [
        "3. Évaluer en continu",
        "Formateur",
        "Pendant"
       ],
       [
        "4. Évaluer en fin de formation",
        "Formateur",
        "Dernière demi-journée"
       ],
       [
        "5. Enregistrer et expliquer",
        "Formateur",
        "Le jour même"
       ],
       [
        "6. Proposer la remédiation",
        "Formateur, direction",
        "5 jours ouvrés"
       ],
       [
        "7. Analyser",
        "Référent pédagogique",
        "Chaque trimestre"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Informer.** Dès l'accueil, le stagiaire sait comment il sera évalué, sur quels critères, et ce qui se passe s'il n'atteint pas un objectif. Rien ne doit être une surprise."
     },
     {
      "t": "p",
      "text": "**Étape 4. Évaluer en fin de formation.** Chaque objectif est évalué selon le critère prévu, dans les mêmes conditions pour tous. Pour une formation certifiante, la grille officielle s'applique sans modification."
     },
     {
      "t": "p",
      "text": "**Étape 5. Enregistrer et expliquer.** Le résultat est saisi par objectif dans l'outil. Le formateur l'explique individuellement, en privé, en commençant par ce qui est acquis."
     },
     {
      "t": "p",
      "text": "**Étape 6. Remédiation.** Pour tout objectif non atteint : proposition écrite (complément de formation, nouvelle session, accompagnement), adressée au stagiaire et, pour un salarié, à l'entreprise. Un résultat forcé ou modifié après coup est toujours justifié par écrit."
     },
     {
      "t": "p",
      "text": "**Étape 7. Analyser.** Taux d'atteinte par formation et par objectif ; un objectif souvent manqué signale un problème de conception ou d'animation (P06, P02)."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Contestation d'un résultat** : traitée comme une réclamation (P01), examen par le référent pédagogique, qui n'est pas le formateur concerné quand c'est possible.",
       "**Stagiaire absent à l'évaluation** : résultat « non évalué », rattrapage proposé.",
       "**Départ anticipé** : seuls les objectifs réellement évalués apparaissent sur l'attestation."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Aménagements possibles sans changer ce qui est évalué : temps supplémentaire, lecture des questions à voix haute, réponses à l'oral, supports agrandis, pauses. Pour une certification, les aménagements autorisés par le certificateur s'appliquent.",
       "Une difficulté de lecture ou d'écriture ne doit pas faire échouer un objectif qui porte sur un geste ou un comportement : l'évaluation porte sur l'objectif, pas sur l'écrit.",
       "Mêmes critères pour tous, quels que soient le sexe, l'âge, l'origine ou l'entreprise."
      ]
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Résultats par objectif, grilles et copies d'évaluation, attestations, certificats, propositions de remédiation, justifications des résultats modifiés. Conservation 5 ans."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Stagiaires évalués sur tous les objectifs",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Taux d'atteinte des objectifs",
        "Suivi, publié",
        "Trimestrielle"
       ],
       [
        "Remédiations proposées quand un objectif n'est pas atteint",
        "100 %",
        "Trimestrielle"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Évaluation de complaisance",
        "Critères écrits, grille officielle, analyse des taux par formateur."
       ],
       [
        "Résultat modifié sans raison",
        "Justification écrite obligatoire, tracée dans l'outil."
       ],
       [
        "Stagiaire en échec sans suite",
        "Remédiation obligatoire, suivi par la direction."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Le positionnement à l'entrée (ind. 8).",
       "L'évaluation de l'atteinte des objectifs pour chaque stagiaire, avec des critères (ind. 11).",
       "La cohérence entre résultats, attestations et taux publiés."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée aux formateurs. Outils d'évaluation revus avec chaque version de programme."
     }
    ]
   }
  ]
 },
 "proc-hand": {
  "id": "proc-hand",
  "num": "P09",
  "code": "QUAL-PSH",
  "name": "Accueil des personnes en situation de handicap",
  "family": "procedures",
  "indicators": [
   26
  ],
  "pilote": "référent handicap",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Permettre à toute personne en situation de handicap, visible ou non, d'accéder à la formation et de la réussir dans les mêmes conditions que les autres, en mettant en place les adaptations raisonnables et en orientant vers les bons partenaires quand l'organisme ne peut pas répondre seul."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Toute personne : stagiaire, candidat, salarié envoyé par une entreprise, quel que soit le type de handicap (moteur, sensoriel, psychique, mental, cognitif, troubles “dys”, maladie chronique invalidante). La reconnaissance administrative (RQTH ou autre) n'est **jamais** exigée pour bénéficier d'une adaptation."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Loi du 11 février 2005 pour l'égalité des droits et des chances ; Code du travail L5213-6 (mesures appropriées).",
       "Référentiel national qualité, indicateur 26.",
       "Procédures P05, P07, P08, P10 ; document public « Accueil des personnes en situation de handicap »."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Adaptation (compensation)",
        "Mesure qui permet de suivre la formation : rythme, supports, matériel, aide humaine, modalité d'évaluation."
       ],
       [
        "Adaptation raisonnable",
        "Adaptation que l'organisme peut mettre en place sans changer les objectifs de la formation ni compromettre la sécurité."
       ],
       [
        "Partenaire ressource",
        "Structure spécialisée : Agefiph, FIPHFP, Ressource handicap formation (RHF), Cap emploi, MDPH, associations spécialisées, médecine du travail."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Référent handicap",
        "Point de contact unique, mène l'entretien, décide des adaptations avec la personne, mobilise les partenaires, suit jusqu'à la fin, se forme."
       ],
       [
        "Toute l'équipe",
        "Transmet sans délai au référent toute demande ou difficulté signalée."
       ],
       [
        "Formateur",
        "Met en œuvre les adaptations, signale ce qui ne fonctionne pas."
       ],
       [
        "Direction",
        "Valide les adaptations qui engagent des moyens."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : question systématique dans la fiche de besoin, la convocation, la fiche de renseignement ; demande directe de la personne ou de l'entreprise."
     },
     {
      "t": "p",
      "text": "**Sorties** : fiche d'adaptation confidentielle, adaptations en place, éventuelle orientation, bilan avec la personne."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Délai"
      ],
      "rows": [
       [
        "1. Recevoir la demande",
        "Toute personne",
        "Transmise au référent le jour même"
       ],
       [
        "2. Prendre contact",
        "Référent handicap",
        "2 jours ouvrés"
       ],
       [
        "3. Entretien des besoins",
        "Référent, la personne",
        "Avant la session, dès que possible"
       ],
       [
        "4. Décider des adaptations",
        "Référent, avec la personne",
        "Sous 5 jours ouvrés après l'entretien"
       ],
       [
        "5. Mobiliser les partenaires si besoin",
        "Référent",
        "Aussitôt"
       ],
       [
        "6. Mettre en place et informer le formateur",
        "Référent",
        "Avant la session"
       ],
       [
        "7. Suivre pendant la session",
        "Formateur, référent",
        "Point à mi-parcours"
       ],
       [
        "8. Faire le bilan",
        "Référent, la personne",
        "Fin de session"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 3. Entretien des besoins.** L'entretien porte sur ce dont la personne a besoin pour suivre la formation, **pas sur son diagnostic**. Questions types : qu'est-ce qui pourrait vous gêner dans le déroulement décrit ? qu'est-ce qui vous aide habituellement ? avez-vous déjà bénéficié d'aménagements ? L'entretien a lieu par le moyen choisi par la personne (téléphone, visio, écrit, sur place) et elle peut être accompagnée."
     },
     {
      "t": "p",
      "text": "**Étape 4. Décider.** Exemples d'adaptations : supports agrandis ou numériques, transmission des supports à l'avance, pauses supplémentaires, place réservée, salle de plain-pied, interprète LSF ou codeur LfPC, boucle magnétique, temps d'évaluation majoré, évaluation à l'oral, matériel adapté, rythme étalé, accompagnant. La décision est écrite, acceptée par la personne."
     },
     {
      "t": "p",
      "text": "**Étape 5. Partenaires.** Si une aide financière ou une expertise est nécessaire (interprète, matériel spécifique), le référent sollicite Agefiph, RHF, Cap emploi ou l'employeur. Si l'adaptation est impossible ou que la formation présente une contre-indication (exemple : aptitude médicale requise pour la conduite d'engins), le référent l'explique à la personne et l'oriente vers une solution adaptée, par écrit."
     },
     {
      "t": "p",
      "text": "**Étape 6. Informer le formateur.** Le formateur reçoit uniquement ce qui est utile à l'adaptation, avec l'accord de la personne. Le groupe n'est pas informé sauf demande de la personne."
     },
     {
      "t": "p",
      "text": "**Étape 8. Bilan.** Les adaptations ont-elles fonctionné ? Ce qui est appris est noté, sans donnée nominative, pour améliorer les pratiques."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Handicap découvert pendant la session** : le formateur adapte immédiatement ce qu'il peut et prévient le référent le jour même.",
       "**La personne ne souhaite pas en parler à son employeur** : son choix est respecté ; l'adaptation est organisée directement avec elle.",
       "**Demande tardive** (moins de 5 jours avant) : on met en place ce qui est possible ; si l'adaptation essentielle ne peut pas l'être, report proposé sans frais.",
       "**Formation sous-traitée** : le donneur d'ordre est informé de l'adaptation avec l'accord de la personne ; l'organisme vérifie qu'elle est en place."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "p",
      "text": "Cette procédure est elle-même la réponse à l'exigence d'égalité. Principes : la personne décide, la confidentialité est stricte, l'adaptation ne doit pas la stigmatiser, et le refus d'une formation ne peut reposer que sur une impossibilité réelle et expliquée."
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Fiche d'adaptation (besoins, adaptations décidées, accord de la personne, bilan) conservée à part, accès limité au référent et à la direction ; contacts avec les partenaires ; formations suivies par le référent ; annuaire des partenaires à jour. Conservation 5 ans. Aucune donnée de santé n'est conservée au-delà de ce qui est nécessaire à l'adaptation."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Demandes prises en charge sous 2 jours ouvrés",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Adaptations en place au démarrage",
        "100 % des adaptations décidées",
        "Trimestrielle"
       ],
       [
        "Satisfaction des personnes accompagnées",
        "Suivie au bilan",
        "Revue de direction"
       ],
       [
        "Annuaire des partenaires vérifié",
        "1 fois par an",
        "Revue de direction"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Besoin non exprimé par crainte",
        "Question posée à tous, de façon neutre et répétée, confidentialité annoncée."
       ],
       [
        "Information de santé diffusée",
        "Fiche séparée, accès limité, formateur informé du strict nécessaire."
       ],
       [
        "Référent indisponible",
        "Suppléant désigné (direction)."
       ],
       [
        "Refus non justifié",
        "Toute impossibilité écrite et motivée, avec orientation."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Un référent identifié, formé, et un réseau de partenaires (ind. 26).",
       "La question posée systématiquement et des exemples d'adaptations réalisées.",
       "L'information du public sur l'accessibilité des formations."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à toute l'équipe et aux formateurs. Revue chaque année avec l'annuaire des partenaires."
     }
    ]
   }
  ]
 },
 "proc-acces": {
  "id": "proc-acces",
  "num": "P10",
  "code": "QUAL-ACCE",
  "name": "Accessibilité des lieux, des supports et des outils",
  "family": "procedures",
  "indicators": [
   17,
   19,
   26
  ],
  "pilote": "référent handicap",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "S'assurer, avant chaque session, que le lieu, les supports et les outils numériques sont utilisables par tous, et connaître à l'avance les limites d'un lieu pour pouvoir prévenir et proposer une solution."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Locaux propres de l'organisme.",
       "Salles louées et salles des clients (intra).",
       "Supports remis ou projetés, documents administratifs (convocation, livret, questionnaires).",
       "Outils numériques : portail stagiaire, émargement, questionnaires en ligne, classe virtuelle."
      ]
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Règles d'accessibilité des établissements recevant du public (ERP), registre public d'accessibilité.",
       "Référentiel général d'amélioration de l'accessibilité (RGAA) pour les outils numériques, à titre de repère.",
       "Référentiel national qualité, ind. 17 (moyens), 19 (ressources), 26 (handicap).",
       "Procédure P09."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Fiche lieu",
        "Description d'un lieu de formation : accès, stationnement, transports, plain-pied ou ascenseur, sanitaires adaptés, éclairage, acoustique, évacuation."
       ],
       [
        "Lieu qualifié",
        "Lieu dont la fiche est remplie et vérifiée depuis moins d'un an."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Référent handicap",
        "Tient les fiches lieux, contrôle les supports types, suit l'accessibilité des outils."
       ],
       [
        "Direction",
        "Choisit les lieux, demande la fiche au client pour l'intra."
       ],
       [
        "Formateur",
        "Vérifie sur place, signale tout écart, applique les règles de mise en forme des supports."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : visite ou questionnaire lieu, informations du client, retours des stagiaires."
     },
     {
      "t": "p",
      "text": "**Sorties** : fiches lieux, information d'accès dans la convocation, supports conformes, liste des améliorations."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Quand"
      ],
      "rows": [
       [
        "1. Qualifier chaque lieu",
        "Référent handicap",
        "Avant la première session, puis chaque année"
       ],
       [
        "2. Vérifier le lieu d'une session intra",
        "Direction",
        "À la confirmation"
       ],
       [
        "3. Informer les stagiaires",
        "Gestion administrative",
        "Dans la convocation"
       ],
       [
        "4. Contrôler les supports",
        "Formateur, référent",
        "À chaque version de programme"
       ],
       [
        "5. Contrôler les outils numériques",
        "Référent, direction",
        "Chaque année et à chaque évolution"
       ],
       [
        "6. Vérifier sur place",
        "Formateur",
        "Le jour de la session"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Qualifier.** La fiche lieu est remplie par visite, ou par questionnaire au gestionnaire du lieu, avec photos si possible. Elle indique clairement ce qui est accessible et ce qui ne l'est pas."
     },
     {
      "t": "p",
      "text": "**Étape 2. Session intra.** Le client remplit une fiche courte (accès, salle, sanitaires, matériel). Si un stagiaire a besoin d'une adaptation que le lieu ne permet pas, une autre salle est cherchée avec le client."
     },
     {
      "t": "p",
      "text": "**Étape 3. Informer.** La convocation donne l'adresse exacte, l'accès, le stationnement, les transports, les conditions d'accessibilité du lieu et le contact du référent handicap."
     },
     {
      "t": "p",
      "text": "**Étape 4. Supports.** Règles minimales : police sans empattement de 12 points au moins pour l'écrit, 24 pour la projection ; contraste fort ; pas d'information par la couleur seule ; titres structurés ; images décrites ; vidéos sous-titrées quand c'est possible ; version numérique disponible sur demande ; langage clair."
     },
     {
      "t": "p",
      "text": "**Étape 5. Outils numériques.** Vérification sur téléphone : lisibilité avec zoom, boutons assez grands, utilisation sans souris, messages d'erreur clairs. Une solution de repli papier existe toujours."
     },
     {
      "t": "p",
      "text": "**Étape 6. Sur place.** Le formateur vérifie l'accès, la signalétique, les issues de secours et les consignes d'évacuation, en tenant compte des personnes à mobilité réduite. Tout écart est signalé (P01, aléas)."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Lieu non accessible** : n'est utilisé que si aucun stagiaire ne le nécessite et si l'information a été donnée à l'avance ; une alternative est recherchée.",
       "**Pratique sur engin ou matériel lourd** : la limite d'accès est expliquée (sécurité, aptitude) et une orientation proposée (P09)."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "p",
      "text": "Au-delà du handicap, la procédure prend en compte : les personnes qui lisent peu ou mal le français (pictogrammes, consignes orales), les personnes sans équipement numérique ou peu à l'aise (version papier, aide sur place), et l'accès aux sanitaires et lieux de pause pour toutes et tous."
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Fiches lieux datées, fiches intra, contrôles des supports et des outils. Conservation 5 ans."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Lieux utilisés avec fiche à jour",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Convocations avec information d'accessibilité",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Supports conformes aux règles minimales",
        "100 % à la prochaine version",
        "Revue de direction"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Découvrir le jour J qu'un lieu est inaccessible",
        "Fiche lieu obligatoire, information dans la convocation."
       ],
       [
        "Supports illisibles",
        "Règles minimales, contrôle à chaque version."
       ],
       [
        "Outil numérique bloquant",
        "Solution papier toujours disponible."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "L'adéquation des locaux et des moyens (ind. 17) et des ressources pédagogiques (ind. 19).",
       "L'information sur l'accessibilité et la capacité à adapter (ind. 26)."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à l'équipe et aux formateurs. Fiches lieux revues chaque année."
     }
    ]
   }
  ]
 },
 "proc-vss": {
  "id": "proc-vss",
  "num": "P11",
  "code": "QUAL-VSS",
  "name": "Prévention et traitement des violences, du harcèlement et des discriminations",
  "family": "procedures",
  "indicators": [
   12
  ],
  "pilote": "référent signalements",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Garantir à chaque personne un cadre de formation sûr et respectueux. Prévenir les violences, le harcèlement moral ou sexuel, les agissements sexistes et les discriminations ; permettre de les signaler facilement et sans crainte ; protéger la victime ; traiter chaque signalement sérieusement et rapidement."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Tous les faits survenant dans le cadre d'une formation, en salle, à distance, sur le site d'un client, pendant les pauses et les repas pris ensemble, ou par message entre participants. Toutes les personnes : stagiaires, formateurs salariés ou sous-traitants, équipe, personnel des clients. L'auteur peut être un stagiaire, un formateur, un membre de l'équipe ou un tiers."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Code pénal : harcèlement sexuel (222-33), harcèlement moral (222-33-2), outrage sexiste et sexuel, discriminations (225-1 et 225-2).",
       "Code du travail : harcèlement (L1152-1, L1153-1), agissements sexistes (L1142-2-1), règlement intérieur des organismes de formation (L6352-3 et suivants).",
       "Référentiel national qualité, indicateur 12.",
       "Règlement intérieur et livret d'accueil de l'organisme."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens simple"
      ],
      "rows": [
       [
        "Harcèlement sexuel",
        "Propos ou comportements à connotation sexuelle ou sexiste répétés, ou une seule pression grave pour obtenir un acte sexuel."
       ],
       [
        "Harcèlement moral",
        "Agissements répétés qui dégradent les conditions de formation ou de travail et portent atteinte à la dignité ou à la santé."
       ],
       [
        "Agissement sexiste",
        "Comportement lié au sexe d'une personne qui porte atteinte à sa dignité ou crée un environnement intimidant ou humiliant."
       ],
       [
        "Discrimination",
        "Traitement défavorable fondé sur un critère interdit : origine, sexe, âge, handicap, état de santé, orientation sexuelle, identité de genre, religion, opinions, situation de famille, grossesse, apparence physique, lieu de résidence, nom, langue, et les autres critères prévus par la loi."
       ],
       [
        "Violence",
        "Toute atteinte physique, verbale ou psychologique, y compris menaces et insultes."
       ],
       [
        "Signalement",
        "Information transmise par la victime, un témoin ou toute personne qui a connaissance des faits."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Référent signalements",
        "Reçoit les signalements, écoute, oriente, conduit l'examen des faits, propose les mesures, assure le suivi. Formé à l'écoute et à l'orientation."
       ],
       [
        "Suppléant",
        "Remplace le référent s'il est absent ou s'il est mis en cause."
       ],
       [
        "Formateur",
        "Présente le cadre à l'accueil, intervient immédiatement face à un comportement inacceptable, transmet tout signalement le jour même."
       ],
       [
        "Direction",
        "Décide des mesures et sanctions, informe l'employeur ou le donneur d'ordre quand c'est nécessaire."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : signalement oral ou écrit, par tout canal (courriel dédié, téléphone, en personne, formulaire du portail, questionnaire), y compris anonyme."
     },
     {
      "t": "p",
      "text": "**Sorties** : fiche de signalement confidentielle, mesures de protection, compte rendu d'examen, décision, information des personnes concernées, bilan annuel anonymisé."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Délai"
      ],
      "rows": [
       [
        "1. Prévenir",
        "Formateur, direction",
        "Chaque session"
       ],
       [
        "2. Faire cesser immédiatement",
        "Formateur ou toute personne présente",
        "Sur le champ"
       ],
       [
        "3. Recevoir le signalement",
        "Référent",
        "Contact sous 24 heures"
       ],
       [
        "4. Protéger",
        "Référent, direction",
        "Sous 48 heures"
       ],
       [
        "5. Examiner les faits",
        "Référent, avec un second membre de la direction",
        "Sous 10 jours ouvrés"
       ],
       [
        "6. Décider et agir",
        "Direction",
        "À l'issue de l'examen"
       ],
       [
        "7. Informer et suivre",
        "Référent",
        "Décision, puis point à 1 mois"
       ],
       [
        "8. Tirer les enseignements",
        "Responsable qualité",
        "Revue de direction"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Prévenir.** À l'accueil, le formateur rappelle en une minute les règles de respect, que les violences, le harcèlement et les discriminations ne sont pas tolérés, et comment joindre le référent. L'affiche et le livret d'accueil reprennent ces informations et les numéros d'aide. Les formateurs sont sensibilisés chaque année."
     },
     {
      "t": "p",
      "text": "**Étape 2. Faire cesser.** Face à un propos ou un comportement inacceptable, le formateur intervient tout de suite, calmement et fermement, et met la personne visée en sécurité. En cas de danger : appel du 17 ou du 112."
     },
     {
      "t": "p",
      "text": "**Étape 3. Recevoir.** Le référent écoute sans juger, sans mettre en doute, sans demander de preuve sur le moment. Il note les faits avec les mots de la personne. Il l'informe de ses droits (porter plainte, numéros d'aide) et de la suite. Un signalement anonyme est traité, dans la mesure où les faits peuvent être examinés."
     },
     {
      "t": "p",
      "text": "**Étape 4. Protéger.** Mesures selon la situation et avec l'accord de la victime : changement de groupe ou de date, séparation lors des exercices, écartement provisoire de l'auteur présumé, formateur remplacé. Ces mesures ne doivent jamais pénaliser la victime."
     },
     {
      "t": "p",
      "text": "**Étape 5. Examiner les faits.** Entretiens séparés avec la victime, l'auteur présumé et les témoins, jamais de confrontation imposée. L'auteur présumé peut s'exprimer. Si le référent est mis en cause ou proche des personnes, le suppléant conduit l'examen."
     },
     {
      "t": "p",
      "text": "**Étape 6. Décider et agir.** Selon les faits : rappel à la règle, avertissement, exclusion de la formation selon le règlement intérieur (avec la procédure disciplinaire prévue), fin de collaboration avec un formateur ou un sous-traitant. Si l'auteur ou la victime est salarié d'une entreprise cliente, l'employeur est informé pour qu'il exerce ses propres obligations, dans le respect de la confidentialité de la victime."
     },
     {
      "t": "p",
      "text": "**Étape 7. Informer et suivre.** La victime et l'auteur sont informés des suites qui les concernent. Un point est fait avec la victime un mois après."
     },
     {
      "t": "p",
      "text": "**Étape 8. Enseignements.** Bilan annuel anonymisé en revue de direction ; actions de prévention ajustées."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Mineur concerné** (apprenti, jeune en formation) : information des responsables légaux sauf si cela le met en danger ; en cas de danger, appel du **119** ou information préoccupante auprès du département.",
       "**Faits pouvant constituer une infraction** : la victime est informée qu'elle peut porter plainte, et accompagnée dans ses démarches si elle le souhaite.",
       "**Faits révélés qui se passent hors de la formation** (violences conjugales, par exemple) : écoute et orientation vers les numéros d'aide, sans enquête de l'organisme.",
       "**Formateur mis en cause** : écarté de la session le temps de l'examen."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Plusieurs canaux de signalement, dont un écrit et un oral, pour que chacun puisse s'exprimer, y compris une personne sourde ou malentendante (courriel, SMS au **114** pour les urgences).",
       "Le référent veille à ne pas reproduire de stéréotype dans l'écoute (un homme peut être victime, un signalement entre personnes du même sexe est traité de la même façon).",
       "Aucune personne ayant signalé ou témoigné de bonne foi ne peut subir de mesure défavorable."
      ]
     }
    ]
   },
   {
    "id": "numeros-d-aide-a-afficher",
    "title": "Numéros d'aide à afficher",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Numéro",
       "Pour qui"
      ],
      "rows": [
       [
        "17 ou 112",
        "Urgence, danger immédiat"
       ],
       [
        "114 (SMS)",
        "Urgence pour personnes sourdes ou malentendantes"
       ],
       [
        "3919",
        "Violences faites aux femmes, gratuit et anonyme, 24 heures sur 24"
       ],
       [
        "119",
        "Enfance en danger"
       ],
       [
        "Défenseur des droits : 3928 ou defenseurdesdroits.fr",
        "Discriminations"
       ],
       [
        "arretonslesviolences.gouv.fr",
        "Signalement en ligne aux forces de l'ordre, conseils"
       ]
      ]
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Fiches de signalement et comptes rendus, conservés séparément, accès limité au référent, au suppléant et à la direction. Conservation 5 ans après la clôture. Bilans annuels anonymisés. Preuves de la sensibilisation des formateurs."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Signalements pris en charge sous 24 heures",
        "100 %",
        "À chaque cas"
       ],
       [
        "Examens conclus sous 10 jours ouvrés",
        "100 %",
        "Revue de direction"
       ],
       [
        "Formateurs sensibilisés dans l'année",
        "100 %",
        "Revue de direction"
       ],
       [
        "Sessions où le cadre est présenté à l'accueil",
        "100 %",
        "Trimestrielle"
       ]
      ]
     },
     {
      "t": "p",
      "text": "Le nombre de signalements n'est pas un objectif : un nombre nul peut aussi signifier que les personnes n'osent pas parler."
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "La victime n'ose pas parler",
        "Cadre annoncé à chaque session, plusieurs canaux, anonymat possible."
       ],
       [
        "Signalement minimisé",
        "Écoute sans jugement, traitement systématique, délais fixés."
       ],
       [
        "Référent en conflit d'intérêts",
        "Suppléant désigné."
       ],
       [
        "Fuite d'information",
        "Accès limité, fiches séparées."
       ],
       [
        "Représailles",
        "Interdiction écrite, suivi à un mois."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Un référent désigné et connu des stagiaires.",
       "Un dispositif de prévention et de signalement réel (affichage, livret, règlement intérieur).",
       "Le traitement des cas survenus, s'il y en a eu."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à toute l'équipe et aux formateurs. Résumé et numéros d'aide dans le livret d'accueil, affichés en salle et sur le portail stagiaire. Revue chaque année."
     }
    ]
   }
  ]
 },
 "proc-rgpd": {
  "id": "proc-rgpd",
  "num": "P12",
  "code": "QUAL-RGPD",
  "name": "Protection des données personnelles",
  "family": "procedures",
  "indicators": [],
  "pilote": "référent données personnelles (direction)",
  "scope": "Exigence légale (transverse)",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Ne collecter que les données utiles, les protéger, les garder le temps nécessaire, et permettre à chacun d'exercer ses droits simplement. Réagir vite et correctement en cas d'incident."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Toutes les données personnelles traitées par l'organisme : stagiaires, contacts des clients et prospects, formateurs, sous-traitants, candidats, salariés. Tous les supports : outil de gestion, messagerie, papier, clés USB, téléphones."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Règlement général sur la protection des données (RGPD) et loi Informatique et libertés.",
       "Recommandations de la CNIL.",
       "Procédures P03, P09, P11 (données sensibles et confidentielles), document « Sauvegarde et restauration »."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Donnée personnelle",
        "Toute information qui permet d'identifier une personne, directement ou non."
       ],
       [
        "Donnée sensible",
        "Santé, handicap, origine, religion, opinions, vie sexuelle, données biométriques ; traitement interdit sauf exception (consentement, nécessité)."
       ],
       [
        "Traitement",
        "Toute opération sur des données : collecte, conservation, consultation, envoi, effacement."
       ],
       [
        "Sous-traitant RGPD",
        "Prestataire qui traite des données pour le compte de l'organisme (hébergeur, messagerie, logiciel)."
       ],
       [
        "Violation de données",
        "Perte, vol, accès non autorisé, modification ou destruction accidentelle de données."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Référent données personnelles",
        "Tient le registre des traitements, répond aux demandes de droits, gère les incidents, sensibilise l'équipe."
       ],
       [
        "Toute personne",
        "Applique les règles de sécurité, signale tout incident immédiatement."
       ],
       [
        "Direction",
        "Valide les choix d'outils et de prestataires, décide en cas de violation."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : nouveaux traitements ou outils, demandes des personnes, incidents."
     },
     {
      "t": "p",
      "text": "**Sorties** : registre des traitements, mentions d'information, réponses aux demandes, registre des violations, contrats avec les prestataires."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Quand"
      ],
      "rows": [
       [
        "1. Tenir le registre",
        "Référent",
        "À chaque nouveau traitement, revue annuelle"
       ],
       [
        "2. Informer les personnes",
        "Référent",
        "À chaque collecte"
       ],
       [
        "3. Limiter la collecte",
        "Tous",
        "À chaque formulaire"
       ],
       [
        "4. Sécuriser",
        "Direction, tous",
        "En continu"
       ],
       [
        "5. Encadrer les prestataires",
        "Direction",
        "À la signature"
       ],
       [
        "6. Respecter les durées",
        "Référent",
        "Purge annuelle"
       ],
       [
        "7. Répondre aux demandes",
        "Référent",
        "1 mois au plus"
       ],
       [
        "8. Gérer un incident",
        "Référent, direction",
        "Immédiat, CNIL sous 72 heures si nécessaire"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Registre.** Pour chaque traitement : finalité, base légale, catégories de données et de personnes, destinataires, durée de conservation, mesures de sécurité, transferts hors Union européenne."
     },
     {
      "t": "p",
      "text": "**Étape 2. Informer.** Une mention courte figure sur chaque formulaire (fiche de renseignement, questionnaires, site) : qui traite, pourquoi, combien de temps, quels droits et comment les exercer. Une politique complète est publiée sur le site."
     },
     {
      "t": "p",
      "text": "**Étape 3. Limiter.** On ne demande que ce qui sert. Le numéro de sécurité sociale n'est collecté que si un texte ou un financeur l'exige, il est chiffré et son refus n'empêche pas la formation sauf obligation légale. Les informations de santé se limitent à l'aménagement utile (P09)."
     },
     {
      "t": "p",
      "text": "**Étape 4. Sécuriser.** Comptes personnels, mots de passe solides et double authentification quand elle existe, droits d'accès limités au besoin de chacun, écrans verrouillés, documents papier sous clé, pas de données de stagiaires sur clé USB non chiffrée, envoi de documents nominatifs uniquement à la bonne personne, sauvegardes testées."
     },
     {
      "t": "p",
      "text": "**Étape 5. Prestataires.** Chaque prestataire qui traite des données signe des clauses conformes à l'article 28 du RGPD. On privilégie un hébergement dans l'Union européenne."
     },
     {
      "t": "p",
      "text": "**Étape 6. Durées.** Durées de référence :"
     },
     {
      "t": "table",
      "head": [
       "Données",
       "Durée"
      ],
      "rows": [
       [
        "Dossiers de formation (émargements, évaluations, attestations)",
        "5 ans après la fin de la formation"
       ],
       [
        "Pièces comptables et factures",
        "10 ans"
       ],
       [
        "Prospects sans suite",
        "3 ans après le dernier contact"
       ],
       [
        "Fiches d'adaptation handicap",
        "5 ans, accès restreint"
       ],
       [
        "Signalements (P11)",
        "5 ans après clôture, accès restreint"
       ],
       [
        "Candidatures non retenues",
        "2 ans, avec accord du candidat"
       ]
      ]
     },
     {
      "t": "p",
      "text": "Une obligation légale ou un financeur peut imposer une durée plus longue ; elle s'applique alors et est notée au registre."
     },
     {
      "t": "p",
      "text": "**Étape 7. Droits.** Accès, rectification, effacement, limitation, opposition, portabilité. Réponse sous 1 mois (prolongeable de 2 mois si la demande est complexe, en prévenant la personne). On vérifie l'identité seulement en cas de doute raisonnable. Un refus est motivé (exemple : obligation de conserver un émargement) et rappelle le droit de saisir la CNIL."
     },
     {
      "t": "p",
      "text": "**Étape 8. Incident.** Toute personne qui constate un incident (courriel envoyé au mauvais destinataire, téléphone perdu, accès suspect) le signale immédiatement. Le référent évalue le risque, limite les dégâts, inscrit l'incident au registre des violations, notifie la CNIL sous 72 heures si un risque existe pour les personnes, et informe les personnes si le risque est élevé."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Demande d'une entreprise sur ses salariés** : elle reçoit ce dont elle a besoin pour la formation (présence, résultats), jamais les informations d'adaptation ou les réponses individuelles aux questionnaires sans accord.",
       "**Photos et vidéos** en formation : uniquement avec l'accord écrit des personnes, pour un usage précis.",
       "**Prospection** : les entreprises peuvent être contactées par courriel professionnel sur un sujet lié à leur activité, avec un moyen simple de s'opposer ; la liste d'opposition est respectée."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "p",
      "text": "Les mentions sont écrites en langage clair. Une demande de droit peut être faite par tout moyen, y compris oralement auprès du formateur, qui la transmet. Les données liées au handicap, à l'origine ou à la religion ne sont jamais collectées à d'autres fins que l'adaptation demandée par la personne."
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Registre des traitements, registre des violations, demandes de droits et réponses, contrats prestataires, preuves de sensibilisation. Conservation 5 ans."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Demandes traitées sous 1 mois",
        "100 %",
        "Revue de direction"
       ],
       [
        "Purge annuelle réalisée",
        "Oui",
        "Revue de direction"
       ],
       [
        "Incidents traités selon la procédure",
        "100 %",
        "À chaque cas"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Envoi de données au mauvais destinataire",
        "Contrôle du destinataire, documents nominatifs envoyés individuellement."
       ],
       [
        "Données gardées indéfiniment",
        "Purge annuelle selon le tableau des durées."
       ],
       [
        "Accès trop larges",
        "Droits par rôle, revue annuelle des comptes, comptes supprimés au départ d'une personne."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "p",
      "text": "Le RGPD n'est pas un indicateur du référentiel, mais l'auditeur peut relever un manquement constaté dans les dossiers (données excessives, absence d'information). La CNIL peut contrôler à tout moment."
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à toute l'équipe et aux formateurs. Registre revu chaque année."
     }
    ]
   }
  ]
 },
 "proc-st": {
  "id": "proc-st",
  "num": "P13",
  "code": "QUAL-ST",
  "name": "Sous-traitance",
  "family": "procedures",
  "indicators": [
   21,
   27
  ],
  "pilote": "direction",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Quand l'organisme confie tout ou partie d'une formation à un autre organisme ou à un formateur indépendant, garantir le même niveau de qualité que s'il la réalisait lui-même : sélection, contrat, information, contrôle, évaluation. L'organisme reste responsable de la prestation vis-à-vis du client."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Formateurs indépendants intervenant pour l'organisme.",
       "Organismes de formation à qui l'organisme confie une session.",
       "Portage salarial le cas échéant."
      ]
     },
     {
      "t": "p",
      "text": "Le cas inverse, où l'organisme est lui-même sous-traitant d'un donneur d'ordre, est traité en section 8."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité, indicateurs 21 (compétences des intervenants) et 27 (conformité des sous-traitants au référentiel).",
       "Code du travail : obligation de vigilance (L8222-1 et D8222-5), attestation de vigilance URSSAF tous les 6 mois pour un contrat d'au moins 5 000 euros hors taxes.",
       "Modèle de contrat de sous-traitance (QUAL-ST), procédure P14."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Sous-traitant",
        "Organisme ou indépendant qui réalise une prestation de formation au nom et pour le compte de l'organisme."
       ],
       [
        "Dossier sous-traitant",
        "Ensemble des pièces d'un sous-traitant : identité, numéro de déclaration d'activité, assurance, attestation de vigilance, CV et justificatifs de compétence, contrat signé, évaluations."
       ],
       [
        "Sous-traitant référencé",
        "Sous-traitant dont le dossier est complet et à jour."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Direction",
        "Sélectionne, contractualise, évalue, décide du maintien."
       ],
       [
        "Référent pédagogique",
        "Vérifie la compétence technique et pédagogique, briefe avant chaque mission."
       ],
       [
        "Responsable qualité",
        "Contrôle la complétude des dossiers, suit les écarts."
       ],
       [
        "Sous-traitant",
        "Applique les procédures de l'organisme, transmet les documents de session, signale les aléas."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : besoin d'un intervenant, candidature ou recommandation."
     },
     {
      "t": "p",
      "text": "**Sorties** : dossier sous-traitant complet, contrat signé, missions avec documents de session, évaluation annuelle, liste des sous-traitants référencés."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Quand"
      ],
      "rows": [
       [
        "1. Sélectionner",
        "Direction, référent pédagogique",
        "Avant toute mission"
       ],
       [
        "2. Constituer le dossier",
        "Direction",
        "Avant toute mission"
       ],
       [
        "3. Contractualiser",
        "Direction",
        "Avant toute mission"
       ],
       [
        "4. Intégrer",
        "Référent pédagogique",
        "Avant la première mission"
       ],
       [
        "5. Confier une mission",
        "Direction",
        "À chaque session"
       ],
       [
        "6. Contrôler",
        "Responsable qualité",
        "À chaque session et par observation"
       ],
       [
        "7. Évaluer",
        "Direction",
        "Chaque année"
       ],
       [
        "8. Mettre à jour le dossier",
        "Direction",
        "Vigilance tous les 6 mois, le reste chaque année"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Sélectionner.** Critères : qualification pour la formation visée (certificat de formateur SST, testeur CACES, habilitation, etc.), expérience terrain et pédagogique, références, adhésion aux valeurs de l'organisme (égalité de traitement, prévention des violences, accueil des personnes en situation de handicap)."
     },
     {
      "t": "p",
      "text": "**Étape 2. Dossier.** Pièces exigées : extrait Kbis ou avis de situation INSEE, numéro de déclaration d'activité quand il en faut un, attestation d'assurance responsabilité civile professionnelle, attestation de vigilance URSSAF, CV, justificatifs des qualifications avec dates de validité, certificat Qualiopi s'il en a un."
     },
     {
      "t": "p",
      "text": "**Étape 3. Contrat.** Le contrat précise la prestation, les obligations qualité (respect du référentiel national qualité et des procédures de l'organisme, documents à remettre et délais), la confidentialité et la protection des données (clauses RGPD), la rémunération, l'interdiction de sous-traiter à nouveau sans accord, et les conditions de fin du contrat."
     },
     {
      "t": "p",
      "text": "**Étape 4. Intégrer.** Remise et explication du livret formateur : procédures réalisation, évaluation, appréciations, réclamations et aléas, handicap, violences et discriminations, RGPD ; utilisation de l'outil (émargement, évaluations). L'intégration est tracée et signée."
     },
     {
      "t": "p",
      "text": "**Étape 5. Mission.** Ordre de mission ou bon de commande par session, avec le dossier de session (P07) et un brief."
     },
     {
      "t": "p",
      "text": "**Étape 6. Contrôler.** Complétude des documents de chaque session, lecture des appréciations, et au moins une observation en situation par an ou un entretien approfondi à défaut."
     },
     {
      "t": "p",
      "text": "**Étape 7. Évaluer.** Grille annuelle : qualité pédagogique (appréciations, résultats), respect des procédures, ponctualité et documents, écarts constatés et leur traitement, veille et formation continue. Décision : maintien, maintien avec plan de progrès, ou fin de collaboration."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**L'organisme est sous-traitant** d'un autre organisme : il applique le contrat et les exigences du donneur d'ordre, ses propres procédures pour tout le reste, transmet les documents demandés dans les délais, et recueille l'avis du donneur d'ordre (P03). Il vérifie avant d'accepter que le programme et les conditions lui permettent de bien faire.",
       "**Remplacement en urgence** : uniquement par un sous-traitant déjà référencé pour la formation concernée.",
       "**Qualification expirée** : aucune mission confiée tant que le justificatif à jour n'est pas fourni."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "p",
      "text": "Le sous-traitant s'engage par contrat à appliquer les adaptations décidées (P09), à présenter le cadre de prévention des violences (P11) et à traiter tous les stagiaires sans discrimination. Le choix des sous-traitants lui-même se fait sans discrimination, sur la seule base des compétences et du sérieux."
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Dossiers sous-traitants, contrats, ordres de mission, comptes rendus d'intégration et d'observation, évaluations annuelles. Conservation 5 ans après la fin de la collaboration."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Sous-traitants avec dossier complet avant mission",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Attestations de vigilance à jour",
        "100 %",
        "Semestrielle"
       ],
       [
        "Sous-traitants évalués dans l'année",
        "100 %",
        "Revue de direction"
       ],
       [
        "Documents de session reçus sous 5 jours ouvrés",
        "95 %",
        "Trimestrielle"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Mission confiée à un intervenant non qualifié",
        "Dossier complet et dates de validité contrôlés avant toute mission."
       ],
       [
        "Le sous-traitant ignore nos procédures",
        "Intégration signée, livret formateur, brief par mission."
       ],
       [
        "Responsabilité solidaire en cas de travail dissimulé",
        "Attestation de vigilance tous les 6 mois."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "La sélection, la qualification et le suivi des sous-traitants (ind. 21, 27).",
       "Le contrat et les moyens de s'assurer qu'ils respectent le référentiel.",
       "Les dossiers de session réalisés par un sous-traitant, aussi complets que les autres."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à la direction et à chaque sous-traitant (résumé dans le livret formateur). Revue chaque année."
     }
    ]
   }
  ]
 },
 "proc-comp": {
  "id": "proc-comp",
  "num": "P14",
  "code": "QUAL-COMP",
  "name": "Compétences des formateurs et de l'équipe",
  "family": "procedures",
  "indicators": [
   21,
   22
  ],
  "pilote": "direction",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "S'assurer que chaque personne qui intervient (formateur salarié ou indépendant, équipe administrative, référents) a les compétences requises pour sa mission, les garde à jour et les développe."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Formateurs (salariés, dirigeants qui forment, sous-traitants), personnel administratif et commercial, référents (handicap, signalements, qualité, pédagogique, données personnelles)."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité, indicateurs 21 (détermination, mobilisation et évaluation des compétences) et 22 (développement des compétences des salariés).",
       "Exigences des dispositifs : certificat de formateur SST et maintien des acquis (INRS), règles des certificateurs pour la conduite d'engins, habilitation électrique du formateur, etc.",
       "Procédure P13 (sous-traitants), P04 (veille)."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Matrice des compétences",
        "Tableau qui croise les personnes et les formations ou missions qu'elles sont habilitées à assurer, avec les dates de validité."
       ],
       [
        "Qualification",
        "Justificatif exigé pour animer une formation donnée (certificat, habilitation, diplôme, expérience prouvée)."
       ],
       [
        "Plan de développement des compétences",
        "Liste annuelle des formations et actions prévues pour l'équipe."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Direction",
        "Définit les exigences par mission, tient la matrice, conduit les entretiens, établit le plan de développement."
       ],
       [
        "Référent pédagogique",
        "Évalue la pratique pédagogique, organise les observations croisées."
       ],
       [
        "Chaque intervenant",
        "Fournit ses justificatifs à jour, se forme, partage sa veille."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : exigences des dispositifs, recrutement ou référencement, appréciations et résultats des sessions, veille."
     },
     {
      "t": "p",
      "text": "**Sorties** : fiche de poste ou de mission, matrice des compétences à jour, comptes rendus d'entretien et d'observation, plan de développement, attestations de formation."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Quand"
      ],
      "rows": [
       [
        "1. Définir les exigences",
        "Direction",
        "Pour chaque formation et chaque mission, revue annuelle"
       ],
       [
        "2. Vérifier à l'arrivée",
        "Direction",
        "Avant toute intervention"
       ],
       [
        "3. Intégrer",
        "Référent pédagogique",
        "Premières semaines"
       ],
       [
        "4. Suivre les validités",
        "Direction",
        "Alerte 3 mois avant échéance"
       ],
       [
        "5. Observer en situation",
        "Référent pédagogique",
        "Au moins 1 fois par an et par formateur"
       ],
       [
        "6. Entretien annuel",
        "Direction",
        "Chaque année"
       ],
       [
        "7. Développer",
        "Direction",
        "Plan annuel"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Exigences.** Pour chaque formation : qualification obligatoire, expérience terrain, compétences pédagogiques. Pour chaque référent : formation ou sensibilisation attendue (exemple : le référent handicap suit une formation dédiée, le référent signalements est formé à l'écoute et à l'orientation)."
     },
     {
      "t": "p",
      "text": "**Étape 2. Vérifier.** Justificatifs originaux ou vérifiables, dates de validité saisies dans la matrice. Aucune intervention sans qualification valide."
     },
     {
      "t": "p",
      "text": "**Étape 3. Intégrer.** Présentation de l'organisme, des procédures et de l'outil ; première session en binôme ou observée quand c'est possible."
     },
     {
      "t": "p",
      "text": "**Étape 4. Validités.** L'outil alerte 3 mois avant l'expiration d'une qualification ; le maintien des acquis est planifié avant l'échéance. À défaut, l'intervenant est retiré du planning pour cette formation."
     },
     {
      "t": "p",
      "text": "**Étape 5. Observer.** Grille d'observation : respect du programme, clarté, pratique, gestion du groupe, adaptation, évaluation, inclusion de tous. L'observé reçoit un retour écrit."
     },
     {
      "t": "p",
      "text": "**Étape 6. Entretien annuel.** Bilan des sessions (appréciations, résultats), observation, besoins de formation, souhaits d'évolution. Pour les salariés, il ne remplace pas l'entretien de parcours professionnel obligatoire : dans la première année suivant l'embauche, puis tous les 4 ans, avec un entretien d'état des lieux tous les 8 ans (loi du 24 octobre 2025), sauf périodicité plus courte prévue par accord."
     },
     {
      "t": "p",
      "text": "**Étape 7. Développer.** Le plan annuel couvre les maintiens d'acquis obligatoires, la pédagogie, l'accueil du handicap, la prévention des violences et discriminations, et les nouveautés techniques issues de la veille."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Dirigeant formateur** : soumis aux mêmes exigences, observation croisée entre dirigeants ou par un pair externe.",
       "**Nouvelle formation au catalogue** : un formateur n'y est affecté qu'une fois qualifié et après une première session observée."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Recrutement et choix des intervenants sur les seules compétences, sans discrimination.",
       "Tous les formateurs sont sensibilisés à l'accueil des personnes en situation de handicap et à la prévention des violences et discriminations, au moins une fois tous les 2 ans, à l'arrivée pour les nouveaux.",
       "L'accès aux formations internes est ouvert à tous les membres de l'équipe."
      ]
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Matrice des compétences, justificatifs de qualification, fiches de poste, comptes rendus d'intégration, d'observation et d'entretien, plan de développement et attestations. Conservation 5 ans après le départ de la personne."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Interventions assurées avec qualification valide",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Formateurs observés dans l'année",
        "100 %",
        "Revue de direction"
       ],
       [
        "Entretiens annuels réalisés",
        "100 %",
        "Revue de direction"
       ],
       [
        "Actions du plan de développement réalisées",
        "80 %",
        "Revue de direction"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Qualification expirée sans qu'on le voie",
        "Dates saisies, alerte 3 mois avant."
       ],
       [
        "Compétences pédagogiques non vérifiées",
        "Observation annuelle obligatoire."
       ],
       [
        "Petite équipe sans regard extérieur",
        "Observation croisée, participation à des réseaux de formateurs."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Les exigences de compétence par formation et leur respect, y compris pour les sous-traitants (ind. 21).",
       "Les actions de développement des compétences des salariés (ind. 22)."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à toute l'équipe et aux formateurs. Matrice revue chaque trimestre, procédure chaque année."
     }
    ]
   }
  ]
 },
 "proc-eng": {
  "id": "proc-eng",
  "num": "P15",
  "code": "QUAL-ENG",
  "name": "Engagement des stagiaires et prévention des ruptures",
  "family": "procedures",
  "indicators": [
   12
  ],
  "pilote": "direction",
  "scope": "",
  "sections": [
   {
    "id": "1-finalite",
    "title": "1. Finalité",
    "blocks": [
     {
      "t": "p",
      "text": "Favoriser la présence et l'implication de chaque stagiaire du début à la fin, repérer tôt les signes de décrochage, et agir avant que la formation ne soit interrompue. Quand une rupture survient malgré tout, la traiter proprement et en comprendre la cause."
     }
    ]
   },
   {
    "id": "2-perimetre",
    "title": "2. Périmètre",
    "blocks": [
     {
      "t": "p",
      "text": "Toutes les sessions. Les formations courtes (1 à 5 jours) concentrent l'enjeu sur l'assiduité et l'implication en séance ; les formations longues ou à distance demandent en plus un suivi entre les séquences."
     }
    ]
   },
   {
    "id": "3-references",
    "title": "3. Références",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Référentiel national qualité, indicateur 12 (engagement et prévention des ruptures de parcours).",
       "Règlement intérieur (assiduité, absences, retards).",
       "Procédures P07, P08, P09, P11."
      ]
     }
    ]
   },
   {
    "id": "4-definitions",
    "title": "4. Définitions",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Terme",
       "Sens"
      ],
      "rows": [
       [
        "Absence",
        "Demi-journée non émargée."
       ],
       [
        "Signe de décrochage",
        "Retards répétés, absence, désintérêt visible, difficulté exprimée, conflit, échec répété aux exercices, absence de connexion à distance."
       ],
       [
        "Rupture",
        "Arrêt de la formation avant son terme, à l'initiative du stagiaire, de l'entreprise ou de l'organisme."
       ],
       [
        "Taux d'assiduité",
        "Demi-journées émargées divisées par demi-journées prévues, publié (ind. 2)."
       ]
      ]
     }
    ]
   },
   {
    "id": "5-roles",
    "title": "5. Rôles",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Qui",
       "Fait quoi"
      ],
      "rows": [
       [
        "Formateur",
        "Crée les conditions de l'engagement, repère les signes, échange avec le stagiaire, alerte le jour même."
       ],
       [
        "Direction ou gestion administrative",
        "Contacte le stagiaire absent et l'entreprise, organise le rattrapage, traite la rupture."
       ],
       [
        "Référent handicap, référent signalements",
        "Interviennent quand la difficulté relève de leur domaine."
       ]
      ]
     }
    ]
   },
   {
    "id": "6-entrees-sorties-liens",
    "title": "6. Entrées, sorties, liens",
    "blocks": [
     {
      "t": "p",
      "text": "**Entrées** : émargements, observations du formateur, résultats intermédiaires, connexions à distance, messages du stagiaire ou de l'entreprise."
     },
     {
      "t": "p",
      "text": "**Sorties** : absences justifiées et tracées, actions de soutien, rattrapages, fiches de rupture avec motif, statistiques d'assiduité et de ruptures."
     }
    ]
   },
   {
    "id": "7-deroulement",
    "title": "7. Déroulement",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Étape",
       "Qui",
       "Quand"
      ],
      "rows": [
       [
        "1. Préparer l'engagement",
        "Gestion, formateur",
        "Avant la session"
       ],
       [
        "2. Engager dès l'accueil",
        "Formateur",
        "Première demi-journée"
       ],
       [
        "3. Suivre la présence",
        "Formateur",
        "Chaque demi-journée"
       ],
       [
        "4. Réagir à une absence",
        "Gestion administrative",
        "Le jour même"
       ],
       [
        "5. Réagir à un signe de décrochage",
        "Formateur",
        "Dans la demi-journée"
       ],
       [
        "6. Traiter une rupture",
        "Direction",
        "Sous 2 jours ouvrés"
       ],
       [
        "7. Analyser",
        "Responsable qualité",
        "Chaque trimestre"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Étape 1. Préparer.** Convocation claire et envoyée dès confirmation (horaires, accès, équipement), attentes recueillies sur la fiche de renseignement, adaptations en place. Un stagiaire qui sait pourquoi il vient et dans quelles conditions s'engage davantage."
     },
     {
      "t": "p",
      "text": "**Étape 2. Engager dès l'accueil.** Lien entre les objectifs et le travail réel de chacun, recueil des attentes, règles du groupe, explication de l'évaluation. Le stagiaire sait à qui parler en cas de difficulté."
     },
     {
      "t": "p",
      "text": "**Étape 3. Suivre la présence.** Émargement à chaque demi-journée. À distance : connexion et participation vérifiées (questions, exercices rendus)."
     },
     {
      "t": "p",
      "text": "**Étape 4. Absence.** Le stagiaire absent est contacté le jour même pour connaître la raison et proposer une solution ; l'entreprise est informée pour un salarié. Le motif est noté. Si la partie manquée est indispensable à l'objectif (exemple : épreuve certificative), un rattrapage est proposé sur une autre session."
     },
     {
      "t": "p",
      "text": "**Étape 5. Décrochage.** Le formateur parle avec le stagiaire en privé, sans le mettre en difficulté devant le groupe, pour comprendre : difficulté d'apprentissage, besoin d'adaptation non exprimé (P09), problème dans le groupe (P11), contrainte personnelle ou professionnelle. Il adapte ce qu'il peut (rythme, explications, exercices) et alerte la direction si la situation persiste."
     },
     {
      "t": "p",
      "text": "**Étape 6. Rupture.** Le motif est recueilli et noté (à l'initiative du stagiaire, de l'entreprise, de l'organisme, cas de force majeure). L'attestation mentionne la présence réelle et les objectifs évalués. Une solution de reprise est proposée (autre date, complément). La facturation suit la convention."
     },
     {
      "t": "p",
      "text": "**Étape 7. Analyser.** Assiduité et ruptures par formation, par formateur et par motif. Un motif récurrent donne lieu à une action (P02)."
     }
    ]
   },
   {
    "id": "8-cas-particuliers",
    "title": "8. Cas particuliers",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Retards répétés** : échange en privé, rappel du règlement intérieur ; pour une formation réglementaire, la durée minimale exigée doit être respectée pour délivrer le certificat.",
       "**Exclusion** décidée selon le règlement intérieur : procédure disciplinaire respectée, entreprise et financeur informés.",
       "**Départ pour raison médicale ou familiale** : aucune justification détaillée exigée, report proposé."
      ]
     }
    ]
   },
   {
    "id": "9-accessibilite-et-egalite-de-traitement",
    "title": "9. Accessibilité et égalité de traitement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Un décrochage est d'abord considéré comme un signal à comprendre, pas comme une faute.",
       "Les contraintes personnelles exprimées (garde d'enfant, transport, santé, pratique religieuse) sont prises en compte dans la mesure du possible, sans jugement et sans demande de justification intrusive.",
       "Les mêmes règles d'assiduité s'appliquent à tous ; seules les adaptations décidées (P09) les modifient."
      ]
     }
    ]
   },
   {
    "id": "10-traces-gardees",
    "title": "10. Traces gardées",
    "blocks": [
     {
      "t": "p",
      "text": "Émargements, motifs d'absence, actions de soutien, rattrapages, fiches de rupture, statistiques. Conservation 5 ans."
     }
    ]
   },
   {
    "id": "11-indicateurs",
    "title": "11. Indicateurs",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Indicateur",
       "Objectif",
       "Revue"
      ],
      "rows": [
       [
        "Taux d'assiduité",
        "95 %, publié",
        "Trimestrielle"
       ],
       [
        "Absences suivies d'un contact le jour même",
        "100 %",
        "Trimestrielle"
       ],
       [
        "Taux de rupture",
        "Suivi, motif renseigné dans 100 % des cas",
        "Trimestrielle"
       ],
       [
        "Rattrapages proposés quand la partie manquée est indispensable",
        "100 %",
        "Trimestrielle"
       ]
      ]
     }
    ]
   },
   {
    "id": "12-risques-et-parades",
    "title": "12. Risques et parades",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Risque",
       "Parade"
      ],
      "rows": [
       [
        "Absence découverte après la session",
        "Émargement par demi-journée, contrôle le soir même."
       ],
       [
        "Décrochage non repéré",
        "Formateurs formés aux signes, échange privé rapide."
       ],
       [
        "Rupture sans suite",
        "Fiche de rupture, solution de reprise proposée."
       ]
      ]
     }
    ]
   },
   {
    "id": "13-ce-que-verifie-l-auditeur",
    "title": "13. Ce que vérifie l'auditeur",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Les moyens mis en œuvre pour favoriser l'engagement et prévenir les ruptures (ind. 12).",
       "Le suivi de l'assiduité et le traitement des absences et abandons.",
       "La cohérence avec le taux d'assiduité publié (ind. 2)."
      ]
     }
    ]
   },
   {
    "id": "14-diffusion-et-revision",
    "title": "14. Diffusion et révision",
    "blocks": [
     {
      "t": "p",
      "text": "Diffusée à l'équipe et aux formateurs. Revue chaque année."
     }
    ]
   }
  ]
 },
 "des-fiches": {
  "id": "des-fiches",
  "num": "D01",
  "code": "QUAL-DESIG",
  "name": "Désignations des référents",
  "family": "gouvernance",
  "indicators": [
   12,
   23,
   24,
   25,
   26,
   31,
   32
  ],
  "pilote": "",
  "scope": "Une lettre par rôle, générée depuis les Paramètres",
  "sections": [
   {
    "id": "modele-de-lettre-commun-aux-9-roles",
    "title": "Modèle de lettre (commun aux 9 rôles)",
    "blocks": [
     {
      "t": "quote",
      "paras": [
       "**{{org.nom}}**, {{org.adresse}}, {{org.code_postal}} {{org.ville}}, SIRET {{org.siret}}, déclaration d'activité n° {{org.nda}}",
       "**Lettre de désignation : [intitulé du rôle]**",
       "Je soussigné(e) {{org.dirigeant}}, {{org.dirigeant_qualite}} de {{org.nom}}, désigne **[nom de la personne]** en qualité de **[intitulé du rôle]** à compter du [date].",
       "Suppléant : **[nom du suppléant]**, qui exerce la mission en cas d'absence, d'empêchement ou de conflit d'intérêts.",
       "La mission, les moyens et les engagements sont décrits dans la fiche de mission jointe, qui fait partie de la présente désignation. Les coordonnées du référent sont publiées [lieux de publication]. La désignation est revue chaque année en revue de direction et prend fin par écrit.",
       "Fait à {{org.lieu_signature}}, le [date]. Signature du dirigeant. Signature de la personne désignée, précédée de la mention « Mission acceptée »."
      ]
     },
     {
      "t": "p",
      "text": "Si le dirigeant se désigne lui-même, la phrase devient : « Je soussigné(e) {{org.dirigeant}}, {{org.dirigeant_qualite}}, assure la fonction de… », une seule signature."
     }
    ]
   },
   {
    "id": "fiches-de-mission",
    "title": "Fiches de mission",
    "blocks": [
     {
      "t": "p",
      "text": "Chaque fiche suit le même plan : mission, tâches, moyens et temps, compétences attendues, lieux de publication, procédures liées."
     },
     {
      "t": "table",
      "head": [
       "Rôle",
       "Mission en une phrase",
       "Tâches principales",
       "Compétences ou formation attendues",
       "Publié",
       "Procédures"
      ],
      "rows": [
       [
        "Responsable qualité",
        "Faire vivre le système qualité et préparer les audits.",
        "Tenir les procédures et documents à jour, suivre non-conformités et plan d'actions, animer la revue de direction, piloter le dossier d'audit.",
        "Connaissance du référentiel national qualité.",
        "Interne",
        "P02, P03 et toutes"
       ],
       [
        "Référent pédagogique",
        "Garantir la qualité pédagogique des formations.",
        "Valider les programmes et leurs versions, briefer les formateurs, observer en séance, traiter les contestations de résultats.",
        "Expérience de formateur, maîtrise des référentiels techniques.",
        "Interne",
        "P06, P07, P08, P14"
       ],
       [
        "Référent handicap",
        "Être l'interlocuteur unique des personnes en situation de handicap.",
        "Mener les entretiens, décider des adaptations avec la personne, mobiliser les partenaires, tenir les fiches lieux et l'annuaire des partenaires.",
        "Formation dédiée au rôle de référent handicap.",
        "Site, convocation, livret, programmes",
        "P09, P10"
       ],
       [
        "Référent signalements",
        "Recevoir et traiter les signalements de violences, harcèlement et discriminations.",
        "Écouter, orienter, protéger, conduire l'examen des faits, suivre la victime.",
        "Formation à l'écoute et à l'orientation des victimes.",
        "Livret, affichage, portail stagiaire",
        "P11"
       ],
       [
        "Référent réclamations",
        "Recevoir et suivre les réclamations, difficultés et aléas.",
        "Accuser réception, analyser, répondre dans les délais, enregistrer.",
        "Connaissance de la procédure P01, sens du dialogue.",
        "Site, livret, CGV",
        "P01"
       ],
       [
        "Référent amélioration continue",
        "Transformer toutes les sources d'information en actions de progrès.",
        "Revue trimestrielle des sources, vérification d'efficacité des actions.",
        "Méthode d'analyse des causes.",
        "Interne",
        "P02"
       ],
       [
        "Référent veille",
        "Organiser la veille et son exploitation.",
        "Tenir la liste des sources et le registre, décider des suites, informer l'équipe.",
        "Connaissance des sources officielles.",
        "Interne",
        "P04"
       ],
       [
        "Référent données personnelles",
        "Faire respecter la protection des données.",
        "Tenir les registres, répondre aux demandes de droits, gérer les incidents, purge annuelle.",
        "Sensibilisation RGPD.",
        "Politique de confidentialité, mentions des formulaires",
        "P12"
       ],
       [
        "Référent déontologie",
        "Veiller au respect de la charte formateur.",
        "Recueillir les manquements à la charte, proposer les suites à la direction, faire signer la charte.",
        "Connaissance de la charte.",
        "Interne",
        "P13, P14, D08"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Temps consacré** : indiqué dans chaque fiche par l'organisme (champ à remplir), pour montrer que la mission est réellement exercée."
     }
    ]
   }
  ]
 },
 "livret-court": {
  "id": "livret-court",
  "num": "D03",
  "code": "QUAL-LIVC",
  "name": "Livret d'accueil, version courte",
  "family": "stagiaires",
  "indicators": [
   9,
   12,
   26
  ],
  "pilote": "",
  "scope": "2 pages, remis avec la convocation et affiché sur le portail stagiaire",
  "sections": [
   {
    "id": "page-1",
    "title": "",
    "blocks": [
     {
      "t": "p",
      "text": "**Bienvenue chez {{org.nom}}**"
     },
     {
      "t": "p",
      "text": "Nous sommes heureux de vous accueillir en formation. Ce livret vous dit l'essentiel."
     },
     {
      "t": "p",
      "text": "**Avant de venir**"
     },
     {
      "t": "ul",
      "items": [
       "Lisez votre convocation : date, horaires, adresse.",
       "Prenez une pièce d'identité et l'équipement indiqué.",
       "Vous ne pouvez pas venir ? Prévenez-nous au plus vite au {{org.telephone}}."
      ]
     },
     {
      "t": "p",
      "text": "**Pendant la formation**"
     },
     {
      "t": "ul",
      "items": [
       "Signez la feuille de présence matin et après-midi.",
       "Respectez les horaires et les consignes de sécurité.",
       "Posez toutes vos questions. Il n'y a pas de question bête.",
       "À la fin, vous donnez votre avis sur la formation."
      ]
     },
     {
      "t": "p",
      "text": "**Après la formation**"
     },
     {
      "t": "ul",
      "items": [
       "Vous recevez une attestation.",
       "3 mois plus tard, nous vous demandons si la formation vous sert dans votre travail."
      ]
     }
    ]
   },
   {
    "id": "page-2",
    "title": "",
    "blocks": [
     {
      "t": "p",
      "text": "**Besoin d'un aménagement ?**"
     },
     {
      "t": "p",
      "text": "Handicap, santé, lecture difficile, contrainte personnelle : parlez-en. C'est confidentiel. Contact : {{role.referent_handicap}}, {{role.referent_handicap.telephone}}, {{role.referent_handicap.email}}"
     },
     {
      "t": "p",
      "text": "**Un problème, une réclamation ?**"
     },
     {
      "t": "p",
      "text": "Parlez-en au formateur, ou écrivez à {{role.referent_reclamations.email}}. Réponse sous 10 jours ouvrés."
     },
     {
      "t": "p",
      "text": "**Victime ou témoin de violence, de harcèlement, de discrimination ?**"
     },
     {
      "t": "p",
      "text": "Ne restez pas sans aide. Parlez-en à {{role.referent_signalements}}, {{role.referent_signalements.telephone}}, {{role.referent_signalements.email}}. C'est confidentiel."
     },
     {
      "t": "table",
      "head": [
       "Situation",
       "Numéro"
      ],
      "rows": [
       [
        "Urgence",
        "17 ou 112"
       ],
       [
        "SMS urgence (sourds, malentendants)",
        "114"
       ],
       [
        "Violences faites aux femmes",
        "3919"
       ],
       [
        "Enfance en danger",
        "119"
       ],
       [
        "Discriminations",
        "3928"
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Vos données** : nous les utilisons seulement pour votre formation. Pour toute question : {{role.referent_rgpd.email}}."
     },
     {
      "t": "p",
      "text": "Le règlement intérieur complet et le livret détaillé sont disponibles sur votre portail et sur demande."
     }
    ]
   }
  ]
 },
 "livret-complet": {
  "id": "livret-complet",
  "num": "D04",
  "code": "QUAL-LIVA",
  "name": "Livret d'accueil, version complète",
  "family": "stagiaires",
  "indicators": [
   1,
   9,
   12,
   26,
   30
  ],
  "pilote": "",
  "scope": "8 à 10 pages, sur le portail stagiaire et sur demande",
  "sections": [
   {
    "id": "sommaire-et-contenu",
    "title": "Sommaire et contenu",
    "blocks": [
     {
      "t": "p",
      "text": "**1. Qui sommes-nous.** {{org.nom}}, organisme de formation enregistré sous le numéro {{org.nda}} auprès du préfet de la région {{org.region_nda}}. Cet enregistrement ne vaut pas agrément de l'État. Domaines de formation : {{catalogue}}. Certification qualité au titre des actions de formation, si elle est détenue (mention reprise des Paramètres, Certification)."
     },
     {
      "t": "p",
      "text": "**2. Vos interlocuteurs.** Tableau : direction, gestion administrative, formateur de la session, référents handicap, signalements, réclamations, données personnelles, avec téléphone et adresse."
     },
     {
      "t": "p",
      "text": "**3. Avant la formation.** Ce que vous recevez (convocation, programme, règlement intérieur, ce livret). Le positionnement : à quoi il sert, il ne sélectionne pas. Comment signaler un besoin d'aménagement. Que faire en cas d'empêchement."
     },
     {
      "t": "p",
      "text": "**4. Le déroulement.** Horaires et pauses, signature de présence par demi-journée, méthodes (apports, démonstrations, pratique, mises en situation), équipement de protection quand la formation l'exige. Formation à distance : connexion, assistance, vérification de la présence."
     },
     {
      "t": "p",
      "text": "**5. L'évaluation.** Comment vous êtes évalué, sur quels critères, les aménagements possibles, ce qui se passe si un objectif n'est pas atteint (proposition de complément), comment contester un résultat."
     },
     {
      "t": "p",
      "text": "**6. Après la formation.** Attestation de fin de formation, certificat le cas échéant, questionnaire à chaud puis à 3 mois, recyclage quand il est obligatoire."
     },
     {
      "t": "p",
      "text": "**7. Votre avis compte.** Les questionnaires, ce que nous en faisons, nos résultats publiés et leur méthode de calcul."
     },
     {
      "t": "p",
      "text": "**8. Handicap et aménagements.** Résumé de P09 : pas besoin de reconnaître officiellement un handicap, la personne décide, confidentialité, exemples d'aménagements, partenaires."
     },
     {
      "t": "p",
      "text": "**9. Respect, violences, harcèlement, discriminations.** Ce qui est interdit, en mots simples avec exemples. Comment signaler, ce qui se passe ensuite, protection contre les représailles. Numéros d'aide."
     },
     {
      "t": "p",
      "text": "**10. Réclamations.** Comment faire, délais (accusé de réception sous 48 heures, réponse sous 10 jours ouvrés), possibilité de recours auprès du financeur."
     },
     {
      "t": "p",
      "text": "**11. Hygiène, sécurité, santé.** Consignes d'évacuation, numéros d'urgence, interdiction de fumer et vapoter, alcool et produits stupéfiants interdits, signalement de tout accident."
     },
     {
      "t": "p",
      "text": "**12. Vos données personnelles.** Ce que nous collectons, pourquoi, combien de temps, vos droits, contact, droit de saisir la CNIL."
     },
     {
      "t": "p",
      "text": "**13. Accès et informations pratiques.** Plan, transports, stationnement, accessibilité du lieu, restauration à proximité. Pour l'intra : renvoi aux consignes du site."
     },
     {
      "t": "p",
      "text": "**14. Résumé du règlement intérieur** et lien vers la version complète."
     }
    ]
   }
  ]
 },
 "reglement": {
  "id": "reglement",
  "num": "D05",
  "code": "QUAL-RI",
  "name": "Règlement intérieur applicable aux stagiaires",
  "family": "stagiaires",
  "indicators": [],
  "pilote": "",
  "scope": "Remis avant l'inscription définitive (L6353-8), affiché, sur le portail",
  "sections": [
   {
    "id": "article-1-objet-et-champ-d-application",
    "title": "Article 1. Objet et champ d'application",
    "blocks": [
     {
      "t": "p",
      "text": "Le présent règlement est établi par {{org.nom}}, organisme de formation enregistré sous le numéro {{org.nda}}. Il s'applique à toute personne inscrite à une action de formation, pour toute sa durée, dans les locaux de l'organisme, dans les locaux loués ou mis à disposition, et à distance. Il fixe les règles d'hygiène et de sécurité, les règles de discipline, la nature et l'échelle des sanctions et les garanties de procédure dont bénéficie le stagiaire."
     },
     {
      "t": "p",
      "text": "Lorsque la formation se déroule dans une entreprise dotée d'un règlement intérieur, les mesures d'hygiène et de sécurité applicables sont celles de ce règlement (R6352-1)."
     }
    ]
   },
   {
    "id": "article-2-hygiene-et-securite",
    "title": "Article 2. Hygiène et sécurité",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Chaque stagiaire respecte les consignes générales et particulières de sécurité, notamment les consignes d'évacuation affichées et celles données par le formateur.",
       "Le port des équipements de protection individuelle indiqués dans la convocation est obligatoire pendant les séquences pratiques. Un stagiaire qui ne les porte pas ne peut pas participer à ces séquences.",
       "Les machines, engins et matériels sont utilisés uniquement en présence et sur instruction du formateur.",
       "Il est interdit de fumer et de vapoter dans les locaux, d'introduire ou de consommer de l'alcool ou des produits stupéfiants, et de se présenter en formation sous leur emprise. Le formateur peut interdire la participation aux séquences pratiques d'une personne dont l'état présente un risque pour elle-même ou pour autrui.",
       "Tout accident ou incident, même léger, survenu pendant la formation ou le trajet est immédiatement signalé au formateur. Pour un salarié, l'organisme en informe l'employeur, à qui il revient de faire la déclaration."
      ]
     }
    ]
   },
   {
    "id": "article-3-egalite-de-traitement-libertes",
    "title": "Article 3. Égalité de traitement, libertés, neutralité et respect des personnes",
    "blocks": [
     {
      "t": "p",
      "text": "Conformément à l'article L6352-4 du Code du travail, l'organisme traite de manière égale tous les stagiaires et apprentis, veille au respect de leur liberté d'expression et de conscience, et veille à la neutralité des enseignements qu'il dispense. Chaque stagiaire exerce sa liberté d'expression dans le respect des autres participants, du déroulement de la formation et des règles de sécurité."
     },
     {
      "t": "p",
      "text": "Chacun doit un comportement respectueux envers toutes les personnes présentes. Sont interdits et constituent des fautes : les violences physiques ou verbales, les menaces, le harcèlement moral ou sexuel, les agissements sexistes, les propos ou comportements discriminatoires, quel qu'en soit le motif."
     },
     {
      "t": "p",
      "text": "Toute personne victime ou témoin peut le signaler au formateur ou au référent signalements, {{role.referent_signalements}}, {{role.referent_signalements.email}}. Le signalement est traité de façon confidentielle. Aucune personne ayant signalé ou témoigné de bonne foi ne peut faire l'objet d'une sanction ou d'une mesure défavorable."
     }
    ]
   },
   {
    "id": "article-4-discipline",
    "title": "Article 4. Discipline",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Horaires** : les stagiaires respectent les horaires fixés dans la convocation. Tout retard ou absence est signalé à l'organisme dès que possible et justifié. Pour un salarié, l'employeur est informé des absences.",
       "**Présence** : les stagiaires signent la feuille de présence à chaque demi-journée. Signer pour une autre personne est interdit.",
       "**Locaux et matériel** : ils sont utilisés conformément à leur objet et laissés en bon état. Le matériel remis pour la formation est restitué à la fin.",
       "**Téléphone** : il est mis en silencieux pendant les séquences et n'est pas utilisé pendant les séquences pratiques, sauf urgence ou usage pédagogique.",
       "**Enregistrements** : il est interdit d'enregistrer ou de photographier une séance ou une personne sans son accord.",
       "**Supports** : les supports remis sont réservés à l'usage personnel du stagiaire et ne peuvent être diffusés.",
       "**Formation à distance** : le stagiaire suit les séquences connecté, participe aux activités demandées et respecte les règles du présent article."
      ]
     }
    ]
   },
   {
    "id": "article-5-sanctions",
    "title": "Article 5. Sanctions",
    "blocks": [
     {
      "t": "p",
      "text": "Constitue une sanction toute mesure, autre que les observations verbales, prise par le dirigeant de l'organisme ou son représentant à la suite d'un agissement du stagiaire considéré comme fautif, de nature à affecter immédiatement ou non sa présence dans la formation ou à mettre en cause la continuité de celle-ci."
     },
     {
      "t": "p",
      "text": "Selon la gravité des faits, les sanctions sont, par ordre croissant :"
     },
     {
      "t": "ol",
      "items": [
       "avertissement écrit ;",
       "exclusion temporaire de la formation ;",
       "exclusion définitive de la formation."
      ]
     },
     {
      "t": "p",
      "text": "Les amendes et autres sanctions pécuniaires sont interdites. L'organisme informe l'employeur et, le cas échéant, le financeur de la sanction prise."
     }
    ]
   },
   {
    "id": "article-6-garanties-de-procedure",
    "title": "Article 6. Garanties de procédure",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "Aucune sanction ne peut être prise sans que le stagiaire ait été informé au préalable, par écrit, des griefs retenus contre lui.",
       "Lorsque la sanction envisagée a une incidence, immédiate ou non, sur la présence du stagiaire dans la formation, le dirigeant ou son représentant le convoque à un entretien, par lettre recommandée ou remise contre décharge, en indiquant l'objet, la date, l'heure et le lieu de l'entretien et la possibilité de se faire assister par une personne de son choix, stagiaire ou salarié de l'organisme.",
       "Au cours de l'entretien, le motif de la sanction envisagée est indiqué et les explications du stagiaire sont recueillies.",
       "La sanction ne peut intervenir moins d'un jour franc ni plus de 15 jours après l'entretien. Elle est écrite, motivée et notifiée au stagiaire par lettre recommandée ou remise contre récépissé.",
       "Lorsque l'agissement rend indispensable une mesure conservatoire d'exclusion temporaire à effet immédiat, aucune sanction définitive ne peut être prise sans que cette procédure ait été respectée.",
       "Le stagiaire peut contester la sanction par écrit auprès du dirigeant, selon la procédure de réclamation."
      ]
     }
    ]
   },
   {
    "id": "article-7-representation-des-stagiaires",
    "title": "Article 7. Représentation des stagiaires",
    "blocks": [
     {
      "t": "p",
      "text": "Les dispositions relatives à l'élection d'un délégué des stagiaires s'appliquent aux formations d'une durée totale supérieure à 500 heures (R6352-9 et suivants). L'organisme ne propose pas de telles formations : cet article est **sans objet**. Il sera complété si une telle formation est ouverte."
     }
    ]
   },
   {
    "id": "article-8-reclamations",
    "title": "Article 8. Réclamations",
    "blocks": [
     {
      "t": "p",
      "text": "Toute réclamation peut être adressée oralement ou par écrit au formateur ou au référent réclamations, {{role.referent_reclamations.email}}. Un accusé de réception est adressé sous 48 heures et une réponse sous 10 jours ouvrés."
     }
    ]
   },
   {
    "id": "article-9-publicite-et-entree-en-vigueur",
    "title": "Article 9. Publicité et entrée en vigueur",
    "blocks": [
     {
      "t": "p",
      "text": "Le présent règlement est remis à chaque stagiaire avant son inscription définitive, affiché dans les locaux et disponible sur le portail stagiaire. Il entre en vigueur le [date] et remplace toute version antérieure."
     },
     {
      "t": "p",
      "text": "Fait à {{org.lieu_signature}}, le [date]. {{org.dirigeant}}, {{org.dirigeant_qualite}}."
     }
    ]
   }
  ]
 },
 "cgv": {
  "id": "cgv",
  "num": "D06",
  "code": "QUAL-CGV",
  "name": "Conditions générales de vente",
  "family": "stagiaires",
  "indicators": [
   1,
   2
  ],
  "pilote": "",
  "scope": "Publiées sur le site, jointes aux devis et conventions",
  "sections": [
   {
    "id": "article-1-objet-et-champ-d-application",
    "title": "Article 1. Objet et champ d'application",
    "blocks": [
     {
      "t": "p",
      "text": "Les présentes conditions s'appliquent à toutes les prestations de formation de {{org.nom}}, déclaration d'activité n° {{org.nda}} auprès du préfet de la région {{org.region_nda}} (cet enregistrement ne vaut pas agrément de l'État). Toute commande vaut acceptation des présentes conditions, qui prévalent sur tout autre document du client sauf accord écrit contraire."
     }
    ]
   },
   {
    "id": "article-2-formations-concernees",
    "title": "Article 2. Formations concernées",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "**Inter-entreprises** : sessions à dates fixes, réunissant des stagiaires de plusieurs structures, dans nos locaux ou dans un lieu choisi par nous.",
       "**Intra-entreprise** : session réservée aux salariés d'un même client, dans ses locaux ou dans un lieu convenu.",
       "**Sur mesure** : formation conçue à partir de l'analyse du besoin du client."
      ]
     }
    ]
   },
   {
    "id": "article-3-commande",
    "title": "Article 3. Commande",
    "blocks": [
     {
      "t": "p",
      "text": "La commande est ferme à réception du devis signé ou du bon de commande, puis de la convention de formation signée (L6353-1 et suivants), à laquelle sont annexés le programme et, sur demande, le règlement intérieur. Pour l'inter, l'inscription est confirmée par écrit dans la limite des places disponibles. Le client transmet la liste des stagiaires et signale tout besoin d'aménagement au plus tôt."
     }
    ]
   },
   {
    "id": "article-4-particuliers-contrat-de-format",
    "title": "Article 4. Contrat de formation et rétractation",
    "blocks": [
     {
      "t": "p",
      "text": "Lorsqu'une personne physique finance elle-même sa formation, un contrat de formation est conclu (L6353-3). Elle dispose d'un délai de **10 jours** à compter de sa signature pour se rétracter par lettre recommandée avec avis de réception, sans frais (L6353-5). Aucune somme ne peut être exigée avant l'expiration de ce délai ; un acompte de **30 % au plus** peut ensuite être demandé, le solde étant échelonné au fur et à mesure du déroulement (L6353-6). En cas d'empêchement de suivre la formation pour force majeure dûment reconnue, seules les prestations effectivement réalisées sont dues, au prorata (L6353-7)."
     }
    ],
    "cond": "particuliers"
   },
   {
    "id": "article-5-prix",
    "title": "Article 5. Prix",
    "blocks": [
     {
      "t": "p",
      "text": "Les prix sont indiqués en euros hors taxes. La TVA est appliquée au taux en vigueur, sauf exonération applicable à l'organisme, mentionnée alors sur le devis et la facture. Les prix comprennent l'animation, les supports et l'évaluation ; les frais de déplacement, d'hébergement et de restauration sont facturés seulement s'ils sont prévus au devis."
     }
    ]
   },
   {
    "id": "article-6-facturation-et-paiement",
    "title": "Article 6. Facturation et paiement",
    "blocks": [
     {
      "t": "ul",
      "items": [
       "La facture est émise à l'issue de la formation, ou selon l'échéancier prévu au devis pour les formations longues. Elle est accompagnée de la copie des feuilles de présence et des attestations.",
       "Paiement par virement, à l'échéance indiquée sur la facture.",
       "Tout retard de paiement entraîne de plein droit, pour un client professionnel, des pénalités au taux d'intérêt de la Banque centrale européenne majoré de 10 points, et une indemnité forfaitaire pour frais de recouvrement de 40 euros (L441-10 du Code de commerce)."
      ]
     }
    ]
   },
   {
    "id": "article-7-prise-en-charge-par-un-finance",
    "title": "Article 7. Prise en charge par un financeur",
    "blocks": [
     {
      "t": "p",
      "text": "Si le client fait financer la formation par un opérateur de compétences ou un autre financeur, il lui appartient de faire la demande avant le début de la formation et de s'assurer de l'accord. L'accord de prise en charge est communiqué à l'organisme avant le début de la formation pour que la facture soit adressée directement au financeur (subrogation). En cas de prise en charge partielle, de refus ou de non-paiement par le financeur, quelle qu'en soit la raison, le montant restant est dû par le client."
     }
    ]
   },
   {
    "id": "article-8-annulation-report-ou-absence-d",
    "title": "Article 8. Annulation, report ou absence du fait du client",
    "blocks": [
     {
      "t": "p",
      "text": "Toute annulation ou demande de report est notifiée par écrit. Le remplacement d'un stagiaire par une autre personne du même client, répondant aux prérequis, est possible sans frais jusqu'à la veille de la formation."
     },
     {
      "t": "table",
      "head": [
       "Date de l'annulation ou de l'absence",
       "Dédommagement dû par le client"
      ],
      "rows": [
       [
        "Plus de 15 jours calendaires avant le début",
        "Aucun"
       ],
       [
        "De 15 à 8 jours avant",
        "50 % du prix des heures annulées"
       ],
       [
        "7 jours ou moins avant",
        "75 % du prix des heures annulées"
       ],
       [
        "Le jour même, ou absence sans annulation",
        "100 % du prix des heures non suivies"
       ]
      ]
     },
     {
      "t": "p",
      "text": "Un report demandé plus de 15 jours avant est sans frais, une seule fois. Pour une formation commencée, seules les heures réellement suivies sont facturées au titre de la formation (L6354-1) ; les heures non suivies du fait du client donnent lieu au dédommagement ci-dessus, sauf force majeure (article 10). Ce dédommagement n'est pas le prix d'une prestation de formation : il fait l'objet d'une facture distincte au client, ne peut pas être présenté à un financeur de la formation et n'entre pas dans le bilan pédagogique et financier comme produit de formation."
     }
    ]
   },
   {
    "id": "article-9-annulation-ou-report-du-fait-d",
    "title": "Article 9. Annulation ou report du fait de l'organisme",
    "blocks": [
     {
      "t": "p",
      "text": "L'organisme peut reporter ou annuler une session si le nombre d'inscrits est insuffisant, en prévenant le client au plus tard 7 jours avant le début, ou à tout moment en cas d'empêchement du formateur sans remplaçant qualifié ou de force majeure. Une nouvelle date est proposée ; si elle ne convient pas, les sommes versées sont remboursées intégralement. Aucune autre indemnité n'est due."
     }
    ]
   },
   {
    "id": "article-10-force-majeure",
    "title": "Article 10. Force majeure",
    "blocks": [
     {
      "t": "p",
      "text": "Aucune des parties n'est responsable d'un manquement dû à un événement de force majeure au sens de l'article 1218 du Code civil. Dans ce cas, aucune pénalité d'annulation n'est due ; seules les prestations déjà réalisées sont facturées. La partie empêchée prévient l'autre sans délai."
     }
    ]
   },
   {
    "id": "article-11-formation-intra-obligations-d",
    "title": "Article 11. Formation intra : obligations du client",
    "blocks": [
     {
      "t": "p",
      "text": "Le client met à disposition une salle adaptée à l'effectif et accessible, le matériel convenu en bon état, et communique les consignes de sécurité de son site. Il informe l'organisme de tout risque particulier. Si la session ne peut pas se tenir du fait de conditions non conformes, l'article 8 s'applique."
     }
    ]
   },
   {
    "id": "article-12-sous-traitance",
    "title": "Article 12. Sous-traitance",
    "blocks": [
     {
      "t": "p",
      "text": "L'organisme peut confier tout ou partie d'une formation à un formateur ou un organisme qu'il a sélectionné et dont il vérifie la qualification. Il reste seul responsable de la prestation vis-à-vis du client."
     }
    ]
   },
   {
    "id": "article-13-propriete-intellectuelle",
    "title": "Article 13. Propriété intellectuelle",
    "blocks": [
     {
      "t": "p",
      "text": "Les supports et contenus remis restent la propriété de l'organisme ou de leurs auteurs. Ils sont destinés à l'usage personnel des stagiaires et ne peuvent être reproduits, diffusés ou utilisés pour animer une formation sans accord écrit."
     }
    ]
   },
   {
    "id": "article-14-confidentialite-et-donnees-pe",
    "title": "Article 14. Confidentialité et données personnelles",
    "blocks": [
     {
      "t": "p",
      "text": "Chaque partie garde confidentielles les informations de l'autre dont elle a connaissance à l'occasion de la formation. Les données personnelles des stagiaires et des contacts sont traitées pour l'organisation, le suivi, l'évaluation et la facturation de la formation, ainsi que pour répondre aux obligations légales. Elles sont conservées 5 ans après la formation, 10 ans pour les pièces comptables. Toute personne peut exercer ses droits auprès de {{role.referent_rgpd.email}} et saisir la CNIL. Le client s'engage à informer ses salariés de ce traitement."
     }
    ]
   },
   {
    "id": "article-15-reference-commerciale",
    "title": "Article 15. Référence commerciale",
    "blocks": [
     {
      "t": "p",
      "text": "Sauf refus écrit du client, l'organisme peut citer son nom comme référence, sans divulguer aucune information sur la formation réalisée."
     }
    ]
   },
   {
    "id": "article-16-reclamations",
    "title": "Article 16. Réclamations",
    "blocks": [
     {
      "t": "p",
      "text": "Toute réclamation est adressée à {{role.referent_reclamations.email}} ou par courrier. Un accusé de réception est envoyé sous 48 heures et une réponse sous 10 jours ouvrés."
     }
    ]
   },
   {
    "id": "article-17-particuliers-mediation-de-la-",
    "title": "Article 17. Médiation de la consommation",
    "blocks": [
     {
      "t": "p",
      "text": "En cas de litige non résolu par une réclamation écrite préalable, le client consommateur peut recourir gratuitement au médiateur de la consommation dont relève l'organisme (articles L612-1 et L616-1 du Code de la consommation) : [nom du médiateur], [adresse postale], [site internet]. Les coordonnées du médiateur figurent aussi sur le site de l'organisme."
     }
    ],
    "cond": "particuliers"
   },
   {
    "id": "article-18-droit-applicable-et-litiges",
    "title": "Article 18. Droit applicable et litiges",
    "blocks": [
     {
      "t": "p",
      "text": "Les présentes conditions sont soumises au droit français. À défaut d'accord amiable, tout litige avec un client professionnel relève de la compétence exclusive du {{org.tribunal}}. Pour un client consommateur, les règles légales de compétence s'appliquent."
     },
     {
      "t": "p",
      "text": "Version du [date]."
     }
    ]
   }
  ]
 },
 "politique": {
  "id": "politique",
  "num": "D07",
  "code": "QUAL-POL",
  "name": "Politique qualité",
  "family": "gouvernance",
  "indicators": [],
  "pilote": "",
  "scope": "Une page, signée, affichée, publiée sur le site, revue en revue de direction",
  "sections": [
   {
    "id": "intro",
    "title": "",
    "blocks": [
     {
      "t": "p",
      "text": "**Politique qualité de {{org.nom}}**"
     },
     {
      "t": "p",
      "text": "{{org.nom}} a pour mission de développer les compétences des personnes et des entreprises qui lui font confiance, dans le respect des exigences légales, réglementaires et du référentiel national qualité. La direction s'engage à conduire cette mission selon les principes suivants."
     },
     {
      "t": "p",
      "text": "**1. Comprendre avant de proposer.** Chaque demande fait l'objet d'une analyse du besoin. L'organisme ne propose que des formations auxquelles il peut répondre avec sérieux et oriente vers d'autres solutions lorsque cela s'impose."
     },
     {
      "t": "p",
      "text": "**2. Former avec rigueur.** Les programmes poursuivent des objectifs évaluables, sont conformes aux référentiels techniques en vigueur et sont mis à jour à partir de la veille. Ils sont animés par des formateurs qualifiés, dont les compétences sont vérifiées et développées."
     },
     {
      "t": "p",
      "text": "**3. Garantir l'égalité d'accès.** L'organisme accueille toute personne sans discrimination, met en place les aménagements raisonnables pour les personnes en situation de handicap et veille à l'accessibilité de ses lieux, supports et outils."
     },
     {
      "t": "p",
      "text": "**4. Assurer un cadre sûr et respectueux.** Les violences, le harcèlement et les discriminations ne sont pas tolérés. Toute personne peut les signaler en confiance ; chaque signalement est traité."
     },
     {
      "t": "p",
      "text": "**5. Écouter et s'améliorer.** L'avis des stagiaires, des entreprises, des financeurs et des formateurs est recueilli et analysé. Les réclamations, les aléas et les écarts sont traités jusqu'à leur cause et donnent lieu à des actions dont l'efficacité est vérifiée."
     },
     {
      "t": "p",
      "text": "**6. Informer avec exactitude.** Les informations publiées, dont les résultats et leur méthode de calcul, sont exactes, vérifiables et tenues à jour."
     },
     {
      "t": "p",
      "text": "**Objectifs pour l'année [année]**"
     },
     {
      "t": "table",
      "head": [
       "Objectif",
       "Cible"
      ],
      "rows": [
       [
        "Satisfaction globale des stagiaires",
        "4,5 sur 5 au moins"
       ],
       [
        "Taux de retour des questionnaires à chaud",
        "95 % au moins"
       ],
       [
        "Assiduité",
        "95 % au moins"
       ],
       [
        "Réclamations traitées dans les délais",
        "100 %"
       ],
       [
        "Dossiers de session complets",
        "100 %"
       ],
       [
        "Actions d'amélioration réalisées dans les délais",
        "90 % au moins"
       ]
      ]
     },
     {
      "t": "p",
      "text": "Les objectifs sont mesurés chaque trimestre et revus chaque année en revue de direction."
     },
     {
      "t": "p",
      "text": "La direction met à disposition les moyens nécessaires à cette politique et désigne un responsable qualité, {{role.responsable_qualite}}, chargé d'en suivre l'application. Chaque membre de l'équipe et chaque intervenant extérieur est invité à y contribuer."
     },
     {
      "t": "p",
      "text": "Fait à {{org.lieu_signature}}, le [date]. {{org.dirigeant}}, {{org.dirigeant_qualite}}."
     }
    ]
   }
  ]
 },
 "charte-formateur": {
  "id": "charte-formateur",
  "num": "D08",
  "code": "QUAL-CHFO",
  "name": "Charte formateur",
  "family": "gouvernance",
  "indicators": [
   21,
   27
  ],
  "pilote": "",
  "scope": "Signée par chaque formateur, salarié ou sous-traitant, à l'arrivée puis à chaque nouvelle version",
  "sections": [
   {
    "id": "intro",
    "title": "",
    "blocks": [
     {
      "t": "p",
      "text": "En intervenant pour {{org.nom}}, je m'engage à :"
     },
     {
      "t": "p",
      "text": "**Compétence**"
     },
     {
      "t": "ol",
      "items": [
       "N'animer que les formations pour lesquelles je détiens une qualification valide, et prévenir l'organisme au moins 3 mois avant l'expiration de l'une d'elles.",
       "Entretenir mes compétences techniques et pédagogiques et partager ma veille.",
       "Utiliser la version à jour du programme et des supports, sans en modifier les objectifs."
      ]
     },
     {
      "t": "p",
      "text": "**Respect des stagiaires**"
     },
     {
      "t": "ol",
      "items": [
       "Traiter chaque personne avec respect et équité, sans aucune discrimination ni stéréotype, dans mes propos, mes exemples et mon évaluation.",
       "Mettre en place les aménagements décidés pour une personne et ne divulguer à personne la raison de cet aménagement.",
       "Intervenir immédiatement face à tout propos ou comportement violent, harcelant, sexiste ou discriminatoire, et le signaler le jour même au référent signalements.",
       "Ne jamais entretenir de relation qui pourrait porter atteinte à l'impartialité de l'évaluation ou à la liberté d'un stagiaire."
      ],
      "start": 4
     },
     {
      "t": "p",
      "text": "**Sécurité**"
     },
     {
      "t": "ol",
      "items": [
       "Faire respecter les règles de sécurité, interdire une séquence pratique à une personne qui présente un danger pour elle ou pour autrui, et signaler tout accident ou incident."
      ],
      "start": 8
     },
     {
      "t": "p",
      "text": "**Évaluation et documents**"
     },
     {
      "t": "ol",
      "items": [
       "Évaluer chaque stagiaire sur les critères prévus, de façon identique pour tous, sans complaisance, et justifier par écrit toute modification de résultat.",
       "Faire signer la présence à chaque demi-journée et transmettre les documents de session dans les 5 jours ouvrés.",
       "Faire remplir le questionnaire de satisfaction sans en lire les réponses en présence des stagiaires."
      ],
      "start": 9
     },
     {
      "t": "p",
      "text": "**Loyauté et confidentialité**"
     },
     {
      "t": "ol",
      "items": [
       "Garder confidentielles les informations sur les stagiaires et les clients, et respecter les règles de protection des données.",
       "Ne pas démarcher pour mon propre compte les clients rencontrés par l'intermédiaire de l'organisme pendant la durée de notre collaboration et 12 mois après, sauf accord écrit.",
       "Signaler tout conflit d'intérêts."
      ],
      "start": 12
     },
     {
      "t": "p",
      "text": "**Amélioration**"
     },
     {
      "t": "ol",
      "items": [
       "Signaler toute réclamation, difficulté ou aléa, et participer à l'analyse des écarts qui me concernent."
      ],
      "start": 15
     },
     {
      "t": "p",
      "text": "Tout manquement est examiné par le référent déontologie, {{role.referent_deontologie}}, et peut conduire à la fin de la collaboration."
     },
     {
      "t": "p",
      "text": "Nom, date, signature précédée de la mention « Lu et approuvé »."
     }
    ]
   }
  ]
 },
 "charte-egalite": {
  "id": "charte-egalite",
  "num": "D09",
  "code": "QUAL-CHEG",
  "name": "Charte égalité et inclusion",
  "family": "stagiaires",
  "indicators": [
   12,
   26
  ],
  "pilote": "",
  "scope": "Une page, affichée en salle, publiée sur le site et le portail",
  "sections": [
   {
    "id": "intro",
    "title": "",
    "blocks": [
     {
      "t": "p",
      "text": "**{{org.nom}} s'engage pour l'égalité et l'inclusion**"
     },
     {
      "t": "p",
      "text": "Nous accueillons chaque personne pour ce qu'elle vient apprendre, quels que soient son origine, son sexe, son âge, son handicap, son état de santé, sa religion, son orientation sexuelle, son identité de genre, sa situation de famille, son apparence, son lieu de résidence, son niveau d'études ou sa maîtrise du français."
     },
     {
      "t": "p",
      "text": "**Nos engagements**"
     },
     {
      "t": "ol",
      "items": [
       "**Accès** : nos formations sont ouvertes à toute personne qui en remplit les prérequis, et ces prérequis se limitent à ce qui est strictement nécessaire.",
       "**Aménagements** : nous adaptons rythme, supports, matériel et évaluation aux besoins de chacun, sans exiger de justification médicale, dans la confidentialité.",
       "**Équité** : les mêmes règles et les mêmes critères d'évaluation s'appliquent à tous.",
       "**Respect** : aucune moquerie, aucun propos sexiste, raciste, homophobe, transphobe, validiste ou discriminatoire n'est accepté, ni de la part des stagiaires, ni de la part de nos équipes.",
       "**Représentation** : nos supports et nos exemples montrent la diversité des personnes et des métiers, sans stéréotype.",
       "**Écoute** : toute personne qui s'estime victime ou témoin d'une discrimination peut le signaler, en confiance et sans crainte de représailles."
      ]
     },
     {
      "t": "p",
      "text": "**Vos contacts**"
     },
     {
      "t": "ul",
      "items": [
       "Aménagement, handicap : {{role.referent_handicap}}, {{role.referent_handicap.email}}",
       "Discrimination, harcèlement, violence : {{role.referent_signalements}}, {{role.referent_signalements.email}}",
       "Défenseur des droits : 3928, defenseurdesdroits.fr"
      ]
     },
     {
      "t": "p",
      "text": "{{org.dirigeant}}, {{org.dirigeant_qualite}}, le [date]."
     }
    ]
   }
  ]
 },
 "checklists": {
  "id": "checklists",
  "num": "D10",
  "code": "QUAL-CHK",
  "name": "Check-lists",
  "family": "checklists",
  "indicators": [],
  "pilote": "",
  "scope": "Reprennent mot pour mot les étapes de P05, P07, P13 · Cases à cocher dans l'outil, avec date et auteur",
  "sections": [
   {
    "id": "a-ouverture-du-dossier-avant-devis",
    "title": "A. Ouverture du dossier (avant devis)",
    "blocks": [
     {
      "t": "check",
      "items": [
       "Demande enregistrée, accusé de réception sous 2 jours ouvrés",
       "Fiche d'analyse du besoin remplie et datée",
       "Besoins d'adaptation demandés au client",
       "Prérequis et validité des formations antérieures vérifiés (recyclages)",
       "Formateur qualifié disponible, matériel et lieu possibles",
       "Proposition ou devis envoyé sous 5 jours ouvrés, programme joint"
      ]
     }
    ]
   },
   {
    "id": "b-preparation-de-la-session",
    "title": "B. Préparation de la session",
    "blocks": [
     {
      "t": "check",
      "items": [
       "Convention ou contrat signé avant le début",
       "Accord du financeur reçu, le cas échéant",
       "Formateur affecté, qualification valide à la date de la session",
       "Lieu avec fiche à jour ; fiche intra remplie par le client",
       "Matériel réservé, en nombre suffisant, vérifié",
       "Convocations envoyées avec règlement intérieur et livret",
       "Positionnement réalisé ou prévu",
       "Aménagements décidés en place et confirmés à la personne",
       "Dossier formateur transmis ; brief fait si formateur nouveau ou sous-traitant"
      ]
     }
    ]
   },
   {
    "id": "c-pendant-la-session",
    "title": "C. Pendant la session",
    "blocks": [
     {
      "t": "check",
      "items": [
       "Accueil : objectifs, déroulé, règles, signalement, réclamation présentés",
       "Attentes recueillies",
       "Émargement de chaque demi-journée, stagiaires et formateur",
       "Absences signalées et stagiaire contacté le jour même",
       "Adaptations au groupe notées",
       "Évaluation des acquis réalisée par objectif",
       "Questionnaire à chaud rempli",
       "Aléas ou réclamations enregistrés"
      ]
     }
    ]
   },
   {
    "id": "d-cloture-sous-10-jours-ouvres",
    "title": "D. Clôture (sous 10 jours ouvrés)",
    "blocks": [
     {
      "t": "check",
      "items": [
       "Résultats saisis par objectif et par stagiaire",
       "Remédiation proposée pour tout objectif non atteint",
       "Bilan formateur rempli",
       "Attestations et certificats envoyés sous 5 jours ouvrés",
       "Questionnaire entreprise envoyé, retour déposé",
       "Facture émise avec émargements",
       "Avis négatifs lus et traités",
       "Questionnaire à froid programmé à 90 jours",
       "Dossier complet contrôlé par le responsable qualité",
       "Passeport de prévention renseigné (formations santé et sécurité au travail)"
      ]
     }
    ]
   },
   {
    "id": "e-referencement-d-un-sous-traitant",
    "title": "E. Référencement d'un sous-traitant",
    "blocks": [
     {
      "t": "check",
      "items": [
       "Critères de sélection vérifiés, entretien réalisé",
       "Kbis ou avis de situation INSEE",
       "Numéro de déclaration d'activité, s'il en faut un",
       "Assurance responsabilité civile professionnelle",
       "Attestation de vigilance URSSAF de moins de 6 mois",
       "CV et justificatifs de qualification avec dates de validité",
       "Certificat qualité, s'il en a un",
       "Contrat de sous-traitance signé",
       "Charte formateur signée",
       "Intégration faite, livret formateur remis et signé",
       "Dates de relance saisies (vigilance tous les 6 mois, qualifications)"
      ]
     }
    ]
   }
  ]
 },
 "trame-rdd": {
  "id": "trame-rdd",
  "num": "D11",
  "code": "QUAL-RDDT",
  "name": "Revue de direction",
  "family": "pilotage",
  "indicators": [
   31,
   32
  ],
  "pilote": "",
  "scope": "Une fois par an au moins, après chaque audit, et en cas d'événement majeur",
  "sections": [
   {
    "id": "intro",
    "title": "",
    "blocks": [
     {
      "t": "p",
      "text": "**Participants** : direction, responsable qualité, référents. Durée indicative : une demi-journée. Les données sont préparées par l'outil et jointes au compte rendu."
     }
    ]
   },
   {
    "id": "ordre-du-jour-et-donnees-d-entree",
    "title": "Ordre du jour et données d'entrée",
    "blocks": [
     {
      "t": "table",
      "head": [
       "N°",
       "Point",
       "Données examinées",
       "Source dans l'outil"
      ],
      "rows": [
       [
        "1",
        "Suivi de la revue précédente",
        "Décisions prises et leur réalisation",
        "Compte rendu précédent"
       ],
       [
        "2",
        "Activité",
        "Sessions, stagiaires, heures, chiffre d'affaires, part de sous-traitance, évolution",
        "Sessions, factures, bilan pédagogique et financier"
       ],
       [
        "3",
        "Résultats des formations",
        "Atteinte des objectifs, assiduité, ruptures, résultats publiés",
        "Certification, méthode de calcul"
       ],
       [
        "4",
        "Appréciations",
        "Satisfaction à chaud et à froid, entreprises, financeurs, formateurs, taux de retour",
        "Indicateurs"
       ],
       [
        "5",
        "Réclamations, aléas, signalements",
        "Nombre, nature, délais, suites (signalements anonymisés)",
        "Qualité"
       ],
       [
        "6",
        "Non-conformités et plan d'actions",
        "Écarts internes et d'audit, actions réalisées, efficacité",
        "Qualité, Certification"
       ],
       [
        "7",
        "Handicap et accessibilité",
        "Demandes, adaptations, fiches lieux, partenaires",
        "Qualité"
       ],
       [
        "8",
        "Compétences",
        "Matrice, observations, entretiens, plan de développement",
        "Formateurs"
       ],
       [
        "9",
        "Sous-traitants",
        "Dossiers, évaluations annuelles, écarts",
        "Sous-traitance"
       ],
       [
        "10",
        "Veille",
        "Informations, décisions, programmes modifiés",
        "Qualité"
       ],
       [
        "11",
        "Protection des données",
        "Demandes de droits, incidents, purge annuelle",
        "Paramètres"
       ],
       [
        "12",
        "Risques",
        "Cartographie mise à jour, risques nouveaux",
        "Qualité"
       ],
       [
        "13",
        "Certification et obligations",
        "Échéances d'audit, déclaration d'activité, bilan pédagogique et financier, règlement intérieur",
        "Certification"
       ],
       [
        "14",
        "Documents",
        "Procédures et documents à réviser, désignations, organigramme",
        "Qualité"
       ],
       [
        "15",
        "Politique et objectifs",
        "Atteinte des objectifs, objectifs de l'année suivante",
        "Politique qualité"
       ],
       [
        "16",
        "Moyens",
        "Besoins humains, matériels, financiers",
        "Direction"
       ]
      ]
     }
    ]
   },
   {
    "id": "compte-rendu",
    "title": "Compte rendu",
    "blocks": [
     {
      "t": "p",
      "text": "Pour chaque point : constat en deux ou trois phrases, décision, responsable, échéance. Les décisions alimentent directement le plan d'actions (D12). Le compte rendu est daté, signé par la direction, conservé 5 ans et diffusé à l'équipe."
     }
    ]
   }
  ]
 },
 "livret-formateur": {
  "id": "livret-formateur",
  "num": "D14",
  "code": "QUAL-LIVF",
  "name": "Livret formateur",
  "family": "soustraitance",
  "indicators": [
   17,
   18,
   21,
   27
  ],
  "pilote": "",
  "scope": "Remis à chaque formateur, salarié ou sous-traitant, à l'intégration ; accusé de réception signé",
  "sections": [
   {
    "id": "sommaire-et-contenu",
    "title": "Sommaire et contenu",
    "blocks": [
     {
      "t": "p",
      "text": "**1. L'organisme.** Présentation, domaines, politique qualité, certification, organigramme et contacts utiles (direction, référent pédagogique, référents handicap et signalements, gestion administrative), joignables pendant les sessions."
     },
     {
      "t": "p",
      "text": "**2. Vos engagements.** Rappel de la charte formateur (D08), à signer."
     },
     {
      "t": "p",
      "text": "**3. Avant la session.** Ce que vous recevez et quand : programme à jour, liste des stagiaires, positionnement, aménagements, informations sur le lieu et le site client, matériel. Ce que vous vérifiez : votre qualification, le matériel, l'accès. Le brief avec le référent pédagogique."
     },
     {
      "t": "p",
      "text": "**4. L'accueil, minute par minute.** Présentation, objectifs, déroulé, sécurité et évacuation, règles du groupe, comment signaler une difficulté, une réclamation, une violence ; recueil des attentes. Un texte d'une minute est fourni pour présenter le cadre de respect et le référent signalements."
     },
     {
      "t": "p",
      "text": "**5. Pendant la session.** Émargement par demi-journée dans l'outil (et version papier de repli), gestion des absences et retards, adaptation au groupe, signes de décrochage et comment réagir, gestion des tensions dans le groupe."
     },
     {
      "t": "p",
      "text": "**6. Évaluer.** Les critères, les grilles officielles, les aménagements autorisés, la saisie par objectif, l'annonce du résultat en privé, la remédiation, ce qui est interdit (modifier un résultat sans justification)."
     },
     {
      "t": "p",
      "text": "**7. Clôturer.** Questionnaire à chaud (sans lire les réponses), bilan formateur, documents à transmettre sous 5 jours ouvrés."
     },
     {
      "t": "p",
      "text": "**8. Situations particulières.** Que faire en cas d'accident, de malaise, de stagiaire sous l'emprise d'alcool ou de stupéfiants, de comportement violent ou discriminant, de révélation de violences, de stagiaire sans les prérequis, de matériel défectueux, de panne de l'outil. Pour chaque cas : première réaction, qui prévenir, ce qu'il faut noter."
     },
     {
      "t": "p",
      "text": "**9. Accueillir chacun.** Handicap visible ou non, difficultés de lecture, maîtrise partielle du français, contraintes personnelles : attitudes à adopter, mots à éviter, ressources."
     },
     {
      "t": "p",
      "text": "**10. Données personnelles.** Ce que vous pouvez voir, garder, transmettre ; ce qui est interdit (photos sans accord, documents nominatifs sur clé non chiffrée)."
     },
     {
      "t": "p",
      "text": "**11. Amélioration continue.** Signaler un aléa ou un écart, participer à l'analyse, transmettre votre veille, l'observation annuelle, l'entretien annuel."
     },
     {
      "t": "p",
      "text": "**12. Annexes.** Check-lists B, C et D (D10), numéros d'aide, mode d'emploi de l'outil (émargement, évaluation, bilan)."
     },
     {
      "t": "p",
      "text": "Accusé de réception : « J'ai reçu et pris connaissance du livret formateur, version [n°] du [date]. » Nom, date, signature."
     }
    ]
   }
  ]
 },
 "st-ref-eval": {
  "id": "st-ref-eval",
  "num": "D15",
  "code": "QUAL-STREF",
  "name": "Sous-traitance : fiche de référencement et évaluation annuelle",
  "family": "soustraitance",
  "indicators": [
   21,
   27
  ],
  "pilote": "",
  "scope": "",
  "sections": [
   {
    "id": "a-fiche-de-referencement",
    "title": "A. Fiche de référencement",
    "blocks": [
     {
      "t": "p",
      "text": "**Identité** : raison sociale ou nom, statut (indépendant, organisme, portage), SIRET, adresse, contact, numéro de déclaration d'activité, certificat qualité et date de fin."
     },
     {
      "t": "p",
      "text": "**Domaines** : formations que le sous-traitant est autorisé à animer pour l'organisme."
     },
     {
      "t": "p",
      "text": "**Pièces** (date de réception, date de fin de validité, prochaine relance) : Kbis ou avis INSEE, assurance responsabilité civile professionnelle, attestation de vigilance URSSAF, CV, chaque qualification, contrat signé, charte signée, accusé de réception du livret formateur."
     },
     {
      "t": "p",
      "text": "**Sélection** : critères vérifiés, entretien (date, qui), références contactées, décision et date."
     },
     {
      "t": "p",
      "text": "**Statut** : référencé, suspendu (pièce expirée), déréférencé (motif). Aucune mission n'est possible si le statut n'est pas « référencé »."
     }
    ]
   },
   {
    "id": "b-grille-d-evaluation-annuelle",
    "title": "B. Grille d'évaluation annuelle",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Critère",
       "Données",
       "Note de 1 à 4"
      ],
      "rows": [
       [
        "Qualité pédagogique",
        "Satisfaction des stagiaires, observation en séance",
        ""
       ],
       [
        "Résultats",
        "Taux d'atteinte des objectifs, cohérence avec les autres formateurs",
        ""
       ],
       [
        "Respect des procédures",
        "Accueil, émargement, évaluation, questionnaires",
        ""
       ],
       [
        "Documents",
        "Complétude et délai de transmission",
        ""
       ],
       [
        "Fiabilité",
        "Ponctualité, annulations, réactivité",
        ""
       ],
       [
        "Inclusion et respect",
        "Aménagements appliqués, absence de signalement fondé",
        ""
       ],
       [
        "Mise à jour",
        "Qualifications à jour, veille, formation suivie",
        ""
       ],
       [
        "Écarts",
        "Nombre et traitement des réclamations et non-conformités le concernant",
        ""
       ]
      ]
     },
     {
      "t": "p",
      "text": "**Lecture** : 1 insuffisant, 2 à améliorer, 3 conforme, 4 très bon."
     },
     {
      "t": "p",
      "text": "**Décision** : maintien (aucun 1, moyenne de 3 au moins), maintien avec plan de progrès daté (un 1 ou moyenne inférieure à 3), fin de collaboration (deux 1 ou plus, ou manquement grave à la charte). La grille est partagée avec le sous-traitant, qui peut faire part de ses observations. Date, évaluateur, signature."
     }
    ]
   }
  ]
 },
 "fiches-modeles": {
  "id": "fiches-modeles",
  "num": "D16",
  "code": "QUAL-FICH",
  "name": "Fiches modèles citées par les procédures",
  "family": "fiches",
  "indicators": [],
  "pilote": "",
  "scope": "",
  "sections": [
   {
    "id": "intro",
    "title": "",
    "blocks": [
     {
      "t": "table",
      "head": [
       "Fiche",
       "Code",
       "Procédure",
       "Champs"
      ],
      "rows": [
       [
        "Analyse du besoin",
        "QUAL-F-BES",
        "P05",
        "Client, contact, date, événement déclencheur, objectif visé, public (nombre, postes, expérience, niveau de français, formations antérieures et validité), besoins d'adaptation, contraintes (dates, lieu, matériel, budget, financement), risques du site, faisabilité, suite donnée"
       ],
       [
        "Fiche lieu",
        "QUAL-F-LIEU",
        "P10",
        "Adresse, contact, accès, transports, stationnement, plain-pied ou ascenseur, largeur des passages, sanitaires adaptés, éclairage, acoustique, boucle magnétique, consignes d'évacuation, capacité, matériel, photos, date de vérification, conclusion d'accessibilité"
       ],
       [
        "Adaptation (confidentielle)",
        "QUAL-F-ADAP",
        "P09",
        "Personne, session, date de la demande, besoins exprimés (pas de diagnostic), adaptations décidées, partenaires sollicités, accord de la personne, informations transmises au formateur, bilan"
       ],
       [
        "Signalement (confidentielle)",
        "QUAL-F-SIG",
        "P11",
        "Date de réception, canal, auteur du signalement (ou anonyme), faits avec les mots de la personne, personnes concernées, mesures de protection, examen (entretiens, dates), décision, informations données, suivi à 1 mois, clôture"
       ],
       [
        "Réclamation, difficulté, aléa",
        "QUAL-F-RECL",
        "P01",
        "Existant dans l'outil, à aligner sur P01"
       ],
       [
        "Non-conformité",
        "QUAL-F-NC",
        "P02",
        "Existant dans l'outil, à compléter : gravité, correction, cause, critère et date d'efficacité"
       ],
       [
        "Rupture de parcours",
        "QUAL-F-RUPT",
        "P15",
        "Stagiaire, session, date, initiative, motif, partie suivie, objectifs évalués, solution de reprise proposée, facturation"
       ],
       [
        "Registre de veille",
        "QUAL-F-VEIL",
        "P04",
        "Date, domaine, source, résumé, date d'effet, impact, décision, responsable, échéance, diffusion"
       ],
       [
        "Matrice des compétences",
        "QUAL-F-COMP",
        "P14",
        "Personne, statut, formations autorisées, qualification par formation, date de fin de validité, dernière observation, dernier entretien"
       ],
       [
        "Grille d'observation",
        "QUAL-F-OBS",
        "P14",
        "Formateur, session, observateur, date ; respect du programme, clarté, part de pratique, gestion du groupe, adaptation, évaluation, inclusion ; points forts, axes de progrès, retour fait le"
       ],
       [
        "Registre des traitements",
        "QUAL-F-RGPD",
        "P12",
        "Traitement, finalité, base légale, données, personnes, destinataires, durée, sécurité, prestataires, transferts hors Union européenne"
       ],
       [
        "Registre des violations",
        "QUAL-F-VIOL",
        "P12",
        "Date, description, données et personnes concernées, risque, mesures, notification CNIL (oui ou non, date), information des personnes"
       ],
       [
        "Avis de l'entreprise",
        "Existant",
        "P03",
        "Formulaire prérempli, remplissable à l'écran ou imprimé, signé"
       ]
      ]
     }
    ]
   }
  ]
 }
}

export default TEMPLATES
