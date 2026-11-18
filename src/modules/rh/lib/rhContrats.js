// Module RH, contrats de travail et avenants (0523). Le texte vient des modèles de la société (hr_contract_models) :
//   - « projet » tant que l'avocat n'a pas validé : PDF marqué PROJET, téléchargé seulement (jamais rangé dans les
//     documents, donc jamais visible du salarié) ;
//   - « validé » : PDF rangé dans les documents RH (restreint : il contient la rémunération), origine et empreinte notées.
// Contrôle avant génération : chaque champ du texte retenu doit être rempli (mentions de L1242-12, R1221-34).
// La rémunération est lue par hr_remuneration (droit « Voir les salaires », consultation journalisée).

import jsPDF from 'jspdf'
import 'jspdf-autotable'
import { supabase } from '../../../core/supabase'
import { startDocument } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { orgHorsFormation } from '../../../core/org/orgUtils'
import { deposerDocument, nomFichierSur } from './rhDocuments'
import { CONTRATS, PERIODES, voirRemuneration } from './rhData'

const must = ({ data, error }) => { if (error) throw error; return data }
const frDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const vide = (x) => x == null || String(x).trim() === ''

// Cas de recours au CDD retenus (L1242-2, 1° à 4°) ; les autres cas attendent l'avocat
export const MOTIFS_CDD = {
  remplacement_absence: 'Remplacement d\'un salarié absent (L1242-2, 1° a)',
  remplacement_temps_partiel: 'Remplacement d\'un salarié passé provisoirement à temps partiel (L1242-2, 1° b)',
  remplacement_suspension: 'Remplacement d\'un salarié dont le contrat est suspendu (L1242-2, 1° c)',
  remplacement_depart: 'Remplacement d\'un salarié parti avant la suppression de son poste (L1242-2, 1° d)',
  remplacement_attente_cdi: 'Remplacement dans l\'attente de l\'arrivée d\'un salarié en CDI (L1242-2, 1° e)',
  accroissement: 'Accroissement temporaire de l\'activité de l\'entreprise (L1242-2, 2°)',
  saisonnier: 'Emploi à caractère saisonnier (L1242-2, 3°)',
  remplacement_chef_entreprise: 'Remplacement d\'un chef d\'entreprise ou de son conjoint collaborateur (L1242-2, 4°)',
}
export const estRemplacement = (motif) => String(motif || '').startsWith('remplacement')
/** CDD sans terme précis permis (L1242-7) : remplacement ou emploi saisonnier */
export const sansTermePermis = (motif) => estRemplacement(motif) || motif === 'saisonnier'

export const TYPES_MODELE = { cdi: 'CDI', cdd: 'CDD', avenant: 'Avenant' }
/** Type de modèle d'un contrat ; null : contrat sans modèle (apprentissage, stage, intérim...) */
export const modelePour = (contractType) => (contractType === 'cdi' || contractType === 'cdd' ? contractType : null)

// Libellé de chaque champ, pour le message « à compléter »
export const CHAMPS = {
  employeur_nom: 'Raison sociale de la société (Paramètres › Sociétés)',
  employeur_forme: 'Forme juridique de la société (Paramètres › Sociétés)',
  employeur_siren: 'SIREN de la société (Paramètres › Sociétés)',
  employeur_adresse: 'Adresse du siège (Paramètres › Sociétés)',
  salarie_nom: 'Nom du salarié',
  salarie_adresse: 'Adresse personnelle du salarié (fiche)',
  date_debut: 'Date de début',
  date_fin: 'Date de fin du CDD (ou une durée minimale si sans terme précis)',
  duree_minimale: 'Fin de la durée minimale (CDD sans terme précis)',
  motif_cdd: 'Motif du CDD',
  remplace_nom: 'Nom du salarié remplacé',
  remplace_qualification: 'Qualification du salarié remplacé',
  poste_intitule: 'Emploi',
  qualification: 'Qualification, catégorie',
  poste_fonctions: 'Fiche de poste',
  lieux_travail: 'Lieux de travail',
  essai_fin: 'Fin de la période d\'essai',
  duree_travail: 'Heures par semaine ou forfait jours',
  remuneration: 'Rémunération (saisie dans le contrat, droit « Voir les salaires »)',
  paie_modalites: 'Modalités de paie (Personnel › Contrats › Réglages)',
  convention_nom: 'Intitulé de la convention collective (Personnel › Contrats › Réglages)',
  convention_idcc: 'IDCC de la société (Paramètres › Sociétés)',
  caisse_retraite: 'Caisse de retraite complémentaire (Personnel › Contrats › Réglages)',
  prevoyance: 'Organisme de prévoyance',
  contrat_type: 'Type du contrat',
  avenant_objet: 'Objet de l\'avenant',
  avenant_date_effet: 'Date d\'effet de l\'avenant',
}

