import { useCallback, useEffect, useState } from 'react'
import { KeyRound, Loader, Send, CheckCircle2, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../../../core/supabase'
import { apiFetch } from '../../../core/api'
import { useDataStore } from '../../../core/store'
import { prepareOrgForPDF } from '../../../core/org/orgUtils'
import { generatePasseportPreventionPDF } from '../../prevention/pdf/pdfPasseportPrevention'
import { donneesDecharge } from '../../prevention/lib/dechargeNir'

// Session : salariés qui ne retrouvent pas leur n° de sécurité sociale (0440, décision de H du 22/10). Autorisation
// signée dans le portail ; demande envoyée à l'entreprise (automatiquement si l'interrupteur « demande_nir » est
// ouvert, sinon ici), numéro saisi par l'entreprise dans son espace. Rien d'affiché sans demande.

const quand = (d) => (d ? new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '')

export default function DemandesNirSession({ session, peutEnvoyer = false }) {
  const { organization, fetchOrganization } = useDataStore()
  const [demandes, setDemandes] = useState([])
  const [envoi, setEnvoi] = useState(null)
  const [dansPasseport, setDansPasseport] = useState(new Set())

  const charger = useCallback(async () => {
    if (!session?.id) return
    const [{ data: sigs }, { data: mails }] = await Promise.all([
      supabase.from('document_signatures').select('id, trainee_id, signature_data, signed_at')
        .eq('session_id', session.id).eq('document_type', 'autorisation_nir').eq('status', 'valid').order('signed_at', { ascending: false }),
      supabase.from('session_emails_sent').select('created_at, to_email, attachments').eq('session_id', session.id).eq('email_type', 'demande_nir'),
    ])
    // Numéro déjà passé dans le Passeport (reprise automatique) : reçu aussi
    const ids = [...new Set((sigs || []).map((s) => s.trainee_id))]
    if (ids.length) {
      const { data: pp } = await supabase.rpc('pp_nir_etat', { p_trainee_ids: ids })
      setDansPasseport(new Set((pp || []).map((x) => x.trainee_id)))
    }
    setDemandes((sigs || []).map((s) => ({
      ...s,
      envoi: (mails || []).find((m) => (m.attachments || []).some((a) => a?.signature_id === s.id)) || null,
    })))
  }, [session?.id])
  useEffect(() => { charger() }, [charger])
  useEffect(() => { if (!organization) fetchOrganization?.() }, [organization, fetchOrganization])

  if (!demandes.length) return null
  const stagiaire = (id) => (session.session_trainees || []).find((st) => st.trainee_id === id || st.trainees?.id === id)?.trainees || {}

  const pdfDe = async (d) => {
    const org = (await prepareOrgForPDF(organization)) || organization
    return generatePasseportPreventionPDF('autorisation', org, donneesDecharge(session, stagiaire(d.trainee_id), d)).output('datauristring').split(',')[1]
  }
  const ouvrir = async (d) => {
    const b64 = await pdfDe(d)
    const bin = atob(b64); const o = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i)
    window.open(URL.createObjectURL(new Blob([o], { type: 'application/pdf' })), '_blank', 'noopener')
  }
  const envoyer = async (d) => {
    setEnvoi(d.id)
    try {
      const pdf = await pdfDe(d)
      const r = await apiFetch('/api/nir-demande', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'equipe', signature_id: d.id, pdf }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`)
      if (j.envoye) toast.success(`Demande envoyée à ${j.a}`)
      else toast(j.raison || 'Rien à envoyer')
      charger()
    } catch (e) { toast.error(e.message) }
    setEnvoi(null)
  }

  return (
    <div className="card p-4 mb-4 border-l-4 border-[rgb(var(--c-warning))]">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2"><KeyRound className="w-4 h-4" aria-hidden="true" />N° de sécurité sociale demandés à l'entreprise</h3>
      <ul className="mt-2 space-y-2">
        {demandes.map((d) => {
          const t = stagiaire(d.trainee_id)
          const renseigne = !!t.ssn_present || dansPasseport.has(d.trainee_id)
          return (
            <li key={d.id} className="flex items-center justify-between gap-3 flex-wrap text-ui">
              <span>
                <b>{(t.last_name || '').toUpperCase()} {t.first_name}</b>
                <span className="muted"> · autorisation signée le {quand(d.signed_at)}</span>
                {renseigne ? <span className="ml-2 text-[rgb(var(--c-success))] inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />numéro reçu</span>
                  : d.envoi ? <span className="muted"> · demande envoyée le {quand(d.envoi.created_at)} à {d.envoi.to_email}</span>
                    : <span className="text-[rgb(var(--c-warning))]"> · demande à envoyer</span>}
              </span>
              <span className="flex gap-2">
                <button type="button" className="btn btn-secondary btn-sm gap-1" onClick={() => ouvrir(d)}><FileText className="w-3.5 h-3.5" aria-hidden="true" />Autorisation</button>
                {!renseigne && peutEnvoyer && (
                  <button type="button" className="btn btn-primary btn-sm gap-1" disabled={envoi === d.id} onClick={() => envoyer(d)}>
                    {envoi === d.id ? <Loader className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Send className="w-3.5 h-3.5" aria-hidden="true" />}{d.envoi ? 'Relancer' : "Envoyer à l'entreprise"}
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
