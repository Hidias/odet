// Papiers des véhicules (0447) : carte grise, attestation d'assurance, constat amiable (prérempli et vierge),
// certificat de cession (Cerfa 15776, prérempli et vierge), suivi des sinistres. Les rubriques viennent de la fiche du
// véhicule et de l'identité de la société : rien n'est retapé dans un formulaire.

import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib'
import { supabase } from '../../../core/supabase'

const must = ({ data, error }) => { if (error) throw error; return data }

export const PAPIERS = {
  carte_grise: 'Carte grise (certificat d\'immatriculation)',
  attestation_assurance: 'Attestation d\'assurance',
  constat: 'Constat amiable rempli',
  photo_sinistre: 'Photo du sinistre',
  cession: 'Certificat de cession signé',
  autre: 'Autre document',
  constat_vierge: 'Constat amiable vierge',
}
export const ETATS_SINISTRE = {
  a_declarer: 'À déclarer à l\'assureur', declare: 'Déclaré', expertise: 'En expertise', reparation: 'En réparation',
  indemnise: 'Indemnisé', clos: 'Clos',
}
export const RESPONSABILITES = { inconnu: 'Pas encore connue', non: 'Non responsable', partiel: 'Responsabilité partagée', oui: 'Responsable' }
export const CERFA_VIERGE = '/formulaires/cerfa_15776-01.pdf'
// Page des assureurs sur l'application officielle e-constat auto (lien donné par H le 24/10)
export const E_CONSTAT = 'https://www.franceassureurs.fr/lassurance-protege-finance-et-emploie/lassurance-protege/les-demarches-en-cas-de-sinistre/e-constat-auto-application-mobile-constat-amiable-assureurs/'

const jour = (d = new Date()) => d.toISOString().slice(0, 10)

// ── Papiers ──
export const chargerPapiers = async (vehicleId) => must(await supabase.from('vehicle_papers').select('*').eq('vehicle_id', vehicleId).order('created_at', { ascending: false }))
export const chargerConstatsVierges = async () => must(await supabase.from('vehicle_papers').select('*').eq('kind', 'constat_vierge').order('created_at', { ascending: false }))

/** Le constat vierge de la société d'un véhicule (le plus récent), ou null */
export const constatViergeDe = (vierges, companyId) => (vierges || []).find((p) => p.company_id === companyId) || null

/** Papier valable à une date (attestation d'assurance : dates de validité) */
export function papierValable(p, j = jour()) {
  if (!p) return false
  if (p.valid_until && p.valid_until < j) return false
  if (p.valid_from && p.valid_from > j) return false
  return true
}

/** Dernière pièce d'un type (la plus récente déposée) */
export const dernier = (papiers, kind) => (papiers || []).find((p) => p.kind === kind) || null

const nomFichier = (f) => String(f?.name || 'document').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').slice(-80)

/** Dépose un fichier dans le stockage privé « vehicules » puis la fiche du papier */
export async function deposerPapier({ companyId, vehicleId = null, eventId = null, kind, file, label = null, validFrom = null, validUntil = null }) {
  if (!file) throw new Error('Choisissez un fichier')
  if (file.size > 5 * 1024 * 1024) throw new Error('Fichier trop lourd (5 Mo au plus)')
  const chemin = `${companyId}/${vehicleId || 'parc'}/${Date.now()}-${kind}-${nomFichier(file)}`
  must(await supabase.storage.from('vehicules').upload(chemin, file, { contentType: file.type || 'application/octet-stream' }))
  try {
    return must(await supabase.from('vehicle_papers').insert({
      vehicle_id: vehicleId, event_id: eventId, kind, label: label || null, valid_from: validFrom || null, valid_until: validUntil || null,
      file_path: chemin, file_name: file.name?.slice(0, 200) || null, company_id: companyId,
    }).select('*').single())
  } catch (e) {
    await supabase.storage.from('vehicules').remove([chemin]).catch(() => {})
    throw e
  }
}
export async function supprimerPapier(p) {
  must(await supabase.from('vehicle_papers').delete().eq('id', p.id))
  await supabase.storage.from('vehicules').remove([p.file_path]).catch(() => {})
}
export async function lienPapier(chemin, secondes = 300) {
  const { data, error } = await supabase.storage.from('vehicules').createSignedUrl(chemin, secondes)
  if (error) throw error
  return data.signedUrl
}
export async function octetsPapier(chemin) {
  const { data, error } = await supabase.storage.from('vehicules').download(chemin)
  if (error) throw error
  return new Uint8Array(await data.arrayBuffer())
}

