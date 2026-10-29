// Rapport d'intervention (visite de vérification du matériel de sécurité), mise en page commune layout.js.

import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import { startDocument, numberPages, drawImageFitted } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { orgHorsFormation } from '../../../core/org/orgUtils'
import { RESULT_LABEL, REPLACE_REASON_LABEL, summarize, frShort, frMonthYear } from '../lib/schedule'
import { photoDataUrl } from '../lib/itvData'

const hour = (ts) => (ts ? new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).replace(':', 'h') : '')

/**
 * @param {object} p visit (avec clients, sites), items, parts, equipmentById, settings, technicianName, org (facultatif, pour les tests)
 */
export async function buildRapportPDF({ visit, items, parts, equipmentById, settings, technicianName, org = null, photos = null }) {
  const ORG = orgHorsFormation(org || await loadPdfOrg())
  const doc = new jsPDF({ compress: true })
  const day = (visit.started_at || visit.finished_at || visit.planned_on || '').slice(0, 10)
  // Visite d'inventaire (0463) : procès-verbal d'inventaire du parc, signé par le client
  const inventaire = visit.kind === 'inventaire'
  const titre = inventaire ? 'Procès-verbal d\'inventaire' : (settings?.report_title || 'Rapport d\'intervention')
  const f = startDocument(doc, ORG, {
    ref: visit.reference, docLabel: titre, code: 'ITV',
    title: titre,
    subtitle: inventaire ? `Inventaire du matériel de sécurité du ${frShort(day)}` : `Vérification du matériel de sécurité du ${frShort(day)}`,
  })

  const site = visit.sites || {}
  f.cards([
    { label: 'Client', lines: [visit.clients?.name || '', [site.address].filter(Boolean).join(''), [site.postal_code, site.city].filter(Boolean).join(' ')].filter((x) => x !== undefined) },
    { label: 'Site', lines: [site.name || 'Site', site.city || '', visit.itv_contracts ? (visit.itv_contracts.label || 'Contrat de maintenance') : 'Hors contrat'] },
    { label: 'Intervention', lines: [technicianName || '', [visit.started_at ? `Arrivée ${hour(visit.started_at)}` : null, visit.finished_at ? `départ ${hour(visit.finished_at)}` : null].filter(Boolean).join(', '), visit.reference || ''] },
  ])
  if (settings?.report_intro) f.para(settings.report_intro, { after: 3 })

  const s = summarize(items)
  f.kv([
    ['Appareils contrôlés', String(s.total)],
    ['Conformes', String(s.conforme)],
    ['À remplacer', String(s.a_remplacer)],
    ['Remplacés', String(s.remplace)],
    ...(s.absent + s.inaccessible ? [['Absents ou inaccessibles', String(s.absent + s.inaccessible)]] : []),
  ], { labelW: 50 })

  f.section('Appareils contrôlés')
  const opLabel = (code) => (settings?.operation_labels || {})[code] || code
  const rows = items
    .map((i) => ({ i, e: equipmentById[i.equipment_id] }))
    .filter((r) => r.e)
    .sort((a, b) => String(a.e.location || '').localeCompare(String(b.e.location || ''), 'fr', { numeric: true }))
    .map(({ i, e }) => [
      e.label_code,
      [e.itv_equipment_types?.name, e.details?.Capacité, e.manufactured_year ? `(${e.manufactured_year})` : null].filter(Boolean).join(' '),
      e.location || '',
      i.operation && i.operation !== 'verification' ? opLabel(i.operation) : 'Vérification',
      RESULT_LABEL[i.result] || 'Non contrôlé',
      [i.defect, i.result === 'remplace' && i.replace_reason ? `Remplacé : ${i.replace_reason === 'autre' && i.replace_note ? i.replace_note : REPLACE_REASON_LABEL[i.replace_reason]}` : null, i.observation].filter(Boolean).join('. '),
      i.result === 'conforme' || i.result === 'remplace' ? frMonthYear(e.next_check_on) : i.result === 'a_remplacer' ? 'Remplacement' : 'À revoir',
    ])
  f.table(['Étiquette', 'Appareil', 'Emplacement', 'Opération', 'Résultat', 'Observation', 'Prochaine'], rows, {
    styles: { fontSize: 7.6 },
    columnStyles: { 0: { cellWidth: 20 }, 3: { cellWidth: 24 }, 4: { cellWidth: 20, fontStyle: 'bold' }, 6: { cellWidth: 20 } },
    didParseCell: (d) => {
      if (d.section === 'body' && d.column.index === 4) {
        const v = d.cell.raw
        if (v === 'À remplacer') d.cell.styles.textColor = [146, 64, 14]
        else if (v === 'Absent' || v === 'Inaccessible') d.cell.styles.textColor = [185, 28, 28]
        else if (v === 'Remplacé') d.cell.styles.textColor = [29, 78, 216]
      }
    },
  })

  if (parts?.length) {
    f.section('Pièces fournies')
    f.table(['Pièce', 'Quantité'], parts.map((p) => [p.label, String(Number(p.quantity))]), { columnStyles: { 1: { cellWidth: 26, halign: 'center' } } })
  }

  const obs = [...(visit.site_observations || [])]
  if (obs.length || visit.observations) {
    f.section('Observations')
    if (obs.length) f.bullets(obs)
    if (visit.observations) f.para(visit.observations)
  }

  // Photos (jusqu'à 6, en vignettes)
  const paths = (visit.photos || []).slice(0, 6)
  if (paths.length) {
    const imgs = photos || (await Promise.all(paths.map((p) => photoDataUrl(p)))).filter(Boolean)
    if (imgs.length) {
      f.section('Photos')
      const w = (f.W - 8) / 3, h = w * 0.72
      for (let i = 0; i < imgs.length; i += 3) {
        f.ensure(h + 4)
        imgs.slice(i, i + 3).forEach((img, j) => drawImageFitted(doc, img, f.M + j * (w + 4), f.y, w, h, 'JPEG'))
        f.y += h + 4
      }
    }
  }

  if (settings?.report_mentions) f.callout('Informations', settings.report_mentions, { tone: 'muted' })

  f.section('Signatures')
  f.signatures([
    { label: 'Le technicien', name: technicianName || '', hint: frShort(day) },
    { label: 'Le client', name: visit.signer_name || '', hint: visit.client_signature ? `Signé le ${frShort(day)}` : 'Non signé', image: visit.client_signature || null },
  ], { height: 34 })

  f.finish()
  numberPages(doc, ORG)
  const safe = String(visit.clients?.name || 'client').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40)
  return { doc, filename: `${inventaire ? 'PV_inventaire' : 'Rapport'}_${visit.reference || 'intervention'}_${safe}.pdf` }
}
