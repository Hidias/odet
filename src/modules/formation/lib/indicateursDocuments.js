// Indicateur Qualiopi affiché sur chaque document vierge (Documents, Documents vierges, fiche session).
// Numéros du référentiel du décret n° 2026-728 (en vigueur le 01/11/2026), lus sur Légifrance :
//   9  : information des publics sur les conditions de déroulement (règlement intérieur, livret d'accueil) ;
//   11 : évaluation de l'atteinte des objectifs (grilles de compétences, certificats) ;
//   12 : engagement des bénéficiaires et prévention des ruptures de parcours (émargement) ;
//   30 : appréciations des parties prenantes (évaluations).
// Rattachements de l'émargement (12) et du livret d'accueil (9) décidés par H le 07/11.
// Un seul indicateur par document (décision de H du 07/11 au soir, guide de lecture V10 de novembre 2026) :
//   4 : fiche de renseignements (« tout support synthétisant les besoins identifiés du bénéficiaire », p. 11) ;
//   5 : convention (« supports de contractualisation », p. 12) ;
//   6 : programme (« parcours, déroulés et séquences », « déroulé de la prestation, avec la durée et le calendrier », p. 13).
export const Q = {
  reglement: '9',
  livret: '9',
  analyseBesoin: '4',
  emargement: '12',
  ficheRenseignements: '4',
  convention: '5',
  programme: '6',
  evaluation: '30',
  evaluationFroid: '30',
  evaluationFormateur: '30',
  positionnement: '8',
  grilles: '11',
}

export const DOCS_ADMINISTRATIFS = [
  { id: 'reglement', label: 'Règlement intérieur', qualiopi: Q.reglement },
  { id: 'livret', label: 'Livret d\'accueil', qualiopi: Q.livret },
  { id: 'analyseBesoin', label: 'Analyse du besoin', qualiopi: Q.analyseBesoin },
]

export const DOCS_FORMATION = [
  { id: 'emargement', label: 'Feuille d\'émargement (10 lignes)', qualiopi: Q.emargement },
  { id: 'ficheRenseignements', label: 'Fiche de renseignements stagiaire', qualiopi: Q.ficheRenseignements },
  { id: 'evaluation', label: 'Évaluation à chaud', qualiopi: Q.evaluation },
  { id: 'evaluationFroid', label: 'Évaluation à froid', qualiopi: Q.evaluationFroid },
  { id: 'evaluationFormateur', label: 'Évaluation formateur', qualiopi: Q.evaluationFormateur },
]