// ── Sinistres ──
/** Où en est la déclaration d'un sinistre : en retard, à faire (jours restants), faite */
export function echeanceSinistre(ev, j = jour()) {
  if (!ev || ev.kind !== 'sinistre') return null
  if (ev.claim_status && ev.claim_status !== 'a_declarer') return { etat: 'fait', texte: ev.claim_declared_on ? `Déclaré le ${new Date(ev.claim_declared_on).toLocaleDateString('fr-FR')}` : ETATS_SINISTRE[ev.claim_status] }
  if (!ev.claim_deadline_on) return { etat: 'afaire', texte: 'À déclarer à l\'assureur' }
  const reste = Math.round((new Date(ev.claim_deadline_on) - new Date(j)) / 86400000)
  const le = new Date(ev.claim_deadline_on).toLocaleDateString('fr-FR')
  if (reste < 0) return { etat: 'retard', texte: `Déclaration en retard (limite le ${le})` }
  return { etat: 'afaire', texte: `À déclarer à l'assureur avant le ${le}${reste === 0 ? ' (aujourd\'hui)' : ''}` }
}

/** e-constat auto possible ? (application des assureurs : 2 véhicules au plus, immatriculés et assurés en France, sans blessé) */
export function eConstatPossible({ vehicules = 2, france = true, blesses = false } = {}) {
  const raisons = []
  if (vehicules > 2) raisons.push('plus de deux véhicules')
  if (!france) raisons.push('un véhicule étranger ou un accident à l\'étranger')
  if (blesses) raisons.push('un blessé')
  return { possible: raisons.length === 0, raisons }
}

// ── Données communes ──
/** Adresse « 12 bis rue des Lilas » découpée pour les cases du Cerfa */
export function decouperAdresse(adresse) {
  const a = String(adresse || '').replace(/\s+/g, ' ').trim()
  const m = a.match(/^(\d+)\s*(bis|ter|quater|[A-Z](?=\s))?\s*,?\s*(rue|avenue|av\.?|boulevard|bd|chemin|place|impasse|allée|allee|route|quai|cours|square|passage|lieu-dit|résidence|residence|zone|za|zi|zac|parc|rond-point)?\s*(.*)$/i)
  if (!m) return { numero: '', extension: '', type: '', voie: a }
  return { numero: m[1] || '', extension: m[2] || '', type: m[3] || '', voie: (m[4] || '').trim() }
}

const deux = (n) => String(n).padStart(2, '0')
function morceauxDate(d) {
  if (!d) return { j: '', m: '', a: '' }
  const [a, m, j] = String(d).slice(0, 10).split('-')
  return { j: j || '', m: m || '', a: a || '' }
}

/** Ce qu'il faut pour remplir les papiers, depuis la fiche du véhicule et l'identité de la société */
export function donneesVehicule({ vehicule, km = null, societe = {}, conducteur = null, attestation = null }) {
  return {
    plaque: vehicule?.plate || '', vin: vehicule?.vin || '', marque: vehicule?.brand || '', modele: vehicule?.model || '',
    type: vehicule?.type_variant || '', genre: vehicule?.national_genre || '', denomination: vehicule?.commercial_name || vehicule?.model || '',
    formule: vehicule?.registration_formula || '', premiereImmat: vehicule?.first_registration_on || '', km: km ?? null,
    assureur: vehicule?.insurer || '', contrat: vehicule?.insurance_policy || '', carteVerte: vehicule?.green_card_number || '',
    agence: vehicule?.insurer_agency || '', agenceAdresse: vehicule?.insurer_agency_address || '', agenceContact: vehicule?.insurer_agency_contact || '',
    degatsCouverts: vehicule?.own_damage_covered ?? null,
    attestationDu: attestation?.valid_from || '', attestationAu: attestation?.valid_until || vehicule?.insurance_due_on || '',
    societe: {
      nom: societe.legal_name || societe.name || '', siret: String(societe.siret || '').replace(/\D/g, ''), adresse: societe.address || '',
      cp: societe.postal_code || '', ville: societe.city || '', tel: societe.phone || '', email: societe.email || '',
    },
    conducteur: conducteur ? { nom: conducteur.last_name || '', prenom: conducteur.first_name || '', tel: conducteur.phone || '', email: conducteur.email || '' } : null,
  }
}

