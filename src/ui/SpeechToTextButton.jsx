import { useState, useEffect, useRef, useCallback } from 'react'
import { Mic, Square } from 'lucide-react'

/**
 * Bouton micro pour dictée vocale (Speech-to-Text)
 * v4 : stop manuel uniquement + anti-boucle infinie
 */
export default function SpeechToTextButton({ 
  onTranscript, 
  lang = 'fr-FR', 
  compact = false,
  className = '' 
}) {
  const [isListening, setIsListening] = useState(false)
  const [isSupported, setIsSupported] = useState(true)
  const [interim, setInterim] = useState('')
  const wantRef = useRef(false)
  const recRef = useRef(null)
  const timerRef = useRef(null)
  const failCountRef = useRef(0)
  const cbRef = useRef(onTranscript)

  useEffect(() => { cbRef.current = onTranscript }, [onTranscript])

  // Nettoyage
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) setIsSupported(false)
    return () => {
      wantRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
      try { recRef.current?.abort() } catch {}
    }
  }, [])

  const doStart = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR || !wantRef.current) return

    // Garde-fou : max 5 échecs consécutifs → on arrête
    if (failCountRef.current >= 5) {
      console.warn('Speech: trop de restarts, arrêt')
      wantRef.current = false
      setIsListening(false)
      setInterim('')
      failCountRef.current = 0
      return
    }

    const r = new SR()
    r.lang = lang
    r.continuous = true
    r.interimResults = true

    r.onresult = (event) => {
      // Succès → reset le compteur d'échecs
      failCountRef.current = 0
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript
        } else {
          interimText += event.results[i][0].transcript
        }
      }
      if (finalText) {
        cbRef.current(finalText.trim())
        setInterim('')
      } else {
        setInterim(interimText)
      }
    }

    r.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setIsSupported(false)
        wantRef.current = false
        setIsListening(false)
        return
      }
      if (event.error === 'aborted') {
        // Chrome avorte quand on restart trop vite → incrémenter le compteur
        failCountRef.current++
        return // onend va gérer le restart avec délai
      }
      // no-speech est normal (silence) → onend relancera
    }

    r.onend = () => {
      if (!wantRef.current) {
        setIsListening(false)
        setInterim('')
        return
      }
      // Relancer après un délai (plus long si échecs récents)
      const delay = failCountRef.current > 0 ? 1000 * failCountRef.current : 500
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (wantRef.current) doStart()
      }, delay)
    }

    recRef.current = r
    try {
      r.start()
    } catch (e) {
      failCountRef.current++
      // Retry après délai
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        if (wantRef.current) doStart()
      }, 1000)
    }
  }, [lang])

  const startListening = useCallback(() => {
    wantRef.current = true
    failCountRef.current = 0
    setIsListening(true)
    setInterim('')
    doStart()
  }, [doStart])

  const stopListening = useCallback(() => {
    wantRef.current = false
    failCountRef.current = 0
    if (timerRef.current) clearTimeout(timerRef.current)
    try { recRef.current?.abort() } catch {}
    setIsListening(false)
    setInterim('')
  }, [])

  if (!isSupported) return null

  return (
    <div className={`inline-flex flex-col items-end ${className}`}>
      <button
        type="button"
        onClick={() => isListening ? stopListening() : startListening()}
        title={isListening ? 'Arrêter la dictée' : 'Dicter (micro)'}
        className={`
          inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-200
          ${compact ? 'w-8 h-8' : 'px-3 py-1.5 text-xs'}
          ${isListening 
            ? 'bg-red-500 text-white shadow-lg shadow-red-200 animate-pulse hover:bg-red-600' 
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-800'
          }
        `}
      >
        {isListening ? (
          <>
            <Square className={compact ? 'w-3.5 h-3.5' : 'w-3 h-3'} fill="currentColor" />
            {!compact && 'Stop'}
          </>
        ) : (
          <>
            <Mic className={compact ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
            {!compact && 'Micro'}
          </>
        )}
      </button>
      {isListening && (
        <div className={`mt-1 px-2 py-1 rounded text-xs max-w-[220px] ${interim ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-red-50 text-red-400'}`}>
          {interim ? `${interim}...` : '🎙️ Parlez...'}
        </div>
      )}
    </div>
  )
}
