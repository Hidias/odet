// Résultats publiés et méthode de calcul (indicateur 2), recalculés à chaque ouverture.

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Copy, Download, Loader2, Check } from 'lucide-react'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { computeResults, publishedLines, publishedText } from '../lib/results'
import { loadResultsData } from '../lib/resultsData'
import { buildMethodePDF } from '../pdf/methodePDF'
import { saveSettings, todayIso, frDate, addMonths, addDays } from '../lib/certData'

const SHOW = [['satisfaction', 'Satisfaction'], ['objectives', 'Atteinte des objectifs'], ['attendance', 'Assiduité'], ['recommendation', 'Recommandation']]

function periodOf(kind) {
  const today = todayIso()
  const y = Number(today.substring(0, 4))
  if (kind === '12m') return { from: addDays(addMonths(today, -12), 1), to: today }
  if (kind === 'year') return { from: `${y}-01-01`, to: today }
  if (kind === 'lastyear') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  return { from: null, to: today }
}

export default function CertMethode({ settings, canWrite, organization, reloadSettings, reloadIndicators }) {
  const [data, setData] = useState(null)
  const [kind, setKind] = useState('12m')
  const [show, setShow] = useState({ satisfaction: true, objectives: true, attendance: true, recommendation: true })
  const [pub, setPub] = useState({ date: settings.results_published_at || todayIso(), url: settings.results_published_url || '' })
  const [busy, setBusy] = useState(null)

  useEffect(() => { loadResultsData().then(setData).catch((e) => toast.error(e.message)) }, [])
  const period = periodOf(kind)
  const results = useMemo(() => (data ? computeResults({ ...data, period }) : null), [data, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const lines = results ? publishedLines(results, show) : []
  const orgName = organization?.name || organization?.legal_name || ''

  const copy = async () => {
    try { await navigator.clipboard.writeText(publishedText(results, show, { orgName, ...period, updatedOn: todayIso() })); toast.success('Texte copié') } catch { toast.error('Copie impossible dans ce navigateur') }
  }
  const pdf = async () => {
    setBusy('pdf')
    try { const ORG = await loadPdfOrg(true); const r = buildMethodePDF(ORG, results, show, period); r.doc.save(r.filename) } catch (e) { toast.error(e.message) }
    setBusy(null)
  }
  const markPublished = async () => {
    setBusy('pub')
    try { await saveSettings({ results_published_at: pub.date || todayIso(), results_published_url: pub.url.trim() || null }); await reloadSettings(); await reloadIndicators(); toast.success('Publication notée (indicateur 2)') } catch (e) { toast.error(e.message) }
    setBusy(null)
  }

  if (!results) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] items-start">
      <section className="card space-y-4">
        <h2 className="section-title">Réglages</h2>
        <label className="block"><span className="label">Période</span>
          <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="12m">12 derniers mois</option>
            <option value="year">Année en cours</option>
            <option value="lastyear">Année précédente</option>
            <option value="all">Depuis la mise en service</option>
          </select>
        </label>
        <div className="space-y-1">
          <span className="label">Résultats à publier</span>
          {SHOW.map(([k, l]) => (
            <label key={k} className="flex items-center gap-2 min-h-[40px] text-ui"><input type="checkbox" className="w-4 h-4" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />{l}</label>
          ))}
        </div>
        <p className="muted text-ui-sm">Seules les sessions terminées comptent. Un résultat calculé sur moins de 10 réponses porte la mention « effectif réduit ».</p>
        {data.demoCount > 0 && <p className="text-ui-sm rounded-lg bg-amber-50 border border-amber-300 p-2">Les données de démonstration sont comprises dans ce calcul. Ne publiez qu'après les avoir effacées.</p>}
        {canWrite && (
          <div className="border-t border-gray-100 pt-3 space-y-2">
            <span className="label">Publication sur le site</span>
            <input className="input" type="date" aria-label="Date de publication" value={pub.date} onChange={(e) => setPub({ ...pub, date: e.target.value })} />
            <input className="input" type="url" placeholder="Adresse de la page (facultatif)" value={pub.url} onChange={(e) => setPub({ ...pub, url: e.target.value })} />
            <button type="button" className="btn btn-secondary w-full" disabled={busy === 'pub'} onClick={markPublished}><Check className="w-4 h-4" />Noter la publication</button>
            {settings.results_published_at && <p className="muted text-ui-sm">Dernière publication notée le {frDate(settings.results_published_at)}.</p>}
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="muted text-ui-sm">Aperçu, recalculé le {frDate(todayIso())}</div>
            <h2 className="section-title text-lg">Nos résultats et leur méthode de calcul</h2>
            <div className="text-ui-sm muted">
              Formations terminées{period.from ? ` du ${frDate(period.from)}` : ''} au {frDate(period.to)} : {results.sessions} session{results.sessions > 1 ? 's' : ''}, {results.trainees} stagiaire{results.trainees > 1 ? 's' : ''}.
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="btn btn-secondary" onClick={copy}><Copy className="w-4 h-4" />Copier le texte pour le site</button>
            <button type="button" className="btn btn-primary" disabled={busy === 'pdf'} onClick={pdf}>{busy === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}PDF</button>
          </div>
        </div>
        {lines.map((l) => (
          <div key={l.key} className="grid gap-x-5 gap-y-1 sm:grid-cols-[150px_minmax(0,1fr)] py-3 border-t border-gray-100">
            <div className="font-display font-semibold text-xl">{l.value}{l.small && <span className="block text-ui-sm font-normal muted">effectif réduit</span>}</div>
            <div>
              <div className="font-semibold text-ui">{l.label}</div>
              <div className="text-ui-sm text-gray-700">{l.method}</div>
              <div className="text-ui-sm muted">Base : {l.sample}.</div>
            </div>
          </div>
        ))}
        {!lines.length && <p className="muted text-ui-sm">Cochez au moins un résultat.</p>}
      </section>
    </div>
  )
}