/** Lignes « à recopier » dans l'application e-constat auto (pré-remplissage du véhicule et de l'assurance) */
export function infosEConstat(d) {
  return [
    ['Immatriculation', d.plaque], ['Marque et modèle', [d.marque, d.modele].filter(Boolean).join(' ')],
    ['Assuré (preneur d\'assurance)', d.societe.nom], ['Adresse', [d.societe.adresse, [d.societe.cp, d.societe.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ')],
    ['Société d\'assurance', d.assureur], ['N° de contrat', d.contrat], ['N° de carte verte', d.carteVerte],
    ['Attestation valable', [d.attestationDu && `du ${new Date(d.attestationDu).toLocaleDateString('fr-FR')}`, d.attestationAu && `au ${new Date(d.attestationAu).toLocaleDateString('fr-FR')}`].filter(Boolean).join(' ')],
    ['Agence ou courtier', [d.agence, d.agenceAdresse, d.agenceContact].filter(Boolean).join(', ')],
  ].filter(([, v]) => v)
}

// ── Certificat de cession (Cerfa 15776*01) ──
const P = (page, champ) => `topmostSubform[0].Page${page}[0].${champ}[0]`

/**
 * Remplit le Cerfa 15776 (les deux exemplaires) : véhicule et ancien propriétaire depuis la fiche et la société ;
 * vente et nouveau propriétaire depuis le formulaire (rien n'est gardé sur l'acheteur). Les champs restent modifiables.
 * @param {Uint8Array|ArrayBuffer} vierge le Cerfa vierge
 * @param {object} d données de donneesVehicule
 * @param {object} vente { date, heure, destruction, agrement, lieu, situationRemise, sansTransformation }
 * @param {object} acheteur { morale, sexe, nom, siret, naissance, lieuNaissance, adresse, cp, ville }
 */
export async function remplirCerfaCession(vierge, d, vente = {}, acheteur = {}) {
  const doc = await PDFDocument.load(vierge)
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'))
  if (acro?.delete) acro.delete(PDFName.of('XFA'))
  const form = doc.getForm()
  const ecrire = (nom, valeur) => {
    if (valeur == null || valeur === '') return
    let f
    try { f = form.getTextField(nom) } catch { return }
    let v = String(valeur)
    const max = f.getMaxLength()
    if (max && v.length > max) v = v.slice(0, max)
    f.setText(v)
  }
  const choisir = (nom, option) => { try { form.getRadioGroup(nom).select(option) } catch { /* champ absent */ } }
  const cocher = (nom, oui) => { if (!oui) return; try { form.getCheckBox(nom).check() } catch { /* champ absent */ } }
  const vendeur = decouperAdresse(d.societe.adresse)
  const adrA = decouperAdresse(acheteur.adresse)
  const imm = morceauxDate(d.premiereImmat)
  const dv = morceauxDate(vente.date)
  const [hh, mm] = String(vente.heure || '').split(':')
  const naiss = morceauxDate(acheteur.naissance)
  const plaque = d.plaque.length > 9 ? d.plaque.replace(/[^A-Za-z0-9]/g, '') : d.plaque
  // Le numéro de formule commence par « 20 », déjà imprimé dans la case
  const formule = String(d.formule || '').replace(/\s/g, '').replace(/^20(?=.{9}$)/, '')
  const dateFr = vente.date ? new Date(vente.date).toLocaleDateString('fr-FR') : ''
  for (const p of [1, 2]) {
    ecrire(P(p, 'num_Immatriculation'), plaque)
    ecrire(P(p, 'num_Identification'), d.vin)
    ecrire(P(p, 'num_DateImmatriculationJour'), imm.j); ecrire(P(p, 'num_DateImmatriculationMois'), imm.m); ecrire(P(p, 'num_DateImmatriculationAnnée'), imm.a)
    ecrire(P(p, 'txt_MarqueVéhicule'), d.marque)
    ecrire(P(p, 'txt_TypeVarianteVersionVéhicule'), d.type)
    ecrire(P(p, 'txt_GenreNational'), d.genre)
    ecrire(P(p, 'txt_DénominationCommerciale'), d.denomination)
    if (d.km != null) ecrire(P(p, 'num_KilométrageCompteur'), Number(d.km).toLocaleString('fr-FR').replace(/\s/g, ' '))
    if (formule) { choisir(P(p, 'Groupe_de_boutons_radio1'), '1'); ecrire(P(p, 'num_Formule'), formule) }
    // Ancien propriétaire : la société, personne morale
    choisir(P(p, 'Groupe_de_boutons_radio3'), '1')
    ecrire(P(p, 'txt_IdentitéVendeur'), d.societe.nom)
    ecrire(P(p, 'Num_Siret'), d.societe.siret)
    ecrire(P(p, 'num_VoieAdresse'), vendeur.numero); ecrire(P(p, 'txt_ExtensionAdresse'), vendeur.extension)
    ecrire(P(p, 'txt_TypeVoieAdresse'), vendeur.type); ecrire(P(p, 'txt_NomVoie'), vendeur.voie)
    ecrire(P(p, 'num_CodePostalAdresse'), d.societe.cp); ecrire(P(p, 'txt_CommuneAdresse'), d.societe.ville)
    choisir(P(p, 'Groupe_de_boutons_radio4'), vente.destruction ? '2' : '1')
    ecrire(P(p, 'num_DateVenteJour'), dv.j); ecrire(P(p, 'num_DateVenteMois'), dv.m); ecrire(P(p, 'num_DateVenteAnnée'), dv.a)
    if (hh) { ecrire(P(p, 'num_HoraireVente1'), deux(hh)); ecrire(P(p, 'num_HoraireVente2'), deux(mm || 0)) }
    cocher(P(p, 'ckb_ValidationDéclaration1'), vente.situationRemise)
    cocher(P(p, 'ckb_ValidationDéclaration2'), vente.sansTransformation)
    if (vente.destruction) { cocher(P(p, 'ckb_ValidationDéclaration3'), true); ecrire(P(p, 'num_Agrément'), vente.agrement) }
    ecrire(P(p, 'txt_LieuDéclaration1'), vente.lieu || d.societe.ville); ecrire(P(p, 'num_DateDéclaration'), dateFr)
    // Nouveau propriétaire
    if (acheteur.nom) {
      choisir(P(p, 'Groupe_de_boutons_radio5'), acheteur.morale ? '1' : '2')
      if (!acheteur.morale && acheteur.sexe) choisir(P(p, 'Groupe_de_boutons_radio6'), acheteur.sexe === 'F' ? '2' : '1')
      ecrire(P(p, 'txt_IdentitéAcheteur'), acheteur.nom)
      ecrire(P(p, 'num_SiretAcheteur'), String(acheteur.siret || '').replace(/\D/g, ''))
      ecrire(P(p, 'num_DateNaissanceAcheteurJ'), naiss.j); ecrire(P(p, 'num_DateNaissanceAcheteurM'), naiss.m); ecrire(P(p, 'num_DateNaissanceAcheteurA'), naiss.a)
      ecrire(P(p, 'txt_LieuNaissanceAcheteur'), acheteur.lieuNaissance)
      ecrire(P(p, 'num_VoieAdresseAcheteur'), adrA.numero); ecrire(P(p, 'txt_ExtensionAdresseAcheteur'), adrA.extension)
      ecrire(P(p, 'txt_TypeVoieAdresseAcheteur'), adrA.type); ecrire(P(p, 'txt_NomVoieAdresseAcheteur'), adrA.voie)
      ecrire(P(p, 'num_CodePostalAdresseAcheteur'), acheteur.cp); ecrire(P(p, 'txt_CommuneAdresseAcheteur'), acheteur.ville)
    }
  }
  const font = await doc.embedFont(StandardFonts.Helvetica)
  form.updateFieldAppearances(font)
  return doc.save()
}

// ── Constat amiable (modèle européen) : partie « Véhicule A » préremplie ──
// Positions relevées sur le modèle du CEA (A4, recto du constat) : x et haut de ligne en points, depuis le coin haut gauche.
export const CASES_CONSTAT = {
  preneurNom: [46, 151.5], preneurPrenom: [52, 164], preneurAdresse: [54, 176], preneurCp: [62, 189], preneurPays: [130, 189], preneurTel: [72, 201],
  marque: [22, 252], immat: [22, 275], paysImmat: [22, 297],
  assureur: [46, 326], contrat: [68, 339], carteVerte: [78, 351], attestationDu: [98, 374], attestationAu: [166, 374],
  agenceNom: [46, 397.5], agenceAdresse: [52, 409], agencePays: [126, 421.5], agenceTel: [72, 434],
  degatsNon: [110.3, 458.5], degatsOui: [170.8, 458.5],
  conducteurNom: [46, 492.5], conducteurPrenom: [52, 504.5], conducteurTel: [72, 555.5],
}
const BORD_DROIT = 216
// Cases suivies d'une autre rubrique sur la même ligne
const BORDS = { preneurCp: 113, attestationDu: 150, agenceAdresse: 214 }

/**
 * Préremplit la partie « Véhicule A » du constat amiable vierge de la société (fichier de son assureur, au modèle
 * européen). Le recto du constat est la dernière page. Les autres pages sont gardées telles quelles.
 */
export async function remplirConstat(vierge, d) {
  const doc = await PDFDocument.load(vierge, { ignoreEncryption: true })
  const pages = doc.getPages()
  const page = pages[pages.length - 1]
  const { width, height } = page.getSize()
  const kx = width / 595.22
  const ky = height / 842
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const taille = 7.5 * Math.min(kx, ky)
  const ecrire = (cle, texte) => {
    if (!texte) return
    const [x, haut] = CASES_CONSTAT[cle]
    let t = String(texte).replace(/\s+/g, ' ').trim()
    const largeur = ((BORDS[cle] || BORD_DROIT) - x) * kx
    while (t.length > 1 && font.widthOfTextAtSize(t, taille) > largeur) t = t.slice(0, -1)
    page.drawText(t, { x: x * kx, y: height - (haut - 0.5) * ky, size: taille, font, color: rgb(0.05, 0.1, 0.45) })
  }
  const dateFr = (x) => (x ? new Date(x).toLocaleDateString('fr-FR') : '')
  ecrire('preneurNom', d.societe.nom)
  ecrire('preneurAdresse', d.societe.adresse)
  ecrire('preneurCp', [d.societe.cp, d.societe.ville].filter(Boolean).join(' '))
  ecrire('preneurPays', 'France')
  ecrire('preneurTel', d.societe.tel || d.societe.email)
  ecrire('marque', [d.marque, d.modele].filter(Boolean).join(' '))
  ecrire('immat', d.plaque)
  ecrire('paysImmat', 'France')
  ecrire('assureur', d.assureur)
  ecrire('contrat', d.contrat)
  ecrire('carteVerte', d.carteVerte)
  ecrire('attestationDu', dateFr(d.attestationDu))
  ecrire('attestationAu', dateFr(d.attestationAu))
  ecrire('agenceNom', d.agence)
  ecrire('agenceAdresse', d.agenceAdresse)
  if (d.agence) ecrire('agencePays', 'France')
  ecrire('agenceTel', d.agenceContact)
  if (d.degatsCouverts === true) ecrire('degatsOui', 'X')
  if (d.degatsCouverts === false) ecrire('degatsNon', 'X')
  if (d.conducteur) {
    ecrire('conducteurNom', d.conducteur.nom)
    ecrire('conducteurPrenom', d.conducteur.prenom)
    ecrire('conducteurTel', d.conducteur.tel || d.conducteur.email)
  }
  return doc.save()
}

/** Ouvre ou télécharge un PDF produit dans le navigateur */
export function ouvrirPdf(octets, nom) {
  const url = URL.createObjectURL(new Blob([octets], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
