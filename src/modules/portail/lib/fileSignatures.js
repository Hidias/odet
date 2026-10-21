// Émargement sans réseau (0417) : une signature faite pendant une coupure est gardée sur le téléphone (stockage du
// navigateur) avec son heure, puis envoyée dès le retour du réseau (portal_sign_halfday_differe). Le serveur refait
// tous les contrôles et note l'heure de réception. Rien n'est gardé au-delà de 48 heures (le serveur refuserait).

const CLE = 'odet_signatures_en_attente'
const DUREE_MAX_MS = 48 * 3600 * 1000

function lireBrut() {
  try { return JSON.parse(localStorage.getItem(CLE) || '[]') || [] } catch { return [] }
}
function ecrire(liste) {
  try { localStorage.setItem(CLE, JSON.stringify(liste)); return true } catch { return false }
}

// Coupure de réseau (et non refus du serveur) : la signature peut être gardée pour plus tard
export function estPanneReseau(erreur) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const m = String(erreur?.message || erreur || '')
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed|err_internet|timeout/i.test(m)
}

export function enAttente(token) {
  const maintenant = Date.now()
  return lireBrut().filter((x) => (!token || x.token === token) && maintenant - Date.parse(x.signedAt) < DUREE_MAX_MS)
}

// Garde une signature ; renvoie false si le navigateur refuse de la garder (navigation privée, stockage plein)
export function garder({ token, traineeId, period, image, date }) {
  const liste = lireBrut().filter((x) => !(x.token === token && x.traineeId === traineeId && x.date === date && x.period === period))
  liste.push({ id: `${traineeId}_${date}_${period}`, token, traineeId, period, image, date, signedAt: new Date().toISOString() })
  return ecrire(liste)
}

function retirer(id) {
  ecrire(lireBrut().filter((x) => x.id !== id))
}

// Envoie ce qui attend ; une coupure arrête l'envoi (nouvel essai plus tard), un refus du serveur retire la signature
export async function envoyerEnAttente(supabase, token) {
  const resultat = { envoyees: 0, refus: [] }
  const maintenant = Date.now()
  for (const x of lireBrut()) {
    if (maintenant - Date.parse(x.signedAt) >= DUREE_MAX_MS) { retirer(x.id); resultat.refus.push({ ...x, error: 'Signature trop ancienne pour être envoyée' }); continue }
    if (token && x.token !== token) continue
    let reponse
    try {
      reponse = await supabase.rpc('portal_sign_halfday_differe', {
        p_token: x.token, p_trainee_id: x.traineeId, p_period: x.period, p_signature: x.image, p_signed_at: x.signedAt,
      })
    } catch (e) {
      if (estPanneReseau(e)) break
      reponse = { error: e }
    }
    if (reponse.error) {
      if (estPanneReseau(reponse.error)) break
      // Fonction absente (base pas encore à jour) : on garde, rien n'est perdu
      if (/portal_sign_halfday_differe|function .* does not exist|PGRST202/i.test(reponse.error.message || '')) break
      retirer(x.id); resultat.refus.push({ ...x, error: reponse.error.message }); continue
    }
    retirer(x.id)
    if (reponse.data?.ok) resultat.envoyees += 1
    else if (!/déjà signée/i.test(reponse.data?.error || '')) resultat.refus.push({ ...x, error: reponse.data?.error || 'Signature refusée' })
  }
  return resultat
}
