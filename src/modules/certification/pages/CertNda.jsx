// Déclaration d'activité : dates (articles R6351-1 et R6351-6), pièces du dossier (R6351-5), mentions.

import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import JSZip from 'jszip'
import { Download, Upload, Trash2, FileText, Loader2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { DateField, DueBadge, Step } from '../components/ui'
import {
  saveSettings, uploadDocument, removeDocument, signedUrl, downloadBlob, addMonths, frDate,
} from '../lib/certData'
import { buildNdaProgrammePDF, buildNdaIntervenantsPDF } from '../pdf/ndaPiecesPDF'

const STATUS = [
  ['preparation', 'En préparation'], ['depose', 'Déposée'], ['complet', 'Dossier complet (accusé reçu)'], ['enregistre', 'Enregistrée'], ['refuse', 'Refusée'],
]

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export default function CertNda({ settings, pieces, canWrite, organization, updateOrganization, reloadSettings }) {
  const [sessions, setSessions] = useState([])
  const [form, setForm] = useState(settings)
  const [nda, setNda] = useState({ nda: organization?.nda || '', nda_region: organization?.nda_region || '' })
  const [busy, setBusy] = useState(null)
  const fileRefs = useRef({})

  useEffect(() => { setForm(settings) }, [settings])
  useEffect(() => { setNda({ nda: organization?.nda || '', nda_region: organization?.nda_region || '' }) }, [organization?.nda, organization?.nda_region])
  useEffect(() => {
    supabase.from('sessions')
      .select('id, reference, start_date, convention_signed, convention_signed_date, convention_signed_file_url, clients(name)')
      .eq('convention_signed', true).order('convention_signed_date', { ascending: true, nullsFirst: false }).limit(200)
      .then(({ data }) => setSessions(data || []))
  }, [])

  const hasNda = !!String(organization?.nda || '').trim()
  const firstSession = sessions.find((s) => s.id === form.first_convention_session_id)
  const depositBy = form.first_convention_date ? addMonths(form.first_convention_date, 3) : null
  const answerBy = (form.nda_complete_at || form.nda_filed_at) ? addMonths(form.nda_complete_at || form.nda_filed_at, 2) : null

  const save = async (patch, msg = 'Enregistré') => {
    setBusy('save')
    try { await saveSettings(patch); await reloadSettings(); toast.success(msg) } catch (e) { toast.error(e.message) }
    setBusy(null)
  }

  const pickSession = (id) => {
    const s = sessions.find((x) => x.id === id)
    const date = s ? String(s.convention_signed_date || s.start_date || '').substring(0, 10) || null : form.first_convention_date
    setForm({ ...form, first_convention_session_id: id || null, first_convention_date: date })
    save({ first_convention_session_id: id || null, first_convention_date: date })
  }

  const saveNumber = async () => {
    if (!nda.nda.trim()) return toast.error('Saisir le numéro reçu')
    setBusy('nda')
    try {
      const r = await updateOrganization({ nda: nda.nda.replace(/\s+/g, ''), nda_region: nda.nda_region.trim() || null })
      if (r?.error) throw r.error
      await saveSettings({ nda_status: 'enregistre', nda_registered_at: form.nda_registered_at || new Date().toISOString().substring(0, 10) })
      await reloadSettings()
      toast.success('Numéro enregistré : il apparaît maintenant sur les documents')
    } catch (e) { toast.error(e.message || String(e)) }
    setBusy(null)
  }

  const upload = async (kind, file) => {
    if (!file) return
    setBusy(kind)
    try { await uploadDocument(kind, file); await reloadSettings(); toast.success('Pièce déposée') } catch (e) { toast.error(e.message) }
    setBusy(null)
  }

  const openDoc = async (d) => {
    try { window.open(await signedUrl(d.file_path), '_blank', 'noopener') } catch (e) { toast.error(e.message) }
  }

  const delDoc = async (d) => {
    if (!window.confirm(`Retirer « ${d.file_name} » du dossier ?`)) return
    setBusy(d.id)
    try { await removeDocument(d); await reloadSettings() } catch (e) { toast.error(e.message) }
    setBusy(null)
  }

  const generate = async (kind) => {
    setBusy(kind)
    try {
      const r = kind === 'nda_programme' ? await buildNdaProgrammePDF() : await buildNdaIntervenantsPDF()
      r.doc.save(r.filename)
    } catch (e) { toast.error(`Génération impossible : ${e.message}`) }
    setBusy(null)
  }

  const openSessionConvention = async () => {
    if (!firstSession?.convention_signed_file_url) return toast.error('Aucune convention signée déposée sur cette session')
    try { window.open(await signedUrl(firstSession.convention_signed_file_url, 'signed-conventions'), '_blank', 'noopener') } catch (e) { toast.error(e.message) }
  }

  const downloadAll = async () => {
    setBusy('zip')
    try {
      const zip = new JSZip()
      let n = 0
      for (const p of pieces) {
        for (const d of p.docs) {
          if (!d.file_path) continue
          zip.file(`${String(++n).padStart(2, '0')}_${d.file_name || p.kind}`, await downloadBlob(d.file_path))
        }
        if (!p.docs.length && p.kind === 'nda_convention' && firstSession?.convention_signed_file_url) {
          zip.file(`${String(++n).padStart(2, '0')}_premiere_convention_signee.pdf`, await downloadBlob(firstSession.convention_signed_file_url, 'signed-conventions'))
        }
        if (!p.docs.length && p.generated) {
          const r = p.kind === 'nda_programme' ? await buildNdaProgrammePDF() : await buildNdaIntervenantsPDF()
          zip.file(`${String(++n).padStart(2, '0')}_${r.filename}`, r.doc.output('blob'))
        }
      }
      if (!n) { toast.error('Aucune pièce à télécharger'); setBusy(null); return }
      saveBlob(await zip.generateAsync({ type: 'blob' }), `Dossier_declaration_activite_${new Date().toISOString().substring(0, 10)}.zip`)
      const absent = pieces.filter((p) => !p.ready).length
      if (absent) toast(`${absent} pièce${absent > 1 ? 's' : ''} manquante${absent > 1 ? 's' : ''} dans le dossier`)
    } catch (e) { toast.error(`Téléchargement impossible : ${e.message}`) }
    setBusy(null)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2 items-start">
      <section className="card space-y-4">
        <h2 className="section-title">Dates</h2>
        <Step done={!!form.first_convention_date} current={!form.first_convention_date} title="Première convention signée">
          <span>Point de départ du délai de 3 mois pour déclarer (article R6351-1).</span>
          {canWrite && (
            <div className="grid gap-2 sm:grid-cols-2 pt-1">
              <label className="block"><span className="label">Session</span>
                <select className="select" value={form.first_convention_session_id || ''} onChange={(e) => pickSession(e.target.value)}>
                  <option value="">Saisie à la main</option>
                  {sessions.map((s) => <option key={s.id} value={s.id}>{s.reference} {s.clients?.name ? `, ${s.clients.name}` : ''}</option>)}
                </select>
              </label>
              <DateField label="Date de signature" value={form.first_convention_date} onChange={(v) => { setForm({ ...form, first_convention_date: v }); save({ first_convention_date: v }) }} />
            </div>
          )}
          {!canWrite && form.first_convention_date && <span>{frDate(form.first_convention_date)}</span>}
        </Step>
        <Step done={['depose', 'complet', 'enregistre'].includes(form.nda_status) || hasNda} current={!!form.first_convention_date && form.nda_status === 'preparation' && !hasNda}
          title="Dépôt sur Mon Activité Formation"
          aside={!hasNda && form.nda_status === 'preparation' && depositBy ? <DueBadge date={depositBy} /> : null}>
          <span>{depositBy ? `Au plus tard le ${frDate(depositBy, { day: 'numeric', month: 'long', year: 'numeric' })}.` : 'Délai calculé dès que la première convention est saisie.'}</span>
          {canWrite && (
            <div className="grid gap-2 sm:grid-cols-2 pt-1">
              <label className="block"><span className="label">Statut</span>
                <select className="select" value={hasNda ? 'enregistre' : form.nda_status} disabled={hasNda} onChange={(e) => { setForm({ ...form, nda_status: e.target.value }); save({ nda_status: e.target.value }) }}>
                  {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <DateField label="Déposée le" value={form.nda_filed_at} onChange={(v) => { setForm({ ...form, nda_filed_at: v }); save({ nda_filed_at: v, ...(v && form.nda_status === 'preparation' ? { nda_status: 'depose' } : {}) }) }} />
            </div>
          )}
        </Step>
        <Step done={hasNda} current={['depose', 'complet'].includes(form.nda_status) && !hasNda} title="Réponse de la DREETS"
          aside={answerBy && !hasNda ? <DueBadge date={answerBy} /> : null}>
          <span>Deux mois après un dossier complet. Sans réponse dans ce délai, la déclaration est enregistrée (R6351-6). Des pièces peuvent être demandées sous 10 jours ouvrés ; réponse sous 12 jours ouvrés.</span>
          {canWrite && !hasNda && (
            <div className="pt-1 sm:w-1/2"><DateField label="Dossier complet le (accusé de réception)" value={form.nda_complete_at} onChange={(v) => { setForm({ ...form, nda_complete_at: v }); save({ nda_complete_at: v, ...(v ? { nda_status: 'complet' } : {}) }) }} /></div>
          )}
        </Step>
        <Step done={hasNda} title="Numéro reçu">
          <span>Saisi ici, il apparaît sur les conventions, devis, contrats et factures, avec la région.</span>
          {canWrite && (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end pt-1">
              <label className="block"><span className="label">Numéro</span><input className="input" value={nda.nda} onChange={(e) => setNda({ ...nda, nda: e.target.value })} inputMode="numeric" placeholder="11 chiffres" /></label>
              <label className="block"><span className="label">Région du préfet</span><input className="input" value={nda.nda_region} onChange={(e) => setNda({ ...nda, nda_region: e.target.value })} /></label>
              <button type="button" className="btn btn-primary" disabled={busy === 'nda'} onClick={saveNumber}>Enregistrer</button>
            </div>
          )}
        </Step>
      </section>

      <div className="space-y-4">
        <section className="card card-flush">
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <h2 className="section-title">Pièces du dossier</h2>
            <span className="muted text-ui-sm">{pieces.filter((p) => p.ready).length} sur {pieces.length}</span>
          </div>
          {pieces.map((p) => (
            <div key={p.kind} className="flex items-start gap-3 px-4 py-3 border-b border-gray-100">
              <div className="flex-1 min-w-0">
                <div className="text-ui">{p.label}</div>
                <div className={`text-ui-sm ${p.ready ? 'text-green-800' : 'text-gray-500'}`}>
                  {p.source === 'depose' ? 'Déposée' : p.source === 'session' ? 'Reprise de la session' : p.source === 'genere' ? 'Générée par l\'outil' : p.hint}
                </div>
                {p.docs.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 text-ui-sm mt-1">
                    <button type="button" className="text-left underline truncate" onClick={() => openDoc(d)}>{d.file_name}</button>
                    {canWrite && <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={`Retirer ${d.file_name}`} disabled={busy === d.id} onClick={() => delDoc(d)}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 flex-none">
                {p.generated && <button type="button" className="btn btn-secondary btn-sm" disabled={busy === p.kind} onClick={() => generate(p.kind)}>{busy === p.kind ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}Voir</button>}
                {p.fromSession && !p.docs.length && firstSession?.convention_signed_file_url && <button type="button" className="btn btn-secondary btn-sm" onClick={openSessionConvention}><FileText className="w-4 h-4" />Voir</button>}
                {p.upload && canWrite && (
                  <>
                    <input ref={(el) => { fileRefs.current[p.kind] = el }} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => { upload(p.kind, e.target.files?.[0]); e.target.value = '' }} />
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy === p.kind} onClick={() => fileRefs.current[p.kind]?.click()}>
                      {busy === p.kind ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Déposer
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          <div className="p-4">
            <button type="button" className="btn btn-primary w-full" disabled={busy === 'zip'} onClick={downloadAll}>
              {busy === 'zip' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}Télécharger le dossier
            </button>
            <p className="muted text-ui-sm mt-2">Le dépôt se fait sur Mon Activité Formation. Rien n'est transmis à l'administration depuis l'outil. Pièces d'identité et casier sont dans un espace privé, visible de la direction et de la gestion seulement.</p>
          </div>
        </section>

        <section className="card space-y-2">
          <h2 className="section-title">Une fois le numéro reçu</h2>
          <ul className="space-y-2 text-ui-sm">
            <li className="flex gap-2"><span className="badge badge-success flex-none">Auto</span><span>Pied de page de tous les documents : « NDA » suivi du numéro et de la région du préfet (conventions, devis, contrats, factures, article R6351-6).</span></li>
            <li className="flex gap-2"><span className="badge badge-neutral flex-none">Site et plaquettes</span><span>Toute publicité qui cite le numéro doit le faire sous la seule forme « Enregistrée sous le numéro {organization?.nda || '[numéro]'}. Cet enregistrement ne vaut pas agrément de l'État. » (article L6352-12).</span></li>
            <li className="flex gap-2"><span className="badge badge-neutral flex-none">Rappel</span><span>Tout changement (adresse, dirigeant, activité) se déclare dans les 30 jours (R6351-8).</span></li>
            <li className="flex gap-2"><span className="badge badge-neutral flex-none">Rappel</span><span>Sans BPF déposé, ou avec un BPF sans activité, la déclaration devient caduque (L6351-6).</span></li>
          </ul>
        </section>
      </div>
    </div>
  )
}
