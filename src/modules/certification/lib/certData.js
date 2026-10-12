// Accès aux données du module Certification (suivi, pièces, référentiel, preuves).
// Les identités viennent de organization_settings ; ce fichier n'écrit aucune valeur d'organisme.

import { supabase } from '../../../core/supabase'
import { sanitizeStorageKey } from '../../../core/storageUtils'

export const BUCKET = 'certification'

// Pièces du dossier de déclaration d'activité (article R6351-5 du code du travail)
export const NDA_PIECES = [
  { kind: 'nda_siren', label: 'Justificatif SIREN (avis de situation)', hint: 'À déposer', upload: true },
  { kind: 'nda_casier', label: 'Bulletin n° 3 du casier judiciaire du dirigeant', hint: 'À demander en ligne, gratuit', upload: true },
  { kind: 'nda_identite', label: 'Pièce d\'identité du dirigeant', hint: 'À déposer, en cours de validité', upload: true },
  { kind: 'nda_convention', label: 'Copie de la première convention signée', hint: 'Reprise de la session, ou à déposer', upload: true, fromSession: true },
  { kind: 'nda_programme', label: 'Programme, organisation et moyens', hint: 'Généré depuis le catalogue et le matériel', generated: true },
  { kind: 'nda_intervenants', label: 'Intervenants : titres et lien contractuel', hint: 'Généré depuis les formateurs', generated: true },
]

/** État de chaque pièce du dossier NDA : prête si déposée, ou générable à partir des données */
export function ndaPieceStates(documents = [], settings = {}, evidence = null) {
  return NDA_PIECES.map((p) => {
    const docs = documents.filter((d) => d.kind === p.kind)
    let ready = docs.length > 0
    let source = docs.length ? 'depose' : null
    if (!ready && p.fromSession && settings.first_convention_session_id && evidence?.n?.signedConventions) { ready = true; source = 'session' }
    if (!ready && p.generated) {
      if (p.kind === 'nda_programme' && evidence?.courses?.total) { ready = true; source = 'genere' }
      if (p.kind === 'nda_intervenants' && evidence?.trainers?.total) { ready = true; source = 'genere' }
    }
    return { ...p, docs, ready, source }
  })
}

export async function loadSettings() {
  const { data, error } = await supabase.from('cert_settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  return data || {}
}

/** Enregistre le suivi ; recopie dans organization_settings ce que le reste de l'application lit déjà */
export async function saveSettings(patch, { organization, updateOrganization } = {}) {
  const { data: u } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('cert_settings')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: u?.user?.id || null })
    .eq('id', 1).select().single()
  if (error) throw error
  if (updateOrganization) {
    const org = {}
    if ('certified_at' in patch || 'certifier_name' in patch) {
      if (data.certified_at) {
        org.qualiopi_certified = true
        org.qualiopi_since = data.certified_at
      }
      if (data.certifier_name && (data.certified_at || organization?.qualiopi_certified)) org.qualiopi_organisme = data.certifier_name
    }
    if (Object.keys(org).length) await updateOrganization(org)
  }
  return data
}

export async function loadDeadlines() {
  const { data, error } = await supabase.rpc('cert_deadlines')
  if (error) throw error
  return (data || []).slice().sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  })
}

