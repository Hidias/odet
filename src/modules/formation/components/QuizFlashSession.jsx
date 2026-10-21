import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Zap, Loader2, Monitor, QrCode } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import QuizFlashEcran from './QuizFlashEcran'

// Quiz flash de la session (0425) : le formateur le lance entre deux étapes (deux fois par jour, par exemple), en
// plein écran sur le vidéoprojecteur ou avec le QR code seul. Rien de certificatif : les résultats restent dans la
// session comme évaluation en cours de formation. Les questions viennent de la banque du thème (modifiable dans
// Formation › Tests et questions).

const fmt = (d) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function QuizFlashSession({ session, peutModifier }) {
  const [themes, setThemes] = useState([])
  const [theme, setTheme] = useState('')
  const [mode, setMode] = useState('direct')
  const [nb, setNb] = useState(5)
  const [busy, setBusy] = useState(false)
  const [ouvert, setOuvert] = useState(null)
  const [parties, setParties] = useState(null)

  const charger = async () => {
    const [{ data: th }, { data: pa }] = await Promise.all([
      supabase.from('training_themes').select('id, name').order('position'),
      supabase.from('quiz_flash_parties').select('id, mode, phase, created_at, question_ids, quiz_flash_reponses(juste), quiz_flash_joueurs(id)')
        .eq('session_id', session.id).order('created_at', { ascending: false }).limit(10),
    ])
    setThemes(th || [])
    setParties(pa || [])
  }
  useEffect(() => { if (session?.id) charger() }, [session?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!theme && session?.courses?.theme_id) setTheme(session.courses.theme_id) }, [session?.courses?.theme_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const lancer = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('quiz_flash_lancer', { p_session: session.id, p_mode: mode, p_theme: theme || null, p_nb: Number(nb) || 5 })
    setBusy(false)
    if (error) return toast.error(error.message)
    setOuvert(data.id)
    charger()
  }

  if (parties === null) return null
  const enCours = parties.find((p) => p.phase !== 'fini')

  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-2">
        <Zap className="w-5 h-5 text-accent-600 mt-0.5" aria-hidden="true" />
        <div className="flex-1">
          <h3 className="font-semibold">Quiz flash</h3>
          <p className="text-ui-sm text-gray-600">Un petit quiz ludique entre deux étapes, pour voir où en est le groupe. Non certificatif : pas grave s'il n'est pas fait. Les stagiaires jouent sur le portail, sous un surnom.</p>
        </div>
      </div>

      {enCours && <button type="button" className="btn btn-primary btn-sm" onClick={() => setOuvert(enCours.id)}><Monitor className="w-4 h-4" />Reprendre le quiz en cours</button>}

      {peutModifier && (
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto] items-end">
          <div>
            <label className="label" htmlFor="qf-mode">Affichage</label>
            <select id="qf-mode" className="select" value={mode} onChange={(ev) => setMode(ev.target.value)}>
              <option value="direct">Plein écran (vidéoprojecteur)</option>
              <option value="autonome">QR code seul (chacun à son rythme)</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="qf-theme">Thème des questions</label>
            <select id="qf-theme" className="select" value={theme} onChange={(ev) => setTheme(ev.target.value)}>
              <option value="">Choisir…</option>
              {themes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="qf-nb">Questions</label>
            <select id="qf-nb" className="select" value={nb} onChange={(ev) => setNb(ev.target.value)}>
              {[3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy || !theme} onClick={lancer}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (mode === 'direct' ? <Monitor className="w-4 h-4" /> : <QrCode className="w-4 h-4" />)}Lancer
          </button>
        </div>
      )}

      {parties.length > 0 && (
        <ul className="text-ui-sm divide-y divide-gray-100">
          {parties.map((p) => {
            const r = p.quiz_flash_reponses || []
            const pc = r.length ? Math.round(r.filter((x) => x.juste).length / r.length * 100) : null
            return (
              <li key={p.id} className="py-1.5 flex flex-wrap gap-x-3">
                <span className="text-gray-500">{fmt(p.created_at)}</span>
                <span>{p.mode === 'direct' ? 'Plein écran' : 'QR code seul'}</span>
                <span>{(p.quiz_flash_joueurs || []).length} joueur{(p.quiz_flash_joueurs || []).length > 1 ? 's' : ''}</span>
                <span>{pc == null ? 'aucune réponse' : `${pc} % de bonnes réponses`}</span>
                {p.phase !== 'fini' && <span className="text-accent-700 font-medium">en cours</span>}
                <button type="button" className="text-accent-700 underline" onClick={() => setOuvert(p.id)}>Voir</button>
              </li>
            )
          })}
        </ul>
      )}

      {ouvert && <QuizFlashEcran partieId={ouvert} session={session} onFermer={() => { setOuvert(null); charger() }} />}
    </div>
  )
}
