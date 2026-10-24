// Circuit de validation d'un document (0455) : relecture par l'équipe, arbitrage par la direction, vérification par
// l'expert (retour par fichier relu tant que son espace n'existe pas), validation. /relectures : mes relectures et les
// circuits en cours ; /relectures/:id : un circuit.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  ChevronLeft, CheckCircle, Pencil, MessageSquare, Loader2, Download, Upload, Send, RotateCcw, X, HelpCircle, Users, Check, FileText,
} from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { useDroits } from '../../../core/rights/useDroit'
import { docCode, currentUserName } from '../../../core/org/currentOrg'
import { loadTemplateContext } from '../../../core/org/templateContext'
import { loadPdfOrg } from '../../../core/pdf/pdfOrg'
import { confirmer } from '../../../ui/Confirm'
import { loadTemplates, isRich, fromTemplate, frDate, todayIso, plusOneYear, bracketGaps } from '../richdocs/model'
import { BlockView, BlockEdit, StatusChip } from '../richdocs/RichDocEditor'
import { buildRichDocPDF } from '../richdocs/richDocPDF'
import { exportDocx, importDocx } from '../richdocs/docxRichDoc'
import { ETATS, QUALITES, etapes, etapeCourante, diffProposition, resteATrancher, actionsPossibles, propositionsDepuisFichier } from '../richdocs/circuit'

const NATURE = { validation: 'Article validé', modification: 'Modification proposée', commentaire: 'Commentaire', question: 'Question', reponse: 'Réponse' }
const STATUT_AVIS = {
  ouverte: { label: 'Ouvert', tone: 'blue' }, acceptee: { label: 'Acceptée', tone: 'green' }, refusee: { label: 'Refusée', tone: 'gray' },
  close: { label: 'Clos', tone: 'gray' }, retiree: { label: 'Retiré', tone: 'gray' },
}
const COND = { particuliers: 'Particuliers seulement', professionnels: 'Professionnels seulement' }
const clone = (x) => JSON.parse(JSON.stringify(x))

function Diff({ parts }) {
  return (
    <p className="text-ui leading-relaxed whitespace-pre-wrap">
      {parts.map((d, i) => d.t === '=' ? <span key={i}>{d.s}</span>
        : d.t === '+' ? <ins key={i} className="no-underline bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))] rounded px-0.5">{d.s}</ins>
          : <del key={i} className="bg-[rgb(var(--c-danger-bg))] text-[rgb(var(--c-danger))] rounded px-0.5">{d.s}</del>)}
    </p>
  )
}

function Avis({ it, moi, peutDecider, onDecider, onRetirer, busy }) {
  const [refus, setRefus] = useState(null)
  const auteur = it.author_quality === 'expert' ? (it.author_label || 'Expert') : it.author_quality === 'modele' ? QUALITES.modele : (it.author_name || 'Équipe')
  return (
    <div className="rounded-ui-sm border border-gray-200 bg-white p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-ui-sm">
        <span className="font-semibold text-gray-900">{NATURE[it.kind]}</span>
        <span className="text-gray-500">{auteur}{it.author_quality === 'expert' ? ' · expert' : ''} · {frDate(it.created_at)}</span>
        <StatusChip status={STATUT_AVIS[it.status] || STATUT_AVIS.ouverte} />
      </div>
      {it.kind === 'modification' && <Diff parts={diffProposition(it.base, it.proposed)} />}
      {it.text && it.kind !== 'question' && <p className="text-ui text-gray-700 whitespace-pre-line">{it.text}</p>}
      {it.decision_note && <p className="text-ui-sm text-gray-500">Décision de {it.decided_name || 'la direction'} : {it.decision_note}</p>}
      {it.status === 'ouverte' && (
        <div className="flex flex-wrap gap-2">
          {peutDecider && it.kind === 'modification' && <>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDecider(it, 'acceptee')}><Check className="w-4 h-4" />Accepter</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setRefus('')}><X className="w-4 h-4" />Refuser</button>
          </>}
          {peutDecider && ['commentaire', 'validation'].includes(it.kind) && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onDecider(it, 'close')}>Clore</button>}
          {it.author_id === moi && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onRetirer(it)}>Retirer</button>}
        </div>
      )}
      {refus !== null && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1 min-w-[12rem]"><span className="label">Pourquoi la refuser ?</span><input className="input" value={refus} maxLength={2000} onChange={(e) => setRefus(e.target.value)} /></label>
          <button type="button" className="btn btn-primary btn-sm" disabled={refus.trim().length < 3 || busy} onClick={async () => { if (await onDecider(it, 'refusee', refus.trim())) setRefus(null) }}>Refuser</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRefus(null)}>Annuler</button>
        </div>
      )}
    </div>
  )
}

