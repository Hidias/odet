/**
 * Configuration des indicateurs SST selon le référentiel INRS
 * Mapping : Compétences → Indicateurs → Cases PDF
 */

export const SST_COMPETENCES_CONFIG = {
  FI: {
    C1: {
      code: 'C1',
      titre: "Délimiter son champ d'intervention en matière de secours",
      epreuve: 2,
      indicateurs: [
        {
          id: 'c1_ind1',
          texte: "Explique les limites de son intervention",
          pdfAcquis: 'Check Box25',
          pdfNonAcquis: 'Check Box26'
        }
      ]
    },
    C2: {
      code: 'C2',
      titre: "Identifier les dangers persistants et repérer les personnes qui pourraient y être exposées + Supprimer ou isoler le danger persistant",
      epreuve: 1,
      indicateurs: [
        {
          id: 'c2_ind1',
          texte: "Repère le(s) danger(s) persistant(s) dans la situation d'accident simulée",
          pdfAcquis: 'Check Box1',
          pdfNonAcquis: 'Check Box2',
          incontournable: true
        },
        {
          id: 'c2_ind2',
          texte: "Repère la(les) personne(s) qui est(sont) exposée(s) au(x) danger(s) persistant(s) identifié(s)",
          pdfAcquis: 'Check Box3',
          pdfNonAcquis: 'Check Box4'
        },
        {
          id: 'c2_ind3',
          texte: "Assure ou fait assurer la suppression",
          pdfAcquis: 'Check Box5',
          pdfNonAcquis: 'Check Box6'
        },
        {
          id: 'c2_ind4',
          texte: "Isole ou fait isoler le danger",
          pdfAcquis: 'Check Box7',
          pdfNonAcquis: 'Check Box8'
        },
        {
          id: 'c2_ind5',
          texte: "Soustrait ou fait soustraire la victime au danger",
          pdfAcquis: 'Check Box9',
          pdfNonAcquis: 'Check Box10'
        }
      ]
    },
    C3: {
      code: 'C3',
      titre: "Rechercher, suivant un ordre déterminé, la présence d'un (ou plusieurs) des signes indiquant que la vie de la victime est immédiatement menacée",
      epreuve: 1,
      indicateurs: [
        {
          id: 'c3_ind1',
          texte: "Recherche les signes indiquant que la vie de la victime est menacée",
          pdfAcquis: 'Check Box11',
          pdfNonAcquis: 'Check Box12',
          incontournable: true
        },
        {
          id: 'c3_ind2',
          texte: "Effectue l'examen dans l'ordre déterminé",
          pdfAcquis: 'Check Box13',
          pdfNonAcquis: 'Check Box14'
        }
      ]
    },
    C4: {
      code: 'C4',
      titre: "Garantir une alerte favorisant l'arrivée de secours adaptés au plus près de la victime",
      epreuve: 1,
      indicateurs: [
        {
          id: 'c4_ind1',
          texte: "Transmet le message d'alerte permettant le déclenchement des secours adaptés",
          pdfAcquis: 'Check Box15',
          pdfNonAcquis: 'Check Box16',
          incontournable: true
        },
        {
          id: 'c4_ind2',
          texte: "Favorise l'arrivée des secours au plus près de la victime",
          pdfAcquis: 'Check Box17',
          pdfNonAcquis: 'Check Box18'
        }
      ]
    },
    C5: {
      code: 'C5',
      titre: "Choisir à l'issue de l'examen l'action ou les actions à effectuer + Réaliser l'action + Surveiller",
      epreuve: 1,
      indicateurs: [
        {
          id: 'c5_ind1',
          texte: "Choisit l'action appropriée au résultat à atteindre",
          pdfAcquis: 'Check Box19',
          pdfNonAcquis: 'Check Box20',
          incontournable: true
        },
        {
          id: 'c5_ind2',
          texte: "Utilise la (ou les) technique(s) préconisée(s)",
          pdfAcquis: 'Check Box21',
          pdfNonAcquis: 'Check Box22',
          incontournable: true
        },
        {
          id: 'c5_ind3',
          texte: "Surveille la victime et agit en conséquence jusqu'à la prise en charge de celle-ci par les secours",
          pdfAcquis: 'Check Box23',
          pdfNonAcquis: 'Check Box24'
        }
      ]
    },
    C6: {
      code: 'C6',
      titre: "Situer son rôle de SST dans l'organisation de la prévention de l'entreprise",
      epreuve: 2,
      indicateurs: [
        {
          id: 'c6_ind1',
          texte: "Indique comment il peut contribuer concrètement à la prévention dans son entreprise",
          pdfAcquis: 'Check Box27',
          pdfNonAcquis: 'Check Box28'
        }
      ]
    },
    C7: {
      code: 'C7',
      titre: "Caractériser des risques professionnels dans une situation de travail",
      epreuve: 2,
      indicateurs: [
        {
          id: 'c7_ind1',
          texte: "À partir d'une situation dangereuse, détermine des risques et les autres dommages potentiels",
          pdfAcquis: 'Check Box29',
          pdfNonAcquis: 'Check Box30'
        }
      ]
    },
    C8: {
      code: 'C8',
      titre: "Participer à la maîtrise des risques professionnels par des actions de prévention",
      epreuve: 2,
      indicateurs: [
        {
          id: 'c8_ind1',
          texte: "Supprime ou à défaut réduit les risques",
          pdfAcquis: 'Check Box31',
          pdfNonAcquis: 'Check Box32',
          incontournable: true
        },
        {
          id: 'c8_ind2',
          texte: "Propose, si possible, des pistes d'amélioration",
          pdfAcquis: 'Check Box33',
          pdfNonAcquis: 'Check Box34'
        }
      ]
    }
  },
  
  MAC: {
    // MAC n'a pas C1
    C2: {
      code: 'C2',
      titre: "Supprimer ou isoler le danger persistant, ou soustraire la victime au danger persistant sans s'exposer soi-même",
      epreuve: 1,
      indicateurs: [
        {
          id: 'c2_ind1',
          texte: "Assure ou fait assurer la suppression",
          pdfAcquis: 'Check Box1',
          pdfNonAcquis: 'Check Box2'
        },
        {
          id: 'c2_ind2',
          texte: "Isole ou fait isoler le danger",
          pdfAcquis: 'Check Box3',
          pdfNonAcquis: 'Check Box4'
        },
        {
          id: 'c2_ind3',
          texte: "Soustrait ou fait soustraire la victime au danger",
          pdfAcquis: 'Check Box5',
          pdfNonAcquis: 'Check Box6'
        }
      ]
    },
    C3: {
      code: 'C3',
      titre: "Rechercher, suivant un ordre déterminé, la présence d'un (ou plusieurs) des signes indiquant que la vie de la victime est immédiatement menacée",
      epreuve: 1,
      indicateurs: [
        {
          id: 'c3_ind1',
          texte: "Recherche les signes indiquant que la vie de la victime est menacée",
          pdfAcquis: 'Check Box7',
          pdfNonAcquis: 'Check Box8'
        }
      ]
    },
    C4: {
      code: 'C4',
      titre: "Garantir une alerte favorisant l'arrivée de secours adaptés au plus près de la victime",
      epreuve: 1,
      indicateurs: [
        {
          id: 'c4_ind1',
          texte: "Transmet le message d'alerte permettant le déclenchement des secours adaptés",
          pdfAcquis: 'Check Box9',
          pdfNonAcquis: 'Check Box10',
          incontournable: true
        },
        {
          id: 'c4_ind2',
          texte: "Favorise l'arrivée des secours au plus près de la victime",
          pdfAcquis: 'Check Box11',
          pdfNonAcquis: 'Check Box12'
        }
      ]
    },
    C5: {
      code: 'C5',
      titre: "Choisir à l'issue de l'examen l'action ou les actions à effectuer + Surveiller",
      epreuve: 1,
      indicateurs: [
        {
          id: 'c5_ind1',
          texte: "Choisit l'action appropriée au résultat à atteindre",
          pdfAcquis: 'Check Box13',
          pdfNonAcquis: 'Check Box14'
        },
        {
          id: 'c5_ind2',
          texte: "Surveille la victime et agit en conséquence jusqu'à la prise en charge de celle-ci par les secours",
          pdfAcquis: 'Check Box15',
          pdfNonAcquis: 'Check Box16'
        }
      ]
    },
    C6: {
      code: 'C6',
      titre: "Situer son rôle de SST dans l'organisation de la prévention de l'entreprise",
      epreuve: 2,
      indicateurs: [
        {
          id: 'c6_ind1',
          texte: "Indique comment il peut contribuer concrètement à la prévention dans son entreprise",
          pdfAcquis: 'Check Box17',
          pdfNonAcquis: 'Check Box18'
        }
      ]
    },
    C7: {
      code: 'C7',
      titre: "Caractériser des risques professionnels dans une situation de travail",
      epreuve: 2,
      indicateurs: [
        {
          id: 'c7_ind1',
          texte: "À partir de la situation d'accident de travail précédemment simulée, explicite le mécanisme d'apparition du dommage rencontré",
          pdfAcquis: 'Check Box19',
          pdfNonAcquis: 'Check Box20'
        }
      ]
    },
    C8: {
      code: 'C8',
      titre: "Participer à la maîtrise des risques professionnels par des actions de prévention",
      epreuve: 2,
      indicateurs: [
        {
          id: 'c8_ind1',
          texte: "À partir de la situation d'accident précédemment simulée, propose des actions visant à supprimer ou à défaut réduire les risques",
          pdfAcquis: 'Check Box21',
          pdfNonAcquis: 'Check Box22'
        }
      ]
    }
  }
}

