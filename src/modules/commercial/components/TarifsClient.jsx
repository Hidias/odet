import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { BadgeEuro, Plus, Trash2, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { confirmer } from '../../../ui/Confirm'
import { valide } from '../../../core/tarifs/tarifsClient'
import { FRAIS_CATALOGUE } from '../lib/fraisCatalogue'

// Tarifs par client (0418) : saisis une seule fois ici, repris dans les devis, les factures, les sessions (intra),
// les inscriptions inter, les pièces de visite et le forfait de visite hors contrat. « Pour tout le groupe » : les
// autres sociétés du même groupe le reprennent quand elles n'ont pas le leur.

const TYPES = [
  ['formation', 'Formation'],
  ['piece', 'Pièce de maintenance'],
  ['remise_pieces', 'Remise sur toutes les pièces'],
  ['deplacement', 'Frais (déplacement, matériel)'],
  ['visite', 'Forfait de visite hors contrat'],
]
const euros = (n) => (n == null || n === '' ? '' : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)
const vide = { kind: 'formation', course_id: '', part_id: '', code: '', prix_ht: '', prix_inter_ht: '', remise_pct: '', pour_le_groupe: false, valid_until: '', notes: '' }
const nombre = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))

export default function TarifsClient({ client, peutModifier }) {
  const [tarifs, setTarifs] = useState(null)
  const [courses, setCourses] = useState([])
  const [parts, setParts] = useState([])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const charger = async () => {
    const { data, error } = await supabase.from('client_prices').select('*').eq('client_id', client.id).order('kind')
    setTarifs(error ? null : data || [])
  }
  useEffect(() => {
    if (!client?.id) return
    charger()
    supabase.from('courses').select('id, title, code, price_ht').order('title').then(({ data }) => setCourses(data || []))
    supabase.from('itv_parts').select('id, name, price_ht').eq('is_active', true).order('name').then(({ data, error }) => setParts(error ? [] : data || []))
  }, [client?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const nomDe = useMemo(() => (t) => {
    if (t.kind === 'formation') return courses.find((c) => c.id === t.course_id)?.title || 'Formation'
    if (t.kind === 'piece') return parts.find((p) => p.id === t.part_id)?.name || 'Pièce'
    if (t.kind === 'deplacement') return FRAIS_CATALOGUE.find((f) => f.code === t.code)?.description_title || t.code
    return TYPES.find(([k]) => k === t.kind)?.[1] || t.kind
  }, [courses, parts])

  // Avant la migration 0418 (table absente) ou sans droit de lecture : rien
  if (tarifs === null) return null

  const prixCatalogue = (t) => {
    if (t.kind === 'formation') return courses.find((c) => c.id === t.course_id)?.price_ht
    if (t.kind === 'piece') return parts.find((p) => p.id === t.part_id)?.price_ht
    if (t.kind === 'deplacement') return FRAIS_CATALOGUE.find((f) => f.code === t.code)?.unit_price_ht
    return null
  }

  const enregistrer = async (e) => {
    e.preventDefault()
    const f = form
    const ligne = {
      client_id: client.id, kind: f.kind,
      course_id: f.kind === 'formation' ? f.course_id || null : null,
      part_id: f.kind === 'piece' ? f.part_id || null : null,
      code: f.kind === 'deplacement' ? f.code || null : null,
      prix_ht: ['formation', 'piece', 'deplacement', 'visite'].includes(f.kind) ? nombre(f.prix_ht) : null,
      prix_inter_ht: f.kind === 'formation' ? nombre(f.prix_inter_ht) : null,
      remise_pct: f.kind === 'remise_pieces' ? nombre(f.remise_pct) : null,
      pour_le_groupe: !!f.pour_le_groupe, valid_until: f.valid_until || null, notes: f.notes?.trim() || null,
    }
    if (f.kind === 'formation' && (!ligne.course_id || (ligne.prix_ht == null && ligne.prix_inter_ht == null))) return toast.error('Choisissez la formation et au moins un prix')
    if (f.kind === 'piece' && (!ligne.part_id || ligne.prix_ht == null)) return toast.error('Choisissez la pièce et son prix')
    if (f.kind === 'deplacement' && (!ligne.code || ligne.prix_ht == null)) return toast.error('Choisissez le frais et son prix')
    if (f.kind === 'visite' && ligne.prix_ht == null) return toast.error('Indiquez le prix du forfait')
    if (f.kind === 'remise_pieces' && (ligne.remise_pct == null || ligne.remise_pct < 0 || ligne.remise_pct > 100)) return toast.error('Remise entre 0 et 100 %')
    setBusy(true)
    const { error } = f.id
      ? await supabase.from('client_prices').update(ligne).eq('id', f.id)
      : await supabase.from('client_prices').insert(ligne)
    setBusy(false)
    if (error) return toast.error(/client_prices_unique|duplicate/i.test(error.message) ? 'Ce client a déjà un tarif pour cet élément : modifiez-le' : error.message)
    toast.success('Tarif enregistré')
    setForm(null)
    charger()
  }

  const supprimer = async (t) => {
    if (!(await confirmer({ title: 'Retirer ce tarif ?', message: `${nomDe(t)} : le prix du catalogue s'appliquera de nouveau à ce client.`, confirmLabel: 'Retirer', danger: true }))) return
    const { error } = await supabase.from('client_prices').delete().eq('id', t.id)
    if (error) return toast.error(error.message)
    charger()
  }

  const valeur = (t) => {
    if (t.kind === 'remise_pieces') return `${String(t.remise_pct).replace('.', ',')} %`
    if (t.kind === 'formation') return [t.prix_ht != null ? `intra ${euros(t.prix_ht)}` : null, t.prix_inter_ht != null ? `inter ${euros(t.prix_inter_ht)} / pers.` : null].filter(Boolean).join(' · ')
    return euros(t.prix_ht)
  }

  return (
    <div className="bg-white rounded-ui border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <BadgeEuro className="w-4 h-4 text-gray-500" aria-hidden="true" />
        <h3 className="font-semibold text-gray-900 flex-1">Tarifs négociés</h3>
        {peutModifier && !form && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm({ ...vide })}><Plus className="w-4 h-4" />Ajouter</button>
        )}
      </div>
      <div className="p-4 space-y-2">
        {tarifs.length === 0 && !form && <p className="text-ui-sm text-gray-500">Aucun tarif négocié : le prix du catalogue s'applique. Un tarif saisi ici est repris automatiquement dans les devis, factures, sessions et visites.</p>}
        {tarifs.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 text-ui ${valide(t) ? '' : 'opacity-60'}`}>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-900 truncate">{nomDe(t)}</div>
              <div className="text-ui-sm text-gray-600">
                {valeur(t)}
                {prixCatalogue(t) != null && <span className="text-gray-400"> (catalogue {euros(prixCatalogue(t))})</span>}
                {t.pour_le_groupe && <span> · pour tout le groupe</span>}
                {t.valid_until && <span> · {valide(t) ? "jusqu'au" : 'échu le'} {new Date(`${t.valid_until}T12:00:00`).toLocaleDateString('fr-FR')}</span>}
              </div>
              {t.notes && <div className="text-ui-sm text-gray-500 italic">{t.notes}</div>}
            </div>
            {peutModifier && (
              <>
                <button type="button" className="text-ui-sm text-accent-700 hover:underline" onClick={() => setForm({ ...vide, ...t, prix_ht: t.prix_ht ?? '', prix_inter_ht: t.prix_inter_ht ?? '', remise_pct: t.remise_pct ?? '', valid_until: t.valid_until || '', notes: t.notes || '', course_id: t.course_id || '', part_id: t.part_id || '', code: t.code || '' })}>Modifier</button>
                <button type="button" className="p-1 text-gray-400 hover:text-[rgb(var(--c-danger))]" aria-label={`Retirer le tarif ${nomDe(t)}`} onClick={() => supprimer(t)}><Trash2 className="w-4 h-4" /></button>
              </>
            )}
          </div>
        ))}
        {form && (
          <form onSubmit={enregistrer} className="border border-gray-200 rounded-ui p-3 space-y-2 bg-gray-50">
            <label className="block text-ui-sm text-gray-600" htmlFor="tarif-type">Type</label>
            <select id="tarif-type" className="select" value={form.kind} disabled={!!form.id} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {form.kind === 'formation' && (
              <>
                <label className="block text-ui-sm text-gray-600" htmlFor="tarif-formation">Formation</label>
                <select id="tarif-formation" className="select" value={form.course_id} disabled={!!form.id} onChange={(e) => setForm({ ...form, course_id: e.target.value })}>
                  <option value="">Choisir</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.title}{c.price_ht != null ? ` (catalogue ${euros(c.price_ht)})` : ''}</option>)}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-ui-sm text-gray-600" htmlFor="tarif-intra">Prix intra HT</label><input id="tarif-intra" className="input" inputMode="decimal" value={form.prix_ht} onChange={(e) => setForm({ ...form, prix_ht: e.target.value })} /></div>
                  <div><label className="block text-ui-sm text-gray-600" htmlFor="tarif-inter">Prix inter HT par personne</label><input id="tarif-inter" className="input" inputMode="decimal" value={form.prix_inter_ht} onChange={(e) => setForm({ ...form, prix_inter_ht: e.target.value })} /></div>
                </div>
              </>
            )}
            {form.kind === 'piece' && (
              <>
                <label className="block text-ui-sm text-gray-600" htmlFor="tarif-piece">Pièce</label>
                <select id="tarif-piece" className="select" value={form.part_id} disabled={!!form.id} onChange={(e) => setForm({ ...form, part_id: e.target.value })}>
                  <option value="">Choisir</option>
                  {parts.map((p) => <option key={p.id} value={p.id}>{p.name}{p.price_ht != null ? ` (catalogue ${euros(p.price_ht)})` : ''}</option>)}
                </select>
              </>
            )}
            {form.kind === 'deplacement' && (
              <>
                <label className="block text-ui-sm text-gray-600" htmlFor="tarif-frais">Frais</label>
                <select id="tarif-frais" className="select" value={form.code} disabled={!!form.id} onChange={(e) => setForm({ ...form, code: e.target.value })}>
                  <option value="">Choisir</option>
                  {FRAIS_CATALOGUE.map((f) => <option key={f.code} value={f.code}>{f.description_title} ({euros(f.unit_price_ht)})</option>)}
                </select>
              </>
            )}
            {['piece', 'deplacement', 'visite'].includes(form.kind) && (
              <div><label className="block text-ui-sm text-gray-600" htmlFor="tarif-prix">Prix HT</label><input id="tarif-prix" className="input" inputMode="decimal" value={form.prix_ht} onChange={(e) => setForm({ ...form, prix_ht: e.target.value })} /></div>
            )}
            {form.kind === 'remise_pieces' && (
              <div><label className="block text-ui-sm text-gray-600" htmlFor="tarif-remise">Remise sur le prix des pièces (%)</label><input id="tarif-remise" className="input" inputMode="decimal" value={form.remise_pct} onChange={(e) => setForm({ ...form, remise_pct: e.target.value })} /></div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block text-ui-sm text-gray-600" htmlFor="tarif-fin">Valable jusqu'au (facultatif)</label><input id="tarif-fin" type="date" className="input" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></div>
              <div><label className="block text-ui-sm text-gray-600" htmlFor="tarif-note">Note (facultatif)</label><input id="tarif-note" className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            {(client.group_name || '').trim() && (
              <label className="flex items-center gap-2 text-ui text-gray-700">
                <input type="checkbox" checked={!!form.pour_le_groupe} onChange={(e) => setForm({ ...form, pour_le_groupe: e.target.checked })} />
                Pour tout le groupe « {client.group_name.trim()} »
              </label>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(null)}>Annuler</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
