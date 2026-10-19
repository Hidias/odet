import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Copy, Mail, Check, X, Loader2, Inbox } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { PageHeader } from '../../../ui/PageHeader'
import { StatusBadge } from '../../../ui/StatusBadge'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { useAuthStore } from '../../../core/store'
import PiloteReglages from '../../pilote/PiloteReglages'

// Relances à valider (lot 2, 0043) : actions préparées chaque nuit par la base (recyclages à prévoir, puis
// justificatifs des prestataires, rappels…). Rien ne part tout seul : on valide, on corrige ou on ignore ; une action validée se
// transmet par sa messagerie (texte prêt à copier) puis se marque « envoyée ». Téléphone d'abord.

const KINDS = { relance_recyclage: 'Recyclage', justificatif_prestataire: 'Justificatif', renouvellement_contrat: 'Renouvellement de contrat', visite_hors_contrat: 'Visite hors contrat', convocation: 'Convocation', rappel: 'Rappel', emargement_manquant: 'Émargement', eval_chaud: 'Évaluation à chaud', attestations: 'Attestations', evaluation_froid: 'Évaluation à froid', facture_brouillon: 'Facture', relance_impaye: 'Impayé', autre: 'Autre' }
const STATUTS = { a_valider: ['warning', 'À valider'], valide: ['info', 'Validée'], envoye: ['success', 'Envoyée'], ignore: ['neutral', 'Ignorée'], erreur: ['danger', 'Erreur'] }
const ONGLETS = [['a_valider', 'À valider'], ['valide', 'À envoyer'], ['envoye', 'Envoyées'], ['ignore', 'Ignorées']]

