// Registre des vérifications d'un site : inventaire du matériel de sécurité, dernières et prochaines vérifications,
// visites réalisées avec leurs constats. À joindre au registre de sécurité tenu par le client.

import { jsPDF } from 'jspdf'
import 'jspdf-autotable'
import { startDocument, numberPages } from '../../../core/pdf/layout'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { RESULT_LABEL, summarize, frShort, frMonthYear, todayIso } from '../lib/schedule'

export async function buildRegistrePDF({ client, site, equipment, visits, settings, org = null }) {
  const ORG = org || await loadPdfOrg()
  const doc = new jsPDF({ compress: true })
  const f = startDocument(doc, ORG, {
    docLabel: 'Registre des vérifications', code: 'REG',
    title: 'Registre des vérifications du matériel de sécurité',
    subtitle: `${client?.name || ''}, ${site?.name || ''}. Édité le ${frShort(todayIso())}`,
  })
  f.cards([
    { label: 'Établissement', lines: [client?.name || '', site?.name || '', [site?.address, site?.postal_code, site?.city].filter(Boolean).join(' ')] },
    { label: 'Entreprise de maintenance', lines: [ORG.name || '', ORG.adressePrincipale || ORG.address || '', [ORG.phone, ORG.email].filter(Boolean).join(', ')] },
  ])
  f.callout('À joindre au registre de sécurité', 'Ce document récapitule le matériel de sécurité suivi sur le site et les vérifications réalisées. Le détail de chaque visite figure sur son rapport d\'intervention. Les essais à la charge de l\'exploitant (essais périodiques de l\'éclairage de sécurité et de l\'alarme, exercices) se consignent à part.', { tone: 'muted' })

  f.section('Inventaire du matériel')
  const eq = [...equipment].sort((a, b) => String(a.itv_equipment_types?.name || '').localeCompare(String(b.itv_equipment_types?.name || ''), 'fr', { numeric: true }) || String(a.location || '').localeCompare(String(b.location || ''), 'fr', { numeric: true }))
  f.table(['Étiquette', 'Appareil', 'Emplacement', 'Année', 'Dernière vérif.', 'Prochaine'], eq.map((e) => [
    e.label_code, e.itv_equipment_types?.name || '', e.location || '', e.manufactured_year ? String(e.manufactured_year) : '',
    e.last_check_on ? frShort(e.last_check_on) : 'Jamais', e.status === 'a_remplacer' ? 'À remplacer' : frMonthYear(e.next_check_on),
  ]), { styles: { fontSize: 7.8 }, columnStyles: { 0: { cellWidth: 22 }, 3: { cellWidth: 14 }, 4: { cellWidth: 26 }, 5: { cellWidth: 24 } } })

  f.section('Visites réalisées')
  if (!visits.length) f.note('Aucune visite enregistrée.')
  const sorted = [...visits].sort((a, b) => String(b.started_at || b.planned_on || '').localeCompare(String(a.started_at || a.planned_on || '')))
  f.table(['Date', 'Référence', 'Résultats', 'Constats'], sorted.map((v) => {
    const s = summarize(v.items || [])
    const constats = (v.items || []).filter((i) => i.result && i.result !== 'conforme').map((i) => {
      const e = equipment.find((x) => x.id === i.equipment_id)
      return `${e?.label_code || ''} ${RESULT_LABEL[i.result].toLowerCase()}${i.defect ? ` (${i.defect})` : ''}`
    })
    return [
      frShort((v.started_at || v.planned_on || '').slice(0, 10)), v.reference || '',
      `${s.total} contrôlés, ${s.conforme} conformes${s.a_remplacer ? `, ${s.a_remplacer} à remplacer` : ''}${s.remplace ? `, ${s.remplace} remplacés` : ''}`,
      [...constats, ...(v.site_observations || [])].join('. ') || 'Aucun',
    ]
  }), { styles: { fontSize: 7.8 }, columnStyles: { 0: { cellWidth: 24 }, 1: { cellWidth: 26 }, 2: { cellWidth: 46 } } })

  if (settings?.report_mentions) f.callout('Informations', settings.report_mentions, { tone: 'muted' })
  f.finish()
  numberPages(doc, ORG)
  const safe = `${client?.name || ''}_${site?.name || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 50)
  return { doc, filename: `Registre_verifications_${safe}.pdf` }
}
