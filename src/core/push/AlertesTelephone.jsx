import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Smartphone, BellRing, BellOff, Loader2 } from 'lucide-react'
import { supabase } from '../supabase'
import { callApi } from '../api'
import { getCurrentCompanyId } from '../company/companyContext'

// Alertes sur le téléphone (0411) : active les notifications de l'application sur cet appareil (gratuit, sans
// abonnement). Rien entre 21 h et 7 h 30 ; plusieurs alertes d'un coup arrivent regroupées.
// Sur iPhone, les alertes web demandent d'ajouter l'application à l'écran d'accueil (Safari › Partager).

const enOctets = (base64) => {
  const p = '='.repeat((4 - (base64.length % 4)) % 4)
  const b = atob((base64 + p).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...b].map((c) => c.charCodeAt(0)))
}
const pris = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const iphoneHorsEcran = () => /iPhone|iPad/.test(navigator.userAgent) && !window.matchMedia?.('(display-mode: standalone)').matches && !navigator.standalone

function appareil() {
  const ua = navigator.userAgent
  const sys = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Appareil'
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navigateur'
  return `${nav}, ${sys}`
}

export default function AlertesTelephone() {
  const [etat, setEtat] = useState('lecture')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pris()) { setEtat(iphoneHorsEcran() ? 'iphone' : 'impossible'); return }
    navigator.serviceWorker.getRegistration('/').then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription()
      setEtat(sub ? 'actif' : Notification.permission === 'denied' ? 'refuse' : 'inactif')
    }).catch(() => setEtat('inactif'))
  }, [])

  const activer = async () => {
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setEtat('refuse'); return }
      const { publicKey } = await callApi('/api/push', { action: 'cle' })
      const reg = await navigator.serviceWorker.register('/sw-push.js', { scope: '/' })
      await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: enOctets(publicKey) })
      const j = sub.toJSON()
      const ligne = { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, label: appareil() }
      if (getCurrentCompanyId()) ligne.company_id = getCurrentCompanyId()
      const { error } = await supabase.from('push_subscriptions').upsert(ligne, { onConflict: 'endpoint' })
      if (error) throw error
      setEtat('actif')
      await callApi('/api/push', { action: 'tester' }).catch(() => null)
      toast.success('Alertes activées sur cet appareil')
    } catch (e) { toast.error(e.message || 'Activation impossible') } finally { setBusy(false) }
  }

  const couper = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
        await sub.unsubscribe()
      }
      setEtat('inactif')
      toast.success('Alertes coupées sur cet appareil')
    } catch (e) { toast.error(e.message) } finally { setBusy(false) }
  }

  if (etat === 'lecture') return null
  return (
    <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 text-ui-sm">
      <Smartphone className="w-4 h-4 text-gray-500 flex-none" aria-hidden="true" />
      {etat === 'actif' && <><span className="flex-1 text-gray-700">Alertes actives sur cet appareil</span>
        <button type="button" className="text-accent-700 hover:underline inline-flex items-center gap-1" onClick={couper} disabled={busy}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellOff className="w-3.5 h-3.5" />}Couper</button></>}
      {etat === 'inactif' && <><span className="flex-1 text-gray-700">Recevoir les alertes sur cet appareil</span>
        <button type="button" className="text-accent-700 hover:underline inline-flex items-center gap-1" onClick={activer} disabled={busy}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}Activer</button></>}
      {etat === 'refuse' && <span className="flex-1 text-gray-600">Alertes bloquées par le navigateur : autorisez les notifications pour ce site dans ses réglages.</span>}
      {etat === 'iphone' && <span className="flex-1 text-gray-600">Sur iPhone : ajoutez l'application à l'écran d'accueil (Partager › Sur l'écran d'accueil), puis activez les alertes depuis l'icône.</span>}
      {etat === 'impossible' && <span className="flex-1 text-gray-600">Ce navigateur ne reçoit pas les alertes.</span>}
    </div>
  )
}
