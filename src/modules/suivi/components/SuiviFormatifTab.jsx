// Onglet « Suivi formatif » de la fiche session (PC) : matrice stagiaires × séquences, couverture avant l'épreuve,
// remarques, fiche de suivi PDF et archives versionnées. La saisie se fait sur la page plein écran (téléphone ou PC).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'
import toast from 'react-hot-toast'
import { Smartphone, FileDown, Archive, ExternalLink, Loader2, ClipboardList, AlertTriangle, X, History } from 'lucide-react'
import { useAuthStore } from '../../../core/store'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { SF_MODULE, STATUSES, statusOf, loadSessionFormative, initSession, effectiveStatus, indexEvaluations, computeCoverage, hasRoles, principalRole, notedSequenceCount, canWriteSession } from '../lib/sfData'
import { modalityShort, modalityLabel } from '../lib/sequenceTemplates'
import { archiveFormativeSheet, openArchive } from '../lib/archive'
import { buildFicheSuiviPDF } from '../pdf/ficheSuiviPDF'

const fullName = (t) => `${t.first_name} ${(t.last_name || '').toUpperCase()}`.trim()
const frDateTime = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

export default function SuiviFormatifTab({ sessionId, sessionStatus }) {
  const { modules, userRole, profile } = useAuthStore()
  const enabled = (modules || []).includes(SF_MODULE)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [qr, setQr] = useState(null)
  const [reasonAsk, setReasonAsk] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await loadSessionFormative(sessionId))
      setError(null)
    } catch (e) { setError(e.message || String(e)) }
    setLoading(false)
  }, [sessionId])

  useEffect(() => { if (enabled) load() }, [enabled, load])

  const isTrainer = !!(data?.session?.trainer_id && profile?.trainer_id && data.session.trainer_id === profile.trainer_id)
  const canWrite = canWriteSession(userRole, isTrainer)

  const idx = useMemo(() => indexEvaluations(data?.evaluations || []), [data])
  const coverage = useMemo(() => (data ? computeCoverage(data.sequences, data.evaluations, data.trainees) : null), [data])
  const lastSheet = data?.sheets?.[0] || null
  const changedSince = useMemo(() => {
    if (!data || !lastSheet) return false
    const t = new Date(lastSheet.created_at).getTime()
    const times = [
      ...data.evaluations.map((e) => e.updated_at),
      ...data.sequences.map((s) => s.group_updated_at),
      ...data.sequences.map((s) => s.closed_at),
    ].filter(Boolean).map((x) => new Date(x).getTime())
    return times.some((x) => x > t + 1000)
  }, [data, lastSheet])

  if (!enabled) {
    return <div className="card text-center text-gray-500 py-10">Le module Suivi formatif n'est pas activé (Console, Modules).</div>
  }
  if (loading) return <div className="card flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  if (error) return <div className="card text-[rgb(var(--c-danger))]">{error}</div>

  const phoneUrl = `${window.location.origin}/#/suivi/${sessionId}`

  const prepare = async () => {
    setBusy(true)
    try {
      const n = await initSession(sessionId)
      if (!n) toast.error('Aucune séquence dans la fiche de la formation')
      await load()
    } catch (e) { toast.error(e.message || 'Préparation impossible') }
    setBusy(false)
  }

  const showQr = async () => {
    try { setQr(await QRCode.toDataURL(phoneUrl, { width: 256, margin: 2 })) } catch { setQr('') }
  }

  const makePdf = async (version = null) => {
    const ORG = await loadPdfOrg()
    return buildFicheSuiviPDF(ORG, { ...data, version, archivedAt: version ? new Date().toISOString() : null })
  }

  const download = async () => {
    setBusy(true)
    try {
      const doc = await makePdf()
      doc.save(`Fiche_suivi_formatif_${data.session.reference || sessionId.slice(0, 8)}.pdf`)
    } catch (e) { toast.error(e.message || 'PDF impossible') }
    setBusy(false)
  }

  const archive = async (reason) => {
    setBusy(true)
    try {
      const nextVersion = (lastSheet?.version || 0) + 1
      const doc = await makePdf(nextVersion)
      const bytes = doc.output('arraybuffer')
      const r = await archiveFormativeSheet(sessionId, bytes, { fileName: `Fiche_suivi_formatif_${data.session.reference || ''}_v${nextVersion}.pdf`, reason })
      toast.success(`Fiche archivée, version ${r.version}`)
      await load()
    } catch (e) { toast.error(e.message || 'Archivage impossible') }
    setBusy(false)
    setReasonAsk(null)
  }

  if (!data.sequences.length) {
    return (
      <div className="card text-center py-10 space-y-3">
        <ClipboardList className="w-10 h-10 mx-auto text-gray-300" aria-hidden="true" />
        <p className="text-gray-600">Aucune séquence dans cette session.</p>
        {canWrite && (
          <button type="button" onClick={prepare} disabled={busy} className="btn btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reprendre les séquences de la formation'}
          </button>
        )}
        <p className="text-ui-sm text-gray-500">Les séquences se définissent dans le catalogue, fiche de la formation, bouton « Séquences ».</p>
      </div>
    )
  }

  const noted = notedSequenceCount(data.sequences, data.evaluations)
  const roleName = principalRole(data.sequences.find(hasRoles))
  const remarks = []
  data.sequences.forEach((s, i) => {
    if (s.group_remark) remarks.push({ k: `g${s.id}`, who: 'Groupe', seq: `S${i + 1}`, text: s.group_remark })
    data.trainees.forEach((t) => {
      const row = idx.get(`${s.id}|${t.id}`)
      if (row?.remark) remarks.push({ k: `${s.id}${t.id}`, who: fullName(t), seq: `S${i + 1} ${s.title}`, text: row.remark })
    })
  })
  const sessionDone = ['completed', 'termine', 'terminée', 'done'].includes(String(sessionStatus || '').toLowerCase())

  return (
    <div className="space-y-5">
      {sessionDone && !lastSheet && canWrite && (
        <div className="card bg-[rgb(var(--c-warning-bg))] border-[rgb(var(--c-warning)/0.3)] flex flex-wrap items-center justify-between gap-3">
          <span className="text-[rgb(var(--c-warning))] text-ui flex items-center gap-2"><AlertTriangle className="w-4 h-4" aria-hidden="true" />Session terminée : la fiche de suivi n'est pas encore archivée.</span>
          <button type="button" onClick={() => archive(null)} disabled={busy} className="btn btn-primary btn-sm">Archiver la fiche</button>
        </div>
      )}
      {lastSheet && changedSince && canWrite && (
        <div className="card bg-[rgb(var(--c-warning-bg))] border-[rgb(var(--c-warning)/0.3)] flex flex-wrap items-center justify-between gap-3">
          <span className="text-[rgb(var(--c-warning))] text-ui flex items-center gap-2"><AlertTriangle className="w-4 h-4" aria-hidden="true" />Saisies modifiées depuis la version {lastSheet.version} archivée : archivez une nouvelle version (l'ancienne reste).</span>
          <button type="button" onClick={() => setReasonAsk('')} disabled={busy} className="btn btn-primary btn-sm">Nouvelle version</button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3">
          <div className="card py-2.5 px-4"><div className="text-ui-sm text-gray-500">Séquences notées</div><div className="font-display text-xl font-semibold">{noted} sur {data.sequences.length}</div></div>
          {coverage.hasRoleSequences && (
            <div className="card py-2.5 px-4"><div className="text-ui-sm text-gray-500">Jamais {String(roleName || 'en rôle principal').toLowerCase()}</div><div className={`font-display text-xl font-semibold ${coverage.neverPrincipal.length ? 'text-[rgb(var(--c-warning))]' : ''}`}>{coverage.neverPrincipal.length} stagiaire{coverage.neverPrincipal.length > 1 ? 's' : ''}</div></div>
          )}
          <div className="card py-2.5 px-4"><div className="text-ui-sm text-gray-500">À revoir non repris</div><div className={`font-display text-xl font-semibold ${coverage.pending.length ? 'text-[rgb(var(--c-danger))]' : ''}`}>{coverage.pending.length}</div></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={showQr} className="btn btn-secondary flex items-center gap-2"><Smartphone className="w-4 h-4" aria-hidden="true" />Ouvrir sur téléphone</button>
          <Link to={`/suivi/${sessionId}`} className="btn btn-secondary flex items-center gap-2"><ExternalLink className="w-4 h-4" aria-hidden="true" />{canWrite ? 'Saisir' : 'Voir la saisie'}</Link>
          <button type="button" onClick={download} disabled={busy} className="btn btn-secondary flex items-center gap-2"><FileDown className="w-4 h-4" aria-hidden="true" />Fiche PDF</button>
          {canWrite && (
            <button type="button" onClick={() => (lastSheet ? setReasonAsk('') : archive(null))} disabled={busy} className="btn btn-primary flex items-center gap-2">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" aria-hidden="true" />}Archiver la fiche
            </button>
          )}
        </div>
      </div>

      <section className="card">
        <div className="overflow-x-auto">
          <table className="border-separate text-[13px]" style={{ borderSpacing: 4 }}>
            <thead>
              <tr>
                <th scope="col" className="text-left font-semibold px-2 min-w-[160px]">Stagiaire</th>
                {data.sequences.map((s, i) => (
                  <th key={s.id} scope="col" title={`${s.title} · ${modalityLabel(s.modality)}${(s.competences || []).length ? ` · ${s.competences.join(', ')}` : ''}`} className="font-semibold w-12 text-center leading-tight">
                    S{i + 1}<br /><span className="font-normal text-gray-500 text-ui-sm">{modalityShort(s.modality)}</span>
                  </th>
                ))}
                {coverage.hasRoleSequences && <th scope="col" className="font-semibold px-2 text-center">{roleName || 'Rôle'}</th>}
              </tr>
            </thead>
            <tbody>
              {data.trainees.map((t) => (
                <tr key={t.id}>
                  <th scope="row" className="text-left font-medium px-2 whitespace-nowrap">{fullName(t)}</th>
                  {data.sequences.map((s) => {
                    const row = idx.get(`${s.id}|${t.id}`)
                    const eff = effectiveStatus(s, row)
                    const st = statusOf(eff.key)
                    const isP = row?.role && hasRoles(s) && row.role === principalRole(s)
                    const style = !st
                      ? { background: '#fff', border: '1px dashed #D8D8D3' }
                      : eff.source === 'groupe' && !isP
                        ? { background: st.tint, color: st.ink }
                        : { background: st.solid, color: '#fff' }
                    return (
                      <td key={s.id} title={`${s.title}${st ? ` : ${st.label}` : ''}${row?.role ? ` · ${row.role}` : ''}${row?.remark ? ` · ${row.remark}` : ''}`}
                        className="w-12 h-8 text-center rounded-ui-sm font-semibold" style={style}>
                        {st ? st.code : ''}{isP ? ' P' : ''}
                      </td>
                    )
                  })}
                  {coverage.hasRoleSequences && (
                    <td className={`text-center font-semibold rounded-ui-sm ${coverage.principalCount[t.id] ? '' : 'bg-[rgb(var(--c-warning-bg))] text-[rgb(var(--c-warning))]'}`}>{coverage.principalCount[t.id] || 0}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-ui-sm text-gray-600">
          {STATUSES.map((s) => <span key={s.key}><strong style={{ color: s.solid }}>{s.code}</strong> {s.label.toLowerCase()}</span>)}
          <span>Fond pâle : note du groupe · fond plein : noté pour le stagiaire · P : {String(roleName || 'rôle principal').toLowerCase()}</span>
        </div>
      </section>

      {coverage.hasRoleSequences && coverage.byCompetence.some((c) => c.missing.length) && (
        <section className="card space-y-1.5">
          <h3 className="font-semibold">Avant l'épreuve</h3>
          {coverage.byCompetence.filter((c) => c.missing.length).map((c) => (
            <p key={c.code} className="text-ui"><strong>{c.code}</strong> · {c.seen} sur {c.total} vus · pas encore : {c.missing.map(fullName).join(', ')}</p>
          ))}
        </section>
      )}

      <section className="card space-y-1.5">
        <h3 className="font-semibold">Remarques</h3>
        {remarks.length === 0 && <p className="text-ui text-gray-500">Aucune remarque.</p>}
        {remarks.map((r) => <p key={r.k} className="text-ui"><strong>{r.who}</strong> · {r.seq} · {r.text}</p>)}
      </section>

      <section className="card space-y-2">
        <h3 className="font-semibold flex items-center gap-2"><History className="w-4 h-4" aria-hidden="true" />Fiches archivées</h3>
        {data.sheets.length === 0 && <p className="text-ui text-gray-500">Aucune fiche archivée. Une fiche archivée n'est jamais remplacée : chaque archivage crée une nouvelle version.</p>}
        {data.sheets.map((sh) => (
          <div key={sh.id} className="flex flex-wrap items-center justify-between gap-2 text-ui border-b border-gray-100 py-1.5">
            <span><strong>Version {sh.version}</strong> · {frDateTime(sh.created_at)}{sh.reason ? ` · ${sh.reason}` : ''}</span>
            <button type="button" onClick={() => openArchive(sh.file_path).catch((e) => toast.error(e.message || 'Ouverture impossible'))} className="btn btn-secondary btn-sm">Ouvrir</button>
          </div>
        ))}
      </section>

      {qr !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setQr(null)}>
          <div role="dialog" aria-label="Ouvrir sur téléphone" className="bg-white rounded-ui p-5 max-w-sm w-full text-center space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center"><h3 className="font-semibold">Ouvrir sur téléphone</h3><button type="button" aria-label="Fermer" onClick={() => setQr(null)} className="p-2"><X className="w-4 h-4" /></button></div>
            {qr ? <img src={qr} alt="QR code de la saisie du suivi formatif" className="mx-auto w-56 h-56" /> : null}
            <p className="text-ui-sm text-gray-500 break-all">{phoneUrl}</p>
            <p className="text-ui-sm text-gray-500">Le formateur doit être connecté à son compte sur le téléphone.</p>
          </div>
        </div>
      )}

      {reasonAsk !== null && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setReasonAsk(null)}>
          <div role="dialog" aria-label="Nouvelle version de la fiche" className="bg-white rounded-ui p-5 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold">Nouvelle version de la fiche</h3>
            <p className="text-ui text-gray-600">La version {lastSheet?.version} reste archivée telle quelle. Indiquez pourquoi une nouvelle version est archivée.</p>
            <label htmlFor="sf-reason" className="text-ui font-medium">Motif</label>
            <input id="sf-reason" className="input w-full" value={reasonAsk} onChange={(e) => setReasonAsk(e.target.value)} placeholder="Ex. remarque complétée après la session" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReasonAsk(null)} className="btn btn-secondary">Annuler</button>
              <button type="button" disabled={busy || !reasonAsk.trim()} onClick={() => archive(reasonAsk.trim())} className="btn btn-primary">Archiver la version {(lastSheet?.version || 0) + 1}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
