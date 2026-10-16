// Modèles de séquences proposés dans le catalogue (suivi formatif).
// Ce ne sont que des valeurs de départ : l'organisme les copie dans sa formation puis les modifie librement.
// Rien ici n'est imposé à une formation, et aucun modèle n'est appliqué sans action de l'utilisateur.
//
// Le modèle SST suit le manuel du formateur SST de l'INRS (janvier 2024) : une évaluation formative à l'issue de
// chaque séquence ; après chaque accident simulé, l'apprenant propose une mesure de prévention (C8).
// Les épreuves certificatives ne sont pas des séquences du suivi formatif.
// Les modèles hors SST reprennent les grilles de compétences existantes (à relire avec l'organisme).

export const MODALITIES = [
  { key: 'oral', label: 'Interrogation orale', short: 'O' },
  { key: 'qcm', label: 'QCM', short: 'Q' },
  { key: 'etude_cas', label: 'Étude de cas', short: 'EC' },
  { key: 'mise_situation', label: 'Mise en situation', short: 'MS' },
  { key: 'demonstration', label: 'Démonstration', short: 'D' },
  { key: 'autre', label: 'Autre', short: 'A' },
]

export const modalityLabel = (k) => MODALITIES.find((m) => m.key === k)?.label || k
export const modalityShort = (k) => MODALITIES.find((m) => m.key === k)?.short || '?'

const SST_ROLES = ['Sauveteur', 'Victime', 'Témoin', 'Observateur']
const sstSecourir = (title, indicators) => ({
  title, competences: ['C5', 'C8'], modality: 'mise_situation', roles: SST_ROLES,
  success_indicators: [...indicators, 'Propose une mesure de prévention et dit à qui la remonter'],
})

