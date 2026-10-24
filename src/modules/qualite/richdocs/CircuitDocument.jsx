// Circuit de validation d'un document (0455), dans la fiche du document : circuit choisi, relecture en cours,
// lancement de la relecture (relecteurs, questions ouvertes, consigne, échéance).
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Send, X, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useDroits } from '../../../core/rights/useDroit'
import { MODES, ETATS, modeDuDocument, chargerReglages, enregistrerReglages, circuitOuvert, lancerCircuit } from './circuit'
import { StatusChip } from './RichDocEditor'
import { confirmer } from '../../../ui/Confirm'

function Lancement({ tpl, mode, onFermer, avantLancement }) {
  const navigate = useNavigate()
  const [gens, setGens] = useState(null)
  const [choisis, setChoisis] = useState([])
  const [questions, setQuestions] = useState(() => (tpl.questions || []).map((q) => ({ section: q.section, q: q.q, choix: q.choix.join('\n') })))
  const [message, setMessage] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.rpc('relecteurs_possibles').then(({ data, error }) => setGens(error ? [] : data || []))
  }, [])
  const lancer = async () => {
    if (!choisis.length && !await confirmer('Aucun relecteur choisi : vous serez seul à relire. Continuer ?')) return
    setBusy(true)
    try {
      const content = await avantLancement()
      if (!content) { setBusy(false); return }
      const r = await lancerCircuit({ tpl, content, mode, participants: choisis, questions: questions.map((q) => ({ ...q, choix: q.choix.split('\n') })), message, dueOn: due || null })
      toast.success('Relecture lancée : les relecteurs la trouvent dans leurs notifications et dans « Relectures »')
      navigate(`/relectures/${r.id}`)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center p-3" role="dialog" aria-modal="true" aria-label="Lancer la relecture">
      <div className="bg-white rounded-ui-lg w-full max-w-lg max-h-[92vh] overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-lg">Lancer la relecture</h2><button type="button" className="btn btn-ghost btn-icon" aria-label="Fermer" onClick={onFermer}><X className="w-5 h-5" /></button></div>
        <p className="text-ui-sm text-gray-500">{MODES[mode].aide} Le texte est figé au lancement ; la version en vigueur ne change qu'à la validation.</p>
        <div>
          <p className="label">Relecteurs de l'équipe</p>
          {!gens ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : gens.length === 0 ? <p className="text-ui-sm text-gray-500">Aucun compte disponible.</p> : (
            <div className="space-y-1">
              {gens.map((g) => (
                <label key={g.id} className="flex items-center gap-2 min-h-[40px] text-ui">
                  <input type="checkbox" className="w-4 h-4" checked={choisis.includes(g.id)} onChange={(e) => setChoisis(e.target.checked ? [...choisis, g.id] : choisis.filter((x) => x !== g.id))} />
                  <span>{g.nom}<span className="text-gray-500">{g.fonction ? ` · ${g.fonction}` : ''}</span></span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <p className="label">Questions ouvertes (les relecteurs choisissent, la direction tranche)</p>
          {questions.map((q, i) => (
            <div key={i} className="rounded-ui-sm border border-gray-200 p-2 space-y-1.5">
              <div className="flex gap-2"><input className="input flex-1" value={q.q} placeholder="Question" onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} />
                <button type="button" className="btn btn-ghost btn-icon" aria-label="Retirer la question" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button></div>
              <textarea className="input w-full text-ui-sm" rows={3} value={q.choix} placeholder="Un choix par ligne (2 à 6)" onChange={(e) => setQuestions(questions.map((x, j) => (j === i ? { ...x, choix: e.target.value } : x)))} />
              {q.section && <p className="text-ui-sm text-gray-500">Rattachée à l'article « {tpl.sections.find((s) => s.id === q.section)?.title || q.section} »</p>}
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQuestions([...questions, { q: '', choix: '' }])}><Plus className="w-4 h-4" />Ajouter une question</button>
        </div>
        <label className="block"><span className="label">Consigne aux relecteurs (facultatif)</span><textarea className="input w-full" rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
        <label className="block"><span className="label">Réponse souhaitée avant le (facultatif)</span><input type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={lancer}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}Lancer la relecture</button>
      </div>
    </div>
  )
}

/** Panneau de la fiche ; onMode(mode) prévient l'éditeur (le bouton « Valider » ne vaut que pour le circuit direct) */
export default function CircuitDocument({ tpl, avantLancement, onMode }) {
  const navigate = useNavigate()
  const d = useDroits({ valider: 'qualite.documents.valider', gerer: ['qualite.documents.gerer', 'qualite.documents.valider'] })
  const [reglages, setReglages] = useState(null)
  const [ouvert, setOuvert] = useState(undefined)
  const [lancer, setLancer] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    Promise.all([chargerReglages(), circuitOuvert(tpl.id)])
      .then(([g, o]) => { setReglages(g); setOuvert(o) })
      .catch(() => { setReglages({ default_mode: 'direct', per_doc: {}, absent: true }); setOuvert(null) })
  }, [tpl.id])
  const mode = modeDuDocument(reglages, tpl.id)
  useEffect(() => { if (reglages) onMode?.(mode, ouvert || null) }, [mode, ouvert]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!reglages || ouvert === undefined || reglages.absent) return null

  const changerMode = async (m) => {
    setBusy(true)
    try {
      const g = await enregistrerReglages({ perDoc: { [tpl.id]: m === '' ? null : m } })
      setReglages(g); toast.success('Circuit enregistré pour ce document')
    } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const propre = reglages.per_doc?.[tpl.id] || ''
  return (
    <section>
      <h2 className="font-semibold text-ui mb-1">Circuit de validation</h2>
      {d.valider ? (
        <label className="block mb-2">
          <span className="sr-only">Circuit de ce document</span>
          <select className="select w-full" value={propre} disabled={busy || !!ouvert} onChange={(e) => changerMode(e.target.value)}>
            <option value="">Comme le réglage général ({MODES[reglages.default_mode || 'direct'].label.toLowerCase()})</option>
            {Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </label>
      ) : <p className="text-ui-sm text-gray-700 mb-1">{MODES[mode].label}</p>}
      <p className="text-ui-sm text-gray-500 mb-2">{MODES[mode].aide}</p>
      {ouvert ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={ETATS[ouvert.status]} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/relectures/${ouvert.id}`)}>Ouvrir la relecture</button>
        </div>
      ) : mode !== 'direct' && d.gerer && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setLancer(true)}><Send className="w-4 h-4" />Lancer la relecture</button>
      )}
      {lancer && <Lancement tpl={tpl} mode={mode} onFermer={() => setLancer(false)} avantLancement={avantLancement} />}
    </section>
  )
}

/** Réglage général du circuit (Processus qualité, Documents) ; « commerce » : ids des conditions commerciales */
export function ReglageCircuit({ commerce = [] }) {
  const d = useDroits({ valider: 'qualite.documents.valider' })
  const [g, setG] = useState(null)
  const [enCours, setEnCours] = useState(0)
  const [busy, setBusy] = useState(false)
  const [pour, setPour] = useState('complet')
  useEffect(() => {
    chargerReglages().then(setG).catch(() => setG(null))
    supabase.from('doc_reviews').select('id', { count: 'exact', head: true }).in('status', ['relecture', 'arbitrage', 'expert'])
      .then(({ count }) => setEnCours(count || 0))
  }, [])
  if (!g) return null
  const enregistrer = async (patch, ok) => {
    setBusy(true)
    try { setG(await enregistrerReglages(patch)); toast.success(ok) } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const nbCommerce = commerce.filter((id) => g.per_doc?.[id]).length
  return (
    <div className="card p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold flex-1 min-w-[12rem]">Circuit de validation des documents</h3>
        {enCours > 0 && <a href="#/relectures" className="btn btn-secondary btn-sm">{enCours} relecture{enCours > 1 ? 's' : ''} en cours</a>}
      </div>
      <p className="text-ui-sm text-gray-500">Chaque document peut être validé directement, relu par l'équipe, ou relu puis vérifié par un expert (avocat, juriste, expert-comptable…). Le réglage se fait ici pour tous les documents, et dans la fiche de chacun.</p>
      {d.valider ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="label">Par défaut</span>
            <select className="select w-full" value={g.default_mode || 'direct'} disabled={busy} onChange={(e) => enregistrer({ defaultMode: e.target.value }, 'Circuit par défaut enregistré')}>
              {Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </label>
          {commerce.length > 0 && (
            <div className="block"><span className="label">Conditions commerciales ({nbCommerce ? `${nbCommerce} réglée${nbCommerce > 1 ? 's' : ''}` : 'comme le défaut'})</span>
              <div className="flex gap-2">
                <select className="select flex-1" value={pour} onChange={(e) => setPour(e.target.value)}>{Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => enregistrer({ perDoc: Object.fromEntries(commerce.map((id) => [id, pour])) }, 'Circuit appliqué aux conditions commerciales')}>Appliquer</button>
              </div>
            </div>
          )}
        </div>
      ) : <p className="text-ui-sm text-gray-700">Par défaut : {MODES[g.default_mode || 'direct'].label}</p>}
    </div>
  )
}
