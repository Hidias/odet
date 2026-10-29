// Fiche formation : objectif (cadre F-3) et spécialité (cadre F-4) du bilan pédagogique et financier (0477).
// Une seule saisie par formation ; le calcul du BPF les reprend pour toutes les sessions.
import { useEffect, useState } from 'react'
import { supabase } from '../../../core/supabase'
import SearchSelect from '../../../ui/SearchSelect'
import { OBJECTIFS_BPF, NIVEAUX_RNCP, specialiteSuggeree } from '../lib/bpf'

let cacheSpecialites = null

export default function BpfFormation({ form, setForm }) {
  const [specialites, setSpecialites] = useState(cacheSpecialites || [])
  useEffect(() => {
    if (cacheSpecialites) return
    supabase.from('bpf_specialites').select('code, libelle').order('code').then(({ data }) => {
      cacheSpecialites = data || []
      setSpecialites(cacheSpecialites)
    })
  }, [])
  const suggestion = !form.nsf_code ? specialiteSuggeree(form) : null
  const libelle = (code) => specialites.find((s) => s.code === code)?.libelle || ''

  return (
    <div className="border rounded-ui-sm p-3 space-y-3">
      <div>
        <p className="font-medium text-ui">Bilan pédagogique et financier</p>
        <p className="text-ui-sm text-gray-500">Rangement de la formation dans le BPF annuel (Cerfa 10443*17). Une seule fois par formation.</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Objectif de la formation</label>
          <SearchSelect value={form.bpf_objectif || ''} emptyLabel="À choisir"
            onChange={(v) => setForm({ ...form, bpf_objectif: v || '', bpf_rncp_niveau: v === 'rncp' ? form.bpf_rncp_niveau : '' })}
            options={OBJECTIFS_BPF.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))} />
        </div>
        {form.bpf_objectif === 'rncp' && (
          <div>
            <label className="label">Niveau RNCP</label>
            <select className="select" value={form.bpf_rncp_niveau || ''} onChange={(e) => setForm({ ...form, bpf_rncp_niveau: e.target.value })}>
              <option value="">À choisir</option>
              {NIVEAUX_RNCP.map((n) => <option key={n} value={n}>Niveau {n}</option>)}
            </select>
          </div>
        )}
        {['rncp', 'rncp_cqp', 'rs'].includes(form.bpf_objectif) && (
          <div>
            <label className="label">Code de la fiche (RNCP ou RS)</label>
            <input type="text" className="input" maxLength={40} placeholder="Tel qu'inscrit sur France compétences" value={form.bpf_fiche || ''}
              onChange={(e) => setForm({ ...form, bpf_fiche: e.target.value })} />
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="label">Spécialité de formation</label>
          <SearchSelect value={form.nsf_code || ''} emptyLabel="À choisir"
            onChange={(v) => setForm({ ...form, nsf_code: v || '' })}
            options={specialites.map((s) => ({ value: s.code, label: `${s.code} ${s.libelle}`, keywords: s.libelle }))} />
          {suggestion && (
            <button type="button" className="mt-1 text-ui-sm text-primary-700 underline" onClick={() => setForm({ ...form, nsf_code: suggestion })}>
              Suggestion d&apos;après l&apos;intitulé : {suggestion} {libelle(suggestion)}. Retenir
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
