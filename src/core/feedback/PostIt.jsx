import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { StickyNote, Send, Minus, Loader2 } from 'lucide-react'
import { callApi } from '../api'

// Post-it de retours, toujours visible dans l'application (version interne simple).
// Le texte est gardé dans le navigateur pendant la navigation ; « Envoyer » l'enregistre
// avec la page en cours, puis vide le post-it. Le super administrateur lit les retours dans la Console.

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

export default function PostIt({ userId, pageTitle }) {
  const location = useLocation()
  const [open, setOpen] = useState(() => readStorage(openKey, '0') === '1')
  const [text, setText] = useState(() => readStorage(draftKey(userId), ''))
  const [sending, setSending] = useState(false)
  const areaRef = useRef(null)

  useEffect(() => { setText(readStorage(draftKey(userId), '')) }, [userId])
  useEffect(() => { writeStorage(draftKey(userId), text) }, [text, userId])
  useEffect(() => { writeStorage(openKey, open ? '1' : '0') }, [open])
  useEffect(() => { if (open && areaRef.current) areaRef.current.focus() }, [open])

  const hasText = text.trim().length > 0

  const send = async () => {
    if (!hasText || sending) return
    setSending(true)
    try {
      await callApi('/api/retours', {
        message: text.trim(),
        page_path: location.pathname + (location.search || ''),
        page_title: pageTitle || document.title || '',
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      })
      setText('')
      toast.success('Merci, votre note est envoyée')
    } catch (e) {
      toast.error(e.message || "La note n'a pas pu être envoyée")
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
        onClick={() => setOpen(true)}
        className="postit-float is-closed fixed z-30 h-11 pl-3 pr-4 rounded-ui flex items-center gap-2 text-ui-sm font-semibold shadow-md border border-highlight-300 bg-highlight-100 text-highlight-900 hover:bg-highlight-200 print:hidden"
        aria-label="Ouvrir le post-it pour noter une remarque"
      >
        <StickyNote className="w-4 h-4" aria-hidden="true" />
        <span>Une remarque ?</span>
        {hasText && <span className="w-2 h-2 rounded-full bg-highlight-600" aria-label="Note en cours" />}
      </button>
    )
  }

  return (
    <div
      className="postit-float fixed z-30 w-[min(320px,calc(100vw-1.5rem))] rounded-ui border border-highlight-300 bg-highlight-100 text-highlight-900 shadow-md print:hidden"
      role="dialog"
      aria-label="Post-it de remarques"
    >
      <div className="flex items-center justify-between px-3 pt-2">
        <div className="flex items-center gap-2 text-ui-sm font-semibold">
          <StickyNote className="w-4 h-4" aria-hidden="true" />
          Une remarque, une idée ?
        </div>
        <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-ui-sm hover:bg-highlight-200" aria-label="Réduire le post-it" title="Réduire">
          <Minus className="w-4 h-4" />
        </button>
      </div>
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
      <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
        <span className="text-ui-sm text-highlight-800">La page en cours est jointe.</span>
        <button
          type="button"
          onClick={send}
          disabled={!hasText || sending}
          className="h-9 px-3 rounded-ui-sm flex items-center gap-2 text-ui-sm font-semibold bg-highlight-500 text-highlight-fg hover:bg-highlight-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
          Envoyer
        </button>
      </div>
    </div>
  )
}
