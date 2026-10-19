import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { StickyNote, Send, Minus, Loader2, Camera, ImagePlus, X, Reply } from 'lucide-react'
import { callApi } from '../api'
import { EVENEMENT_POSTIT } from '../notices/notices'
import { TYPES, GRAVITES, TYPE_LABELS, STATUTS, compresser, capturerEcran, captureEcranPossible } from './retours'

// Post-it de retours, toujours visible dans l'application.
// Le texte est gardé dans le navigateur pendant la navigation ; « Envoyer » l'enregistre avec la page en cours,
// puis vide le post-it. Version complète (migration 0263, `complet`) : type (problème, idée, question), gravité
// ressentie pour un problème, capture facultative (prise par le navigateur ou fichier joint, compressée),
// onglet « Mes retours » avec le statut et la réponse de l'équipe. Sans 0263 : texte seul, comme avant.

const draftKey = (userId) => `odet.postit.draft.${userId || 'anonyme'}`
const openKey = 'odet.postit.open'

function readStorage(key, fallback) {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? fallback : v
  } catch (_) {
    return fallback
  }
}

function writeStorage(key, value) {
  try {
    if (value === null || value === '') window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch (_) { /* stockage indisponible : le texte reste en mémoire */ }
}

function Puces({ options, value, onChange, label }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(value === o.id ? null : o.id)}
          className={`h-7 px-2.5 rounded-full text-ui-sm border ${value === o.id
            ? 'bg-highlight-600 border-highlight-600 text-highlight-fg font-semibold'
            : 'bg-highlight-50 border-highlight-300 text-highlight-900 hover:bg-highlight-200'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function MesRetours({ items, onLu }) {
  if (items === null) return <div className="flex items-center gap-2 text-ui-sm text-highlight-800 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Chargement…</div>
  if (items.length === 0) return <p className="text-ui-sm text-highlight-800 py-4">Vous n'avez encore envoyé aucun retour.</p>
  return (
    <ul className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
      {items.map((it) => {
        const nonLue = it.response && !it.response_read_at
        return (
          <li key={it.id} className={`rounded-ui-sm border p-2 bg-highlight-50 ${nonLue ? 'border-highlight-600' : 'border-highlight-300'}`}>
            <div className="flex items-center justify-between gap-2 text-ui-sm">
              <span className="text-highlight-800">
                {format(new Date(it.created_at), 'd MMM', { locale: fr })}{it.kind ? ` · ${TYPE_LABELS[it.kind]}` : ''}
              </span>
              <span className="font-semibold text-highlight-900">{STATUTS[it.status]?.[2] || it.status}</span>
            </div>
            <p className="text-ui-sm text-gray-900 line-clamp-3 whitespace-pre-wrap break-words mt-0.5">{it.message}</p>
            {it.response && (
              <div className="mt-1.5 rounded-ui-sm bg-white border border-highlight-200 p-2">
                <div className="flex items-center gap-1.5 text-ui-sm font-semibold text-gray-900">
                  <Reply className="w-3.5 h-3.5" aria-hidden="true" /> Réponse
                  {nonLue && <span className="badge badge-warning" style={{ height: 18, fontSize: 10.5 }}>nouvelle</span>}
                </div>
                <p className="text-ui-sm text-gray-800 whitespace-pre-wrap break-words">{it.response}</p>
                {nonLue && <button type="button" onClick={() => onLu(it.id)} className="mt-1 text-ui-sm text-accent-700 hover:underline">Marquer comme lue</button>}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default function PostIt({ userId, pageTitle, complet = false }) {
  const location = useLocation()
  const [open, setOpen] = useState(() => readStorage(openKey, '0') === '1')
  const [text, setText] = useState(() => readStorage(draftKey(userId), ''))
  const [kind, setKind] = useState(null)
  const [severity, setSeverity] = useState(null)
  const [capture, setCapture] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const [sending, setSending] = useState(false)
  const [onglet, setOnglet] = useState('ecrire')
  const [mesRetours, setMesRetours] = useState(null)
  const [nonLues, setNonLues] = useState(0)
  const areaRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => { setText(readStorage(draftKey(userId), '')) }, [userId])
  useEffect(() => { writeStorage(draftKey(userId), text) }, [text, userId])
  useEffect(() => { writeStorage(openKey, open ? '1' : '0') }, [open])
  useEffect(() => { if (open && onglet === 'ecrire' && areaRef.current) areaRef.current.focus() }, [open, onglet])

  // Ouverture depuis le bandeau ou une page (« Signaler un problème ou une idée », « Proposer une idée »)
  useEffect(() => {
    const ouvrir = (e) => {
      setOpen(true)
      setOnglet('ecrire')
      if (complet && e.detail?.kind) setKind(e.detail.kind)
    }
    window.addEventListener(EVENEMENT_POSTIT, ouvrir)
    return () => window.removeEventListener(EVENEMENT_POSTIT, ouvrir)
  }, [complet])

  const chargerMesRetours = async () => {
    if (!complet) return
    try {
      const res = await callApi('/api/retours', {}, { method: 'GET' })
      const items = res.items || []
      setMesRetours(items)
      setNonLues(items.filter((it) => it.response && !it.response_read_at).length)
    } catch (_) {
      setMesRetours([])
    }
  }
  // Réponses non lues : vérifiées à l'ouverture de l'application et toutes les 10 minutes
  useEffect(() => {
    if (!complet || !userId) return undefined
    chargerMesRetours()
    const t = setInterval(chargerMesRetours, 600000)
    return () => clearInterval(t)
  }, [complet, userId])
  useEffect(() => { if (open && onglet === 'mes') chargerMesRetours() }, [open, onglet])
  // Échap réduit le post-it, sauf si une fenêtre est ouverte par-dessus (elle se ferme d'abord)
  useEffect(() => {
    if (!open) return undefined
    const surEchap = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[aria-modal="true"]')) return
      setOpen(false)
    }
    window.addEventListener('keydown', surEchap)
    return () => window.removeEventListener('keydown', surEchap)
  }, [open])

  const marquerLu = async (id) => {
    try {
      await callApi('/api/retours', { id, read: true }, { method: 'PATCH' })
      setMesRetours((l) => (l || []).map((it) => (it.id === id ? { ...it, response_read_at: new Date().toISOString() } : it)))
      setNonLues((n) => Math.max(0, n - 1))
    } catch (e) {
      toast.error(e.message)
    }
  }

  const hasText = text.trim().length > 0

  const prendreCapture = async () => {
    setCapturing(true)
    try {
      setCapture(await capturerEcran())
    } catch (e) {
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') toast.error(e.message || 'Capture impossible')
    }
    setCapturing(false)
  }

  const joindreFichier = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Joignez une image (capture d\'écran, photo)')
    setCapturing(true)
    try {
      setCapture(await compresser(file))
    } catch (err) {
      toast.error(err.message || 'Image illisible')
    }
    setCapturing(false)
  }

  const send = async () => {
    if (!hasText || sending) return
    setSending(true)
    try {
      await callApi('/api/retours', {
        message: text.trim(),
        page_path: location.pathname + (location.search || ''),
        page_title: pageTitle || document.title || '',
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        ...(complet ? { kind, severity: kind === 'probleme' ? severity : null, screenshot: capture || null } : {}),
      })
      setText('')
      setKind(null)
      setSeverity(null)
      setCapture(null)
      toast.success('Merci, votre retour est envoyé')
      if (complet) chargerMesRetours()
    } catch (e) {
      toast.error(e.message || "Le retour n'a pas pu être envoyé")
    }
    setSending(false)
  }

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); send() }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); if (nonLues > 0) setOnglet('mes') }}
        className="postit-float is-closed fixed z-30 h-11 px-3 lg:pl-3 lg:pr-4 rounded-ui flex items-center gap-2 text-ui-sm font-semibold shadow-md border border-highlight-300 bg-highlight-100 text-highlight-900 hover:bg-highlight-200 print:hidden"
        aria-label={nonLues > 0 ? `Ouvrir le post-it : ${nonLues} réponse(s) à lire` : 'Ouvrir le post-it pour noter une remarque'}
      >
        <StickyNote className="w-4 h-4" aria-hidden="true" />
        <span className="hidden lg:inline">Une remarque ?</span>
        {hasText && <span className="w-2 h-2 rounded-full bg-highlight-600" aria-label="Note en cours" />}
        {nonLues > 0 && <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent-500 text-accent-fg text-[11px] flex items-center justify-center">{nonLues}</span>}
      </button>
    )
  }

  return (
    <div
      className="postit-float fixed z-30 w-[min(340px,calc(100vw-1.5rem))] rounded-ui border border-highlight-300 bg-highlight-100 text-highlight-900 shadow-md print:hidden"
      role="dialog"
      aria-label="Post-it de remarques"
    >
      <div className="flex items-center justify-between px-3 pt-2">
        <div className="flex items-center gap-2 text-ui-sm font-semibold">
          <StickyNote className="w-4 h-4" aria-hidden="true" />
          {complet ? (
            <div className="flex gap-1" role="tablist" aria-label="Post-it">
              <button type="button" role="tab" aria-selected={onglet === 'ecrire'} onClick={() => setOnglet('ecrire')}
                className={`px-2 py-0.5 rounded-ui-sm ${onglet === 'ecrire' ? 'bg-highlight-300/60' : 'hover:bg-highlight-200'}`}>Écrire</button>
              <button type="button" role="tab" aria-selected={onglet === 'mes'} onClick={() => setOnglet('mes')}
                className={`px-2 py-0.5 rounded-ui-sm flex items-center gap-1 ${onglet === 'mes' ? 'bg-highlight-300/60' : 'hover:bg-highlight-200'}`}>
                Mes retours
                {nonLues > 0 && <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-accent-500 text-accent-fg text-[10px] flex items-center justify-center">{nonLues}</span>}
              </button>
            </div>
          ) : 'Une remarque, une idée ?'}
        </div>
        <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-ui-sm hover:bg-highlight-200" aria-label="Réduire le post-it" title="Réduire">
          <Minus className="w-4 h-4" />
        </button>
      </div>

      {onglet === 'mes' && complet ? (
        <div className="px-3 pt-2 pb-3"><MesRetours items={mesRetours} onLu={marquerLu} /></div>
      ) : (
        <>
          {complet && (
            <div className="px-3 pt-2 space-y-1.5">
              <Puces options={TYPES} value={kind} onChange={setKind} label="Type de retour" />
              {kind === 'probleme' && <Puces options={GRAVITES} value={severity} onChange={setSeverity} label="Gravité ressentie" />}
            </div>
          )}
          <div className="px-3 pt-2">
            <textarea
              ref={areaRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 4000))}
              onKeyDown={onKeyDown}
              rows={5}
              placeholder="Notez ici tout ce qui vous gêne ou vous manque, sur cette page ou ailleurs. Le texte reste là même si vous changez de page."
              className="w-full resize-y rounded-ui-sm border border-highlight-300 bg-highlight-50 px-2 py-2 text-ui text-gray-900 placeholder:text-highlight-800/70 focus:outline-none focus:ring-2 focus:ring-highlight-500"
            />
          </div>
          {complet && (
            <div className="px-3 pt-1">
              {capture ? (
                <div className="relative inline-block">
                  <img src={capture} alt="Capture jointe" className="max-h-24 rounded-ui-sm border border-highlight-300" />
                  <button type="button" onClick={() => setCapture(null)} aria-label="Retirer la capture"
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-highlight-300 flex items-center justify-center hover:bg-highlight-50">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {captureEcranPossible() && (
                    <button type="button" onClick={prendreCapture} disabled={capturing}
                      className="h-8 px-2 rounded-ui-sm text-ui-sm flex items-center gap-1.5 border border-highlight-300 bg-highlight-50 hover:bg-highlight-200 disabled:opacity-50">
                      {capturing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" aria-hidden="true" />} Capturer l'écran
                    </button>
                  )}
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={capturing}
                    className="h-8 px-2 rounded-ui-sm text-ui-sm flex items-center gap-1.5 border border-highlight-300 bg-highlight-50 hover:bg-highlight-200 disabled:opacity-50">
                    <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" /> Joindre une image
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={joindreFichier} />
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-2">
            <span className="text-ui-sm text-highlight-800">La page en cours est jointe.</span>
            <button
              type="button"
              onClick={send}
              disabled={!hasText || sending || capturing}
              className="h-9 px-3 rounded-ui-sm flex items-center gap-2 text-ui-sm font-semibold bg-highlight-500 text-highlight-fg hover:bg-highlight-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
              Envoyer
            </button>
          </div>
        </>
      )}
    </div>
  )
}
