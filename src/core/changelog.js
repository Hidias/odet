// Notes de version, affichées dans la console (super administrateur).
// Une entrée par version publiée ; la plus récente en premier. Pas de jargon, pas de ticket.

export const CHANGELOG = [
  {
    version: '0.3.0',
    date: '2026-10-11',
    title: 'Quiz gamifiés et espace stagiaire',
    notes: [
      'Portail stagiaire aux couleurs de l\'organisme avec un espace par stagiaire : émargement, positionnement, entraînement, évaluation des acquis, satisfaction, documents.',
      'Moteur de quiz plein écran : QCM, vrai ou faux, remise dans l\'ordre, questions ouvertes, auto-évaluation. Correction et explication immédiates, XP et séries.',
      'Évaluation des acquis notée côté serveur, une seule tentative ; entraînement illimité. Les niveaux de difficulté ne sont jamais montrés aux stagiaires.',
      'Banque de questions enrichie : explications et questions de niveau moyen et difficile pour les sept thèmes.',
      'Page Tests et quiz : édition complète de la banque et aperçus.',
      'Assistant de configuration et console super administrateur.',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-10',
    title: 'Marque blanche',
    notes: [
      'Toute l\'identité de l\'organisme vient des paramètres : nom, adresse, SIRET, NDA, signataire, logo, couleurs, polices, textes réglementaires.',
      'Documents PDF (conventions, émargements, attestations, devis, factures) générés avec cette identité et bloqués tant qu\'un champ obligatoire manque.',
      'Rôles : super administrateur, administrateur, direction, gestionnaire, formateur, commercial, comptable, lecture. Les évaluations ne sont modifiables que par le super administrateur.',
      'Trois présentations au choix pour chaque utilisateur : Atelier, Terrain, Cockpit.',
      'Modules activables : formation, portail, prévention, qualité, commercial, prospection, campagnes, budget, comptable, DUERP, réseaux sociaux.',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-10-09',
    title: 'Socle',
    notes: [
      'Nouveau dépôt et nouvelle base, schéma versionné par migrations.',
      'Reprise du périmètre formation : catalogue, sessions, stagiaires, formateurs, documents, qualité, devis et factures, DUERP, budget.',
    ],
  },
]
