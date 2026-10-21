import { supabase } from '../supabase'

// Tarifs par client (0418) : saisis une fois dans la fiche client, repris dans les devis, les factures, les sessions
// et les visites. Le tarif du client passe avant celui de son groupe (même nom de groupe, « pour le groupe »), et un
// tarif échu ne s'applique plus. La base applique les mêmes règles (app.prix_client) pour ce qu'elle pose elle-même.

const aujourdhui = () => new Date().toISOString().slice(0, 10)

export function valide(t, jour = aujourdhui()) {
  return !t.valid_until || String(t.valid_until).slice(0, 10) >= jour
}

// Tarifs d'un client : les siens, puis ceux de son groupe marqués « pour le groupe ». [] si rien ou sans droit.
export async function chargerTarifs(clientId) {
  if (!clientId) return []
  const [{ data: propres, error }, { data: client }] = await Promise.all([
    supabase.from('client_prices').select('*').eq('client_id', clientId),
    supabase.from('clients').select('group_name').eq('id', clientId).maybeSingle(),
  ])
  if (error) return []
  let groupe = []
  const g = (client?.group_name || '').trim()
  if (g) {
    const { data } = await supabase.from('client_prices').select('*, clients!inner(group_name)')
      .eq('pour_le_groupe', true).ilike('clients.group_name', g).neq('client_id', clientId)
    groupe = (data || []).map((t) => ({ ...t, du_groupe: true }))
  }
  return [...(propres || []), ...groupe].filter((t) => valide(t))
}

// Le tarif qui s'applique (le sien d'abord)
export function tarifPour(tarifs, { kind, course_id = null, part_id = null, code = null }) {
  const ok = (tarifs || []).filter((t) => t.kind === kind
    && (!course_id || t.course_id === course_id) && (!part_id || t.part_id === part_id) && (!code || t.code === code))
  return ok.find((t) => !t.du_groupe) || ok[0] || null
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))

// Prix d'une formation pour ce client : intra (ligne de devis ou de facture, session) ou inter (par personne)
export function prixFormation(tarifs, course, mode = 'intra') {
  const t = course?.id ? tarifPour(tarifs, { kind: 'formation', course_id: course.id }) : null
  const p = t ? num(mode === 'inter' ? t.prix_inter_ht : t.prix_ht) : null
  return p !== null ? { prix: p, tarifClient: true, tarif: t } : { prix: num(course?.price_ht) || 0, tarifClient: false, tarif: null }
}

// Prix d'une pièce : prix négocié de la pièce, sinon remise du client sur les pièces, sinon catalogue
export function prixPiece(tarifs, part) {
  const t = part?.id ? tarifPour(tarifs, { kind: 'piece', part_id: part.id }) : null
  if (t && num(t.prix_ht) !== null) return { prix: num(t.prix_ht), tarifClient: true, tarif: t }
  const r = tarifPour(tarifs, { kind: 'remise_pieces' })
  const base = num(part?.price_ht) || 0
  if (r && num(r.remise_pct) !== null) return { prix: Math.round(base * (1 - num(r.remise_pct) / 100) * 100) / 100, tarifClient: true, tarif: r }
  return { prix: base, tarifClient: false, tarif: null }
}

// Prix d'un frais (déplacement, code de la ligne) ou du forfait de visite hors contrat
export function prixFrais(tarifs, code, prixCatalogue) {
  const t = code ? tarifPour(tarifs, { kind: 'deplacement', code }) : null
  return t && num(t.prix_ht) !== null ? { prix: num(t.prix_ht), tarifClient: true, tarif: t } : { prix: num(prixCatalogue) || 0, tarifClient: false, tarif: null }
}
export function prixVisite(tarifs, prixCatalogue) {
  const t = tarifPour(tarifs, { kind: 'visite' })
  return t && num(t.prix_ht) !== null ? { prix: num(t.prix_ht), tarifClient: true, tarif: t } : { prix: num(prixCatalogue) || 0, tarifClient: false, tarif: null }
}

// Une ligne de devis ou de facture est-elle au tarif du client ? (badge « tarif client »)
export function ligneAuTarif(tarifs, ligne) {
  const pu = num(ligne?.unit_price_ht)
  if (pu === null || !tarifs?.length) return false
  if (ligne.course_id) {
    const t = tarifPour(tarifs, { kind: 'formation', course_id: ligne.course_id })
    return !!t && (num(t.prix_ht) === pu || num(t.prix_inter_ht) === pu)
  }
  if (ligne.code) {
    const t = tarifPour(tarifs, { kind: 'deplacement', code: ligne.code })
    return !!t && num(t.prix_ht) === pu
  }
  return false
}

// Lignes à repasser au tarif d'un client (changement de client sur un devis ou une facture) : seulement les lignes
// restées au prix du catalogue, jamais un prix modifié à la main. Renvoie [lignes, nombre de lignes changées].
export function appliquerTarifs(tarifs, lignes, { courses = [], frais = [] } = {}) {
  let n = 0
  const out = (lignes || []).map((l) => {
    const pu = num(l.unit_price_ht)
    if (l.course_id) {
      const c = courses.find((x) => x.id === l.course_id)
      if (!c || pu !== (num(c.price_ht) || 0)) return l
      const p = prixFormation(tarifs, c)
      if (!p.tarifClient || p.prix === pu) return l
      n += 1
      return { ...l, unit_price_ht: p.prix }
    }
    if (l.code) {
      const f = frais.find((x) => x.code === l.code)
      if (!f || pu !== (num(f.unit_price_ht) || 0)) return l
      const p = prixFrais(tarifs, l.code, f.unit_price_ht)
      if (!p.tarifClient || p.prix === pu) return l
      n += 1
      return { ...l, unit_price_ht: p.prix }
    }
    return l
  })
  return [out, n]
}
