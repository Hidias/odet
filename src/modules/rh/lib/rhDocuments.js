// Module RH, documents et santé au travail (chantier 12, 0301). Droits contrôlés en base :
//   - documents dans le bucket PRIVÉ « rh », chemin <société>/<personne>/<fichier>, servis par liens signés courts ;
//   - ouverture par hr_document_ouvrir(), qui vérifie les droits et journalise la consultation d'un document
//     restreint ou privé par quelqu'un d'autre que la personne ;
//   - suivi de santé administratif seulement : aucune donnée médicale.

import { supabase } from '../../../core/supabase'

const must = ({ data, error }) => { if (error) throw error; return data }
const BUCKET = 'rh'

// Catégorie : libellé et confidentialité imposée (null = au choix, « normal » ou « restreint »)
export const CATEGORIES_DOC = {
  contrat: { label: 'Contrat de travail', conf: 'normal' },
  avenant: { label: 'Avenant', conf: 'normal' },
  fiche_poste: { label: 'Fiche de poste', conf: 'normal' },
  attestation: { label: 'Attestation', conf: 'normal' },
  titre: { label: 'Titre, diplôme, permis', conf: 'normal' },
  justificatif: { label: 'Justificatif d\'absence', conf: 'restreint' },
  sante: { label: 'Santé au travail (avis, convocation)', conf: 'restreint' },
  bulletin: { label: 'Bulletin de paie', conf: 'prive' },
  autre: { label: 'Autre document', conf: null },
}
export const CONFIDENTIALITES = {
  normal: { label: 'Dossier', badge: 'badge-neutral', aide: 'Visible de qui voit les dossiers du personnel' },
  restreint: { label: 'Restreint', badge: 'badge-warning', aide: 'Visible de la personne et de la RH seulement ; consultation notée au journal' },
  prive: { label: 'Privé', badge: 'badge-danger', aide: 'Visible de la personne et de la RH seulement ; consultation notée au journal' },
}

export const TYPES_HABILITATION = {
  habilitation_electrique: 'Habilitation électrique',
  autorisation_conduite: 'Autorisation de conduite',
  sst: 'Sauveteur secouriste du travail',
  incendie: 'Sécurité incendie',
  apsad: 'Certification APSAD',
  permis: 'Permis de conduire',
  autre: 'Autre titre',
}

export const TYPES_VISITE = {
  information_prevention: 'Visite d\'information et de prévention',
  embauche: 'Visite d\'embauche',
  periodique: 'Visite périodique',
  reprise: 'Visite de reprise',
  prereprise: 'Visite de préreprise',
  mi_carriere: 'Visite de mi-carrière',
  demande: 'Visite à la demande',
}
export const CONCLUSIONS = {
  apte: { label: 'Apte', badge: 'badge-success' },
  apte_amenagements: { label: 'Apte avec aménagements', badge: 'badge-warning' },
  inapte: { label: 'Inapte', badge: 'badge-danger' },
  sans_avis: { label: 'Sans avis', badge: 'badge-neutral' },
}

export const TYPES_FICHIER = 'application/pdf,image/jpeg,image/png,image/webp'
export const TAILLE_MAX = 15 * 1024 * 1024

/** Échéance : expirée, proche (moins de 60 jours) ou lointaine */
export function etatEcheance(iso, aujourdhui = new Date().toISOString().slice(0, 10)) {
  if (!iso) return null
  const jours = Math.round((new Date(`${iso}T12:00:00`) - new Date(`${aujourdhui}T12:00:00`)) / 86400000)
  if (jours < 0) return { badge: 'badge-danger', label: 'Dépassée', jours }
  if (jours <= 60) return { badge: 'badge-warning', label: jours === 0 ? 'Aujourd\'hui' : `Dans ${jours} j`, jours }
  return { badge: 'badge-success', label: 'À jour', jours }
}

/** Nom de fichier sans accent ni caractère spécial (chemin de stockage) */
export function nomFichierSur(nom) {
  const base = String(nom || 'document').normalize('NFD').replace(/[̀-ͯ]/g, '')
  return base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-80) || 'document'
}

