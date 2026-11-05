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
