// Module Stock, socle (0240) : mon stock (technicien, téléphone), articles, mouvements, alertes de réapprovisionnement,
// emplacements et fournisseurs. Les quantités sont calculées depuis les mouvements ; un mouvement ne se modifie pas
// (une erreur se corrige par un mouvement inverse). Chaque onglet suit les droits ; la base décide.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Pencil, Search, Package, ArrowDownToLine, ArrowUpFromLine, Undo2, AlertTriangle, Truck, MapPin, History, ShoppingCart, Trash2, Check, X, Send, PackageCheck, Mail } from 'lucide-react'
import { useAuthStore } from '../../../core/store'
import { PageHeader } from '../../../ui/PageHeader'
import { Tabs } from '../../../ui/Tabs'
import { Sheet } from '../../../ui/Sheet'
import { DataTable } from '../../../ui/DataTable'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { confirmer, demander } from '../../../ui/Confirm'
import {
  TYPES_MOUVEMENT, TYPES_EMPLACEMENT, qte, euros, chargerArticles, chargerCategories, chargerEmplacements,
  chargerFournisseurs, chargerNiveaux, chargerSeuils, chargerAlertes, chargerMouvements, chargerCouts, chargerValeur,
  chargerMonStock, chargerArticlesTerrain, chargerDepotsTerrain, enregistrerArticle, archiverArticle,
  enregistrerEmplacement, enregistrerFournisseur, archiverFournisseur, enregistrerSeuil, mouvement, indexerNiveaux,
  STATUTS_COMMANDE, chargerCommandes, chargerLignesCommande, chargerReceptions, creerCommande, commandeDepuisAlertes,
  enregistrerLigne, supprimerLigne, modifierCommande, supprimerCommande, soumettreCommande, commandeEnvoyee, annulerCommande,
  deciderCommande, recevoirLigne,
} from '../lib/stockData'

const frDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '')

function Champ({ label, children, aide = null, className = '' }) {
  return <label className={`block ${className}`}><span className="label">{label}</span>{children}{aide && <span className="block text-ui-sm muted mt-0.5">{aide}</span>}</label>
}

// ─── Mon stock (technicien) ───
function GesteSheet({ geste, monEmplacement, onClose, onSaved }) {
  const [articles, setArticles] = useState([])
  const [depots, setDepots] = useState([])
  const [v, setV] = useState({ itemId: geste.itemId || '', depot: '', quantity: '1', note: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    Promise.all([chargerArticlesTerrain(), chargerDepotsTerrain()]).then(([a, d]) => { setArticles(a); setDepots(d); setV((x) => ({ ...x, depot: d[0]?.id || '' })) }).catch((e) => toast.error(e.message))
  }, [])
  const titres = { prendre: 'Prendre au dépôt', rendre: 'Rendre au dépôt', utiliser: 'Utilisé ou perdu' }
  const valider = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (geste.kind === 'prendre') await mouvement({ kind: 'transfert', itemId: v.itemId, quantity: v.quantity, from: v.depot, to: monEmplacement, note: v.note })
      else if (geste.kind === 'rendre') await mouvement({ kind: 'retour', itemId: v.itemId, quantity: v.quantity, from: monEmplacement, to: v.depot, note: v.note })
      else await mouvement({ kind: 'perte', itemId: v.itemId, quantity: v.quantity, from: monEmplacement, note: v.note || 'Utilisé hors visite' })
      toast.success('Enregistré')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={titres[geste.kind]} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="stock-geste" className="btn btn-primary" disabled={busy || !v.itemId}>Valider</button></>}>
      <form id="stock-geste" onSubmit={valider} className="space-y-3">
        <Champ label="Article">
          <select className="select" required value={v.itemId} onChange={(e) => setV({ ...v, itemId: e.target.value })}>
            <option value="">Choisir…</option>
            {articles.map((a) => <option key={a.id} value={a.id}>{a.label}{a.reference ? ` (${a.reference})` : ''}</option>)}
          </select>
        </Champ>
        {geste.kind !== 'utiliser' && (
          <Champ label={geste.kind === 'prendre' ? 'Pris au dépôt' : 'Rendu au dépôt'}>
            <select className="select" required value={v.depot} onChange={(e) => setV({ ...v, depot: e.target.value })}>{depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </Champ>
        )}
        <Champ label="Quantité"><input className="input" inputMode="decimal" required value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} /></Champ>
        <Champ label="Note (facultatif)"><input className="input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder={geste.kind === 'utiliser' ? 'Chantier, casse…' : ''} /></Champ>
        {geste.kind === 'utiliser' && <p className="text-ui-sm muted">Les pièces notées dans une visite sortent toutes seules à la clôture : ce geste sert pour le reste.</p>}
      </form>
    </Sheet>
  )
}

function MonStock() {
  const [lignes, setLignes] = useState(null)
  const [geste, setGeste] = useState(null)
  const charger = useCallback(() => { chargerMonStock().then(setLignes).catch((e) => { toast.error(e.message); setLignes([]) }) }, [])
  useEffect(() => { charger() }, [charger])
  if (!lignes) return <Spinner />
  const emplacement = lignes[0]?.location_id || null
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <button type="button" className="btn btn-primary h-auto py-3 flex-col" onClick={() => setGeste({ kind: 'prendre' })}><ArrowDownToLine className="w-5 h-5" aria-hidden="true" />Prendre</button>
        <button type="button" className="btn btn-secondary h-auto py-3 flex-col" onClick={() => setGeste({ kind: 'rendre' })} disabled={!lignes.length}><Undo2 className="w-5 h-5" aria-hidden="true" />Rendre</button>
        <button type="button" className="btn btn-secondary h-auto py-3 flex-col" onClick={() => setGeste({ kind: 'utiliser' })} disabled={!lignes.length}><ArrowUpFromLine className="w-5 h-5" aria-hidden="true" />Utilisé</button>
      </div>
      {lignes.length === 0 ? (
        <EmptyState icon={Package} title="Votre stock est vide" compact>Prenez des articles au dépôt : ils apparaissent ici. Les pièces notées dans vos visites sortent toutes seules à la clôture.</EmptyState>
      ) : (
        <ul className="card card-flush divide-y divide-gray-100">
          {lignes.map((l) => (
            <li key={l.item_id} className="px-4 py-3 flex items-center gap-3">
              <span className="flex-1 min-w-0"><span className="block font-semibold text-ui">{l.label}</span>{l.reference && <span className="block text-ui-sm text-gray-500">{l.reference}</span>}</span>
              <span className={`text-ui font-semibold tabular-nums ${Number(l.quantity) < 0 ? 'text-[rgb(var(--c-danger))]' : ''}`}>{qte(l.quantity)} {l.unit}</span>
            </li>
          ))}
        </ul>
      )}
      {lignes.some((l) => Number(l.quantity) < 0) && <p className="text-ui-sm text-[rgb(var(--c-danger))]">Une quantité négative signale une sortie sans prise au dépôt : prévenez le responsable du stock pour corriger.</p>}
      {geste && <GesteSheet geste={geste} monEmplacement={emplacement} onClose={() => setGeste(null)} onSaved={() => { setGeste(null); charger() }} />}
    </div>
  )
}