/**
 * Récupère la configuration pour un type de formation
 */
export function getCompetencesConfig(formationType) {
  return SST_COMPETENCES_CONFIG[formationType] || SST_COMPETENCES_CONFIG.FI
}

/**
 * Récupère tous les IDs d'indicateurs pour une formation
 */
export function getAllIndicatorIds(formationType) {
  const config = getCompetencesConfig(formationType)
  const ids = []
  
  Object.values(config).forEach(comp => {
    comp.indicateurs.forEach(ind => {
      ids.push(ind.id)
    })
  })
  
  return ids
}

/**
 * Calcule si une compétence est acquise selon les règles INRS
 */
export function isCompetenceAcquise(competenceCode, indicateurs, formationType) {
  const config = getCompetencesConfig(formationType)
  const comp = config[competenceCode]
  
  if (!comp) return false
  
  // Compter les indicateurs incontournables acquis
  const incontournablesAcquis = comp.indicateurs
    .filter(ind => ind.incontournable)
    .filter(ind => indicateurs[ind.id] === true)
    .length
    
  const incontournablesTotal = comp.indicateurs.filter(ind => ind.incontournable).length
  
  // Tous les incontournables doivent être acquis
  if (incontournablesTotal > 0 && incontournablesAcquis < incontournablesTotal) {
    return false
  }
  
  // Pour C2, C4, C5, C8 : au moins un indicateur parmi les autres
  // Pour les autres : l'indicateur unique doit être acquis
  const autresIndicateurs = comp.indicateurs.filter(ind => !ind.incontournable)
  
  if (autresIndicateurs.length > 0) {
    const autresAcquis = autresIndicateurs.filter(ind => indicateurs[ind.id] === true).length
    return autresAcquis >= 1
  }
  
  // Si pas d'autres indicateurs, les incontournables suffisent
  return incontournablesAcquis === incontournablesTotal
}

/**
 * Calcule si le candidat est certifié
 */
export function isCandidatCertifie(indicateurs, formationType) {
  const config = getCompetencesConfig(formationType)
  const competencesRequises = Object.keys(config)
  
  const competencesAcquises = competencesRequises.filter(code => 
    isCompetenceAcquise(code, indicateurs, formationType)
  )
  
  return competencesAcquises.length === competencesRequises.length
}
