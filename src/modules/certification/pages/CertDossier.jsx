// Dossier d'audit : un PDF par critère, les preuves ajoutées à la main et un échantillon de sessions, dans un zip.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import JSZip from 'jszip'
import { Loader2, Download, ChevronRight } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { StatusBadge } from '../components/ui'
import { downloadBlob } from '../lib/certData'
import { buildCriterionPDF, buildSamplePDF } from '../pdf/dossierAuditPDF'

const safe = (s) => String(s || 'fichier').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/_+/g, '_').substring(0, 80)

export default function CertDossier({ referential: refData, evaluated }) {
  const [sel, setSel] = useState(() => Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [n, true])))
  const [opt, setOpt] = useState({ na: true, files: true, sample: 3 })
  const [busy, setBusy] = useState(false)

  if (!evaluated || !refData) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  const referential = refData.referentials.find((r) => r.code === refData.code)

  const summary = (n) => {
    const l = evaluated.filter((i) => i.criterion === n)
    const missing = l.filter((i) => i.status === 'manquant').length
    const todo = l.filter((i) => i.status === 'a_completer').length
    if (missing) return <StatusBadge status="manquant">{missing} manquant{missing > 1 ? 's' : ''}</StatusBadge>
    if (todo) return <StatusBadge status="a_completer">{todo} à compléter</StatusBadge>
    return <StatusBadge status="preuves">Complet</StatusBadge>
  }

  const generate = async () => {
    const crits = refData.criteria.filter((c) => sel[c.number])
    if (!crits.length) return toast.error('Choisir au moins un critère')
    setBusy(true)
    try {
      const ORG = await loadPdfOrg(true)
      const zip = new JSZip()
      const proofName = (p) => `preuves/${p.indicator_number}_${safe(p.file_name)}`
      for (const c of crits) {
        const doc = buildCriterionPDF(ORG, {
          criterion: c, referential, includeNa: opt.na,
          indicators: evaluated.filter((i) => i.criterion === c.number),
          proofFileName: proofName,
        })
        zip.file(`Critere_${c.number}.pdf`, doc.output('blob'))
      }
      if (opt.files) {
        const nums = new Set(evaluated.filter((i) => sel[i.criterion]).map((i) => i.number))
        for (const p of refData.proofs.filter((x) => x.file_path && nums.has(x.indicator_number))) {
          try { zip.file(proofName(p), await downloadBlob(p.file_path)) } catch { /* fichier introuvable : la ligne reste dans le PDF */ }
        }
      }
      if (opt.sample > 0) {
        const { data } = await supabase.from('sessions')
          .select('id, reference, start_date, end_date, convention_signed, convention_signed_file_url, courses(title), clients(name), session_trainees(id)')
          .eq('status', 'completed').order('end_date', { ascending: false }).limit(opt.sample)
        const sessions = data || []
        zip.file('Echantillon_sessions.pdf', buildSamplePDF(ORG, { sessions }).output('blob'))
        for (const s of sessions) {
          if (!s.convention_signed_file_url) continue
          try { zip.file(`echantillon/${safe(s.reference)}_convention_signee.pdf`, await downloadBlob(s.convention_signed_file_url, 'signed-conventions')) } catch { /* convention non lisible : ignorée */ }
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `Dossier_audit_Qualiopi_${new Date().toISOString().substring(0, 10)}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch (e) { toast.error(`Génération impossible : ${e.message}`) }
    setBusy(false)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
      <section className="card card-flush">
        <div className="px-4 pt-3 pb-2">
          <h2 className="section-title">Critères</h2>
          <p className="muted text-ui-sm">Un PDF par critère : libellé officiel de chaque indicateur, statut, éléments vérifiables dans l'outil, preuves ajoutées et justification des non applicables.</p>
        </div>
        {refData.criteria.map((c) => (
          <label key={c.number} className="flex items-center gap-3 min-h-[60px] px-4 py-2 border-t border-gray-100 cursor-pointer">
            <input type="checkbox" className="w-5 h-5 flex-none" checked={!!sel[c.number]} onChange={(e) => setSel({ ...sel, [c.number]: e.target.checked })} />
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-ui">Critère {c.number}</span>
              <span className="block text-ui-sm muted">{c.title}</span>
            </span>
            <span className="flex-none">{summary(c.number)}</span>
          </label>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Contenu</h2>
        <label className="flex items-center gap-2 min-h-[40px] text-ui"><input type="checkbox" className="w-4 h-4" checked={opt.na} onChange={(e) => setOpt({ ...opt, na: e.target.checked })} />Indicateurs non applicables, avec leur justification</label>
        <label className="flex items-center gap-2 min-h-[40px] text-ui"><input type="checkbox" className="w-4 h-4" checked={opt.files} onChange={(e) => setOpt({ ...opt, files: e.target.checked })} />Fichiers des preuves ajoutées</label>
        <label className="block"><span className="label">Échantillon de sessions</span>
          <select className="select" value={opt.sample} onChange={(e) => setOpt({ ...opt, sample: Number(e.target.value) })}>
            <option value={0}>Aucun</option>
            <option value={3}>Les 3 dernières sessions terminées</option>
            <option value={5}>Les 5 dernières sessions terminées</option>
          </select>
        </label>
        <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={generate}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}Générer le dossier</button>
        <Link to="/certification/indicateurs" className="btn btn-secondary w-full">Compléter les indicateurs <ChevronRight className="w-4 h-4" /></Link>
        <p className="muted text-ui-sm">L'audit blanc se fait depuis le tableau des indicateurs : chaque point « à préciser » est une question que posera l'auditeur.</p>
      </section>
    </div>
  )
}
