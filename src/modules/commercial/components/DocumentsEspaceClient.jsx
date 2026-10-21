// Documents mis à disposition dans l'espace du client (0404) : ceux déposés tout seuls (rapports d'intervention,
// factures émises, devis envoyés) et ceux déposés à la main ici (contrat, attestation, tout PDF). Un document se retire
// (motif), il ne s'efface pas.

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { FolderOpen, Upload, Loader2, ExternalLink, EyeOff } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { demander } from '../../../ui/Confirm'
import { mettreADisposition, ouvrirDocumentInterne, versBase64 } from '../../../core/portail/documentsClient'

const TYPES = { rapport: "Rapport d'intervention", facture: 'Facture', devis: 'Devis', contrat: 'Contrat', convention: 'Convention', attestation: 'Attestation', autre: 'Autre document' }
const quand = (d) => new Date(d).toLocaleDateString('fr-FR')

export default function DocumentsEspaceClient({ client, peutModifier }) {
  const [docs, setDocs] = useState(null)
  const [form, setForm] = useState(null) // { kind, label, file }
  const [busy, setBusy] = useState(false)
  const fichier = useRef(null)

  const charger = () => supabase.from('client_shared_documents').select('*').eq('client_id', client.id).order('published_at', { ascending: false })
    .then(({ data, error }) => setDocs(error ? [] : (data || [])))
  useEffect(() => { charger() }, [client.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!docs) return null
  const actifs = docs.filter((d) => !d.withdrawn_at)

  const deposer = async () => {
    if (!form?.file || form.label.trim().length < 2) { toast.error('Choisissez un PDF et donnez-lui un nom'); return }
    if (form.file.type !== 'application/pdf') { toast.error('Seuls les PDF sont acceptés'); return }
    if (form.file.size > 3.5 * 1024 * 1024) { toast.error('PDF trop lourd (3,5 Mo au plus)'); return }
    setBusy(true)
    const r = await mettreADisposition({ objectType: 'client', objectId: client.id, kind: form.kind, label: form.label.trim(), base64: versBase64(await form.file.arrayBuffer()) })
    setBusy(false)
    if (!r) { toast.error('Dépôt impossible'); return }
    toast.success('Document mis à disposition du client')
    setForm(null); charger()
  }

  const retirer = async (d) => {
    const motif = await demander(`Retirer « ${d.label} » de l'espace du client ?\n\nIl reste gardé ici (preuve de mise à disposition). Motif :`, { title: 'Retirer le document' })
    if (motif === null) return
    const { error } = await supabase.from('client_shared_documents').update({ withdrawn_at: new Date().toISOString(), withdrawn_reason: motif.trim() || null }).eq('id', d.id)
    if (error) { toast.error(error.message); return }
    toast.success('Document retiré de l\'espace du client'); charger()
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><FolderOpen className="w-5 h-5 text-gray-500" aria-hidden="true" />Documents de l'espace client</h3>
          <p className="text-ui text-gray-500">{actifs.length ? `${actifs.length} document(s) à disposition du client.` : 'Rapports, factures émises et devis envoyés y arrivent tout seuls.'}</p>
        </div>
        {peutModifier && !form && <button type="button" className="btn btn-secondary btn-sm flex items-center gap-1.5" onClick={() => setForm({ kind: 'contrat', label: '', file: null })}><Upload className="w-4 h-4" aria-hidden="true" />Déposer un PDF</button>}
      </div>
      {form && (
        <div className="mt-3 rounded border border-gray-200 p-3 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {['contrat', 'attestation', 'convention', 'autre'].map((k) => <option key={k} value={k}>{TYPES[k]}</option>)}
            </select>
            <input className="input" placeholder="Nom affiché au client" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </div>
          <input ref={fichier} type="file" accept="application/pdf" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null, label: form.label || (e.target.files?.[0]?.name || '').replace(/\.pdf$/i, '') })} />
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setForm(null)}>Annuler</button>
            <button type="button" className="btn btn-primary btn-sm flex items-center gap-1.5" disabled={busy} onClick={deposer}>{busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Mettre à disposition</button>
          </div>
        </div>
      )}
      {docs.length > 0 && (
        <ul className="mt-3 divide-y divide-gray-100">
          {docs.slice(0, 20).map((d) => (
            <li key={d.id} className={`py-2 flex items-center gap-3 text-ui ${d.withdrawn_at ? 'opacity-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate"><span className="text-gray-500">{TYPES[d.kind]} · </span>{d.label}</div>
                <div className="text-ui-sm text-gray-500">
                  {d.withdrawn_at ? `Retiré le ${quand(d.withdrawn_at)}${d.withdrawn_reason ? ` (${d.withdrawn_reason})` : ''}` : `Mis à disposition le ${quand(d.published_at)}${d.published_by_name ? ` par ${d.published_by_name}` : ''}`}
                  <span className="font-mono" title={d.sha256}> · empreinte {d.sha256.slice(0, 10)}…</span>
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-icon" aria-label="Ouvrir" onClick={() => ouvrirDocumentInterne(d.id).catch((e) => toast.error(e.message))}><ExternalLink className="w-4 h-4" /></button>
              {peutModifier && !d.withdrawn_at && <button type="button" className="btn btn-ghost btn-icon" aria-label="Retirer de l'espace du client" onClick={() => retirer(d)}><EyeOff className="w-4 h-4" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