export default function AValider() {
  const [items, setItems] = useState(null)
  const [indispo, setIndispo] = useState(false)
  const [onglet, setOnglet] = useState('a_valider')
  const [ouvert, setOuvert] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reglages, setReglages] = useState(false)
  const can = useAuthStore((st) => st.can)
  const role = useAuthStore((st) => st.userRole)
  const droitModules = can('parametres.modules.gerer')
  const peutRegler = droitModules === true || (droitModules == null && ['superadmin', 'admin'].includes(role))

  const load = async () => {
    let { data, error } = await supabase.from('scheduled_actions')
      .select('id, kind, client_id, target_table, target_id, session_id, blocked_reason, due_on, title, payload, status, validated_at, sent_at, clients(name)')
      .order('due_on', { ascending: true }).limit(500)
    // Avant 0160 (pilote des sessions) : ni session_id ni blocked_reason
    if (error) ({ data, error } = await supabase.from('scheduled_actions')
      .select('id, kind, client_id, target_table, target_id, due_on, title, payload, status, validated_at, sent_at, clients(name)')
      .order('due_on', { ascending: true }).limit(500))
    if (error) { setIndispo(true); setItems([]); return }
    setItems(data || [])
  }
  useEffect(() => { load() }, [])

  const [type, setType] = useState('')
  const compte = useMemo(() => Object.fromEntries(ONGLETS.map(([k]) => [k, (items || []).filter((i) => i.status === k).length])), [items])
  const liste = (items || []).filter((i) => i.status === onglet && (!type || i.kind === type))
  const types = useMemo(() => [...new Set((items || []).map((i) => i.kind))], [items])
  const prets = liste.filter((i) => i.status === 'a_valider' && !i.blocked_reason)

  const toutValider = async () => {
    if (!(await confirmer(`Valider ${prets.length} relance${prets.length > 1 ? 's' : ''} « ${KINDS[type] || type} » ? Elles passeront « à envoyer ».`))) return
    setBusy(true)
    const { error } = await supabase.from('scheduled_actions').update({ status: 'valide' }).in('id', prets.map((i) => i.id))
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Relances validées : à envoyer')
    load()
  }

  const changer = async (a, status, payload) => {
    if (status === 'ignore' && !(await confirmer('Ignorer cette relance ? Elle ne sera plus proposée.'))) return
    setBusy(true)
    const maj = { status, ...(payload ? { payload } : {}) }
    const { error } = await supabase.from('scheduled_actions').update(maj).eq('id', a.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success({ valide: 'Relance validée : à envoyer', envoye: 'Relance marquée envoyée', ignore: 'Relance ignorée', a_valider: 'Remise à valider' }[status] || 'Enregistré')
    setOuvert(null)
    load()
  }

  const copier = async (a) => {
    const p = a.payload || {}
    try {
      await navigator.clipboard.writeText(`${p.objet || a.title}\n\n${p.texte || ''}`)
      toast.success('Objet et texte copiés')
    } catch { toast.error('Copie impossible') }
  }

  const mailto = (a) => {
    const p = a.payload || {}
    if (!p.destinataire) return null
    return `mailto:${encodeURIComponent(p.destinataire)}?subject=${encodeURIComponent(p.objet || a.title)}&body=${encodeURIComponent(p.texte || '')}`
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Relances à valider" meta={<span>Préparées chaque nuit par l'application ; rien n'est envoyé sans vous.</span>}
        actions={peutRegler ? <button type="button" className="btn btn-secondary" onClick={() => setReglages(true)}>Pilote des sessions</button> : null} />
      {reglages && <PiloteReglages onClose={() => { setReglages(false); load() }} />}
      {indispo && <Banner tone="warning">Les relances ne sont pas encore disponibles sur cette instance (migration 0043).</Banner>}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Relances">
        {ONGLETS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={onglet === k} onClick={() => setOnglet(k)}
            className={`btn btn-sm ${onglet === k ? 'btn-primary' : 'btn-secondary'}`}>{l} ({compte[k] || 0})</button>
        ))}
      </div>
      {types.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="select w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type de relance">
            <option value="">Tous les types</option>
            {types.map((k) => <option key={k} value={k}>{KINDS[k] || k}</option>)}
          </select>
          {type && onglet === 'a_valider' && prets.length > 1 && <button type="button" className="btn btn-sm btn-secondary" onClick={toutValider} disabled={busy}><Check className="w-4 h-4" /> Tout valider ({prets.length})</button>}
        </div>
      )}
      {items === null ? <Spinner /> : liste.length === 0 ? (
        <EmptyState icon={Inbox} title={onglet === 'a_valider' ? 'Rien à valider' : 'Aucune relance ici'} compact>
          {onglet === 'a_valider' ? 'Chaque nuit, l\'outil prépare ici les relances utiles : recyclages à prévoir (formation arrivée à échéance), devis sans réponse, justificatifs à demander aux prestataires. Rien n\'est dû aujourd\'hui : la liste se remplit dès qu\'une échéance approche.' : null}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {liste.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setOuvert({ ...a, payload: { ...(a.payload || {}) } })} className="card w-full text-left hover:bg-gray-50 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-gray-900">{a.title}</span>
                  <StatusBadge tone={STATUTS[a.status]?.[0]}>{STATUTS[a.status]?.[1]}</StatusBadge>
                </div>
                <div className="text-ui-sm text-gray-500">
                  {KINDS[a.kind]}{a.clients?.name ? ` · ${a.clients.name}` : ''}{a.due_on ? ` · échéance ${new Date(`${a.due_on}T12:00:00`).toLocaleDateString('fr-FR')}` : ''}
                  {a.payload?.depasse ? ' · dépassée' : ''}
                </div>
                {a.blocked_reason && <div className="text-ui-sm text-[rgb(var(--c-warning))]">Bloquée : {a.blocked_reason}</div>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {ouvert && (
        <Sheet title={KINDS[ouvert.kind] || 'Relance'} onClose={() => setOuvert(null)} size="lg"
          footer={<>
            {ouvert.status === 'a_valider' && <button type="button" className="btn btn-ghost mr-auto" onClick={() => changer(ouvert, 'ignore')} disabled={busy}><X className="w-4 h-4" /> Ignorer</button>}
            {ouvert.status === 'valide' && <button type="button" className="btn btn-ghost mr-auto" onClick={() => changer(ouvert, 'a_valider')} disabled={busy}>Remettre à valider</button>}
            {ouvert.status === 'a_valider' && <button type="button" className="btn btn-primary" onClick={() => changer(ouvert, 'valide', ouvert.payload)} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Valider</button>}
            {ouvert.status === 'valide' && <button type="button" className="btn btn-primary" onClick={() => changer(ouvert, 'envoye')} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Marquer envoyée</button>}
            {['envoye', 'ignore'].includes(ouvert.status) && <button type="button" className="btn btn-secondary" onClick={() => setOuvert(null)}>Fermer</button>}
          </>}>
          <div className="text-ui-sm text-gray-600">
            {ouvert.clients?.name && <Link to={`/clients/${ouvert.client_id}`} className="text-accent-700 hover:underline" onClick={() => setOuvert(null)}>{ouvert.clients.name}</Link>}
            {ouvert.payload?.lien && <Link to={ouvert.payload.lien} className="text-accent-700 hover:underline ml-3" onClick={() => setOuvert(null)}>{ouvert.session_id ? 'Ouvrir la session' : 'Ouvrir'}</Link>}
            {ouvert.blocked_reason && <p className="text-[rgb(var(--c-warning))] mt-1">Bloquée : {ouvert.blocked_reason}. Complétez la session : l'étape se débloque à la prochaine préparation (chaque nuit).</p>}
            {ouvert.target_table === 'subcontractors' && <Link to="/sous-traitants" className="text-accent-700 hover:underline" onClick={() => setOuvert(null)}>Voir les sous-traitants</Link>}
          </div>
          <div>
            <label className="label" htmlFor="rel-dest">Destinataire</label>
            <input id="rel-dest" className="input" value={ouvert.payload.destinataire || ''} disabled={ouvert.status !== 'a_valider'}
              onChange={(e) => setOuvert({ ...ouvert, payload: { ...ouvert.payload, destinataire: e.target.value } })} placeholder="Adresse email du destinataire" />
            {!ouvert.payload.destinataire && <p className="text-ui-sm text-[rgb(var(--c-warning))] mt-1">Aucune adresse sur la fiche : complétez-la ici ou sur la fiche.</p>}
          </div>
          <div>
            <label className="label" htmlFor="rel-objet">Objet</label>
            <input id="rel-objet" className="input" value={ouvert.payload.objet || ''} disabled={ouvert.status !== 'a_valider'}
              onChange={(e) => setOuvert({ ...ouvert, payload: { ...ouvert.payload, objet: e.target.value } })} />
          </div>
          <div>
            <label className="label" htmlFor="rel-texte">Texte</label>
            <textarea id="rel-texte" className="input min-h-[220px]" value={ouvert.payload.texte || ''} disabled={ouvert.status !== 'a_valider'}
              onChange={(e) => setOuvert({ ...ouvert, payload: { ...ouvert.payload, texte: e.target.value } })} />
          </div>
          {ouvert.status === 'valide' && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => copier(ouvert)}><Copy className="w-4 h-4" /> Copier objet et texte</button>
              {mailto(ouvert) && <a className="btn btn-secondary" href={mailto(ouvert)}><Mail className="w-4 h-4" /> Ouvrir dans ma messagerie</a>}
            </div>
          )}
          {ouvert.status === 'valide' && <p className="text-ui-sm text-gray-500">L'envoi automatique n'est pas activé : envoyez depuis votre messagerie, puis « Marquer envoyée ».</p>}
        </Sheet>
      )}
    </div>
  )
}