/** Conditions des articles (clé « si » des modèles) */
export function conditions(contrat = {}, reglages = {}) {
  const c = new Set()
  if (!vide(contrat.job_description)) c.add('fonctions')
  if (contrat.trial_end_on) c.add('essai')
  if (!vide(reglages.prevoyance_org)) c.add('prevoyance')
  if (contrat.contract_type === 'cdd') {
    if (estRemplacement(contrat.cdd_reason)) c.add('remplacement')
    if (contrat.end_on || !contrat.cdd_min_end_on) c.add('terme_precis')
    else c.add('sans_terme')
    if (contrat.cdd_renewable) c.add('renouvelable')
    if (contrat.risky_post) c.add('poste_risque')
  }
  return c
}

/** Rémunération en vigueur au début du contrat (sinon la première saisie) */
export function remunerationAuDebut(lignes = [], debut) {
  const triees = [...(lignes || [])].sort((a, b) => String(a.effective_on).localeCompare(String(b.effective_on)))
  const avant = triees.filter((l) => !debut || String(l.effective_on) <= String(debut))
  return avant[avant.length - 1] || triees[0] || null
}
const montant = (n) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, ' ')
export const texteRemuneration = (l) => (l && l.amount != null ? `${montant(l.amount)} euros ${PERIODES[l.period] || ''}`.trim() : '')

export function texteDureeTravail(contrat = {}) {
  if (contrat.days_per_year) return `Le salarié est soumis à un forfait annuel de ${contrat.days_per_year} jours de travail.`
  if (contrat.weekly_hours) return `La durée du travail est de ${String(Number(contrat.weekly_hours)).replace('.', ',')} heures par semaine.`
  return ''
}

/** Valeurs des champs du texte, depuis la société, la personne, le contrat, les réglages et la rémunération */
export function valeurs({ societe = {}, personne = {}, contrat = {}, reglages = {}, remuneration = null, avenant = null } = {}) {
  const adresse = (a, cp, ville) => [a, [cp, ville].filter(Boolean).join(' ')].filter((x) => !vide(x)).join(', ')
  return {
    employeur_nom: societe.legal_name || '',
    employeur_forme: societe.legal_form || '',
    employeur_siren: societe.siren || '',
    employeur_adresse: adresse(societe.address, societe.postal_code, societe.city),
    salarie_nom: [personne.first_name, (personne.last_name || '').toUpperCase()].filter(Boolean).join(' '),
    salarie_adresse: adresse(personne.personal_address, personne.personal_postal_code, personne.personal_city),
    date_debut: frDate(contrat.start_on),
    date_fin: frDate(contrat.end_on),
    duree_minimale: frDate(contrat.cdd_min_end_on),
    motif_cdd: contrat.cdd_reason ? (MOTIFS_CDD[contrat.cdd_reason] || '').replace(/ \(L1242-2.*\)$/, '').toLowerCase() : '',
    remplace_nom: contrat.cdd_replaced_name || '',
    remplace_qualification: contrat.cdd_replaced_qualification || '',
    poste_intitule: contrat.job_title || '',
    qualification: contrat.qualification || '',
    poste_fonctions: contrat.job_description || '',
    lieux_travail: contrat.work_places || '',
    essai_fin: frDate(contrat.trial_end_on),
    duree_travail: texteDureeTravail(contrat),
    remuneration: texteRemuneration(remuneration),
    paie_modalites: reglages.pay_terms || '',
    convention_nom: reglages.collective_agreement_name || '',
    convention_idcc: societe.idcc || '',
    caisse_retraite: reglages.retirement_fund || '',
    prevoyance: reglages.prevoyance_org || '',
    contrat_type: CONTRATS[contrat.contract_type] || '',
    avenant_objet: avenant?.subject || '',
    avenant_date_effet: frDate(avenant?.effective_on),
  }
}