export const SEQUENCE_TEMPLATES = [
  {
    key: 'sst_fi',
    label: 'SST formation initiale',
    sequences: [
      { title: 'Le SST, cadre juridique et limites d\'intervention', competences: ['C1'], modality: 'oral', roles: [], success_indicators: ['Explique les limites de son intervention (temps, moyens, espace)'] },
      { title: 'La prévention, ses enjeux et le rôle du SST', competences: ['C6'], modality: 'oral', roles: [], success_indicators: ['Indique comment il peut contribuer à la prévention dans son entreprise'] },
      { title: 'Repérer des dangers, déterminer des risques, agir en prévention', competences: ['C7', 'C8'], modality: 'etude_cas', roles: [], success_indicators: ['Identifie danger, personne exposée et situation dangereuse', 'Détermine un risque et un dommage potentiel', 'Hiérarchise les actions de prévention'] },
      { title: 'Protéger', competences: ['C2'], modality: 'mise_situation', roles: SST_ROLES, success_indicators: ['Repère le danger persistant et les personnes exposées', 'Supprime, isole ou soustrait sans s\'exposer'] },
      { title: 'Examiner la victime', competences: ['C3'], modality: 'mise_situation', roles: SST_ROLES, success_indicators: ['Recherche les signes de détresse vitale', 'Respecte l\'ordre de l\'examen'] },
      { title: 'Faire alerter ou alerter', competences: ['C4'], modality: 'mise_situation', roles: SST_ROLES, success_indicators: ['Message d\'alerte complet', 'Favorise l\'arrivée des secours au plus près de la victime'] },
      sstSecourir('Secourir : la victime saigne abondamment', ['Arrête le saignement avec la technique adaptée']),
      sstSecourir('Secourir : la victime s\'étouffe', ['Reconnaît l\'obstruction et désobstrue']),
      sstSecourir('Secourir : la victime ne répond pas et ne respire pas', ['Fait alerter et demande le défibrillateur', 'Compressions efficaces, sans interruption longue']),
      sstSecourir('Secourir : la victime ne répond pas mais respire', ['Met en position latérale de sécurité et surveille']),
      sstSecourir('Secourir : la victime se plaint de malaise', ['Met au repos, questionne, alerte si besoin']),
      sstSecourir('Secourir : la victime se plaint de brûlures', ['Arrose la brûlure selon la conduite à tenir']),
      sstSecourir('Secourir : douleur empêchant des mouvements, plaie qui ne saigne pas', ['Ne mobilise pas, protège la plaie, surveille']),
    ],
  },
  {
    key: 'sst_mac',
    label: 'SST maintien et actualisation des compétences',
    sequences: [
      { title: 'Retour d\'expérience et rôle du SST', competences: ['C6'], modality: 'oral', roles: [], success_indicators: ['Partage une action menée en prévention ou en secours'] },
      { title: 'Prévention : de la situation dangereuse aux actions', competences: ['C7', 'C8'], modality: 'etude_cas', roles: [], success_indicators: ['Détermine des risques et propose une action de prévention hiérarchisée'] },
      { title: 'Protéger, examiner, faire alerter', competences: ['C2', 'C3', 'C4'], modality: 'mise_situation', roles: SST_ROLES, success_indicators: ['Protection adaptée', 'Examen dans l\'ordre', 'Alerte complète'] },
      sstSecourir('Secourir : urgences vitales', ['Conduite à tenir conforme pour la détresse présentée']),
      sstSecourir('Secourir : autres situations', ['Conduite à tenir conforme pour la situation présentée']),
      { title: 'Actualisation des gestes et des conduites à tenir', competences: ['C5'], modality: 'demonstration', roles: [], success_indicators: ['Réalise les gestes actualisés'] },
    ],
  },
  {
    key: 'gestes_postures',
    label: 'Gestes et postures',
    sequences: [
      { title: 'Risques liés à l\'activité physique, TMS', competences: ['GP-T1', 'GP-T3', 'GP-T4'], modality: 'qcm', roles: [], success_indicators: ['Identifie les principaux risques et facteurs aggravants'] },
      { title: 'Notions d\'anatomie du dos', competences: ['GP-T2'], modality: 'oral', roles: [], success_indicators: ['Explique le rôle des vertèbres, disques et muscles'] },
      { title: 'Principes de sécurité et d\'économie d\'effort', competences: ['GP-P1', 'GP-P2', 'GP-P3', 'GP-P4', 'GP-P5', 'GP-P6'], modality: 'mise_situation', roles: ['Opérateur', 'Observateur'], success_indicators: ['Évalue la charge', 'Garde le dos droit et la charge près du corps', 'Pivote sans torsion du tronc'] },
      { title: 'Aides techniques', competences: ['GP-P7'], modality: 'demonstration', roles: ['Opérateur', 'Observateur'], success_indicators: ['Choisit et utilise l\'aide technique adaptée'] },
      { title: 'Analyse et amélioration de son poste de travail', competences: ['GP-A1', 'GP-A2', 'GP-A3', 'GP-A4'], modality: 'etude_cas', roles: [], success_indicators: ['Propose au moins une amélioration de son poste'] },
    ],
  },
  {
    key: 'incendie_epi',
    label: 'Incendie, équipier de première intervention',
    sequences: [
      { title: 'Le feu : causes, classes de feux, moyens d\'extinction', competences: ['INC-T1', 'INC-T2', 'INC-T3'], modality: 'qcm', roles: [], success_indicators: ['Associe chaque classe de feu à l\'agent extincteur adapté'] },
      { title: 'Consignes et organisation de l\'évacuation', competences: ['INC-T4', 'INC-T5'], modality: 'oral', roles: [], success_indicators: ['Connaît les consignes et le rôle de chacun'] },
      { title: 'Manipulation des extincteurs sur feu réel', competences: ['INC-P1', 'INC-P2', 'INC-P3', 'INC-P4', 'INC-P5'], modality: 'mise_situation', roles: ['Équipier', 'Observateur'], success_indicators: ['Choisit l\'extincteur adapté', 'Distance et posture d\'attaque correctes', 'Éteint le feu en sécurité'] },
      { title: 'Exercice d\'évacuation', competences: ['INC-E1', 'INC-E2', 'INC-E3', 'INC-E4', 'INC-E5'], modality: 'mise_situation', roles: ['Guide-file', 'Serre-file', 'Occupant'], success_indicators: ['Alerte donnée', 'Zone vérifiée', 'Comptage au point de rassemblement'] },
    ],
  },
  {
    key: 'r489',
    label: 'Conduite de chariots (formation interne R489)',
    sequences: [
      { title: 'Réglementation, risques et responsabilités', competences: ['R489-T1', 'R489-T2', 'R489-T5'], modality: 'qcm', roles: [], success_indicators: ['Connaît le rôle de l\'autorisation de conduite et les principaux risques'] },
      { title: 'Stabilité, plaque de charge, règles de circulation', competences: ['R489-T3', 'R489-T4'], modality: 'etude_cas', roles: [], success_indicators: ['Lit une plaque de charge', 'Applique les règles de circulation'] },
      { title: 'Vérifications de prise de poste', competences: ['R489-V1', 'R489-V2', 'R489-V3', 'R489-V4', 'R489-V5'], modality: 'demonstration', roles: ['Conducteur', 'Observateur'], success_indicators: ['Réalise toutes les vérifications', 'Signale une anomalie'] },
      { title: 'Circulation et prise de charge', competences: ['R489-C1', 'R489-C2', 'R489-C6'], modality: 'mise_situation', roles: ['Conducteur', 'Observateur'], success_indicators: ['Circule en sécurité', 'Prend et dépose la charge sans heurt'] },
      { title: 'Gerbage, stockage, chargement de véhicule', competences: ['R489-C3', 'R489-C4', 'R489-C5', 'R489-C7', 'R489-C8'], modality: 'mise_situation', roles: ['Conducteur', 'Observateur'], success_indicators: ['Gerbe et stocke en sécurité', 'Immobilise le chariot en fin de poste'] },
      { title: 'Situations particulières et conduite à tenir', competences: ['R489-S1', 'R489-S2', 'R489-S3'], modality: 'oral', roles: [], success_indicators: ['Adapte sa conduite et rend compte des anomalies'] },
    ],
  },
  {
    key: 'r485',
    label: 'Conduite de gerbeurs accompagnants (formation interne R485)',
    sequences: [
      { title: 'Réglementation, risques et stabilité', competences: ['R485-T1', 'R485-T2', 'R485-T3', 'R485-T4'], modality: 'qcm', roles: [], success_indicators: ['Connaît les risques propres au gerbeur accompagnant'] },
      { title: 'Vérifications et commandes', competences: ['R485-V1', 'R485-V2', 'R485-V3'], modality: 'demonstration', roles: ['Conducteur', 'Observateur'], success_indicators: ['Réalise les vérifications journalières'] },
      { title: 'Conduite, gerbage et stockage', competences: ['R485-C1', 'R485-C2', 'R485-C3', 'R485-C4', 'R485-C5', 'R485-C6', 'R485-C7'], modality: 'mise_situation', roles: ['Conducteur', 'Observateur'], success_indicators: ['Position au timon correcte', 'Gerbe et stocke en sécurité'] },
      { title: 'Sécurité et coactivité', competences: ['R485-S1', 'R485-S2', 'R485-S3'], modality: 'oral', roles: [], success_indicators: ['Protège ses pieds et respecte les piétons'] },
    ],
  },
  {
    key: 'habilitation_electrique',
    label: 'Habilitation électrique',
    sequences: [
      { title: 'Dangers de l\'électricité et effets sur le corps humain', competences: ['HE-1'], modality: 'qcm', roles: [], success_indicators: ['Cite les effets du courant et les facteurs de gravité'] },
      { title: 'Zones d\'environnement, symboles et limites de l\'habilitation', competences: ['HE-2'], modality: 'qcm', roles: [], success_indicators: ['Identifie les zones et les limites de son habilitation'] },
      { title: 'Équipements de protection et analyse du risque', competences: ['HE-3'], modality: 'etude_cas', roles: [], success_indicators: ['Choisit les protections adaptées à l\'opération'] },
      { title: 'Mise en situation sur les opérations visées', competences: ['HE-4'], modality: 'mise_situation', roles: ['Opérateur', 'Observateur'], success_indicators: ['Réalise l\'opération dans le respect des consignes'] },
      { title: 'Conduite à tenir en cas d\'accident ou d\'incendie d\'origine électrique', competences: ['HE-5'], modality: 'oral', roles: [], success_indicators: ['Décrit la conduite à tenir sans s\'exposer'] },
    ],
  },
]

export const templateByKey = (key) => SEQUENCE_TEMPLATES.find((t) => t.key === key) || null
