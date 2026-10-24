// Avis de passage (0451) : avant la visite (« notre technicien passera le … ») ou au passage quand le client est
// absent (« nous sommes passés le … ; rappelez-nous »). Mise en page commune layout.js ; à imprimer pour la boîte
// aux lettres et mis à disposition dans l'espace client.

import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { orgHorsFormation } from '../../../core/org/orgUtils'

const dateLongue = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '')

/** Texte de l'avis (servi au PDF et à l'écran) */
export function texteAvis({ kind, passageOn, fenetre, message, contact = '' }) {
  const le = dateLongue(passageOn)
  if (kind === 'absent') {
    return {
      titre: 'Avis de passage',
      sousTitre: 'Nous sommes passés',
      corps: [
        `Notre technicien s'est présenté le ${le}${fenetre ? ` à ${fenetre}` : ''} pour la vérification de votre matériel de sécurité, sans pouvoir accéder aux locaux ni au matériel.`,
        `Merci de nous contacter pour convenir d'un nouveau rendez-vous${contact ? ` : ${contact}` : ''}. Tant que la vérification n'est pas faite, le matériel reste non vérifié pour cette période.`,
      ],
      message,
    }
  }
  return {
    titre: 'Avis de passage',
    sousTitre: 'Prochaine visite de vérification',
    corps: [
      `Notre technicien passera le ${le}${fenetre ? `, ${fenetre}` : ''}, pour la vérification de votre matériel de sécurité (extincteurs, éclairage de sécurité, alarme…).`,
      `Merci de prévoir l'accès aux locaux et au matériel. Si ce créneau ne vous convient pas, contactez-nous pour le déplacer${contact ? ` : ${contact}` : ''}.`,
    ],
    message,
  }
}

/**
 * @param {object} p visit (avec clients, sites), kind 'prevu' | 'absent', passageOn (AAAA-MM-JJ), fenetre, message
 */
export async function buildAvisPassagePDF({ visit, kind, passageOn, fenetre = '', message = '', org = null }) {
  const ORG = orgHorsFormation(org || await loadPdfOrg())
  const doc = new jsPDF({ compress: true })
  const contact = [ORG.phone, ORG.email].filter(Boolean).join(' ou ')
  const t = texteAvis({ kind, passageOn, fenetre, message, contact })
  const f = startDocument(doc, ORG, { ref: visit.reference, docLabel: t.titre, code: 'AVP', title: t.titre, subtitle: t.sousTitre })
  const site = visit.sites || {}
  f.cards([
    { label: 'Client', lines: [visit.clients?.name || '', site.address || '', [site.postal_code, site.city].filter(Boolean).join(' ')] },
    { label: 'Site', lines: [site.name || 'Site', kind === 'absent' ? `Passage du ${dateLongue(passageOn)}` : `Visite du ${dateLongue(passageOn)}`, fenetre || ''] },
  ])
  t.corps.forEach((p) => f.para(p, { size: 10.5, after: 4 }))
  if (t.message) { f.section('Message du technicien'); f.para(t.message, { size: 10, after: 4 }) }
  if (contact) f.note(`Nous joindre : ${contact}`)
  numberPages(doc, ORG)
  const nom = `Avis-de-passage-${(visit.reference || 'visite').replace(/[^A-Za-z0-9-]+/g, '-')}-${String(passageOn).slice(0, 10)}.pdf`
  return { doc, filename: nom, texte: t }
}
