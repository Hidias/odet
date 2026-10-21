import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus, Pencil, Star, Archive, Check, X, Loader2, MapPin } from 'lucide-react'
import { supabase } from '../supabase'
import { Field } from './shared'

// Établissements d'une société (0054) : le siège et les sites. L'établissement marqué « adresse principale » est
// l'adresse mise en avant sur les documents et les signatures ; le siège reste l'adresse légale (mentions, blocs
// juridiques). Pour la société qui porte l'instance, la base recopie l'adresse principale dans les réglages.
// Une seule source : c'est ici, et seulement ici, qu'on change l'adresse d'un site.

const VIDE = { name: '', address: '', postal_code: '', city: '', siret: '' }
const ligne = (e) => [e.address, [e.postal_code, e.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')

export default function Etablissements({ companyId, peutModifier = true, onChange }) {
  const [liste, setListe] = useState(null)
  const [edition, setEdition] = useState(null) // { id | null, ...champs }
  const [enCours, setEnCours] = useState(false)

  const charger = async () => {
    if (!companyId) return setListe([])
    const { data, error } = await supabase.from('company_establishments')
      .select('id, name, address, postal_code, city, siret, is_head_office, is_main_site, status')
      .eq('company_id', companyId).order('is_head_office', { ascending: false }).order('created_at')
    if (error) { toast.error(error.message); setListe([]); return }
    setListe(data || [])
  }
  useEffect(() => { charger() }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  const apres = async (message) => { toast.success(message); await charger(); onChange?.() }

  const enregistrer = async () => {
    const e = edition
    if (!e.address?.trim() || !e.city?.trim()) return toast.error('Adresse et ville requises')
    const siret = (e.siret || '').replace(/\s+/g, '')
    if (siret && !/^\d{14}$/.test(siret)) return toast.error('Le SIRET compte 14 chiffres (ou laissez-le vide)')
    const champs = { name: e.name?.trim() || null, address: e.address.trim(), postal_code: e.postal_code?.trim() || null, city: e.city.trim(), siret: siret || null }
    setEnCours(true)
    const { error } = e.id
      ? await supabase.from('company_establishments').update(champs).eq('id', e.id)
      : await supabase.from('company_establishments').insert({ company_id: companyId, ...champs, is_main_site: !(liste || []).some((x) => x.is_main_site) })
    setEnCours(false)
    if (error) return toast.error(error.message)
    setEdition(null)
    apres(e.id ? 'Établissement mis à jour' : 'Site ajouté')
  }

  // Une seule adresse principale par société : on retire d'abord l'ancienne, puis on pose la nouvelle
  const principal = async (e) => {
    setEnCours(true)
    const r1 = await supabase.from('company_establishments').update({ is_main_site: false }).eq('company_id', companyId).eq('is_main_site', true).neq('id', e.id)
    const r2 = r1.error ? r1 : await supabase.from('company_establishments').update({ is_main_site: true }).eq('id', e.id)
    setEnCours(false)
    if (r2.error) return toast.error(r2.error.message)
    apres(`${e.name || ligne(e)} : adresse principale`)
  }

  const archiver = async (e) => {
    setEnCours(true)
    const { error } = await supabase.from('company_establishments').update({ status: 'archived', is_main_site: false }).eq('id', e.id)
    setEnCours(false)
    if (error) return toast.error(error.message)
    apres('Site archivé')
  }

  if (liste === null) return <p className="text-ui-sm text-gray-500"><Loader2 className="w-4 h-4 inline animate-spin" /> Chargement des établissements…</p>
  const actifs = liste.filter((e) => e.status !== 'archived')

  return (
    <div className="grid gap-3">
      {actifs.length === 0 && <p className="text-ui-sm text-gray-500">Aucun établissement enregistré.</p>}
      {actifs.map((e) => (
        edition?.id === e.id ? null : (
          <div key={e.id} className="flex flex-wrap items-start gap-3 rounded-ui border border-gray-200 p-3">
            <MapPin className="w-4 h-4 mt-0.5 text-gray-400 flex-none" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{e.name || (e.is_head_office ? 'Siège social' : 'Site')}</span>
                {e.is_head_office && <span className="badge badge-neutral">Siège social</span>}
                {e.is_main_site && <span className="badge badge-success">Adresse principale</span>}
              </div>
              <div className="text-ui-sm text-gray-600">{ligne(e) || 'Adresse non renseignée'}</div>
              <div className="text-ui-sm text-gray-500">{e.siret ? `SIRET ${e.siret}` : 'Sans SIRET'}</div>
            </div>
            {peutModifier && (
              <div className="flex flex-wrap gap-1">
                {!e.is_main_site && <button type="button" className="btn btn-ghost btn-sm" disabled={enCours} onClick={() => principal(e)}><Star className="w-3.5 h-3.5" />Adresse principale</button>}
                <button type="button" className="btn btn-ghost btn-sm" disabled={enCours} onClick={() => setEdition({ ...VIDE, ...e, siret: e.siret || '' })}><Pencil className="w-3.5 h-3.5" />Modifier</button>
                {!e.is_head_office && <button type="button" className="btn btn-ghost btn-sm" disabled={enCours} onClick={() => archiver(e)}><Archive className="w-3.5 h-3.5" />Archiver</button>}
              </div>
            )}
          </div>
        )
      ))}

      {edition && (
        <div className="rounded-ui border border-gray-300 p-3 grid gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nom de l'établissement" hint="Ex. : Site principal"><input id="etab-nom" className="input" value={edition.name || ''} onChange={(ev) => setEdition({ ...edition, name: ev.target.value })} /></Field>
            <Field label="SIRET" hint="Facultatif : un site non déclaré n'en a pas"><input id="etab-siret" className="input" value={edition.siret || ''} onChange={(ev) => setEdition({ ...edition, siret: ev.target.value })} /></Field>
            <Field label="Adresse" className="md:col-span-2"><input id="etab-adresse" className="input" value={edition.address || ''} onChange={(ev) => setEdition({ ...edition, address: ev.target.value })} /></Field>
            <Field label="Code postal"><input id="etab-cp" className="input" value={edition.postal_code || ''} onChange={(ev) => setEdition({ ...edition, postal_code: ev.target.value })} /></Field>
            <Field label="Ville"><input id="etab-ville" className="input" value={edition.city || ''} onChange={(ev) => setEdition({ ...edition, city: ev.target.value })} /></Field>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={enCours} onClick={enregistrer}>{enCours ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}Enregistrer</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={enCours} onClick={() => setEdition(null)}><X className="w-3.5 h-3.5" />Annuler</button>
          </div>
        </div>
      )}

      {peutModifier && !edition && (
        <div><button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdition({ ...VIDE, id: null })}><Plus className="w-4 h-4" />Ajouter un site</button></div>
      )}
    </div>
  )
}
