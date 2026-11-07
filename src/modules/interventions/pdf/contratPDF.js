// Contrat de maintenance en PDF (0460, lot 1 des contrats) : conditions particulières (parties, sites, matériel couvert,
// visites, prix, durée, reconduction, préavis, facturation, moment des factures et ce que le prix comprend, révision du
// prix selon l'indice), cadre de signature des deux parties, puis les conditions
// générales de maintenance dans leur version validée. Sans version validée, le contrat ne part pas à la signature
// (aperçu seulement) : message clair, rien d'autre n'est bloqué.

import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import { PDFDocument } from 'pdf-lib'
import { startDocument, numberPages, compacter } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { orgHorsFormation } from '../../../core/org/orgUtils'
import { monthLabel } from '../lib/schedule'
import { phraseConditions, dateFr, limiteRefus, libellePeriodicite, termeFacture, comprisDuContrat, parEcheancier, FORMULE_REVISION } from '../lib/contrat'

const euros = (n) => `${Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € HT`
const enOctets = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
function enBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export const MESSAGE_CGV_MANQUANTE = "Les conditions générales de maintenance ne sont pas encore validées (Qualité › Processus qualité). Le contrat peut être vu en aperçu, mais pas envoyé à signer."

/**
 * Contrat en PDF. Renvoie { base64, cgv } ; cgv = null quand aucune version validée n'existe (aperçu seulement).
 * contract : ligne itv_contracts avec clients ; sites, types : listes chargées par l'écran ; parc : appareils couverts.
 */