function EditeurArticle({ section, titre = 'Votre proposition', onAnnuler, onEnregistrer, libelle = 'Proposer', busy }) {
  const [s, setS] = useState(() => clone(section))
  return (
    <div className="rounded-ui-sm border border-primary-200 bg-primary-50/40 p-3 space-y-2">
      <p className="font-semibold text-ui">{titre}</p>
      <label className="block"><span className="label">Titre de l'article</span><input className="input" value={s.title || ''} onChange={(e) => setS({ ...s, title: e.target.value })} /></label>
      {s.blocks.map((b, i) => <BlockEdit key={i} b={b} onChange={(nb) => setS({ ...s, blocks: s.blocks.map((x, j) => (j === i ? nb : x)) })} />)}
      <button type="button" className="text-ui-sm text-primary-600 font-semibold" onClick={() => setS({ ...s, blocks: [...s.blocks, { t: 'p', text: '' }] })}>Ajouter un paragraphe</button>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onEnregistrer({ title: s.title, blocks: s.blocks.filter((b) => !(b.t === 'p' && !String(b.text || '').trim())) })}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}{libelle}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  )
}

function Commentaire({ onAnnuler, onEnregistrer, busy, placeholder = 'Votre remarque' }) {
  const [t, setT] = useState('')
  return (
    <div className="space-y-2">
      <textarea className="input w-full" rows={3} maxLength={5000} value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)} />
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || t.trim().length < 2} onClick={() => onEnregistrer(t.trim())}>Envoyer</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  )
}

function ListeRelectures() {
  const { profile } = useAuthStore()
  const [l, setL] = useState(null)
  useEffect(() => {
    supabase.from('doc_reviews').select('id, doc_id, doc_name, status, mode, round, due_on, created_at, created_by_name, doc_review_participants(profile_id, done_at)')
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data, error }) => setL(error ? [] : data || []))
  }, [])
  if (!l) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
  const ouverts = l.filter((r) => ['relecture', 'arbitrage', 'expert'].includes(r.status))
  const clos = l.filter((r) => !ouverts.includes(r))
  const Ligne = ({ r }) => {
    const moi = (r.doc_review_participants || []).find((p) => p.profile_id === profile?.id)
    return (
      <li>
        <Link to={`/relectures/${r.id}`} className="card p-4 flex flex-wrap items-center gap-2 hover:border-primary-300">
          <span className="font-semibold text-gray-900 flex-1 min-w-[12rem]">{r.doc_name}</span>
          {moi && r.status === 'relecture' && !moi.done_at && <span className="text-ui-sm text-[rgb(var(--c-warning))] font-semibold">À relire</span>}
          {r.due_on && r.status === 'relecture' && <span className="text-ui-sm text-gray-500">avant le {frDate(r.due_on)}</span>}
          <StatusChip status={ETATS[r.status]} />
        </Link>
      </li>
    )
  }
  return (
    <div className="max-w-4xl mx-auto p-4 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Relectures de documents</h1>
        <p className="text-ui-sm text-gray-500">Documents à relire, à arbitrer ou chez l'expert. Un document se met en relecture depuis Processus qualité, Documents.</p>
      </div>
      <section><h2 className="text-ui-sm font-semibold text-gray-500 uppercase mb-2">En cours</h2>
        {ouverts.length ? <ul className="space-y-2">{ouverts.map((r) => <Ligne key={r.id} r={r} />)}</ul> : <p className="text-ui-sm text-gray-500">Aucune relecture en cours.</p>}
      </section>
      {clos.length > 0 && <section><h2 className="text-ui-sm font-semibold text-gray-500 uppercase mb-2">Terminées</h2><ul className="space-y-2">{clos.map((r) => <Ligne key={r.id} r={r} />)}</ul></section>}
    </div>
  )
}

