// api/_lib/comptable.js
// Source unique de vérité pour le destinataire comptable.
// Lit les paramètres de l'organisme (organization_settings), plus aucune adresse en dur dans les endpoints d'envoi.
//
// Règle de sécurité : si comptable_email est vide, on NE DEVINE PAS et on
// N'ENVOIE PAS. Un défaut en dur ferait repartir les pièces chez l'ancien
// cabinet le jour d'un changement de comptable.

export async function getComptableConfig(supabase) {
  const { data, error } = await supabase
    .from('organization_settings')
    .select('comptable_name, comptable_email, comptable_cc, comptable_bcc')
    .limit(1)
    .maybeSingle()

  if (error) {
    return { error: `Lecture des paramètres de l'organisme impossible : ${error.message}` }
  }

  const to = (data?.comptable_email || '').trim().toLowerCase()
  if (!to) {
    return {
      error: "Aucun comptable configuré. Renseignez l'email dans Paramètres → Accès comptable avant d'envoyer.",
    }
  }

  // cc / bcc acceptent plusieurs adresses séparées par virgule ou point-virgule
  const parseList = (value) => {
    const list = (value || '')
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    return list.length ? list.join(', ') : null
  }

  return {
    to,
    name: (data?.comptable_name || '').trim() || null,
    cc: parseList(data?.comptable_cc),
    bcc: parseList(data?.comptable_bcc),
  }
}
