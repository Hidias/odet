import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Sheet } from './Sheet'

// Confirmation dans l'écran, pour remplacer window.confirm (bloqué dans certains navigateurs,
// impossible à styler). Trois formes :
//  - <ConfirmInline> : la question s'affiche à la place du bouton, sans fenêtre ;
//  - useConfirm() : const ok = await confirm({ title, message, confirmLabel, danger }) ; nécessite <ConfirmProvider> ;
//  - confirmer(message | options) : même fenêtre, appelable hors d'un composant ou dans un gestionnaire existant
//    (`if (!(await confirmer('Supprimer ce devis ?'))) return`). Sans fournisseur monté : repli sur la confirmation
//    du navigateur (jamais de « oui » donné à la place de l'utilisateur) ;
//  - demander(question, { defaut, placeholder }) : remplace window.prompt (texte saisi, ou null si annulé).

export function ConfirmInline({ label, question = 'Confirmer ?', confirmLabel = 'Confirmer', danger = false, onConfirm, className = '', buttonClassName = 'btn btn-secondary' }) {
  const [asking, setAsking] = useState(false)
  if (!asking) return <button type="button" className={`${buttonClassName} ${className}`} onClick={() => setAsking(true)}>{label}</button>
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`} role="group" aria-label={question}>
      <span className="text-ui-sm text-gray-700">{question}</span>
      <button type="button" className={`btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => { setAsking(false); onConfirm?.() }}>{confirmLabel}</button>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAsking(false)}>Annuler</button>
    </span>
  )
}

const ConfirmContext = createContext(null)
let confirmGlobal = null

// Verbes d'action reconnus en tête de question : libellé du bouton, et action destructrice (bouton rouge)
const VERBES = {
  supprimer: ['Supprimer', true], retirer: ['Retirer', true], effacer: ['Effacer', true],
  abandonner: ['Abandonner', true], annuler: ['Oui, annuler', true], remplacer: ['Remplacer', false],
  publier: ['Publier', false], dupliquer: ['Dupliquer', false], créer: ['Créer', false], classer: ['Classer', false],
  marquer: ['Confirmer', false], passer: ['Confirmer', false], relancer: ['Relancer', false], noter: ['Confirmer', false],
  bloquer: ['Bloquer', true], renvoyer: ['Renvoyer', false], enregistrer: ['Enregistrer', false], fermer: ['Fermer sans enregistrer', true],
  remettre: ['Remettre', true], envoyer: ['Envoyer', false],
}

// Options déduites d'une question en texte libre (appels repris de window.confirm)
export function optionsDeQuestion(message) {
  const texte = String(message ?? '').replace(/^\s+/, '')
  const mot = (texte.match(/^[A-Za-zÀ-ÿ]+/) || [''])[0].toLowerCase()
  const verbe = VERBES[mot]
  const destructrice = (verbe ? verbe[1] : false) || /définitivement|ATTENTION/.test(texte)
  return {
    title: destructrice ? 'Confirmer l\'action' : 'Confirmer',
    message: texte,
    confirmLabel: verbe ? verbe[0] : 'Confirmer',
    cancelLabel: mot === 'annuler' ? 'Non' : 'Annuler',
    danger: destructrice,
  }
}

export async function confirmer(question) {
  const opts = typeof question === 'string' || question == null ? optionsDeQuestion(question) : question
  if (confirmGlobal) return confirmGlobal(opts)
  // Repli : fournisseur absent (écran hors application) : confirmation du navigateur
  return typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(opts.message || 'Confirmer ?') : false
}

export async function demander(question, { defaut = '', placeholder = '', title = 'Saisir' } = {}) {
  const opts = { title, message: String(question ?? ''), saisie: true, defaut: String(defaut ?? ''), placeholder, confirmLabel: 'Valider' }
  if (confirmGlobal) return confirmGlobal(opts)
  return typeof window !== 'undefined' && typeof window.prompt === 'function' ? window.prompt(opts.message, opts.defaut) : null
}

export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null)
  const [valeur, setValeur] = useState('')
  const resolver = useRef(null)
  const enCours = useRef(null)
  const confirm = useCallback((opts) => new Promise((resolve) => {
    // Une question déjà ouverte est refusée avant d'en poser une autre (jamais deux réponses mélangées)
    resolver.current?.(enCours.current?.saisie ? null : false)
    resolver.current = resolve
    enCours.current = opts || {}
    setValeur(opts?.saisie ? opts.defaut || '' : '')
    setReq(opts || {})
  }), [])
  // Saisie : Valider rend le texte, Annuler rend null (comme window.prompt) ; question : true ou false
  const close = (ok) => {
    const reponse = req?.saisie ? (ok ? valeur : null) : ok
    resolver.current?.(reponse); resolver.current = null; enCours.current = null; setReq(null)
  }
  useEffect(() => {
    confirmGlobal = confirm
    return () => { if (confirmGlobal === confirm) confirmGlobal = null }
  }, [confirm])
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {req && (
        <Sheet title={req.title || 'Confirmer'} size="sm" layer="z-[200]" onClose={() => close(false)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => close(false)}>{req.cancelLabel || 'Annuler'}</button>
            <button type="button" className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>{req.confirmLabel || 'Confirmer'}</button>
          </>}>
          {req.message && <p className="text-gray-700 whitespace-pre-line break-words">{req.message}</p>}
          {req.saisie && (
            <input className="input" autoFocus value={valeur} placeholder={req.placeholder || ''} aria-label={req.message || req.title}
              onChange={(e) => setValeur(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); close(true) } }} />
          )}
        </Sheet>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  // Repli sûr si le fournisseur manque : ne confirme jamais une action à la place de l'utilisateur
  return ctx || (async () => false)
}
