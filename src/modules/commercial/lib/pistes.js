// Pistes entre formation et maintenance (fonction 10, 0130) : préparation du devis d'une piste.
// Vers la formation : formations de la règle de l'obligation (catalogue), quantité = salariés du site sans formation
// valide (résumé de la base), à défaut un groupe ; prix du catalogue. Vers la maintenance : une ligne « contrat de
// maintenance » sans prix. Le devis reste un brouillon à relire ; la piste passe « en cours » et le garde.

import { supabase } from '../../../core/supabase'
import { computeDocumentTotals, lineTotal } from '../../../core/billing/totals'
import { chargerTarifs, tarifPour } from '../../../core/tarifs/tarifsClient'

const must = ({ data, error }) => { if (error) throw error; return data }
const todayIso = () => new Date().toISOString().slice(0, 10)

async function nextRef() {
  const ds = todayIso().replace(/-/g, '')
  const { data } = await supabase.from('quotes').select('reference').like('reference', 'DEV-%').order('reference', { ascending: false }).limit(1)
  let seq = 1
  const m = data?.[0]?.reference?.match(/-(\d+)$/)
  if (m) seq = parseInt(m[1], 10) + 1
  return `DEV-${ds}-${String(seq).padStart(5, '0')}`
}

async function nonFormes(lead) {
  // Salariés connus du site (ou du client) sans formation valide pour la règle : lu sur la vue des validités
  let q = supabase.from('trainees').select('id').eq('client_id', lead.client_id)
  if (lead.site_id) q = q.or(`site_id.eq.${lead.site_id},site_id.is.null`)
  const { data: tr } = await q
  const ids = (tr || []).map((t) => t.id)
  if (!ids.length || !lead.rule_id) return ids.length
  const { data: val } = await supabase.from('v_trainee_validities').select('trainee_id, echeance').eq('rule_id', lead.rule_id).in('trainee_id', ids)
  const today = todayIso()
  const ok = new Set((val || []).filter((v) => !v.echeance || v.echeance >= today).map((v) => v.trainee_id))
  return ids.filter((id) => !ok.has(id)).length
}

/** Prépare le brouillon de devis d'une piste et relie la piste ; renvoie le devis */
export async function preparerDevisPiste(lead) {
  const lines = []
  let object
  if (lead.direction === 'vers_formation') {
    const { data: rule } = lead.rule_id
      ? await supabase.from('obligation_rules').select('label, course_ids').eq('id', lead.rule_id).maybeSingle()
      : { data: null }
    const courseIds = rule?.course_ids || []
    const { data: courses } = courseIds.length
      ? await supabase.from('courses').select('id, title, code, price_ht, price_per_day, duration_days').in('id', courseIds)
      : { data: [] }
    const n = await nonFormes(lead)
    const c = (courses || [])[0]
    // Tarif du client (0418) : par personne (inter) ou par groupe (intra), avant le prix du catalogue
    const tarifs = await chargerTarifs(lead.client_id)
    if (c) {
      const t = tarifPour(tarifs, { kind: 'formation', course_id: c.id })
      const parPersonne = n > 0 && (Number(t?.prix_inter_ht) > 0 || (!(Number(t?.prix_ht) > 0) && Number(c.price_ht) > 0))
      const prixGroupe = Number(t?.prix_ht) > 0 ? Number(t.prix_ht) : Number(c.price_per_day || 0) * Number(c.duration_days || 1) || Number(c.price_ht || 0)
      lines.push({
        course_id: c.id, code: c.code || null, description_title: c.title,
        description_detail: n > 0 ? `${n} salarié${n > 1 ? 's' : ''} du site sans formation valide connue` : 'Un groupe',
        quantity: parPersonne ? n : 1, unit: parPersonne ? 'stagiaire' : 'groupe',
        unit_price_ht: parPersonne ? (Number(t?.prix_inter_ht) > 0 ? Number(t.prix_inter_ht) : Number(c.price_ht)) : prixGroupe,
        tva_rate: 20,
      })
      ;(courses || []).slice(1).forEach((o) => lines.push({ course_id: o.id, code: o.code || null, description_title: `Variante : ${o.title}`, description_detail: 'À garder ou retirer', quantity: 0, unit: 'groupe', unit_price_ht: Number(o.price_ht || 0), tva_rate: 20 }))
    } else {
      lines.push({ description_title: rule?.label || 'Formation sécurité incendie', description_detail: n > 0 ? `${n} salarié${n > 1 ? 's' : ''} du site` : 'Un groupe', quantity: 1, unit: 'groupe', unit_price_ht: 0, tva_rate: 20, metier: 'formation' })
    }
    object = `Formation ${rule?.label ? rule.label.toLowerCase() : 'sécurité incendie'}`
  } else {
    lines.push({ description_title: 'Contrat de maintenance du matériel de sécurité incendie', description_detail: 'Vérification annuelle des extincteurs et du matériel : nombre d\'appareils à préciser après inventaire', quantity: 1, unit: 'an', unit_price_ht: 0, tva_rate: 20, metier: 'maintenance' })
    object = 'Maintenance du matériel de sécurité incendie'
  }

  const { data: contact } = await supabase.from('client_contacts').select('id').eq('client_id', lead.client_id).order('is_primary', { ascending: false }).limit(1).maybeSingle()
  const t = computeDocumentTotals(lines)
  const d = new Date(); d.setDate(d.getDate() + 30)
  const q = must(await supabase.from('quotes').insert({
    reference: await nextRef(), client_id: lead.client_id, contact_id: contact?.id || null,
    quote_date: todayIso(), validity_date: d.toISOString().slice(0, 10), payment_deadline: null,
    object, status: 'draft', tva_rate: 20, tva_applicable: true, total_ht: t.taxBasis, total_tva: t.taxTotal, total_ttc: t.grandTotal,
  }).select().single())
  must(await supabase.from('quote_items').insert(lines.map((l, i) => ({ ...l, quote_id: q.id, position: i, total_ht: lineTotal(l) }))))
  must(await supabase.from('cross_sell_leads').update({ quote_id: q.id, status: 'en_cours' }).eq('id', lead.id))
  return q
}