// ─── Articles ───
function ArticleSheet({ article, categories, fournisseurs, voirPrix, onClose, onSaved }) {
  const [v, setV] = useState(() => ({ label: '', reference: '', supplier_reference: '', category_id: '', unit: 'unité', sale_price_ht: '', supplier_id: '', barcode: '', serialized: false, consumable: true, ...(article || {}), achat: article?.achat ?? '' }))
  const [busy, setBusy] = useState(false)
  const m = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const enregistrer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { achat, quantite: _q, ...a } = v
      await enregistrerArticle({ ...a, category_id: a.category_id || null, supplier_id: a.supplier_id || null }, voirPrix ? achat : undefined)
      toast.success('Article enregistré')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  return (
    <Sheet title={article?.id ? 'Modifier l\'article' : 'Nouvel article'} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="stock-article" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="stock-article" onSubmit={enregistrer} className="space-y-3">
        <Champ label="Désignation"><input className="input" required value={v.label} onChange={m('label')} placeholder="Extincteur eau pulvérisée 6 L" /></Champ>
        <div className="grid gap-3 sm:grid-cols-2">
          <Champ label="Référence interne"><input className="input" value={v.reference || ''} onChange={m('reference')} /></Champ>
          <Champ label="Référence fournisseur"><input className="input" value={v.supplier_reference || ''} onChange={m('supplier_reference')} /></Champ>
          <Champ label="Catégorie">
            <select className="select" value={v.category_id || ''} onChange={m('category_id')}><option value="">Aucune</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Champ>
          <Champ label="Unité"><input className="input" value={v.unit} onChange={m('unit')} /></Champ>
          <Champ label="Fournisseur principal">
            <select className="select" value={v.supplier_id || ''} onChange={m('supplier_id')}><option value="">Aucun</option>{fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
          </Champ>
          <Champ label="Prix de vente HT" aide="Repris dans les devis et les factures"><input className="input" inputMode="decimal" value={v.sale_price_ht ?? ''} onChange={m('sale_price_ht')} /></Champ>
          {voirPrix && <Champ label="Prix d'achat HT" aide="Visible seulement avec le droit « Voir les prix d'achat »"><input className="input" inputMode="decimal" value={v.achat ?? ''} onChange={m('achat')} /></Champ>}
          <Champ label="Code-barres ou QR"><input className="input" value={v.barcode || ''} onChange={m('barcode')} /></Champ>
        </div>
        {article?.id && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={async () => { try { await archiverArticle(article.id, !article.is_active); toast.success(article.is_active ? 'Article archivé' : 'Article réactivé'); onSaved() } catch (err) { toast.error(err.message) } }}>
            {article.is_active ? 'Archiver l\'article (il ne se propose plus)' : 'Réactiver l\'article'}
          </button>
        )}
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={!!v.consumable} onChange={m('consumable')} /><span className="text-ui">Consommable</span></label>
          <label className="flex items-center gap-2 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={!!v.serialized} onChange={m('serialized')} /><span className="text-ui">Suivi par numéro de série</span></label>
        </div>
      </form>
    </Sheet>
  )
}

function MouvementSheet({ article, emplacements, onClose, onSaved }) {
  const actifs = emplacements.filter((l) => l.is_active)
  const [v, setV] = useState({ kind: 'entree', quantity: '', from: '', to: actifs.find((l) => l.kind === 'depot')?.id || '', note: '', unitCost: '', sens: 'plus' })
  const [busy, setBusy] = useState(false)
  const k = v.kind
  const besoinDe = ['sortie', 'perte', 'transfert', 'retour'].includes(k) || (k === 'ajustement' && v.sens === 'moins')
  const besoinVers = ['entree', 'transfert', 'retour'].includes(k) || (k === 'ajustement' && v.sens === 'plus')
  const valider = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await mouvement({ kind: k, itemId: article.id, quantity: v.quantity, from: besoinDe ? v.from : null, to: besoinVers ? v.to : null, note: v.note, unitCost: k === 'entree' ? v.unitCost : null })
      toast.success('Mouvement enregistré')
      onSaved()
    } catch (err) { toast.error(err.message) }
    setBusy(false)
  }
  const choix = (val, set, label) => (
    <Champ label={label}>
      <select className="select" required value={val} onChange={(e) => set(e.target.value)}><option value="">Choisir…</option>{actifs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
    </Champ>
  )
  return (
    <Sheet title={`Mouvement : ${article.label}`} onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="stock-mvt" className="btn btn-primary" disabled={busy}>Enregistrer</button></>}>
      <form id="stock-mvt" onSubmit={valider} className="space-y-3">
        <Champ label="Type" aide={TYPES_MOUVEMENT[k].aide}>
          <select className="select" value={k} onChange={(e) => setV({ ...v, kind: e.target.value })}>{Object.entries(TYPES_MOUVEMENT).map(([key, t]) => <option key={key} value={key}>{t.label}</option>)}</select>
        </Champ>
        {k === 'ajustement' && (
          <div className="flex gap-4">
            <label className="flex items-center gap-2"><input type="radio" checked={v.sens === 'plus'} onChange={() => setV({ ...v, sens: 'plus' })} />En plus</label>
            <label className="flex items-center gap-2"><input type="radio" checked={v.sens === 'moins'} onChange={() => setV({ ...v, sens: 'moins' })} />En moins</label>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {besoinDe && choix(v.from, (x) => setV({ ...v, from: x }), 'Depuis')}
          {besoinVers && choix(v.to, (x) => setV({ ...v, to: x }), 'Vers')}
          <Champ label={`Quantité (${article.unit})`}><input className="input" inputMode="decimal" required value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} /></Champ>
          {k === 'entree' && <Champ label="Prix d'achat unitaire HT" aide="Sert à la valeur du stock (coût moyen)"><input className="input" inputMode="decimal" value={v.unitCost} onChange={(e) => setV({ ...v, unitCost: e.target.value })} /></Champ>}
        </div>
        <Champ label="Note"><input className="input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="Bon de livraison, chantier…" /></Champ>
        <p className="text-ui-sm muted">Un mouvement ne se modifie pas : une erreur se corrige par un mouvement inverse.</p>
      </form>
    </Sheet>
  )
}

