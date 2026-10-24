// Notes de frais du formateur (0454) : déclarées depuis l'espace formateur, décidées par qui gère les coûts des sessions.
import { supabase } from '../../../core/supabase'

export const NATURES = {
  kilometres: 'Kilomètres',
  transport: 'Train, avion, bus',
  repas: 'Repas',
  hebergement: 'Hébergement',
  parking_peage: 'Parking, péage',
  materiel: 'Matériel',
  autre: 'Autre',
}

export const ETATS_FRAIS = {
  soumise: ['bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]', 'À valider'],
  validee: ['bg-[rgb(var(--c-info-bg))] text-[rgb(var(--c-info))]', 'Validée, à rembourser'],
  remboursee: ['bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]', 'Remboursée'],
  refusee: ['bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))]', 'Refusée'],
  annulee: ['bg-gray-100 text-gray-500', 'Annulée'],
}

/** « 12,50 » ou « 12.5 » → 12.5 ; null si illisible */
export function montant(texte) {
  const t = String(texte ?? '').replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  return Number(t)
}

export const euros = (n) => `${Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Motif qui empêche l'envoi de la note, ou null (la base refait les mêmes contrôles) */
export function motifFrais(f, aujourdhui = new Date().toISOString().slice(0, 10)) {
  if (!f.spent_on) return 'Indiquez la date de la dépense'
  if (f.spent_on > aujourdhui) return 'La date ne peut pas être dans le futur'
  const ilYaUnAn = new Date(`${aujourdhui}T12:00:00`); ilYaUnAn.setDate(ilYaUnAn.getDate() - 365)
  if (f.spent_on < ilYaUnAn.toISOString().slice(0, 10)) return 'Dépense de plus d\'un an : voyez directement avec l\'organisme'
  if (!NATURES[f.category]) return 'Choisissez la nature de la dépense'
  const m = montant(f.amount)
  if (m === null || m <= 0 || m > 10000) return 'Montant TTC entre 0,01 et 10 000 €'
  if (f.category === 'kilometres') {
    const km = montant(f.km)
    if (km === null || km <= 0 || km > 5000) return 'Indiquez les kilomètres parcourus'
  } else if (!f.file) return 'Ajoutez la photo du ticket ou de la facture'
  if (f.file && f.file.size > 8 * 1024 * 1024) return 'Fichier trop lourd (8 Mo au plus)'
  if (f.category === 'autre' && String(f.description || '').trim().length < 3) return 'Précisez la dépense'
  return null
}

/** Totaux par état (hors annulées et refusées pour le « à rembourser ») */
export function totauxFrais(liste = []) {
  const t = { aValider: 0, aRembourser: 0, rembourse: 0 }
  for (const e of liste) {
    if (e.status === 'soumise') t.aValider += Number(e.amount_ttc || 0)
    else if (e.status === 'validee') t.aRembourser += Number(e.amount_ttc || 0)
    else if (e.status === 'remboursee') t.rembourse += Number(e.amount_ttc || 0)
  }
  return t
}

const extension = (file) => {
  const n = String(file?.name || '').toLowerCase().match(/\.([a-z0-9]{2,5})$/)
  if (n) return n[1]
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' })[file?.type] || 'bin'
}

/** Envoie le justificatif puis déclare la note ; companyId et trainerId viennent de ext_frais */
export async function declarerFrais({ companyId, trainerId, form }) {
  let chemin = null
  if (form.file) {
    chemin = `${companyId}/${trainerId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension(form.file)}`
    const { error } = await supabase.storage.from('frais').upload(chemin, form.file, { contentType: form.file.type || 'application/octet-stream' })
    if (error) throw new Error('Envoi du justificatif impossible : réessayez')
  }
  const { data, error } = await supabase.rpc('ext_frais_ajouter', {
    p_spent_on: form.spent_on, p_category: form.category, p_amount: montant(form.amount),
    p_km: form.category === 'kilometres' ? montant(form.km) : null, p_session_id: form.session_id || null,
    p_description: form.description?.trim() || null, p_receipt_path: chemin,
  })
  if (error) throw new Error(error.message || 'Enregistrement impossible')
  return data
}

export async function lienJustificatif(chemin) {
  const { data, error } = await supabase.storage.from('frais').createSignedUrl(chemin, 300)
  if (error || !data?.signedUrl) throw new Error('Justificatif introuvable ou accès refusé')
  return data.signedUrl
}

/** Ouvre le justificatif dans un nouvel onglet (fenêtre ouverte tout de suite pour ne pas être bloquée) */
export async function ouvrirJustificatif(chemin) {
  const w = window.open('', '_blank')
  try { const url = await lienJustificatif(chemin); if (w) w.location.href = url; else window.location.href = url } catch (e) { if (w) w.close(); throw e }
}
