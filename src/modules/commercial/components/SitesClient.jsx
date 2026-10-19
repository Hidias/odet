import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { MapPin, Plus, ChevronDown, ChevronUp, Loader2, Search, Building2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { saveSite } from '../../interventions/lib/itvData'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { confirmer } from '../../../ui/Confirm'
import { etablissementsDe, libelleEtat } from '../lib/registry'

// Sites du client (lot 2, 0041) : adresse de la fiche (site par défaut, synchronisé avec l'adresse du client par la
// base), siège au répertoire, établissements avec SIRET et état, lieux d'intervention et de formation.
// « Chercher les établissements » : le répertoire ne les liste qu'avec un code postal ou un département.

const VIDE = { name: '', address: '', postal_code: '', city: '', siret: '', is_head_office: false, access_notes: '', capacity: '' }

export default function SitesClient({ client, peutModifier, onClientChange }) {
  const [ouvert, setOuvert] = useState(true)
  const [sites, setSites] = useState(null)
  const [edition, setEdition] = useState(null)
  const [busy, setBusy] = useState(false)
  const [voirArchives, setVoirArchives] = useState(false)
  const siren = String(client?.siren || client?.siret || '').replace(/\s/g, '').slice(0, 9)

  const load = async () => {
    const { data, error } = await supabase.from('sites').select('*').eq('client_id', client.id)
      .order('is_default', { ascending: false }).order('name')
    setSites(error ? [] : data || [])
  }
  useEffect(() => { if (client?.id) load() }, [client?.id])

  if (!client || client.client_type === 'particulier') return null

  const actifs = (sites || []).filter((s) => s.is_active !== false)
  const archives = (sites || []).filter((s) => s.is_active === false)
  const liste = voirArchives ? sites || [] : actifs

  const enregistrer = async () => {
    const f = edition
    if (!f.name?.trim()) return toast.error('Donnez un nom au site')
    const siret = String(f.siret || '').replace(/\s/g, '')
    if (siret && !/^\d{14}$/.test(siret)) return toast.error('Le SIRET compte 14 chiffres')
    setBusy(true)
    try {
      const row = {
        ...(f.id ? { id: f.id } : {}),
        client_id: client.id,
        is_active: f.is_active !== false,
        name: f.name.trim(),
        address: f.address || null,
        postal_code: f.postal_code || null,
        city: f.city || null,
        siret: siret || null,
        is_head_office: !!f.is_head_office,
        access_notes: f.access_notes || null,
        capacity: f.capacity === '' || f.capacity == null ? null : Number(f.capacity),
        ...(f.etat_administratif !== undefined ? { etat_administratif: f.etat_administratif } : {}),
        ...(f.registry_snapshot !== undefined ? { registry_snapshot: f.registry_snapshot } : {}),
        ...(f.latitude != null && f.longitude != null && f.depuisRepertoire ? { latitude: f.latitude, longitude: f.longitude } : {}),
      }
      await saveSite(row)
      toast.success(f.id ? 'Site enregistré' : 'Site ajouté')
      setEdition(null)
      await load()
      // Le site par défaut met à jour l'adresse de la fiche (base) : on relit le client
      if (f.is_default) onClientChange?.()
    } catch (e) {
      toast.error(e.message || 'Enregistrement impossible')
    }
    setBusy(false)
  }

  const archiver = async (s, actif) => {
    if (!actif && !(await confirmer(`Archiver le site « ${s.name} » ? Il n'est plus proposé, son historique est conservé.`))) return
    const { error } = await supabase.from('sites').update({ is_active: actif, updated_at: new Date().toISOString() }).eq('id', s.id)
    if (error) return toast.error(error.message)
    toast.success(actif ? 'Site réactivé' : 'Site archivé')
    load()
  }

  return (
    <div className="bg-white rounded-ui border border-gray-200">
      <button type="button" onClick={() => setOuvert((v) => !v)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 rounded-t-xl">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary-600" />
          <h2 className="font-semibold text-gray-900">Sites</h2>
          <span className="text-ui-sm bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{actifs.length}</span>
        </div>
        {ouvert ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {ouvert && (
        <div className="px-5 pb-4 space-y-2">
          {sites === null ? <p className="text-ui-sm text-gray-400">Chargement…</p> : liste.length === 0 ? (
            <p className="text-ui-sm text-gray-500">Aucun site.</p>
          ) : (
            <ul className="space-y-2">
              {liste.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setEdition({ ...VIDE, ...s, capacity: s.capacity ?? '' })}
                    className={`w-full text-left rounded-ui-sm border p-2.5 hover:bg-gray-50 ${s.is_active === false ? 'border-dashed border-gray-200 opacity-70' : 'border-gray-200'}`}>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-ui font-medium text-gray-900">{s.name}</span>
                      {s.is_default && <span className="badge badge-info" style={{ height: 18, fontSize: 10.5 }}>adresse de la fiche</span>}
                      {s.is_head_office && <span className="badge badge-neutral" style={{ height: 18, fontSize: 10.5 }}>siège</span>}
                      {s.etat_administratif === 'F' && <span className="badge badge-danger" style={{ height: 18, fontSize: 10.5 }}>fermé au répertoire</span>}
                      {s.is_active === false && <span className="badge badge-neutral" style={{ height: 18, fontSize: 10.5 }}>archivé</span>}
                    </div>
                    <div className="text-ui-sm text-gray-500">{[s.address, [s.postal_code, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Adresse à compléter'}</div>
                    {s.siret && <div className="text-ui-sm text-gray-400 font-mono">SIRET {s.siret}</div>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {peutModifier && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdition({ ...VIDE })}>
                <Plus className="w-4 h-4" /> Ajouter un site
              </button>
            )}
            {archives.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVoirArchives((v) => !v)}>
                {voirArchives ? 'Masquer les archivés' : `Voir les archivés (${archives.length})`}
              </button>
            )}
          </div>
        </div>
      )}

      {edition && (
        <FicheSite site={edition} siren={siren} peutModifier={peutModifier} busy={busy}
          onChange={setEdition} onClose={() => setEdition(null)} onSave={enregistrer}
          onArchive={(actif) => { const s = edition; setEdition(null); archiver(s, actif) }} />
      )}
    </div>
  )
}

function FicheSite({ site, siren, peutModifier, busy, onChange, onClose, onSave, onArchive }) {
  const [recherche, setRecherche] = useState(site.postal_code || '')
  const [etabs, setEtabs] = useState(null)
  const [cherche, setCherche] = useState(false)
  const set = (k, v) => onChange({ ...site, [k]: v })

  const chercher = async () => {
    const v = String(recherche || '').replace(/\s/g, '')
    if (!/^\d{2,5}$/.test(v) && !/^2[AB]$/i.test(v)) return toast.error('Code postal (5 chiffres) ou département (2 chiffres)')
    setCherche(true)
    try {
      const r = await etablissementsDe(siren, v.length === 5 ? { codePostal: v } : { departement: v })
      setEtabs(r)
      if (r.length === 0) toast('Aucun établissement de cette entreprise à cet endroit')
    } catch (e) {
      toast.error(e.message)
    }
    setCherche(false)
  }

  const reprendre = (e) => {
    onChange({
      ...site,
      name: site.name || e.nom || (e.est_siege ? 'Siège' : `Établissement ${e.ville || ''}`.trim()),
      address: e.adresse || site.address, postal_code: e.code_postal || site.postal_code, city: e.ville || site.city,
      siret: e.siret, is_head_office: e.est_siege, etat_administratif: e.etat, registry_snapshot: { ...e, lu_le: new Date().toISOString() },
      latitude: e.latitude, longitude: e.longitude, depuisRepertoire: true,
    })
    setEtabs(null)
  }

  const champ = (k, label, props = {}) => (
    <div>
      <label className="label" htmlFor={`site-${k}`}>{label}</label>
      <input id={`site-${k}`} className="input" value={site[k] ?? ''} disabled={!peutModifier} onChange={(e) => set(k, e.target.value)} {...props} />
    </div>
  )

  return (
    <Sheet title={site.id ? site.name || 'Site' : 'Nouveau site'} onClose={onClose}
      footer={peutModifier ? <>
        {site.id && !site.is_default && (site.is_active === false
          ? <button type="button" className="btn btn-ghost mr-auto" onClick={() => onArchive(true)}>Réactiver</button>
          : <button type="button" className="btn btn-ghost mr-auto" onClick={() => onArchive(false)}>Archiver</button>)}
        <button type="button" className="btn btn-secondary" onClick={onClose}>Annuler</button>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
      </> : <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>}>
      {site.is_default && <Banner tone="info">Site « adresse de la fiche » : son adresse et celle du client sont les mêmes (changer l'une change l'autre).</Banner>}
      {site.etat_administratif === 'F' && <Banner tone="warning">Établissement fermé au répertoire : pensez à archiver ce site.</Banner>}
      {peutModifier && /^\d{9}$/.test(siren) && (
        <div className="rounded-ui border border-gray-200 p-3 space-y-2">
          <div className="text-ui-sm font-semibold text-gray-900 flex items-center gap-1.5"><Building2 className="w-4 h-4" /> Établissements au répertoire</div>
          <div className="flex gap-2">
            <input className="input max-w-[200px]" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Code postal ou département"
              aria-label="Code postal ou département" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); chercher() } }} />
            <button type="button" className="btn btn-secondary" onClick={chercher} disabled={cherche}>
              {cherche ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Chercher
            </button>
          </div>
          {etabs && etabs.length > 0 && (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-ui-sm max-h-60 overflow-y-auto">
              {etabs.map((e) => (
                <li key={e.siret}>
                  <button type="button" onClick={() => reprendre(e)} className="w-full text-left p-2 hover:bg-gray-50">
                    <div className="text-ui-sm text-gray-900 flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono">{e.siret}</span>
                      {e.est_siege && <span className="badge badge-neutral" style={{ height: 18, fontSize: 10.5 }}>siège</span>}
                      <span className={`badge ${e.etat === 'F' ? 'badge-danger' : 'badge-success'}`} style={{ height: 18, fontSize: 10.5 }}>{libelleEtat(e.etat)}</span>
                    </div>
                    <div className="text-ui-sm text-gray-500">{[e.nom, e.adresse, [e.code_postal, e.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {champ('name', 'Nom du site', { placeholder: 'Ex. : Dépôt de Concarneau' })}
      {champ('address', 'Adresse')}
      <div className="grid grid-cols-[120px_1fr] gap-2">
        {champ('postal_code', 'Code postal', { inputMode: 'numeric' })}
        {champ('city', 'Ville')}
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {champ('siret', 'SIRET', { inputMode: 'numeric', placeholder: '14 chiffres' })}
        {champ('capacity', 'Capacité (salle)', { inputMode: 'numeric' })}
      </div>
      <label className="flex items-center gap-2 text-ui text-gray-800">
        <input type="checkbox" checked={!!site.is_head_office} disabled={!peutModifier} onChange={(e) => set('is_head_office', e.target.checked)} />
        Siège au répertoire
      </label>
      <div>
        <label className="label" htmlFor="site-acces">Accès, consignes</label>
        <textarea id="site-acces" className="input min-h-[70px]" value={site.access_notes ?? ''} disabled={!peutModifier} onChange={(e) => set('access_notes', e.target.value)} />
      </div>
    </Sheet>
  )
}
