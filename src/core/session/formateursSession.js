// Formateurs d'une session (C6) : un formateur principal (sessions.trainer_id, repris par les documents et les e-mails)
// et d'autres formateurs. Tous figurent dans session_trainers, que la base lit pour les droits (espace formateur,
// émargement, BPF). Principal en premier, sans doublon ni vide.
export function formateursVoulus(principalId, autresIds = []) {
  const ids = [principalId, ...(autresIds || [])].filter(Boolean)
  return [...new Set(ids)]
}

// Autres formateurs d'une session à partir des lignes de session_trainers : tout sauf le principal, sans doublon
export function autresFormateursIds(lignes = [], principalId = null) {
  return [...new Set((lignes || []).map((l) => l.trainer_id).filter((id) => id && id !== principalId))]
}

// Liste reçue d'un formulaire (trainer_ids) : le premier est le principal
export function separerFormateurs(trainerIds = []) {
  const ids = formateursVoulus(null, trainerIds)
  return { principalId: ids[0] || null, autresIds: ids.slice(1) }
}

// Formateurs à envoyer à l'enregistrement d'une fiche session (C6). Rien si rien n'a changé : un formateur qui corrige
// l'horaire de sa session n'a pas le droit d'écrire dans session_trainers. Sous-traitance : formateur principal seul.
// Liste inconnue (lecture en échec, null) côté formulaire ou côté session : on refuse plutôt que de retirer quelqu'un.
// Renvoie { trainerIds } (undefined = ne rien envoyer) ou { erreur }.
export function formateursAEnvoyer({ principalId, autresIds, sousTraitance = false }, { principalInitial, autresInitiaux }) {
  const principalChange = (principalId || null) !== (principalInitial || null)
  const voulus = sousTraitance ? [] : (autresIds || [])
  const inconnu = autresInitiaux == null || (!sousTraitance && autresIds == null)
  if (inconnu) {
    if (principalChange || voulus.length) return { erreur: "Les formateurs de la session n'ont pas pu être lus : rechargez la page avant de les changer." }
    return { trainerIds: undefined }
  }
  const autresChange = voulus.length !== autresInitiaux.length || voulus.some((x) => !autresInitiaux.includes(x))
  if (!principalChange && !autresChange) return { trainerIds: undefined }
  return { trainerIds: principalId ? formateursVoulus(principalId, voulus) : [] }
}