export async function loadDocuments() {
  const { data, error } = await supabase.from('cert_documents').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function uploadDocument(kind, file, extra = {}) {
  const { data: u } = await supabase.auth.getUser()
  const path = `${kind}/${Date.now()}-${sanitizeStorageKey(file.name)}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (up.error) throw up.error
  const { data, error } = await supabase.from('cert_documents')
    .insert({ kind, file_path: path, file_name: file.name, created_by: u?.user?.id || null, ...extra })
    .select().single()
  if (error) throw error
  return data
}

export async function removeDocument(doc) {
  if (doc.file_path) await supabase.storage.from(BUCKET).remove([doc.file_path])
  const { error } = await supabase.from('cert_documents').delete().eq('id', doc.id)
  if (error) throw error
}

export async function signedUrl(path, bucket = BUCKET, seconds = 300) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}

export async function downloadBlob(path, bucket = BUCKET) {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error) throw error
  return data
}

export async function loadReferential(code) {
  const [ref, crit, ind, st, proofs] = await Promise.all([
    supabase.from('cert_referentials').select('*').order('sort_order'),
    supabase.from('cert_criteria').select('*').eq('referential_code', code).order('number'),
    supabase.from('cert_indicators').select('*').eq('referential_code', code).order('number'),
    supabase.from('cert_indicator_status').select('*').eq('referential_code', code),
    supabase.from('cert_proofs').select('*').order('created_at'),
  ])
  for (const r of [ref, crit, ind, st, proofs]) if (r.error) throw r.error
  return { referentials: ref.data || [], criteria: crit.data || [], indicators: ind.data || [], statuses: st.data || [], proofs: proofs.data || [] }
}

export async function saveIndicatorStatus(code, number, patch) {
  const { data: u } = await supabase.auth.getUser()
  const { error } = await supabase.from('cert_indicator_status').upsert({
    referential_code: code, number, ...patch, updated_at: new Date().toISOString(), updated_by: u?.user?.id || null,
  }, { onConflict: 'referential_code,number' })
  if (error) throw error
}

export async function addProof(number, { label, note, url, file }) {
  const { data: u } = await supabase.auth.getUser()
  let file_path = null
  let file_name = null
  if (file) {
    file_path = `preuves/${number}/${Date.now()}-${sanitizeStorageKey(file.name)}`
    const up = await supabase.storage.from(BUCKET).upload(file_path, file, { upsert: false, contentType: file.type || undefined })
    if (up.error) throw up.error
    file_name = file.name
  }
  const { data, error } = await supabase.from('cert_proofs')
    .insert({ indicator_number: number, label, note: note || null, url: url || null, file_path, file_name, created_by: u?.user?.id || null })
    .select().single()
  if (error) throw error
  return data
}

export async function removeProof(p) {
  if (p.file_path) await supabase.storage.from(BUCKET).remove([p.file_path])
  const { error } = await supabase.from('cert_proofs').delete().eq('id', p.id)
  if (error) throw error
}

export async function loadFindings() {
  const { data, error } = await supabase.from('cert_audit_findings').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveFinding(f) {
  const { data: u } = await supabase.auth.getUser()
  const row = { ...f }
  if (!row.id) row.created_by = u?.user?.id || null
  const q = row.id
    ? supabase.from('cert_audit_findings').update(row).eq('id', row.id)
    : supabase.from('cert_audit_findings').insert(row)
  const { error } = await q
  if (error) throw error
}

// ── Dates ──
export function addMonths(iso, n) {
  if (!iso) return null
  const [y, m, d] = iso.substring(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate()
  dt.setUTCDate(Math.min(d, last))
  return dt.toISOString().substring(0, 10)
}
export function addDays(iso, n) {
  if (!iso) return null
  const [y, m, d] = iso.substring(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().substring(0, 10)
}
export function todayIso() {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
export function daysUntil(iso) {
  if (!iso) return null
  const a = Date.parse(todayIso() + 'T00:00:00Z')
  const b = Date.parse(iso.substring(0, 10) + 'T00:00:00Z')
  return Math.round((b - a) / 86400000)
}
export function frDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return ''
  const [y, m, d] = iso.substring(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' })
}

/** Cycle Qualiopi calculé (arrêté du 6 juin 2019 modifié) */
export function qualiopiCycle(s) {
  if (!s?.certified_at) return null
  const validUntil = s.valid_until || addDays(addMonths(s.certified_at, 36), -1)
  return {
    surveillanceFrom: addMonths(s.certified_at, 14),
    surveillanceTo: addMonths(s.certified_at, 22),
    renewalFrom: addDays(addMonths(s.certified_at, 24), 0),
    renewalAlert: addMonths(validUntil, -4),
    validUntil,
  }
}