// ─── Documents ───
export const chargerDocuments = async (personId) => must(await supabase.from('hr_documents')
  .select('id, person_id, company_id, category, confidentiality, title, doc_date, file_name, mime_type, size_bytes, created_at')
  .eq('person_id', personId).order('doc_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }))

/** Dépose le fichier puis enregistre le document ; en cas de refus de la base, le fichier est retiré */
export async function deposerDocument({ companyId, personId, file, category, confidentiality, title, docDate = null, employmentId = null }) {
  if (!file) throw new Error('Choisissez un fichier')
  if (file.size > TAILLE_MAX) throw new Error('Fichier trop lourd (15 Mo au plus)')
  const id = crypto.randomUUID()
  const path = `${companyId}/${personId}/${id}-${nomFichierSur(file.name)}`
  must(await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined }))
  const { data, error } = await supabase.from('hr_documents').insert({
    id, company_id: companyId, person_id: personId, employment_id: employmentId, category, confidentiality,
    title: title?.trim() || CATEGORIES_DOC[category]?.label || file.name, doc_date: docDate || null,
    file_path: path, file_name: file.name, mime_type: file.type || null, size_bytes: file.size,
  }).select('id').single()
  if (error) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw error
  }
  return data
}

/** Ouvre un document dans un nouvel onglet (lien signé de 2 minutes, consultation journalisée par la base) */
export async function ouvrirDocument(id) {
  const fenetre = window.open('', '_blank')
  try {
    const path = must(await supabase.rpc('hr_document_ouvrir', { p_doc: id }))
    const { signedUrl } = must(await supabase.storage.from(BUCKET).createSignedUrl(path, 120))
    if (fenetre) fenetre.location.href = signedUrl
    else window.location.href = signedUrl
  } catch (e) {
    if (fenetre) fenetre.close()
    throw e
  }
}

/** Efface le fichier puis la ligne : le stockage ne laisse effacer un fichier que tant que sa ligne est lisible (0303) */
export async function supprimerDocument(doc) {
  const path = must(await supabase.from('hr_documents').select('file_path').eq('id', doc.id).single()).file_path
  const { data: effaces, error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) throw error
  if (!effaces?.length) throw new Error('Le fichier n\'a pas pu être effacé : document conservé')
  must(await supabase.from('hr_documents').delete().eq('id', doc.id))
}

// ─── Habilitations ───
export const chargerHabilitations = async (personId) => must(await supabase.from('hr_qualifications')
  .select('*').eq('person_id', personId).is('archived_at', null).order('expires_on', { ascending: true, nullsFirst: false }))

export async function enregistrerHabilitation(h) {
  const { id, ...reste } = h
  const ligne = {
    ...reste,
    label: reste.label?.trim(),
    issuer: reste.issuer?.trim() || null,
    notes: reste.notes?.trim() || null,
    obtained_on: reste.obtained_on || null,
    expires_on: reste.expires_on || null,
    document_id: reste.document_id || null,
  }
  if (id) return must(await supabase.from('hr_qualifications').update(ligne).eq('id', id))
  return must(await supabase.from('hr_qualifications').insert(ligne))
}
export const archiverHabilitation = async (id) => must(await supabase.from('hr_qualifications').update({ archived_at: new Date().toISOString() }).eq('id', id))

// ─── Suivi de santé au travail (administratif) ───
export const chargerSuivisSante = async (personId) => must(await supabase.from('hr_medical_followups')
  .select('*').eq('person_id', personId).order('visit_on', { ascending: false, nullsFirst: true }))

export async function enregistrerSuiviSante(s) {
  const { id, ...reste } = s
  const ligne = {
    ...reste,
    visit_on: reste.visit_on || null,
    next_due_on: reste.next_due_on || null,
    conclusion: reste.conclusion || null,
    accommodation: reste.accommodation?.trim() || null,
    document_id: reste.document_id || null,
  }
  if (id) return must(await supabase.from('hr_medical_followups').update(ligne).eq('id', id))
  return must(await supabase.from('hr_medical_followups').insert(ligne))
}
export const supprimerSuiviSante = async (id) => must(await supabase.from('hr_medical_followups').delete().eq('id', id))

// ─── Échéances (vue aux droits du lecteur) ───
export const chargerEcheances = async ({ personId = null, jusquAu = null } = {}) => {
  let q = supabase.from('v_hr_echeances').select('*').order('due_on')
  if (personId) q = q.eq('person_id', personId)
  if (jusquAu) q = q.lte('due_on', jusquAu)
  return must(await q)
}
