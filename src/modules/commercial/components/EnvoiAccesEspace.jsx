// Envoi de l'accès à l'espace client (0449) : le lien et le code partent dans deux e-mails séparés, depuis la boîte
// de la personne, à un contact du client ; option « code envoyé à part » (le code n'est plus imprimé sur les devis et
// conventions) ; appareils qui ont ouvert l'espace.

import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Send, Loader2, Smartphone } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'
import { confirmer } from '../../../ui/Confirm'

const quand = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const libelle = (ua) => {
  const u = String(ua || '')
  const nav = /edg\//i.test(u) ? 'Edge' : /chrome|crios/i.test(u) ? 'Chrome' : /firefox|fxios/i.test(u) ? 'Firefox' : /safari/i.test(u) ? 'Safari' : 'Navigateur'
  const os = /iphone/i.test(u) ? 'iPhone' : /ipad/i.test(u) ? 'iPad' : /android/i.test(u) ? 'Android' : /windows/i.test(u) ? 'Windows' : /mac os/i.test(u) ? 'Mac' : /linux/i.test(u) ? 'Linux' : ''
  return [nav, os].filter(Boolean).join(', ')
}

export default function EnvoiAccesEspace({ acces, contacts = [], peutGerer, onChange }) {
  const adresses = [...new Set([acces.contact_email, ...contacts.map((c) => c.email)].filter(Boolean).map((e) => e.trim().toLowerCase()))]
  const [to, setTo] = useState(adresses[0] || '')
  const [busy, setBusy] = useState(null)
  const [appareils, setAppareils] = useState([])
  useEffect(() => {
    supabase.from('portal_devices').select('id, user_agent, first_seen_at, last_seen_at, access_id, profile_id').eq('client_id', acces.client_id).order('last_seen_at', { ascending: false }).limit(20)
      .then(({ data }) => setAppareils(data || []))
  }, [acces.client_id])

  const envoyer = async (quoi) => {
    if (!to) { toast.error('Choisissez l\'adresse d\'un contact'); return }
    if (!(await confirmer(quoi === 'lien' ? `Envoyer le lien de l'espace à ${to} ?` : `Envoyer le code d'accès à ${to}, dans un e-mail séparé du lien ?`))) return
    setBusy(quoi)
    try {
      await callApi('/api/espace-entreprise', { action: 'envoyer_acces', client_id: acces.client_id, quoi, to })
      toast.success(quoi === 'lien' ? 'Lien envoyé' : 'Code envoyé')
      onChange?.()
    } catch (e) { toast.error(e.message) }
    setBusy(null)
  }

  return (
    <div className="space-y-2 pt-2 border-t border-gray-100">
      {peutGerer && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select className="select text-ui-sm flex-1 min-w-[10rem]" aria-label="Adresse du contact" value={to} onChange={(e) => setTo(e.target.value)}>
              {adresses.length === 0 && <option value="">Aucun contact avec e-mail</option>}
              {adresses.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary btn-sm justify-center" disabled={!!busy || !acces.is_active || !to} onClick={() => envoyer('lien')}>{busy === 'lien' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}Envoyer le lien</button>
            <button type="button" className="btn btn-secondary btn-sm justify-center" disabled={!!busy || !acces.is_active || !to} onClick={() => envoyer('code')}>{busy === 'code' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}Envoyer le code</button>
          </div>
          <p className="text-ui-sm text-gray-500">Deux e-mails séparés : celui qui intercepte l'un n'a pas l'autre.
            {acces.link_sent_at ? ` Lien envoyé le ${quand(acces.link_sent_at)}.` : ''}{acces.code_sent_at ? ` Code envoyé le ${quand(acces.code_sent_at)}.` : ''}
            {acces.code_changed_at ? ` Code changé par le client le ${quand(acces.code_changed_at)}.` : ''}</p>
          <label className="flex items-start gap-2 text-ui-sm">
            <input type="checkbox" className="mt-0.5" checked={!!acces.code_apart} onChange={async (e) => {
              const { error } = await supabase.from('client_portal_access').update({ code_apart: e.target.checked, updated_at: new Date().toISOString() }).eq('id', acces.id)
              if (error) toast.error(error.message); else onChange?.()
            }} />
            <span>Code envoyé à part : ne plus l'imprimer sur les devis et conventions (l'encadré « Signer en ligne » renvoie à l'e-mail séparé)</span>
          </label>
        </>
      )}
      {appareils.length > 0 && (
        <details className="text-ui-sm">
          <summary className="cursor-pointer text-gray-600 flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" />{appareils.length} appareil{appareils.length > 1 ? 's' : ''} ont ouvert l'espace</summary>
          <ul className="mt-1 divide-y divide-gray-100">
            {appareils.map((a) => <li key={a.id} className="py-1 flex flex-wrap gap-x-2"><span>{libelle(a.user_agent)}</span><span className="text-gray-400">{a.access_id ? 'lien et code' : 'compte'}</span><span className="text-gray-500 ml-auto">{quand(a.last_seen_at)}</span></li>)}
          </ul>
        </details>
      )}
    </div>
  )
}
