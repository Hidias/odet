// Saisie interrompue par la déconnexion automatique (A1, 21/10) : au moment de la déconnexion, les champs remplis de
// la page (visite, devis, facture, fiche…) sont gardés sur l'appareil, avec la page et l'heure. À la reconnexion, un
// bandeau propose de revenir sur la page et de remettre les valeurs ; si le formulaire n'est pas ouvert, les valeurs
// restent affichées pour être recopiées. Rien n'est envoyé au serveur. Gardé 24 heures, cinq pages au plus.

const CLE = (userId) => `odet_saisies_interrompues_${userId || 'anonyme'}`
const DUREE_MS = 24 * 3600 * 1000
const EXCLUS = new Set(['password', 'file', 'hidden', 'submit', 'button', 'reset', 'image'])

function lireBrut(userId) {
  try { return JSON.parse(localStorage.getItem(CLE(userId)) || '[]') || [] } catch { return [] }
}
function ecrire(userId, liste) {
  try { localStorage.setItem(CLE(userId), JSON.stringify(liste)); return true } catch { return false }
}

// Libellé lisible d'un champ : étiquette, aria-label, texte indicatif ou nom
export function libelleChamp(el, doc = document) {
  const id = el.getAttribute('id')
  const lab = (id && doc.querySelector(`label[for="${CSS.escape ? CSS.escape(id) : id}"]`)) || el.closest('label')
  const t = (lab?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim()
  return t.slice(0, 80)
}

// Champs remplis d'une zone : identifiés par id, nom, sinon rang dans la zone
export function lireChamps(racine, doc = document) {
  const champs = []
  const els = [...racine.querySelectorAll('input, textarea, select')]
  els.forEach((el, rang) => {
    const type = (el.getAttribute('type') || el.tagName).toLowerCase()
    if (EXCLUS.has(type) || el.disabled || el.readOnly) return
    const cle = el.getAttribute('id') ? `id:${el.getAttribute('id')}` : el.getAttribute('name') ? `nom:${el.getAttribute('name')}` : `rang:${rang}`
    // Tous les champs remplis sont gardés (React recopie la valeur dans l'attribut : impossible de savoir lesquels ont
    // changé) ; remettre une valeur identique ne change rien
    if (type === 'checkbox' || type === 'radio') {
      champs.push({ cle, type, coche: el.checked, libelle: libelleChamp(el, doc) })
      return
    }
    const v = el.value
    if (v == null || String(v).trim() === '') return
    champs.push({ cle, type, valeur: String(v).slice(0, 20000), libelle: libelleChamp(el, doc) })
  })
  return champs
}

export function garderSaisie(userId, route, racine = document.body) {
  const champs = lireChamps(racine)
  // Rien de saisi (seulement des cases) : rien à garder
  if (!champs.some((c) => c.valeur && c.valeur.trim().length > 0)) return false
  const autres = lireBrut(userId).filter((s) => s.route !== route)
  return ecrire(userId, [{ route, a: new Date().toISOString(), champs }, ...autres].slice(0, 5))
}

export function saisiesGardees(userId) {
  const maintenant = Date.now()
  const liste = lireBrut(userId).filter((s) => maintenant - Date.parse(s.a) < DUREE_MS)
  return liste
}

export function oublierSaisie(userId, route) {
  ecrire(userId, lireBrut(userId).filter((s) => s.route !== route))
}

// Remet les valeurs dans les champs présents (valeur posée comme une frappe, pour les formulaires React).
// Renvoie le nombre de champs remis.
export function remettreSaisie(saisie, racine = document.body) {
  const els = [...racine.querySelectorAll('input, textarea, select')]
  let n = 0
  for (const c of saisie.champs || []) {
    const [mode, val] = [c.cle.slice(0, c.cle.indexOf(':')), c.cle.slice(c.cle.indexOf(':') + 1)]
    const el = mode === 'id' ? els.find((e) => e.getAttribute('id') === val)
      : mode === 'nom' ? els.find((e) => e.getAttribute('name') === val)
        : els[Number(val)]
    if (!el) continue
    if ('coche' in c) {
      if (el.checked !== c.coche) { el.click(); n += 1 }
      continue
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    if (setter) setter.call(el, c.valeur); else el.value = c.valeur
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    n += 1
  }
  return n
}
