// Prévisionnel récurrent (fonction 12, 0150) : lecture de la vue v_recurring_revenue et regroupements.
// Aucun montant inventé : les échéances sans prix sont comptées à part.

import { supabase } from '../../../core/supabase'
import { fetchAll } from '../../../core/fetchAll'

export const NATURES = { formation: 'Formation', maintenance: 'Maintenance', contrat: 'Contrats' }

export async function chargerPrevisionnel() {
  const { data, error } = await fetchAll(() => supabase.from('v_recurring_revenue')
    .select('client_id, client_name, mois, nature, rule_id, label, nb_echeances, montant_attendu, nb_sans_prix, montant_devise, montant_planifie, nb_planifies, client_a_ne_pas_solliciter')
    .order('mois').order('client_name'), { orderBy: ['client_id', 'nature', 'label', 'rule_id'] })
  if (error) throw error
  return data || []
}

/** 12 mois à partir du mois en cours, avec les totaux par nature */
export function parMois(lignes, nature = '') {
  const d = new Date()
  const mois = Array.from({ length: 12 }, (_, i) => {
    const x = new Date(d.getFullYear(), d.getMonth() + i, 1)
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
  })
  const vide = () => ({ attendu: 0, devise: 0, planifie: 0, sansPrix: 0, echeances: 0, formation: 0, maintenance: 0, contrat: 0 })
  const m = Object.fromEntries(mois.map((k) => [k, vide()]))
  lignes.filter((l) => !nature || l.nature === nature).forEach((l) => {
    const k = String(l.mois).slice(0, 10)
    if (!m[k]) return
    const a = Number(l.montant_attendu) || 0
    m[k].attendu += a
    m[k].devise += Number(l.montant_devise) || 0
    m[k].planifie += Number(l.montant_planifie) || 0
    m[k].sansPrix += Number(l.nb_sans_prix) || 0
    m[k].echeances += Number(l.nb_echeances) || 0
    m[k][l.nature] = (m[k][l.nature] || 0) + a
  })
  return mois.map((k) => ({ mois: k, ...m[k] }))
}

export function totaux(lignes, nature = '') {
  return parMois(lignes, nature).reduce((t, x) => ({
    attendu: t.attendu + x.attendu, devise: t.devise + x.devise, planifie: t.planifie + x.planifie, sansPrix: t.sansPrix + x.sansPrix,
  }), { attendu: 0, devise: 0, planifie: 0, sansPrix: 0 })
}

export const euros = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} €`
export const libMois = (k, court = false) => new Date(`${k}T12:00:00`).toLocaleDateString('fr-FR', court ? { month: 'short' } : { month: 'long', year: 'numeric' })

/** Export tableur (CSV, séparateur point-virgule) */
export function exporterCsv(lignes) {
  const tete = ['Mois', 'Client', 'Nature', 'Objet', 'Échéances', 'Attendu HT', 'Déjà devisé HT', 'Planifié HT', 'Sans prix', 'Ne pas solliciter']
  const esc = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const num = (n) => String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',')
  const rows = lignes.map((l) => [String(l.mois).slice(0, 7), l.client_name, NATURES[l.nature] || l.nature, l.label, l.nb_echeances,
    num(l.montant_attendu), num(l.montant_devise), num(l.montant_planifie), l.nb_sans_prix, l.client_a_ne_pas_solliciter ? 'oui' : ''])
  const csv = '﻿' + [tete, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `previsionnel_${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