export async function buildContratPDF({ contract, client, sites = [], types = [], parc = [], quoteRef = null, org = null, avecCgv = true }) {
  const ORG = orgHorsFormation(org || await loadPdfOrg())
  const ref = contract.reference || quoteRef || null
  // Construction synchrone, recomposée plus serrée si la dernière page est presque vide (compacter, 06/11) ;
  // f.finish() pose le pied de page légal sur la dernière page (il manquait)
  const doc = compacter(() => {
    const doc = new jsPDF({ compress: true })
    const f = startDocument(doc, ORG, { ref, docLabel: 'Contrat de maintenance', code: 'CTR', title: contract.label || 'Contrat de maintenance', subtitle: 'Conditions particulières' })

    f.cards([
      { label: 'Prestataire', lines: [ORG.name, ORG.addressFull || '', ORG.siret ? `SIRET ${ORG.siret}` : ''].filter(Boolean) },
      { label: 'Client', lines: [client?.name || '', client?.address || '', [client?.postal_code, client?.city].filter(Boolean).join(' '), client?.siret ? `SIRET ${client.siret}` : ''].filter(Boolean) },
    ])

    const couverts = (contract.site_ids || []).length ? sites.filter((s) => contract.site_ids.includes(s.id)) : sites
    const typesCouverts = (contract.type_ids || []).length ? types.filter((t) => contract.type_ids.includes(t.id)) : []
    const conds = { duree_ans: contract.duration_years || 1, reconduction: !!contract.tacit_renewal, reconduction_ans: contract.renewal_years || 1, preavis_mois: contract.notice_months ?? 0, periodicite: contract.billing_period || 'annuel' }

    f.section('Objet et périmètre')
    f.kv([
      ['Sites couverts', couverts.length ? couverts.map((s) => [s.name, s.city].filter(Boolean).join(', ')).join(' ; ') : 'Tous les sites du client'],
      ['Matériel couvert', typesCouverts.length ? typesCouverts.map((t) => t.name).join(', ') : 'Tout le matériel de sécurité inscrit au parc'],
      ['Visites', `${(contract.visit_months || []).map(monthLabel).join(', ') || 'à convenir'} (avis de passage avant chaque visite)`],
      ...(contract.emergency_hours ? [['Dépannage urgent', `arrivée sur site sous ${contract.emergency_hours} heures après la demande`]] : []),
      ...(quoteRef ? [['Devis d\'origine', quoteRef]] : []),
    ], { labelW: 40 })

    if (parc.length) {
      f.section('Parc couvert à la signature')
      const parType = new Map()
      for (const e of parc) parType.set(e.type_name || 'Autre', (parType.get(e.type_name || 'Autre') || 0) + 1)
      f.table(['Matériel', 'Nombre'], [...parType.entries()].map(([k, n]) => [k, String(n)]), { columnStyles: { 1: { halign: 'right', cellWidth: 30 } }, reportable: true })
    }

    // Points de coupe (compacter) : la page suivante peut commencer à une rubrique, pas au milieu
    f.coupure()
    f.section('Prix, durée et facturation')
    const echeance = contract.term_on || null
    f.kv([
      ['Prix annuel', euros(contract.annual_price_ht)],
      ['Facturation', libellePeriodicite(conds.periodicite)],
      // Échéancier (0461) : moment des factures et ce que le prix comprend ; à la visite, chaque visite est facturée
      ...(parEcheancier(contract) ? [
        ['Date des factures', termeFacture(contract, client?.client_type) === 'echu' ? 'après chaque période, une fois le service fait' : 'au début de chaque période, pour la période à venir'],
        ['Compris dans le prix', comprisDuContrat(contract).join(', ') || 'les visites seulement ; pièces, recharges, déplacement et dépannage facturés en plus'],
      ] : [
        ['Factures', 'une facture après chaque visite ; pièces, recharges, déplacement et dépannage facturés en plus'],
      ]),
      ['Prise d\'effet', dateFr(contract.start_on)],
      ['Durée', `${conds.duree_ans} an${conds.duree_ans > 1 ? 's' : ''}${echeance ? `, échéance le ${dateFr(echeance)}` : ''}`],
      ['À l\'échéance', conds.reconduction
        ? `reconduction tacite par périodes de ${conds.reconduction_ans} an${conds.reconduction_ans > 1 ? 's' : ''}${echeance ? ` ; refus possible jusqu'au ${dateFr(limiteRefus(echeance, conds.preavis_mois))}` : ''}`
        : 'fin du contrat, sans reconduction'],
    ], { labelW: 40 })
    f.para(phraseConditions(conds), { size: 8.5, after: 2 })

    // Clause de révision (0462) : seulement si une valeur de référence de l'indice est prévue au contrat
    if (Number(contract.index_base_value) > 0) {
      const moisRef = contract.index_base_month ? new Date(`${String(contract.index_base_month).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : null
      f.coupure()
      f.section('Révision du prix')
      f.kv([
        ['Indice', [contract.index_label, contract.index_series ? `identifiant INSEE ${contract.index_series}` : null].filter(Boolean).join(', ') || 'indice prévu au contrat'],
        ['Valeur de référence', `${Number(contract.index_base_value).toLocaleString('fr-FR', { maximumFractionDigits: 4 })}${moisRef ? `, ${moisRef}` : ''}`],
        ['Prix de départ', euros(contract.base_price_ht ?? contract.annual_price_ht)],
      ], { labelW: 40 })
      f.para(`Chaque année, à la date anniversaire de la prise d'effet, le prix annuel peut être révisé selon la formule : ${FORMULE_REVISION}. Le nouveau prix est communiqué au client par courrier.`, { size: 8.5, after: 2 })
    }
    f.para('Le présent contrat est régi par les conditions particulières ci-dessus et par les conditions générales de maintenance et de vérification jointes, dont le client reconnaît avoir pris connaissance. En cas de contradiction, les conditions particulières prévalent.', { size: 8.5, after: 4 })

    f.signatures([
      { label: 'Pour le prestataire', name: [ORG.dirigeant, ORG.dirigeant_title].filter(Boolean).join(', '), hint: 'Date et signature', image: ORG.dirigeant_signature_base64 || null, stamp: ORG.stamp_base64 || null },
      { label: 'Pour le client', name: contract.signed_name || '', hint: 'Nom, fonction, date, signature et cachet' },
    ], { height: 34 })
    f.finish()
    numberPages(doc, ORG)
    return doc
  })
  const base = doc.output('datauristring').split(',')[1]

  if (!avecCgv) return { base64: base, cgv: null }
  const { publishedDocPDF } = await import('../../qualite/richdocs/published')
  const cgv = await publishedDocPDF('cgv-maintenance', { audience: client?.client_type === 'particulier' ? 'particulier' : 'pro' })
  if (!cgv || cgv.source !== 'valide') return { base64: base, cgv: null }
  const out = await PDFDocument.load(enOctets(base), { updateMetadata: false })
  const src = await PDFDocument.load(enOctets(cgv.base64))
  ;(await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p))
  return { base64: enBase64(await out.save()), cgv: { version: cgv.version, validated_at: cgv.validated_at || null } }
}
