// Espace de l'expert (0457) : relecture d'un document en ligne, sans compte, avec le lien et le code reçus dans deux
// e-mails séparés. Pour chaque article : valider, proposer une rédaction, commenter ; puis « J'ai terminé ».
// L'expert ne valide jamais une version : l'entreprise arbitre ses avis.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Loader2, Check, Pencil, MessageSquare, CheckCircle, Lock } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import PublicLayout from '../../../app/PublicLayout'
import { BlockView } from '../richdocs/RichDocEditor'
import { EditeurArticle, Commentaire, Diff } from './Relecture'
import { diffProposition } from '../richdocs/circuit'
import { frDate } from '../richdocs/model'

const COND = { particuliers: 'Clients particuliers seulement', professionnels: 'Clients professionnels seulement' }
const NATURE = { validation: 'Article validé', modification: 'Rédaction proposée', commentaire: 'Commentaire' }
const cle = (t) => `odet.expert.${t}`
const lireCode = (t) => { try { return window.sessionStorage.getItem(cle(t)) || '' } catch { return '' } }
const garderCode = (t, c) => { try { window.sessionStorage.setItem(cle(t), c) } catch { /* sans stockage */ } }

export default function RelectureExpert() {
  const { token } = useParams()
  const [code, setCode] = useState(() => lireCode(token))
  const [saisie, setSaisie] = useState('')
  const [d, setD] = useState(null)
  const [erreur, setErreur] = useState('')
  const [busy, setBusy] = useState(false)
  const [ouvert, setOuvert] = useState(null) // { section, kind }
  const [fin, setFin] = useState(null) // message de fin

  const charger = useCallback(async (c = code) => {
    if (!c) return
    const { data, error } = await supabase.rpc('expert_ouvrir', { p_token: token, p_code: c })
    if (error) { setErreur('Ouverture impossible pour le moment'); return }
    if (data?.error) { setErreur(data.error); if (data.code) { setCode(''); garderCode(token, '') } return }
    setErreur(''); setD(data); garderCode(token, c); setCode(c)
  }, [token, code])
  useEffect(() => { if (code) charger(code) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const appeler = async (fn, args, ok) => {
    setBusy(true)
    const { data, error } = await supabase.rpc(fn, { p_token: token, p_code: code, ...args })
    setBusy(false)
    if (error || data?.error) { toast.error(data?.error || 'Enregistrement impossible'); return false }
    if (ok) toast.success(ok)
    setOuvert(null)
    await charger()
    return true
  }

  if (!code || !d) {
    return (
      <PublicLayout title="Relecture d'un document">
        <div className="max-w-sm mx-auto py-10 space-y-3">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto"><Lock className="w-6 h-6 text-gray-500" aria-hidden="true" /></div>
          <h1 className="text-xl font-bold text-center text-gray-900">Relecture d'un document</h1>
          <p className="text-ui text-gray-600 text-center">Saisissez le code reçu dans l'e-mail séparé.</p>
          <form onSubmit={(e) => { e.preventDefault(); setBusy(true); charger(saisie.replace(/\s/g, '')).finally(() => setBusy(false)) }} className="space-y-2">
            <label className="block"><span className="label">Code d'accès</span><input className="input text-center text-lg tracking-widest" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={saisie} onChange={(e) => setSaisie(e.target.value)} /></label>
            {erreur && <p className="text-ui-sm text-[rgb(var(--c-danger))]" role="alert">{erreur}</p>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy || saisie.replace(/\s/g, '').length < 4}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Ouvrir le document</button>
          </form>
        </div>
      </PublicLayout>
    )
  }

  const { review, expert, organisme, avis = [], questions = [] } = d
  const termine = !!expert.done_at
  const avisDe = (sid) => avis.filter((a) => a.section_id === sid)
  const generaux = avis.filter((a) => !a.section_id)

  const Avis = ({ a, section }) => (
    <div className="rounded-ui-sm border border-gray-200 bg-white p-3 space-y-1.5">
      <p className="text-ui-sm font-semibold text-gray-900">{NATURE[a.kind]} <span className="font-normal text-gray-500">· {frDate(a.created_at)}{a.status !== 'ouverte' ? ' · traité par l\'entreprise' : ''}</span></p>
      {a.kind === 'modification' && section && <Diff parts={diffProposition(section, a.proposed)} />}
      {a.text && <p className="text-ui text-gray-700 whitespace-pre-line">{a.text}</p>}
      {!termine && a.status === 'ouverte' && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => appeler('expert_retirer', { p_item: a.id }, 'Avis retiré')}>Retirer</button>}
    </div>
  )

  return (
    <PublicLayout title={review.doc_name}>
      <div className="max-w-3xl mx-auto px-3 py-5 space-y-4">
        <div>
          <p className="text-ui-sm text-gray-500">{organisme?.nom} · relecture demandée à {expert.name}, {expert.quality}</p>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{review.doc_name}</h1>
          {review.due_on && <p className="text-ui-sm text-gray-600">Retour souhaité avant le {frDate(review.due_on)}</p>}
        </div>
        {termine ? (
          <div className="card p-4 flex items-start gap-3"><CheckCircle className="w-6 h-6 text-[rgb(var(--c-success))] shrink-0" aria-hidden="true" /><div><p className="font-semibold">Merci, votre relecture est transmise.</p><p className="text-ui-sm text-gray-600">L'entreprise examine vos avis. Vous pouvez relire cette page ; elle n'accepte plus de nouvel avis.</p></div></div>
        ) : (
          <div className="card p-3 text-ui text-gray-700 space-y-1">
            <p>Pour chaque article : <strong>C'est bon</strong>, <strong>Proposer une rédaction</strong> (le texte modifié vous est montré mot à mot), ou <strong>Commenter</strong>. Quand vous avez fini, cliquez sur <strong>J'ai terminé ma relecture</strong> en bas de la page.</p>
            {review.message && <p className="text-ui-sm text-gray-600 whitespace-pre-line"><span className="font-semibold">Consigne : </span>{review.message}</p>}
          </div>
        )}
        {questions.length > 0 && (
          <div className="card p-3 space-y-1">
            <p className="font-semibold text-ui">Choix déjà faits par l'entreprise</p>
            {questions.map((q, i) => <p key={i} className="text-ui-sm text-gray-700">{q.text} : <strong>{q.choice}</strong></p>)}
          </div>
        )}

        {(review.sections || []).map((s) => {
          const av = avisDe(s.id)
          const valide = av.some((a) => a.kind === 'validation')
          const ouvre = ouvert?.section === s.id
          return (
            <section key={s.id} className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-gray-900 flex-1 min-w-[10rem]">{s.title || 'Introduction'}</h2>
                {s.cond && <span className="text-ui-sm px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{COND[s.cond] || s.cond}</span>}
                {valide && <span className="text-ui-sm text-[rgb(var(--c-success))] flex items-center gap-1"><Check className="w-4 h-4" aria-hidden="true" />Validé</span>}
              </div>
              <div className="space-y-2">{(s.blocks || []).map((b, i) => <BlockView key={i} b={b} ctx={null} />)}</div>
              {av.filter((a) => a.kind !== 'validation').map((a) => <Avis key={a.id} a={a} section={s} />)}
              {!termine && ouvre && ouvert.kind === 'modification' && <EditeurArticle section={s} busy={busy} titre="Votre rédaction" onAnnuler={() => setOuvert(null)} onEnregistrer={(p) => appeler('expert_deposer', { p_section: s.id, p_kind: 'modification', p_text: null, p_proposed: p }, 'Rédaction proposée')} />}
              {!termine && ouvre && ouvert.kind === 'commentaire' && <Commentaire busy={busy} onAnnuler={() => setOuvert(null)} onEnregistrer={(t) => appeler('expert_deposer', { p_section: s.id, p_kind: 'commentaire', p_text: t, p_proposed: null }, 'Commentaire enregistré')} />}
              {!termine && !ouvre && (
                <div className="flex flex-wrap gap-2">
                  {!valide && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => appeler('expert_deposer', { p_section: s.id, p_kind: 'validation', p_text: null, p_proposed: null })}><Check className="w-4 h-4" />C'est bon</button>}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOuvert({ section: s.id, kind: 'modification' })}><Pencil className="w-4 h-4" />Proposer une rédaction</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOuvert({ section: s.id, kind: 'commentaire' })}><MessageSquare className="w-4 h-4" />Commenter</button>
                </div>
              )}
            </section>
          )
        })}

        {generaux.length > 0 && <section className="card p-4 space-y-2"><h2 className="font-semibold">Remarques sur l'ensemble</h2>{generaux.map((a) => <Avis key={a.id} a={a} />)}</section>}
        {!termine && (
          <section className="card p-4 space-y-2">
            {fin === null ? (
              <button type="button" className="btn btn-primary w-full" onClick={() => setFin('')}><CheckCircle className="w-4 h-4" />J'ai terminé ma relecture</button>
            ) : (
              <>
                <label className="block"><span className="label">Un mot pour l'entreprise (facultatif)</span><textarea className="input w-full" rows={3} maxLength={5000} value={fin} onChange={(e) => setFin(e.target.value)} /></label>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => appeler('expert_terminer', { p_message: fin.trim() || null }, 'Merci : votre relecture est transmise')}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Transmettre ma relecture</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setFin(null)}>Annuler</button>
                </div>
                <p className="text-ui-sm text-gray-500">Après l'envoi, vous ne pourrez plus ajouter d'avis.</p>
              </>
            )}
          </section>
        )}
      </div>
    </PublicLayout>
  )
}