function DetailArticle({ article, emplacements, niveaux, seuils, peutGerer, onClose, onChange }) {
  const [hist, setHist] = useState(null)
  const [edition, setEdition] = useState({})
  useEffect(() => { chargerMouvements({ itemId: article.id, limite: 50 }).then(setHist).catch(() => setHist([])) }, [article.id])
  const nom = Object.fromEntries(emplacements.map((l) => [l.id, l.name]))
  const seuil = (loc) => seuils.find((s) => s.item_id === article.id && s.location_id === loc)
  const enregistrer = async (loc) => {
    const e = edition[loc]
    try { await enregistrerSeuil({ item_id: article.id, location_id: loc, min_qty: e.min, target_qty: e.cible }); toast.success('Seuil enregistré'); setEdition({ ...edition, [loc]: undefined }); onChange() } catch (err) { toast.error(err.message) }
  }
  return (
    <Sheet title={article.label} onClose={onClose} size="lg">
      <div className="space-y-4">
        <section className="space-y-2">
          <h3 className="font-semibold text-ui">Quantités et seuils par emplacement</h3>
          <ul className="divide-y divide-gray-100">
            {emplacements.filter((l) => l.is_active).map((l) => {
              const q = niveaux.parCouple[`${article.id}:${l.id}`] || 0
              const s = seuil(l.id)
              const e = edition[l.id]
              return (
                <li key={l.id} className="py-2 flex flex-wrap items-center gap-3">
                  <span className="flex-1 min-w-[10rem] text-ui">{l.name}<span className="block text-ui-sm text-gray-500">{TYPES_EMPLACEMENT[l.kind]}</span></span>
                  <span className={`font-semibold tabular-nums ${s && q < s.min_qty ? 'text-[rgb(var(--c-danger))]' : ''}`}>{qte(q)} {article.unit}</span>
                  {e ? (
                    <span className="flex items-center gap-1">
                      <input className="input w-20" inputMode="decimal" value={e.min} onChange={(ev) => setEdition({ ...edition, [l.id]: { ...e, min: ev.target.value } })} aria-label="Seuil minimal" />
                      <input className="input w-20" inputMode="decimal" value={e.cible} onChange={(ev) => setEdition({ ...edition, [l.id]: { ...e, cible: ev.target.value } })} aria-label="Quantité cible" placeholder="Cible" />
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => enregistrer(l.id)}>OK</button>
                    </span>
                  ) : (
                    <span className="text-ui-sm text-gray-600">{s ? `seuil ${qte(s.min_qty)}${s.target_qty != null ? `, cible ${qte(s.target_qty)}` : ''}` : 'sans seuil'}
                      {peutGerer && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdition({ ...edition, [l.id]: { min: s?.min_qty ?? '', cible: s?.target_qty ?? '' } })}>Régler</button>}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold text-ui flex items-center gap-2"><History className="w-4 h-4 text-gray-400" aria-hidden="true" />Derniers mouvements</h3>
          {hist === null ? <Spinner /> : hist.length === 0 ? <p className="text-ui-sm muted">Aucun mouvement.</p> : (
            <ul className="text-ui-sm divide-y divide-gray-100">
              {hist.map((h) => (
                <li key={h.id} className="py-1.5 flex flex-wrap gap-x-3">
                  <span className="text-gray-500 w-32">{frDate(h.created_at)}</span>
                  <span className="font-medium">{TYPES_MOUVEMENT[h.kind]?.label} {qte(h.quantity)}</span>
                  <span className="text-gray-600">{[h.from_location_id && nom[h.from_location_id], h.to_location_id && nom[h.to_location_id]].filter(Boolean).join(' → ')}</span>
                  {h.note && <span className="text-gray-500">{h.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Sheet>
  )
}

function Articles({ peutGerer, voirPrix }) {
  const [d, setD] = useState(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [edite, setEdite] = useState(null)
  const [mvt, setMvt] = useState(null)
  const [detail, setDetail] = useState(null)
  const charger = useCallback(async () => {
    try {
      const [articles, categories, emplacements, fournisseurs, niveaux, seuils, couts, valeur] = await Promise.all([
        chargerArticles(), chargerCategories(), chargerEmplacements(), chargerFournisseurs(), chargerNiveaux(), chargerSeuils(),
        voirPrix ? chargerCouts() : [], voirPrix ? chargerValeur() : [],
      ])
      setD({ articles, categories, emplacements, fournisseurs, niveaux: indexerNiveaux(niveaux), seuils, couts: Object.fromEntries(couts.map((c) => [c.item_id, c.purchase_price_ht])), valeur })
    } catch (e) { toast.error(e.message); setD({ articles: [], categories: [], emplacements: [], fournisseurs: [], niveaux: indexerNiveaux([]), seuils: [], couts: {}, valeur: [] }) }
  }, [voirPrix])
  useEffect(() => { charger() }, [charger])
  const visibles = useMemo(() => (d?.articles || []).filter((a) => (!cat || a.category_id === cat)
    && (!q || `${a.label} ${a.reference || ''} ${a.supplier_reference || ''} ${a.barcode || ''}`.toLowerCase().includes(q.toLowerCase()))), [d, q, cat])
  if (!d) return <Spinner />
  const total = d.valeur.reduce((t, x) => t + Number(x.value || 0), 0)
  const colonnes = [
    { key: 'label', label: 'Article', mobile: 'title', render: (a) => <span className={a.is_active ? '' : 'text-gray-400 line-through'}>{a.label}</span> },
    { key: 'reference', label: 'Référence', mobile: 'subtitle', render: (a) => a.reference || '' },
    { key: 'cat', label: 'Catégorie', render: (a) => a.stock_categories?.name || '' },
    { key: 'qte', label: 'En stock', align: 'right', mobile: 'aside', render: (a) => `${qte(d.niveaux.parArticle[a.id] || 0)} ${a.unit}` },
    { key: 'vente', label: 'Prix de vente', align: 'right', render: (a) => euros(a.sale_price_ht) },
    ...(voirPrix ? [{ key: 'achat', label: 'Prix d\'achat', align: 'right', render: (a) => euros(d.couts[a.id]) }] : []),
    ...(peutGerer ? [{ key: 'actions', label: '', mobile: 'meta', render: (a) => (
      <span className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMvt(a)}>Mouvement</button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${a.label}`} onClick={() => setEdite({ ...a, achat: d.couts[a.id] ?? '' })}><Pencil className="w-4 h-4" /></button>
      </span>
    ) }] : []),
  ]
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input className="input pl-9" placeholder="Désignation, référence, code-barres" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        </div>
        <select className="select w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Catégorie"><option value="">Toutes les catégories</option>{d.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {peutGerer && <button type="button" className="btn btn-primary" onClick={() => setEdite({})}><Plus className="w-4 h-4" aria-hidden="true" />Nouvel article</button>}
      </div>
      {voirPrix && d.valeur.length > 0 && <p className="text-ui-sm text-gray-600">Valeur du stock (coût moyen pondéré) : <span className="font-semibold">{euros(total)}</span></p>}
      <DataTable columns={colonnes} rows={visibles} onRowClick={(a) => setDetail(a)}
        empty={<EmptyState icon={Package} title={d.articles.length ? 'Aucun article ne correspond' : 'Aucun article'} compact>{d.articles.length ? 'Changez la recherche.' : 'Créez vos articles : pièces, extincteurs neufs, consommables, EPI.'}</EmptyState>} />
      {edite && <ArticleSheet article={edite.id ? edite : null} categories={d.categories} fournisseurs={d.fournisseurs} voirPrix={voirPrix} onClose={() => setEdite(null)} onSaved={() => { setEdite(null); charger() }} />}
      {mvt && <MouvementSheet article={mvt} emplacements={d.emplacements} onClose={() => setMvt(null)} onSaved={() => { setMvt(null); charger() }} />}
      {detail && <DetailArticle article={detail} emplacements={d.emplacements} niveaux={d.niveaux} seuils={d.seuils} peutGerer={peutGerer} onClose={() => setDetail(null)} onChange={charger} />}
    </div>
  )
}

// ─── Mouvements ───
function Journal() {
  const [d, setD] = useState(null)
  useEffect(() => {
    Promise.all([chargerMouvements({ limite: 300 }), chargerArticles(), chargerEmplacements()])
      .then(([m, a, l]) => setD({ m, art: Object.fromEntries(a.map((x) => [x.id, x])), loc: Object.fromEntries(l.map((x) => [x.id, x.name])) }))
      .catch((e) => { toast.error(e.message); setD({ m: [], art: {}, loc: {} }) })
  }, [])
  if (!d) return <Spinner />
  return (
    <DataTable rows={d.m} columns={[
      { key: 'date', label: 'Date', mobile: 'subtitle', render: (m) => frDate(m.created_at) },
      { key: 'type', label: 'Type', mobile: 'aside', render: (m) => TYPES_MOUVEMENT[m.kind]?.label },
      { key: 'article', label: 'Article', mobile: 'title', render: (m) => d.art[m.item_id]?.label || '' },
      { key: 'qte', label: 'Quantité', align: 'right', render: (m) => `${qte(m.quantity)} ${d.art[m.item_id]?.unit || ''}` },
      { key: 'trajet', label: 'De → vers', render: (m) => [m.from_location_id && d.loc[m.from_location_id], m.to_location_id && d.loc[m.to_location_id]].filter(Boolean).join(' → ') },
      { key: 'note', label: 'Note', render: (m) => m.note || (m.source_table === 'itv_visit_parts' ? 'Visite d\'intervention' : '') },
    ]} empty={<EmptyState icon={History} title="Aucun mouvement" compact>Les entrées, sorties et transferts s'affichent ici, du plus récent au plus ancien.</EmptyState>} />
  )
}

// ─── Alertes ───
function Alertes({ peutCommander = false, onCommande = null }) {
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    Promise.all([chargerAlertes(), chargerArticles(), chargerEmplacements()])
      .then(([al, a, l]) => setD({ al, art: Object.fromEntries(a.map((x) => [x.id, x])), loc: Object.fromEntries(l.map((x) => [x.id, x.name])) }))
      .catch((e) => { toast.error(e.message); setD({ al: [], art: {}, loc: {} }) })
  }, [])
  if (!d) return <Spinner />
  if (!d.al.length) return <EmptyState icon={AlertTriangle} title="Aucun article sous le seuil" compact>Réglez un seuil sur un article (fiche de l'article) : il apparaîtra ici quand le stock passera dessous.</EmptyState>
  const parFournisseur = {}
  for (const a of d.al) {
    const art = d.art[a.item_id]
    const cle = art?.supplier_id || ''
    ;(parFournisseur[cle] ||= { nom: art?.suppliers?.name || 'Sans fournisseur', lignes: [] }).lignes.push(a)
  }
  const preparer = async (fournisseur) => {
    setBusy(true)
    try { const id = await commandeDepuisAlertes(fournisseur); toast.success('Commande préparée'); onCommande?.(id) } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return (
    <div className="space-y-3">
      {Object.entries(parFournisseur).map(([fid, { nom: f, lignes }]) => (
        <section key={fid || 'aucun'} className="card space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="section-title flex items-center gap-2 flex-1 min-w-0"><Truck className="w-4 h-4 text-gray-400" aria-hidden="true" />{f}</h2>
            {peutCommander && fid && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => preparer(fid)}><ShoppingCart className="w-4 h-4" aria-hidden="true" />Préparer la commande</button>}
          </div>
          {!fid && <p className="text-ui-sm muted">Indiquez le fournisseur principal sur ces articles pour pouvoir les commander.</p>}
          <ul className="divide-y divide-gray-100">
            {lignes.map((a) => (
              <li key={`${a.item_id}-${a.location_id}`} className="py-2 flex flex-wrap items-center gap-3">
                <span className="flex-1 min-w-[10rem] text-ui font-semibold">{d.art[a.item_id]?.label}<span className="block text-ui-sm text-gray-500 font-normal">{d.loc[a.location_id]}</span></span>
                <span className="text-ui-sm text-gray-600">en stock {qte(a.quantity)}, seuil {qte(a.min_qty)}</span>
                <span className="badge badge-warning">à commander : {qte(a.to_order)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// ─── Commandes ───
function NouvelleCommandeSheet({ onClose, onCree }) {
  const [f, setF] = useState(null)
  const [dep, setDep] = useState([])
  const [v, setV] = useState({ supplierId: '', locationId: '', notes: '' })
  useEffect(() => {
    Promise.all([chargerFournisseurs(), chargerEmplacements()]).then(([fs, ls]) => {
      setF(fs); const d = ls.filter((l) => l.is_active && l.kind === 'depot'); setDep(d); setV((x) => ({ ...x, locationId: d[0]?.id || '' }))
    }).catch((e) => toast.error(e.message))
  }, [])
  const valider = async (e) => {
    e.preventDefault()
    try { onCree(await creerCommande(v)) } catch (err) { toast.error(err.message) }
  }
  return (
    <Sheet title="Nouvelle commande" onClose={onClose}
      footer={<><button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button><button type="submit" form="stock-cmd" className="btn btn-primary" disabled={!v.supplierId}>Créer</button></>}>
      {!f ? <Spinner /> : f.length === 0 ? <p className="text-ui">Ajoutez d'abord un fournisseur (onglet Fournisseurs).</p> : (
        <form id="stock-cmd" onSubmit={valider} className="space-y-3">
          <Champ label="Fournisseur"><select className="select" required value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}><option value="">Choisir…</option>{f.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Champ>
          <Champ label="Livrée au dépôt"><select className="select" value={v.locationId} onChange={(e) => setV({ ...v, locationId: e.target.value })}>{dep.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Champ>
          <Champ label="Note (facultatif)"><input className="input" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Champ>
        </form>
      )}
    </Sheet>
  )
}

function DetailCommande({ commande, voirPrix, peutPreparer, peutValider, emplacements, onClose, onChange }) {
  const [lignes, setLignes] = useState(null)
  const [recs, setRecs] = useState([])
  const [articles, setArticles] = useState([])
  const [nouvelle, setNouvelle] = useState(null)
  const [recep, setRecep] = useState({})
  const [lieu, setLieu] = useState(commande.location_id || '')
  const [fact, setFact] = useState({ supplier_invoice_ref: commande.supplier_invoice_ref || '', supplier_invoice_on: commande.supplier_invoice_on || '', supplier_invoice_ht: commande.supplier_invoice_ht ?? '' })
  const [busy, setBusy] = useState(false)
  const c = commande
  const editable = peutPreparer && ['brouillon', 'refusee'].includes(c.status)
  const recevable = peutPreparer && ['validee', 'envoyee', 'partielle'].includes(c.status)
  const charger = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([chargerLignesCommande(c.id), chargerReceptions(c.id)])
      setLignes(l); setRecs(r)
    } catch (e) { toast.error(e.message); setLignes([]) }
  }, [c.id])
  useEffect(() => { charger() }, [charger])
  useEffect(() => { if (editable) chargerArticles().then((a) => setArticles(a.filter((x) => x.is_active))).catch(() => {}) }, [editable])
  const agir = async (fn, ok) => {
    setBusy(true)
    try { await fn(); if (ok) toast.success(ok); await charger(); onChange() } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const ajouter = (e) => {
    e.preventDefault()
    const art = articles.find((a) => a.id === nouvelle.item_id)
    agir(async () => { await enregistrerLigne({ ...nouvelle, order_id: c.id, unit_price_ht: voirPrix ? nouvelle.unit_price_ht : null }); setNouvelle(null) }, art ? `${art.label} ajouté` : null)
  }
  const refuser = async () => {
    const motif = await demander('Motif du refus (il sera lu par qui a préparé la commande)', { title: 'Refuser la commande' })
    if (motif == null) return
    if (!motif.trim()) { toast.error('Un refus demande un motif'); return }
    agir(() => deciderCommande(c.approval_id, 'rejected', motif.trim()), 'Commande refusée')
  }
  const recevoirTout = () => agir(async () => {
    for (const l of lignes) {
      const reste = Number(l.quantity) - Number(l.received_qty)
      if (reste > 0) await recevoirLigne({ lineId: l.id, quantity: reste, locationId: lieu })
    }
  }, 'Commande reçue, stock mis à jour')
  const ecart = fact.supplier_invoice_ht !== '' && voirPrix ? Number(String(fact.supplier_invoice_ht).replace(',', '.')) - Number(c.total_ht) : null
  const texteEmail = () => {
    const corps = [`Bonjour,`, '', `Merci de nous livrer la commande ${c.reference} :`, ...(lignes || []).map((l) => `- ${qte(l.quantity)} ${l.stock_items?.unit || ''} ${l.stock_items?.label || ''}${l.stock_items?.reference ? ` (réf. ${l.stock_items.reference})` : ''}`), '', `Livraison : ${c.stock_locations?.name || ''}`, '', 'Cordialement']
    return `mailto:${encodeURIComponent(c.suppliers?.email || '')}?subject=${encodeURIComponent(`Commande ${c.reference}`)}&body=${encodeURIComponent(corps.join('\n'))}`
  }
  const st = STATUTS_COMMANDE[c.status]
  return (
    <Sheet title={`Commande ${c.reference}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-ui">
          <span className={`badge ${st.badge}`}>{st.label}</span>
          <span className="font-semibold">{c.suppliers?.name}</span>
          <span className="text-gray-600">· livrée à {c.stock_locations?.name || 'dépôt à choisir'}</span>
          {voirPrix && <span className="ml-auto font-semibold tabular-nums">{euros(c.total_ht)} HT</span>}
        </div>
        {c.status === 'refusee' && c.refusal_reason && <p className="text-ui-sm text-[rgb(var(--c-danger))]">Refusée : {c.refusal_reason}. Corrigez puis soumettez de nouveau.</p>}
        {c.notes && <p className="text-ui-sm text-gray-600">{c.notes}</p>}

        <section className="space-y-2">
          <h3 className="font-semibold text-ui">Lignes</h3>
          {lignes === null ? <Spinner /> : lignes.length === 0 ? <p className="text-ui-sm muted">Aucune ligne.</p> : (
            <ul className="divide-y divide-gray-100">
              {lignes.map((l) => {
                const reste = Number(l.quantity) - Number(l.received_qty)
                return (
                  <li key={l.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="flex-1 min-w-[10rem] text-ui">{l.stock_items?.label}{l.stock_items?.reference && <span className="block text-ui-sm text-gray-500">{l.stock_items.reference}</span>}</span>
                    <span className="tabular-nums text-ui">{qte(l.quantity)} {l.stock_items?.unit}</span>
                    {voirPrix && <span className="tabular-nums text-ui-sm text-gray-600 w-24 text-right">{l.unit_price_ht == null ? 'prix à saisir' : euros(l.unit_price_ht)}</span>}
                    {Number(l.received_qty) > 0 && <span className="text-ui-sm text-gray-600">reçu {qte(l.received_qty)}</span>}
                    {editable && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${l.stock_items?.label}`} onClick={() => setNouvelle({ id: l.id, item_id: l.item_id, quantity: String(l.quantity), unit_price_ht: l.unit_price_ht ?? '' })}><Pencil className="w-4 h-4" /></button>}
                    {editable && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Retirer ${l.stock_items?.label}`} onClick={() => agir(() => supprimerLigne(l.id))}><Trash2 className="w-4 h-4" /></button>}
                    {recevable && reste > 0 && (
                      <span className="flex items-center gap-1">
                        <input className="input w-20" inputMode="decimal" aria-label="Quantité reçue" placeholder={qte(reste)} value={recep[l.id] ?? ''} onChange={(e) => setRecep({ ...recep, [l.id]: e.target.value })} />
                        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => agir(async () => { await recevoirLigne({ lineId: l.id, quantity: recep[l.id] || reste, locationId: lieu }); setRecep({ ...recep, [l.id]: '' }) }, 'Réception enregistrée')}>Reçu</button>
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {editable && !nouvelle && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNouvelle({ item_id: '', quantity: '1', unit_price_ht: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter un article</button>}
          {editable && nouvelle && (
            <form onSubmit={ajouter} className="grid gap-2 sm:grid-cols-[1fr_6rem_7rem_auto] items-end">
              <Champ label="Article"><select className="select" required value={nouvelle.item_id} disabled={!!nouvelle.id} onChange={(e) => setNouvelle({ ...nouvelle, item_id: e.target.value })}><option value="">Choisir…</option>{articles.map((a) => <option key={a.id} value={a.id}>{a.label}{a.reference ? ` (${a.reference})` : ''}</option>)}</select></Champ>
              <Champ label="Quantité"><input className="input" inputMode="decimal" required value={nouvelle.quantity} onChange={(e) => setNouvelle({ ...nouvelle, quantity: e.target.value })} /></Champ>
              {voirPrix ? <Champ label="Prix HT"><input className="input" inputMode="decimal" value={nouvelle.unit_price_ht} onChange={(e) => setNouvelle({ ...nouvelle, unit_price_ht: e.target.value })} /></Champ> : <span />}
              <div className="flex gap-1"><button type="submit" className="btn btn-primary btn-sm" disabled={busy}>OK</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setNouvelle(null)}>Annuler</button></div>
            </form>
          )}
        </section>

        {recevable && (
          <section className="space-y-2">
            <Champ label="Emplacement de réception">
              <select className="select" value={lieu} onChange={(e) => setLieu(e.target.value)}>{emplacements.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            </Champ>
            <button type="button" className="btn btn-primary" disabled={busy || !lignes?.length} onClick={recevoirTout}><PackageCheck className="w-4 h-4" aria-hidden="true" />Tout est arrivé</button>
            <p className="text-ui-sm muted">Chaque réception entre en stock au prix de la ligne. Une livraison incomplète : notez la quantité reçue sur la ligne.</p>
          </section>
        )}

        {recs.length > 0 && (
          <section className="space-y-1">
            <h3 className="font-semibold text-ui">Réceptions</h3>
            <ul className="text-ui-sm text-gray-600">
              {recs.map((r) => <li key={r.id}>{frDate(r.received_at)} : {qte(r.quantity)} {lignes?.find((l) => l.id === r.line_id)?.stock_items?.label || ''}</li>)}
            </ul>
          </section>
        )}

        {voirPrix && ['envoyee', 'partielle', 'recue'].includes(c.status) && (
          <section className="space-y-2">
            <h3 className="font-semibold text-ui">Facture du fournisseur</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <Champ label="Numéro"><input className="input" value={fact.supplier_invoice_ref} onChange={(e) => setFact({ ...fact, supplier_invoice_ref: e.target.value })} /></Champ>
              <Champ label="Date"><input className="input" type="date" value={fact.supplier_invoice_on} onChange={(e) => setFact({ ...fact, supplier_invoice_on: e.target.value })} /></Champ>
              <Champ label="Montant HT"><input className="input" inputMode="decimal" value={fact.supplier_invoice_ht} onChange={(e) => setFact({ ...fact, supplier_invoice_ht: e.target.value })} /></Champ>
            </div>
            {ecart != null && !Number.isNaN(ecart) && <p className={`text-ui-sm ${Math.abs(ecart) > 0.009 ? 'text-[rgb(var(--c-danger))]' : 'text-gray-600'}`}>{Math.abs(ecart) > 0.009 ? `Écart avec la commande : ${euros(ecart)}` : 'Conforme à la commande'}</p>}
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => agir(() => modifierCommande(c.id, {
              supplier_invoice_ref: fact.supplier_invoice_ref.trim() || null, supplier_invoice_on: fact.supplier_invoice_on || null,
              supplier_invoice_ht: fact.supplier_invoice_ht === '' ? null : Number(String(fact.supplier_invoice_ht).replace(',', '.')),
            }), 'Facture rapprochée')}>Enregistrer la facture</button>
          </section>
        )}

        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
          {editable && <button type="button" className="btn btn-primary" disabled={busy || !lignes?.length} onClick={() => agir(async () => {
            const r = await soumettreCommande(c.id)
            toast.success(r === 'validee' ? 'Commande validée (aucune validation demandée)' : 'Commande envoyée à la validation')
          })}><Check className="w-4 h-4" aria-hidden="true" />Soumettre</button>}
          {peutValider && c.status === 'a_valider' && c.approval_id && <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => agir(() => deciderCommande(c.approval_id, 'approved'), 'Commande validée')}><Check className="w-4 h-4" aria-hidden="true" />Valider</button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={refuser}><X className="w-4 h-4" aria-hidden="true" />Refuser</button>
          </>}
          {peutPreparer && c.status === 'validee' && <>
            <a className="btn btn-secondary" href={texteEmail()}><Mail className="w-4 h-4" aria-hidden="true" />Préparer l'email</a>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => agir(() => commandeEnvoyee(c.id), 'Commande marquée envoyée')}><Send className="w-4 h-4" aria-hidden="true" />Marquer envoyée</button>
          </>}
          {peutPreparer && !['recue', 'annulee'].includes(c.status) && (
            <button type="button" className="btn btn-ghost ml-auto" disabled={busy} onClick={async () => {
              const solder = c.status === 'partielle'
              if (!(await confirmer(solder ? 'Solder la commande : le reste ne sera pas livré ?' : 'Annuler cette commande ?'))) return
              agir(() => annulerCommande(c.id), solder ? 'Commande soldée' : 'Commande annulée')
            }}>{c.status === 'partielle' ? 'Solder' : 'Annuler la commande'}</button>
          )}
          {peutPreparer && ['brouillon', 'refusee', 'annulee'].includes(c.status) && recs.length === 0 && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={async () => {
              if (!(await confirmer('Supprimer définitivement cette commande ?'))) return
              setBusy(true)
              try { await supprimerCommande(c.id); toast.success('Commande supprimée'); onChange(); onClose() } catch (e) { toast.error(e.message) }
              setBusy(false)
            }}><Trash2 className="w-4 h-4" aria-hidden="true" />Supprimer</button>
          )}
        </div>
        {c.status === 'validee' && <p className="text-ui-sm muted">« Préparer l'email » ouvre votre messagerie avec la commande : rien ne part sans vous.</p>}
      </div>
    </Sheet>
  )
}

function Commandes({ voirPrix, peutPreparer, peutValider, ouvrir = null, onOuvert = null }) {
  const [liste, setListe] = useState(null)
  const [emplacements, setEmplacements] = useState([])
  const [filtre, setFiltre] = useState('en_cours')
  const [nouvelle, setNouvelle] = useState(false)
  const [detail, setDetail] = useState(null)
  const charger = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([chargerCommandes(), chargerEmplacements().catch(() => [])])
      setListe(c); setEmplacements(l)
      return c
    } catch (e) { toast.error(e.message); setListe([]); return [] }
  }, [])
  useEffect(() => {
    charger().then((c) => { if (ouvrir) { const x = c.find((o) => o.id === ouvrir); if (x) setDetail(x); onOuvert?.() } })
  }, [charger, ouvrir, onOuvert])
  if (!liste) return <Spinner />
  const enCours = (o) => !['recue', 'annulee'].includes(o.status)
  const visibles = liste.filter((o) => (filtre === 'en_cours' ? enCours(o) : filtre === 'a_valider' ? o.status === 'a_valider' : true))
  const nbAValider = liste.filter((o) => o.status === 'a_valider').length
  const rafraichir = async () => { const c = await charger(); setDetail((d) => (d ? c.find((o) => o.id === d.id) || null : null)) }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className="select w-auto" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Filtre">
          <option value="en_cours">En cours</option>
          <option value="a_valider">À valider{nbAValider ? ` (${nbAValider})` : ''}</option>
          <option value="toutes">Toutes</option>
        </select>
        {peutPreparer && <button type="button" className="btn btn-primary ml-auto" onClick={() => setNouvelle(true)}><Plus className="w-4 h-4" aria-hidden="true" />Nouvelle commande</button>}
      </div>
      <DataTable rows={visibles} onRowClick={setDetail} columns={[
        { key: 'ref', label: 'Commande', mobile: 'title', render: (o) => o.reference },
        { key: 'fourn', label: 'Fournisseur', mobile: 'subtitle', render: (o) => o.suppliers?.name || '' },
        { key: 'statut', label: 'Statut', mobile: 'aside', render: (o) => <span className={`badge ${STATUTS_COMMANDE[o.status].badge}`}>{STATUTS_COMMANDE[o.status].label}</span> },
        ...(voirPrix || peutValider ? [{ key: 'total', label: 'Total HT', align: 'right', render: (o) => euros(o.total_ht) }] : []),
        { key: 'date', label: 'Créée le', render: (o) => new Date(o.created_at).toLocaleDateString('fr-FR') },
      ]} empty={<EmptyState icon={ShoppingCart} title={liste.length ? 'Aucune commande dans ce filtre' : 'Aucune commande'} compact>Préparez une commande depuis les alertes (articles sous le seuil) ou à la main.</EmptyState>} />
      {nouvelle && <NouvelleCommandeSheet onClose={() => setNouvelle(false)} onCree={async (id) => { setNouvelle(false); const c = await charger(); setDetail(c.find((o) => o.id === id) || null) }} />}
      {detail && <DetailCommande key={`${detail.id}-${detail.status}`} commande={detail} voirPrix={voirPrix} peutPreparer={peutPreparer} peutValider={peutValider} emplacements={emplacements} onClose={() => setDetail(null)} onChange={rafraichir} />}
    </div>
  )
}

// ─── Emplacements ───
function Emplacements({ peutGerer }) {
  const [liste, setListe] = useState(null)
  const [edite, setEdite] = useState(null)
  const charger = useCallback(() => { chargerEmplacements().then(setListe).catch((e) => toast.error(e.message)) }, [])
  useEffect(() => { charger() }, [charger])
  const enregistrer = async (e) => {
    e.preventDefault()
    try { await enregistrerEmplacement(edite); setEdite(null); charger() } catch (err) { toast.error(err.message) }
  }
  if (!liste) return <Spinner />
  return (
    <div className="space-y-3">
      {peutGerer && !edite && <button type="button" className="btn btn-secondary" onClick={() => setEdite({ kind: 'depot', name: '', is_active: true })}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter un emplacement</button>}
      {edite && (
        <form onSubmit={enregistrer} className="card grid gap-3 sm:grid-cols-[10rem_1fr_auto] items-end">
          <Champ label="Type"><select className="select" value={edite.kind} onChange={(e) => setEdite({ ...edite, kind: e.target.value })}>{Object.entries(TYPES_EMPLACEMENT).filter(([k]) => k !== 'technicien').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Champ>
          <Champ label="Nom"><input className="input" required value={edite.name} onChange={(e) => setEdite({ ...edite, name: e.target.value })} placeholder="Dépôt de Plomelin, Camionnette AB-123-CD…" /></Champ>
          <div className="flex gap-2"><button type="submit" className="btn btn-primary">Enregistrer</button><button type="button" className="btn btn-ghost" onClick={() => setEdite(null)}>Annuler</button></div>
        </form>
      )}
      <ul className="card card-flush divide-y divide-gray-100">
        {liste.map((l) => (
          <li key={l.id} className="px-4 py-3 flex items-center gap-3">
            <MapPin className="w-4 h-4 text-gray-400 flex-none" aria-hidden="true" />
            <span className="flex-1 min-w-0"><span className="block font-semibold text-ui">{l.name}</span><span className="block text-ui-sm text-gray-600">{TYPES_EMPLACEMENT[l.kind]}{l.is_active ? '' : ' · inactif'}</span></span>
            {peutGerer && l.kind !== 'technicien' && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${l.name}`} onClick={() => setEdite(l)}><Pencil className="w-4 h-4" /></button>}
          </li>
        ))}
      </ul>
      <p className="text-ui-sm muted">Le stock de chaque technicien se crée tout seul la première fois qu'il ouvre « Mon stock ».</p>
    </div>
  )
}

// ─── Fournisseurs ───
function Fournisseurs({ peutGerer }) {
  const [liste, setListe] = useState(null)
  const [edite, setEdite] = useState(null)
  const charger = useCallback(() => { chargerFournisseurs().then(setListe).catch((e) => toast.error(e.message)) }, [])
  useEffect(() => { charger() }, [charger])
  const enregistrer = async (e) => {
    e.preventDefault()
    try { await enregistrerFournisseur(edite); setEdite(null); charger() } catch (err) { toast.error(err.message) }
  }
  if (!liste) return <Spinner />
  const m = (k) => (e) => setEdite({ ...edite, [k]: e.target.value })
  return (
    <div className="space-y-3">
      {peutGerer && !edite && <button type="button" className="btn btn-secondary" onClick={() => setEdite({ name: '' })}><Plus className="w-4 h-4" aria-hidden="true" />Ajouter un fournisseur</button>}
      {edite && (
        <form onSubmit={enregistrer} className="card space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Champ label="Raison sociale"><input className="input" required value={edite.name || ''} onChange={m('name')} /></Champ>
            <Champ label="SIREN"><input className="input" inputMode="numeric" value={edite.siren || ''} onChange={m('siren')} /></Champ>
            <Champ label="Contact"><input className="input" value={edite.contact_name || ''} onChange={m('contact_name')} /></Champ>
            <Champ label="Email"><input className="input" type="email" value={edite.email || ''} onChange={m('email')} /></Champ>
            <Champ label="Téléphone"><input className="input" type="tel" value={edite.phone || ''} onChange={m('phone')} /></Champ>
            <Champ label="Délai habituel (jours)"><input className="input" inputMode="numeric" value={edite.lead_time_days ?? ''} onChange={m('lead_time_days')} /></Champ>
            <Champ label="Conditions de paiement"><input className="input" value={edite.payment_terms || ''} onChange={m('payment_terms')} placeholder="30 jours fin de mois" /></Champ>
            <Champ label="Site de commande"><input className="input" value={edite.website || ''} onChange={m('website')} /></Champ>
          </div>
          <div className="flex gap-2"><button type="submit" className="btn btn-primary">Enregistrer</button><button type="button" className="btn btn-ghost" onClick={() => setEdite(null)}>Annuler</button>
            {edite.id && <button type="button" className="btn btn-ghost ml-auto" onClick={async () => { try { await archiverFournisseur(edite.id); setEdite(null); charger() } catch (err) { toast.error(err.message) } }}>Archiver</button>}
          </div>
        </form>
      )}
      {liste.length === 0 && !edite ? <EmptyState icon={Truck} title="Aucun fournisseur" compact>Ajoutez vos fournisseurs : ils regroupent les propositions de commande.</EmptyState> : (
        <ul className="card card-flush divide-y divide-gray-100">
          {liste.map((f) => (
            <li key={f.id} className="px-4 py-3 flex items-center gap-3">
              <span className="flex-1 min-w-0"><span className="block font-semibold text-ui">{f.name}</span><span className="block text-ui-sm text-gray-600">{[f.contact_name, f.phone, f.email, f.lead_time_days && `livré en ${f.lead_time_days} j`].filter(Boolean).join(' · ')}</span></span>
              {peutGerer && <button type="button" className="btn btn-ghost btn-icon" aria-label={`Modifier ${f.name}`} onClick={() => setEdite(f)}><Pencil className="w-4 h-4" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Stock() {
  const { can } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const voir = can('stock.voir') === true
  const gerer = can('stock.articles.gerer') === true
  const sien = can('stock.sien.mouvementer') === true
  const voirPrix = can('stock.valeur.voir') === true
  const preparer = can('stock.commandes.preparer') === true && voir
  const valider = can('stock.commandes.valider') === true
  const [ouvrir, setOuvrir] = useState(null)
  const ouvert = useCallback(() => setOuvrir(null), [])
  const tabs = [
    ...((sien || gerer) ? [{ id: 'mon-stock', label: 'Mon stock' }] : []),
    ...(voir ? [{ id: 'articles', label: 'Articles' }, { id: 'mouvements', label: 'Mouvements' }, { id: 'alertes', label: 'Alertes' }] : []),
    ...((preparer || valider || (voirPrix && voir)) ? [{ id: 'commandes', label: 'Commandes' }] : []),
    ...(voir ? [{ id: 'emplacements', label: 'Emplacements' }, { id: 'fournisseurs', label: 'Fournisseurs' }] : []),
  ]
  const chemin = location.pathname.replace(/^\/stock\/?/, '').split('/')[0]
  const onglet = tabs.some((t) => t.id === chemin) ? chemin : (tabs[0]?.id || 'mon-stock')
  if (!tabs.length) return <EmptyState icon={Package} title="Stock non accessible" compact>Votre profil ne donne pas accès au stock.</EmptyState>
  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Maintenance" title="Stock" meta={<span>Les quantités se calculent depuis les mouvements : rien ne se recompte à la main.</span>} />
      <Tabs tabs={tabs} value={onglet} onChange={(id) => navigate(`/stock/${id}`)} />
      {onglet === 'mon-stock' && <MonStock />}
      {onglet === 'articles' && <Articles peutGerer={gerer} voirPrix={voirPrix} />}
      {onglet === 'mouvements' && <Journal />}
      {onglet === 'alertes' && <Alertes peutCommander={preparer} onCommande={(id) => { setOuvrir(id); navigate('/stock/commandes') }} />}
      {onglet === 'commandes' && <Commandes voirPrix={voirPrix} peutPreparer={preparer} peutValider={valider} ouvrir={ouvrir} onOuvert={ouvert} />}
      {onglet === 'emplacements' && <Emplacements peutGerer={gerer} />}
      {onglet === 'fournisseurs' && <Fournisseurs peutGerer={gerer} />}
    </div>
  )
}