function Circuit({ id }) {
  const navigate = useNavigate()
  const { profile } = useAuthStore()
  const d = useDroits({ valider: 'qualite.documents.valider', gerer: ['qualite.documents.gerer', 'qualite.documents.valider'] })
  const [r, setR] = useState(null)
  const [items, setItems] = useState([])
  const [parts, setParts] = useState([])
  const [tpl, setTpl] = useState(null)
  const [ctx, setCtx] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [busy, setBusy] = useState(false)
  const [ouvert, setOuvert] = useState(null) // { section, kind: 'modification' | 'commentaire' | 'texte' }
  const [validation, setValidation] = useState(null) // motif
  const [expert, setExpert] = useState(null) // libellé de l'expert

  const charger = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('doc_reviews').select('*').eq('id', id).maybeSingle(),
      supabase.from('doc_review_items').select('*').eq('review_id', id).order('created_at'),
      supabase.from('doc_review_participants').select('*').eq('review_id', id).order('invited_at'),
    ])
    if (a.error || !a.data) { setErreur('Relecture introuvable, ou vous n\'y êtes pas invité.'); return }
    setR(a.data); setItems(b.data || []); setParts(c.data || [])
  }, [id])
  useEffect(() => { charger() }, [charger])
  useEffect(() => { loadTemplates().then((t) => setTpl(r ? t[r.doc_id] || null : null)).catch(() => {}) }, [r?.doc_id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadTemplateContext().then(setCtx).catch(() => {}) }, [])

  const estRelecteur = parts.some((p) => p.profile_id === profile?.id)
  const moiPart = parts.find((p) => p.profile_id === profile?.id)
  const actions = useMemo(() => actionsPossibles(r, { peutValider: d.valider, peutGerer: d.gerer, estRelecteur, estAuteur: r?.created_by === profile?.id, items }), [r, d.valider, d.gerer, estRelecteur, items, profile?.id])
  const reste = resteATrancher(items)
  const questions = items.filter((i) => i.kind === 'question')
  const reponses = (q) => items.filter((i) => i.parent_id === q.id && i.status !== 'retiree')
  const avisDe = (sid) => items.filter((i) => i.section_id === sid && !['question', 'reponse'].includes(i.kind) && i.status !== 'retiree')
  const generaux = items.filter((i) => !i.section_id && ['commentaire', 'validation'].includes(i.kind) && i.status !== 'retiree')

  const agir = async (fn, ok) => {
    setBusy(true)
    try { await fn(); if (ok) toast.success(ok); await charger(); setBusy(false); return true } catch (e) { toast.error(e.message || 'Action impossible'); setBusy(false); return false }
  }
  const must = (res) => { if (res.error) throw new Error(res.error.message); return res.data }
  const deposer = (ligne) => agir(async () => { must(await supabase.from('doc_review_items').insert({ review_id: r.id, ...ligne })); setOuvert(null) }, 'Avis enregistré')
  const decider = (it, decision, note = null, choice = null) => agir(async () => must(await supabase.rpc('doc_review_decider', { p_item: it.id, p_decision: decision, p_note: note, p_choice: choice })))
  const retirer = (it) => agir(async () => must(await supabase.from('doc_review_items').update({ status: 'retiree' }).eq('id', it.id)))
  const changerEtat = (status, extra = {}, ok) => agir(async () => {
    const rows = must(await supabase.from('doc_reviews').update({ status, ...extra }).eq('id', r.id).select('id'))
    if (!rows?.length) throw new Error('Action refusée')
  }, ok)
  const modifierTexte = (sid, proposed) => agir(async () => {
    const sections = r.content.sections.map((s) => (s.id === sid ? { ...s, title: proposed.title, blocks: proposed.blocks } : s))
    must(await supabase.from('doc_reviews').update({ content: { ...r.content, sections } }).eq('id', r.id))
    setOuvert(null)
  }, 'Article modifié')

  const telecharger = async (format) => {
    setBusy(true)
    try {
      const content = { model: 'rich', ...r.content, status: 'brouillon', version: r.base_version }
      const code = docCode(tpl?.code || '')
      if (format === 'pdf') {
        const ORG = await loadPdfOrg(true)
        buildRichDocPDF(ORG, { tpl: tpl || { id: r.doc_id, name: r.doc_name }, code, content, ctx, history: [] }).doc.save(`${r.doc_name} - pour relecture.pdf`)
      } else {
        const blob = await exportDocx({ tpl: tpl || { id: r.doc_id, name: r.doc_name }, content, code })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob); a.download = `${r.doc_name} - pour relecture.docx`.replace(/[\\/:*?"<>|]+/g, '-')
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000)
      }
    } catch (e) { toast.error(e.message || 'Téléchargement impossible') }
    setBusy(false)
  }

  const importerRetour = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    await agir(async () => {
      const imp = await importDocx(await f.arrayBuffer(), r.content.sections)
      const props = propositionsDepuisFichier(r.content.sections, imp.sections)
      const label = `${r.expert_label || 'Expert'} (fichier relu)`
      if (props.length) must(await supabase.from('doc_review_items').insert(props.map((p) => ({ review_id: r.id, section_id: p.section_id, kind: 'modification', proposed: p.proposed, author_quality: 'expert', author_label: label }))))
      else must(await supabase.from('doc_review_items').insert({ review_id: r.id, kind: 'validation', text: 'Aucune modification dans le fichier relu.', author_quality: 'expert', author_label: label }))
      toast.success(props.length ? `${props.length} modification${props.length > 1 ? 's' : ''} de l'expert à arbitrer` : 'Le fichier relu ne change rien')
    })
  }

  const valider = async () => {
    await agir(async () => {
      const { data: qd } = await supabase.from('quality_documents').select('content').eq('doc_id', r.doc_id).maybeSingle()
      const actuel = isRich(qd?.content) ? qd.content : (tpl ? fromTemplate(tpl) : { model: 'rich', sections: [] })
      const version = (actuel.version || 0) + 1
      const today = todayIso(); const next = plusOneYear(today)
      must(await supabase.from('quality_doc_versions').insert({
        doc_id: r.doc_id, version, content: { sections: r.content.sections, options: r.content.options || {} },
        motif: validation.trim(), validated_by: profile?.id || null, validated_by_name: currentUserName() || null, next_review: next,
      }))
      must(await supabase.from('quality_documents').upsert({
        doc_id: r.doc_id, code: tpl?.code || r.doc_id.slice(0, 20), name: r.doc_name,
        content: { ...actuel, sections: r.content.sections, options: r.content.options || actuel.options || {}, status: 'valide', version, validated_at: today, next_review: next, motif: null },
        version: String(version), updated_at: new Date().toISOString(), updated_by: profile?.id || null,
      }, { onConflict: 'doc_id' }))
      setValidation(null)
    }, 'Version validée : elle s\'applique désormais')
  }

  if (erreur) return <div className="max-w-xl mx-auto p-6 text-center space-y-3"><p className="text-gray-700">{erreur}</p><Link to="/relectures" className="btn btn-secondary">Mes relectures</Link></div>
  if (!r) return <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  const liste = etapes(r.mode)
  const courante = etapeCourante(r)
  const iCourante = r.status === 'validee' ? liste.length - 1 : liste.findIndex(([k]) => k === courante)
  const gaps = bracketGaps({ model: 'rich', sections: r.content.sections })
  const motifParDefaut = () => {
    const relu = [...new Set(parts.map((p) => p.profile_name).filter(Boolean))]
    return [`Circuit de relecture (tour ${r.round})`, relu.length ? `relu par ${relu.join(', ')}` : '', r.expert_returned_at ? `vérifié par ${r.expert_label || 'l\'expert'} le ${frDate(r.expert_returned_at)}` : ''].filter(Boolean).join(', ')
  }

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4 space-y-4">
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => navigate('/relectures')} className="h-11 w-11 flex items-center justify-center rounded-ui-sm hover:bg-gray-100" aria-label="Retour aux relectures"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 flex flex-wrap items-center gap-2">{r.doc_name}<StatusChip status={ETATS[r.status]} /></h1>
          <p className="text-ui-sm text-gray-500">Lancé par {r.created_by_name || 'l\'équipe'} le {frDate(r.created_at)}{r.due_on ? ` · réponse souhaitée avant le ${frDate(r.due_on)}` : ''} · tour {r.round}</p>
        </div>
      </div>

      {/* Étapes */}
      <ol className="flex flex-wrap gap-1.5" aria-label="Étapes du circuit">
        {liste.map(([k, l], i) => (
          <li key={k} className={`px-3 h-8 inline-flex items-center rounded-full text-ui-sm font-semibold ${i < iCourante || r.status === 'validee' ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : i === iCourante ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500'}`}>
            {i < iCourante || r.status === 'validee' ? <Check className="w-3.5 h-3.5 mr-1" aria-hidden="true" /> : null}{l}
          </li>
        ))}
      </ol>

      {r.message && <div className="card p-3 text-ui text-gray-700 whitespace-pre-line"><span className="font-semibold">Consigne : </span>{r.message}</div>}

      {/* Relecteurs et actions */}
      <div className="card p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-ui-sm">
          <Users className="w-4 h-4 text-gray-400" aria-hidden="true" />
          {parts.length ? parts.map((p) => <span key={p.id} className={`px-2 py-0.5 rounded-full ${p.done_at ? 'bg-[rgb(var(--c-success-bg))] text-[rgb(var(--c-success))]' : 'bg-gray-100 text-gray-700'}`}>{p.profile_name || 'Relecteur'}{p.done_at ? ' : terminé' : ''}</span>) : <span className="text-gray-500">Aucun relecteur invité</span>}
          {r.expert_label && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">Expert : {r.expert_label}{r.expert_returned_at ? ' : retour reçu' : ''}</span>}
        </div>
        {(reste.modifications + reste.questions > 0) && r.status !== 'validee' && <p className="text-ui-sm text-gray-600">À trancher : {reste.modifications} modification{reste.modifications > 1 ? 's' : ''}, {reste.questions} question{reste.questions > 1 ? 's' : ''}.</p>}
        <div className="flex flex-wrap gap-2">
          {actions.has('terminer') && !moiPart?.done_at && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => agir(async () => must(await supabase.from('doc_review_participants').update({ done_at: new Date().toISOString() }).eq('id', moiPart.id)), 'Merci : votre relecture est notée terminée')}><CheckCircle className="w-4 h-4" />J'ai terminé ma relecture</button>}
          {actions.has('arbitrer') && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={async () => {
            const enCours = parts.filter((p) => !p.done_at).length
            if (enCours && !await confirmer(`${enCours} relecteur${enCours > 1 ? 's n\'ont' : ' n\'a'} pas terminé. Passer quand même à l'arbitrage ? Ils ne pourront plus déposer d'avis.`)) return
            changerEtat('arbitrage', {}, 'Relecture close : à vous d\'arbitrer')
          }}>Passer à l'arbitrage</button>}
          {actions.has('renvoyer') && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={async () => { if (await confirmer('Renvoyer le texte arbitré en relecture à l\'équipe (nouveau tour) ?')) changerEtat('relecture', {}, 'Renvoyé en relecture') }}><RotateCcw className="w-4 h-4" />Renvoyer en relecture</button>}
          {actions.has('expert') && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => setExpert(r.expert_label || '')}><Send className="w-4 h-4" />Envoyer à l'expert</button>}
          {actions.has('valider') && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => setValidation(motifParDefaut())}><CheckCircle className="w-4 h-4" />Valider la version</button>}
          {actions.has('dossier_expert') && <>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => telecharger('pdf')}><Download className="w-4 h-4" />PDF pour l'expert</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => telecharger('docx')}><Download className="w-4 h-4" />Word pour l'expert</button>
          </>}
          {actions.has('retour_expert') && <>
            <label className="btn btn-secondary btn-sm cursor-pointer"><Upload className="w-4 h-4" />Importer le fichier relu
              <input type="file" className="hidden" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={importerRetour} />
            </label>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setOuvert({ section: null, kind: 'commentaire_expert' })}><MessageSquare className="w-4 h-4" />Noter une remarque de l'expert</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={async () => { if (await confirmer('Retour de l\'expert reçu : passer à l\'arbitrage de ses modifications ?')) changerEtat('arbitrage', {}, 'Retour de l\'expert : à arbitrer') }}>Retour reçu : arbitrer</button>
          </>}
          {actions.has('abandonner') && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={async () => { if (await confirmer('Abandonner ce circuit ? Le document reste dans sa version en vigueur ; les avis restent consultables.')) changerEtat('abandonnee', {}, 'Circuit abandonné') }}>Abandonner</button>}
        </div>
        {r.status === 'expert' && <p className="text-ui-sm text-gray-500">Envoyez le PDF ou le fichier Word à l'expert. Quand il vous le renvoie corrigé, importez-le : chaque changement devient une modification à arbitrer. Le fichier Word peut aussi contenir ses modifications suivies, acceptées à l'import.</p>}
        {expert !== null && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="block flex-1 min-w-[14rem]"><span className="label">Expert (nom et qualité)</span><input className="input" value={expert} maxLength={120} placeholder="Me Dupont, avocat" onChange={(e) => setExpert(e.target.value)} /></label>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || expert.trim().length < 2} onClick={async () => { if (await changerEtat('expert', { expert_label: expert.trim() }, 'Chez l\'expert : téléchargez le dossier ci-dessous')) setExpert(null) }}>Confirmer</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpert(null)}>Annuler</button>
          </div>
        )}
        {ouvert?.kind === 'commentaire_expert' && <Commentaire busy={busy} placeholder="Remarque de l'expert (copiée de son courrier ou de son courriel)" onAnnuler={() => setOuvert(null)}
          onEnregistrer={(t) => deposer({ kind: 'commentaire', text: t, author_quality: 'expert', author_label: r.expert_label || 'Expert' })} />}
        {validation !== null && (
          <div className="space-y-2 rounded-ui-sm border border-gray-200 p-3">
            {gaps.length > 0 && <p className="text-ui-sm text-[rgb(var(--c-warning))]">Encore {gaps.length} passage{gaps.length > 1 ? 's' : ''} entre crochets à compléter : {[...new Set(gaps.map((g) => g.gap))].slice(0, 5).join(', ')}.</p>}
            <label className="block"><span className="label">Motif de cette version</span><input className="input" value={validation} maxLength={500} onChange={(e) => setValidation(e.target.value)} /></label>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || validation.trim().length < 3} onClick={valider}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Valider : la version s'applique</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValidation(null)}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      {/* Questions ouvertes */}
      {questions.length > 0 && (
        <section className="card p-3 space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><HelpCircle className="w-4 h-4 text-gray-400" aria-hidden="true" />Questions</h2>
          {questions.map((q) => {
            const rep = reponses(q)
            const maReponse = rep.find((x) => x.author_id === profile?.id && x.status === 'ouverte')
            return (
              <div key={q.id} className="space-y-2 border-t border-gray-100 pt-2 first:border-0 first:pt-0">
                <p className="font-medium text-gray-900">{q.text}{q.section_id ? <span className="text-ui-sm text-gray-500"> · article « {r.content.sections.find((s) => s.id === q.section_id)?.title || q.section_id} »</span> : null}</p>
                <div className="flex flex-wrap gap-2">
                  {(q.choices || []).map((c) => {
                    const n = rep.filter((x) => x.choice === c)
                    const retenu = q.status === 'close' && q.choice === c
                    return (
                      <div key={c} className={`rounded-ui-sm border px-3 py-2 ${retenu ? 'border-[rgb(var(--c-success))] bg-[rgb(var(--c-success-bg))]' : 'border-gray-200'}`}>
                        <p className="font-semibold text-ui">{c}{retenu ? ' : retenu' : ''}</p>
                        {n.length > 0 && <p className="text-ui-sm text-gray-500">{n.map((x) => x.author_name).join(', ')}</p>}
                        <div className="flex gap-2 mt-1">
                          {q.status === 'ouverte' && actions.has('avis') && !maReponse && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => deposer({ kind: 'reponse', parent_id: q.id, choice: c })}>Je choisis</button>}
                          {q.status === 'ouverte' && actions.has('decider') && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decider(q, 'close', null, c)}>Retenir</button>}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {maReponse && <p className="text-ui-sm text-gray-500">Votre réponse : {maReponse.choice || maReponse.text} <button type="button" className="underline" onClick={() => retirer(maReponse)}>changer</button></p>}
                {q.status === 'close' && actions.has('modifier_texte') && <p className="text-ui-sm text-gray-500">Reportez le choix retenu dans le texte de l'article (« Modifier l'article »).</p>}
              </div>
            )
          })}
        </section>
      )}

      {/* Remarques générales */}
      {(generaux.length > 0 || actions.has('avis')) && (
        <section className="card p-3 space-y-2">
          <h2 className="font-semibold">Remarques sur l'ensemble du document</h2>
          {generaux.map((it) => <Avis key={it.id} it={it} moi={profile?.id} peutDecider={actions.has('decider')} onDecider={decider} onRetirer={retirer} busy={busy} />)}
          {actions.has('avis') && (ouvert?.section === '__doc' ? <Commentaire busy={busy} onAnnuler={() => setOuvert(null)} onEnregistrer={(t) => deposer({ kind: 'commentaire', text: t })} />
            : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOuvert({ section: '__doc', kind: 'commentaire' })}><MessageSquare className="w-4 h-4" />Commenter le document</button>)}
        </section>
      )}

      {/* Articles */}
      {r.content.sections.map((s) => {
        const av = avisDe(s.id)
        const valides = av.filter((a) => a.kind === 'validation')
        const autres = av.filter((a) => a.kind !== 'validation')
        const ouvre = ouvert?.section === s.id
        return (
          <section key={s.id} className="card p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-gray-900 flex-1 min-w-[10rem]">{s.title || 'Introduction'}</h2>
              {s.cond && <span className="text-ui-sm px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">{COND[s.cond] || s.cond}</span>}
              {valides.length > 0 && <span className="text-ui-sm text-[rgb(var(--c-success))] flex items-center gap-1"><Check className="w-4 h-4" aria-hidden="true" />Validé par {valides.map((v) => v.author_name || v.author_label).join(', ')}</span>}
            </div>
            <div className="space-y-2">{(s.blocks || []).map((b, i) => <BlockView key={i} b={b} ctx={ctx} />)}</div>
            {autres.map((it) => <Avis key={it.id} it={it} moi={profile?.id} peutDecider={actions.has('decider')} onDecider={decider} onRetirer={retirer} busy={busy} />)}
            {ouvre && ouvert.kind === 'modification' && <EditeurArticle section={s} busy={busy} onAnnuler={() => setOuvert(null)} onEnregistrer={(p) => deposer({ section_id: s.id, kind: 'modification', proposed: p })} />}
            {ouvre && ouvert.kind === 'texte' && <EditeurArticle section={s} busy={busy} titre="Texte arbitré de l'article" libelle="Enregistrer le texte" onAnnuler={() => setOuvert(null)} onEnregistrer={(p) => modifierTexte(s.id, p)} />}
            {ouvre && ouvert.kind === 'commentaire' && <Commentaire busy={busy} onAnnuler={() => setOuvert(null)} onEnregistrer={(t) => deposer({ section_id: s.id, kind: 'commentaire', text: t })} />}
            {!ouvre && (
              <div className="flex flex-wrap gap-2">
                {actions.has('avis') && !valides.some((v) => v.author_id === profile?.id) && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => deposer({ section_id: s.id, kind: 'validation' })}><Check className="w-4 h-4" />C'est bon</button>}
                {actions.has('avis') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOuvert({ section: s.id, kind: 'modification' })}><Pencil className="w-4 h-4" />Proposer une modification</button>}
                {actions.has('avis') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOuvert({ section: s.id, kind: 'commentaire' })}><MessageSquare className="w-4 h-4" />Commenter</button>}
                {actions.has('modifier_texte') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOuvert({ section: s.id, kind: 'texte' })}><FileText className="w-4 h-4" />Modifier l'article</button>}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

export default function Relecture() {
  const { id } = useParams()
  return id ? <Circuit id={id} /> : <ListeRelectures />
}