/** Articles retenus pour ce contrat (sans condition, ou condition remplie) */
export const articlesRetenus = (modele, conds) => (modele?.articles || []).filter((a) => !a.si || conds.has(a.si))
export const champsDe = (texte) => [...String(texte || '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1])
export const remplir = (texte, v) => String(texte || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => (vide(v[k]) ? '' : String(v[k])))

/** Mentions manquantes (libellés, sans doublon) : un seul manque bloque la génération */
export function manquants(articles, v) {
  const m = new Set()
  for (const a of articles) for (const k of champsDe(a.texte)) if (vide(v[k])) m.add(CHAMPS[k] || k)
  return [...m]
}

/** Lignes d'avenant : un libellé et une nouvelle valeur chacune */
export function erreurAvenant(a = {}) {
  if (!a.effective_on) return 'Date d\'effet manquante'
  if (vide(a.subject)) return 'Objet de l\'avenant manquant'
  const lignes = (a.changes || []).filter((c) => !vide(c.label) || !vide(c.before) || !vide(c.after))
  if (lignes.length === 0) return 'Ajoutez au moins une modification'
  if (lignes.some((c) => vide(c.label) || vide(c.after))) return 'Chaque modification a un libellé et une nouvelle valeur'
  return null
}

export async function empreinte(octets) {
  const h = await crypto.subtle.digest('SHA-256', octets)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export const origine = (modele) => `${modele.kind}@${modele.version}:${modele.status}`

/** PDF du contrat ou de l'avenant ; filigrane PROJET tant que le modèle n'est pas validé */
export async function construirePDF({ modele, articles, v, changes = null, ville = '' }) {
  const ORG = orgHorsFormation(await loadPdfOrg(true))
  const doc = new jsPDF({ compress: true })
  const projet = modele.status !== 'valide'
  const f = startDocument(doc, ORG, {
    code: modele.kind === 'avenant' ? 'AVE' : 'CTR', docLabel: modele.title, title: modele.title,
    subtitle: projet ? 'PROJET, à valider par l\'avocat : sans valeur, ne pas remettre au salarié' : `${v.salarie_nom}`,
  })
  articles.forEach((a, i) => {
    f.section(`Article ${i + 1}. ${a.titre}`)
    f.para(remplir(a.texte, v))
    if (changes && a.titre === 'Modifications') {
      f.table([['Disposition', 'Avant', 'À compter de la date d\'effet']], changes.map((c) => [c.label, c.before || '', c.after]))
    }
  })
  f.space(4)
  f.para(`Fait à ${ville || '..................'}, le ..................., en deux exemplaires originaux.`)
  f.signatures([
    { label: 'Pour l\'employeur', name: v.employeur_nom, hint: 'Nom, qualité et signature' },
    { label: 'Le salarié', name: v.salarie_nom, hint: 'Mention « lu et approuvé » et signature' },
  ])
  f.finish()
  if (projet) {
    const n = doc.getNumberOfPages()
    for (let p = 1; p <= n; p += 1) {
      doc.setPage(p)
      if (doc.GState) doc.setGState(new doc.GState({ opacity: 0.15 }))
      doc.setFontSize(90); doc.setTextColor(200, 30, 30)
      doc.text('PROJET', 105, 170, { align: 'center', angle: 35 })
      if (doc.GState) doc.setGState(new doc.GState({ opacity: 1 }))
    }
  }
  return doc
}

// ─── Données ───
export const chargerModeles = async () => must(await supabase.from('hr_contract_models')
  .select('*').order('kind').order('version', { ascending: false }))
/** Modèle à utiliser : le plus récent validé, sinon le plus récent */
export function modeleCourant(modeles, kind) {
  const l = (modeles || []).filter((m) => m.kind === kind).sort((a, b) => b.version - a.version)
  return l.find((m) => m.status === 'valide') || l[0] || null
}
export const poserModeles = async (companyId) => must(await supabase.rpc('hr_modeles_contrat_poser', { p_company: companyId }))
export async function validerModele(id, { validated_on, validated_by_name }) {
  if (!validated_on || vide(validated_by_name)) throw new Error('Date et nom du validateur obligatoires')
  return must(await supabase.from('hr_contract_models')
    .update({ status: 'valide', validated_on, validated_by_name: validated_by_name.trim() }).eq('id', id))
}

export const REGLAGES = ['collective_agreement_name', 'retirement_fund', 'prevoyance_org', 'pay_terms']
export async function chargerReglagesContrat(companyId) {
  const [{ data: r }, { data: s }] = await Promise.all([
    supabase.from('hr_settings').select(`company_id, ${REGLAGES.join(', ')}`).eq('company_id', companyId).maybeSingle(),
    supabase.from('companies').select('id, legal_name, legal_form, siren, address, postal_code, city, idcc').eq('id', companyId).maybeSingle(),
  ])
  return { reglages: r || {}, societe: s || {} }
}
export async function enregistrerReglagesContrat(companyId, r) {
  const ligne = { company_id: companyId, ...Object.fromEntries(REGLAGES.map((k) => [k, vide(r[k]) ? null : String(r[k]).trim()])) }
  return must(await supabase.from('hr_settings').upsert(ligne, { onConflict: 'company_id' }))
}

export const chargerAvenants = async (employmentId) => must(await supabase.from('hr_contract_amendments')
  .select('*').eq('employment_id', employmentId).order('effective_on', { ascending: false }))
export async function enregistrerAvenant(a) {
  const err = erreurAvenant(a)
  if (err) throw new Error(err)
  const changes = a.changes.filter((c) => !vide(c.label) || !vide(c.after))
    .map((c) => ({ label: c.label.trim(), before: (c.before || '').trim(), after: c.after.trim() }))
  const ligne = { employment_id: a.employment_id, effective_on: a.effective_on, subject: a.subject.trim(), changes }
  if (a.id) return must(await supabase.from('hr_contract_amendments').update(ligne).eq('id', a.id).select('*').single())
  return must(await supabase.from('hr_contract_amendments').insert(ligne).select('*').single())
}
export const supprimerAvenant = async (id) => must(await supabase.from('hr_contract_amendments').delete().eq('id', id))
export const marquerAvenantRemis = async (id, jour) => must(await supabase.from('hr_contract_amendments').update({ handed_on: jour || null }).eq('id', id))
export const marquerContratRemis = async (id, jour) => must(await supabase.from('hr_employments').update({ contract_handed_on: jour || null }).eq('id', id))

/** Contrat ou avenant signé (scan) : rangé dans les documents (restreint), puis relié */
export async function deposerSigne({ companyId, personId, contrat, avenant = null, file }) {
  const doc = await deposerDocument({
    companyId, personId, file, employmentId: contrat.id,
    category: avenant ? 'avenant' : 'contrat', confidentiality: 'restreint',
    title: avenant ? `Avenant signé du ${frDate(avenant.effective_on)}` : `Contrat signé (${CONTRATS[contrat.contract_type] || 'contrat'} du ${frDate(contrat.start_on)})`,
  })
  if (avenant) must(await supabase.from('hr_contract_amendments').update({ signed_document_id: doc.id }).eq('id', avenant.id))
  else must(await supabase.from('hr_employments').update({ signed_document_id: doc.id }).eq('id', contrat.id))
  return doc
}

/**
 * Prépare la génération : modèle, articles retenus, valeurs, mentions manquantes.
 * Lit la rémunération (journalisée) seulement si le texte en a besoin.
 */
export async function preparer({ personne, contrat, avenant = null, modeles = null }) {
  const kind = avenant ? 'avenant' : modelePour(contrat.contract_type)
  if (!kind) return { erreur: `Pas de modèle pour un contrat « ${CONTRATS[contrat.contract_type] || contrat.contract_type} »` }
  const modele = modeleCourant((modeles || await chargerModeles()).filter((m) => m.company_id === personne.company_id), kind)
  if (!modele) return { erreur: 'Aucun modèle : posez les modèles de départ (Personnel › Contrats)' }
  const { reglages, societe } = await chargerReglagesContrat(personne.company_id)
  const articles = articlesRetenus(modele, conditions(contrat, reglages))
  let remuneration = null
  if (articles.some((a) => champsDe(a.texte).includes('remuneration'))) {
    try { remuneration = remunerationAuDebut(await voirRemuneration(contrat.id), contrat.start_on) } catch { remuneration = null }
  }
  const v = valeurs({ societe, personne, contrat, reglages, remuneration, avenant })
  return { modele, articles, v, manque: manquants(articles, v), ville: societe.city || '' }
}

/** Génère : projet téléchargé seulement ; validé rangé dans les documents (et relié à l'avenant) */
export async function generer({ personne, contrat, avenant = null, prep }) {
  const { modele, articles, v, ville } = prep
  const doc = await construirePDF({ modele, articles, v, ville, changes: avenant?.changes || null })
  const nom = `${avenant ? 'avenant' : 'contrat'}-${nomFichierSur(v.salarie_nom)}${modele.status !== 'valide' ? '-PROJET' : ''}.pdf`
  if (modele.status !== 'valide') {
    doc.save(nom)
    return { range: false }
  }
  const octets = doc.output('arraybuffer')
  const file = new File([octets], nom, { type: 'application/pdf' })
  const d = await deposerDocument({
    companyId: personne.company_id, personId: personne.id, file, employmentId: contrat.id,
    category: avenant ? 'avenant' : 'contrat', confidentiality: 'restreint',
    title: avenant ? `Avenant du ${frDate(avenant.effective_on)} (à signer)` : `Contrat ${CONTRATS[contrat.contract_type]} (à signer)`,
    generatedFrom: origine(modele), contentSha256: await empreinte(octets),
  })
  if (avenant) must(await supabase.from('hr_contract_amendments').update({ generated_document_id: d.id }).eq('id', avenant.id))
  return { range: true, id: d.id }
}
