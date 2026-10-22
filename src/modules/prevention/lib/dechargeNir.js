// Décharge « numéro de sécurité sociale non communiqué » (0436) : données du document à partir de la session, du
// stagiaire et, une fois signée, de sa signature. Même document dans le portail, à l'organisme et pour l'entreprise.

const dateFr = (d) => {
  if (!d) return ''
  const [y, m, j] = String(d).slice(0, 10).split('-')
  return y && m && j ? `${j}/${m}/${y}` : ''
}

export function donneesDecharge(session = {}, trainee = {}, sig = null) {
  const debut = dateFr(session.start_date)
  const fin = dateFr(session.end_date)
  return {
    stagiaire: [trainee.first_name, (trainee.last_name || '').toUpperCase()].filter(Boolean).join(' '),
    naissance: dateFr(trainee.birth_date),
    entreprise: session.clients?.name || '',
    poste: trainee.job_title || '',
    formation: session.courses?.title || '',
    dates: debut && fin && debut !== fin ? `du ${debut} au ${fin}` : debut,
    signature: sig?.signature_data || null,
    signedAt: sig?.signed_at || null,
    signatureId: sig?.id || null,
  }
}

export const nomFichierDecharge = (trainee = {}) =>
  `Decharge_NIR_${String(trainee.last_name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}_${String(trainee.first_name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}.pdf`

export const nomFichierAutorisation = (trainee = {}) => nomFichierDecharge(trainee).replace(/^Decharge_NIR_/, 'Autorisation_NIR_')
