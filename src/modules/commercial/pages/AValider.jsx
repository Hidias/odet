import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Copy, Mail, Check, X, Loader2, Inbox, Send, Eye } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'
import { PageHeader } from '../../../ui/PageHeader'
import { Tabs } from '../../../ui/Tabs'
import { StatusBadge } from '../../../ui/StatusBadge'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { useAuthStore } from '../../../core/store'
import PiloteReglages from '../../pilote/PiloteReglages'
import { Kanban, CLASSE_ITEM_MENU } from '../../../ui/Kanban'
import { ChoixVue, useVue } from '../../../ui/ChoixVue'
import { colonnesRelances, passagesRelance, depotRelancePossible, MESSAGES_RELANCE } from '../lib/relances'

// Relances à valider (lot 2, 0043) : actions préparées chaque nuit par la base (recyclages à prévoir, puis
// justificatifs des prestataires, rappels…). Rien ne part tout seul : on valide, on corrige ou on ignore ; une action validée
// part depuis l'outil après aperçu (0518, /api/relance-envoi), ou se transmet par sa messagerie puis se marque « envoyée ».
// Téléphone d'abord.
// Deux affichages : liste par onglet, ou colonnes par état (Kanban, règles dans `lib/relances.js`).

const KINDS = { relance_recyclage: 'Recyclage', justificatif_prestataire: 'Justificatif', renouvellement_contrat: 'Renouvellement de contrat', visite_hors_contrat: 'Visite hors contrat', convocation: 'Convocation', rappel: 'Rappel', emargement_manquant: 'Émargement', eval_chaud: 'Évaluation à chaud', attestations: 'Attestations', evaluation_froid: 'Évaluation à froid', facture_brouillon: 'Facture', relance_impaye: 'Impayé', avis_financeur: 'Avis du financeur', autre: 'Autre' }
const STATUTS = { a_valider: ['warning', 'À valider'], valide: ['info', 'Validée'], envoye: ['success', 'Envoyée'], ignore: ['neutral', 'Ignorée'], erreur: ['danger', 'Erreur'] }
const ONGLETS = [['a_valider', 'À valider'], ['valide', 'À envoyer'], ['envoye', 'Envoyées'], ['ignore', 'Ignorées']]

export default function AValider() {
  const [items, setItems] = useState(null)
  const [indispo, setIndispo] = useState(false)
  const [onglet, setOnglet] = useState('a_valider')
  const [ouvert, setOuvert] = useState(null)
  const [busy, setBusy] = useState(false)
  const [reglages, setReglages] = useState(false)
  const [vue, setVue] = useVue('relances')
  const [apercu, setApercu] = useState(null)
  const can = useAuthStore((st) => st.can)
  const role = useAuthStore((st) => st.userRole)
  const droitModules = can('parametres.modules.gerer')
  const peutRegler = droitModules === true || (droitModules == null && ['superadmin', 'admin'].includes(role))

  const load = async () => {
    // Avant 0518 (envoi depuis l'outil) : ni erreur d'envoi ni boîte
    let { data, error } = await supabase.from('scheduled_actions')
      .select('id, kind, client_id, target_table, target_id, session_id, blocked_reason, due_on, title, payload, status, validated_at, sent_at, error, envoi_boite, clients(name)')
      .order('due_on', { ascending: true }).limit(500)
    if (error) ({ data, error } = await supabase.from('scheduled_actions')
      .select('id, kind, client_id, target_table, target_id, session_id, blocked_reason, due_on, title, payload, status, validated_at, sent_at, clients(name)')
      .order('due_on', { ascending: true }).limit(500))
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
  const colonnes = useMemo(() => colonnesRelances((items || []).filter((i) => !type || i.kind === type)), [items, type])
  const ouvrir = (a) => { setApercu(null); setOuvert({ ...a, payload: { ...(a.payload || {}) } }) }
  const types = useMemo(() => [...new Set((items || []).map((i) => i.kind))], [items])
  const prets = liste.filter((i) => i.status === 'a_valider' && !i.blocked_reason)

  const toutValider = async () => {
    if (!(await confirmer(`Valider ${prets.length} relance${prets.length > 1 ? 's' : ''} « ${KINDS[type] || type} » ? Elles passeront « à envoyer ».`))) return
    setBusy(true)
    // Seulement les relances encore « à valider » ; 0 ligne sans erreur : compte en lecture seule ou déjà traitées
    const { data, error } = await supabase.from('scheduled_actions').update({ status: 'valide' }).in('id', prets.map((i) => i.id)).eq('status', 'a_valider').select('id')
    setBusy(false)
    if (error) return toast.error(error.message)
    if (!data?.length) { toast.error('Aucune relance validée : déjà traitées, ou votre compte ne peut pas les modifier'); return load() }
    toast.success(data.length < prets.length ? `${data.length} relance${data.length > 1 ? 's' : ''} validée${data.length > 1 ? 's' : ''} sur ${prets.length} (les autres étaient déjà traitées)` : 'Relances validées : à envoyer')
    load()
  }

  // depuisFiche : la relance est ouverte, son texte sous les yeux (« Marquer envoyée » sans nouvelle question)
  const changer = async (a, status, payload, depuisFiche = false) => {
    const passage = passagesRelance(a).find((p) => p.status === status)
    if (!passage) return toast.error('Cette relance ne peut plus changer d\'état')
    if (passage.confirmer && !(depuisFiche && status === 'envoye') && !(await confirmer(passage.confirmer))) return
    setBusy(true)
    const maj = { status, ...(payload ? { payload } : {}) }
    // Seulement si la relance est encore dans l'état vu à l'écran (une autre personne a pu la traiter)
    const { data, error } = await supabase.from('scheduled_actions').update(maj).eq('id', a.id).eq('status', a.status).select('id')
    setBusy(false)
    if (error) return toast.error(error.message)
    if (!data?.length) {
      // 0 ligne sans erreur : soit l'état a changé entre-temps, soit le compte n'a pas le droit d'écrire (lecture seule)
      const { data: lue } = await supabase.from('scheduled_actions').select('status').eq('id', a.id).maybeSingle()
      toast.error(lue && lue.status === a.status ? 'Votre compte ne peut pas modifier les relances' : 'Cette relance a déjà été traitée : la liste est mise à jour')
      setOuvert(null)
      return load()
    }
    toast.success(MESSAGES_RELANCE[status] || 'Enregistré')
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

  // Envoi depuis l'outil (0518) : aperçu tel qu'il partira, exemple à soi, puis envoi au destinataire
  const voirApercu = async (a) => {
    setBusy(true)
    try { setApercu(await callApi('/api/relance-envoi', { id: a.id, action: 'apercu' })) } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const testAMoi = async (a) => {
    setBusy(true)
    try { const r = await callApi('/api/relance-envoi', { id: a.id, action: 'test' }); toast.success(`Exemple envoyé à ${r.test}`) } catch (e) { toast.error(e.message) }
    setBusy(false)
  }
  const envoyer = async (a) => {
    const dest = String(a.payload?.destinataire || '').trim()
    if (!(await confirmer({ title: 'Envoyer la relance', message: `Envoyer cette relance à ${dest} depuis votre boîte d'envoi ? Le mail part tout de suite.`, confirmLabel: 'Envoyer' }))) return
    setBusy(true)
    try {
      const r = await callApi('/api/relance-envoi', { id: a.id, action: 'envoi' })
      if (r.avertissement) toast.error(r.avertissement, { duration: 10000 })
      else toast.success(`Relance envoyée à ${r.destinataire}`)
      setOuvert(null)
    } catch (e) { toast.error(e.message, { duration: 8000 }) }
    setBusy(false)
    load()
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Relances à valider" meta={<span>Préparées chaque nuit par l'application ; rien n'est envoyé sans vous.</span>}
        actions={peutRegler ? <button type="button" className="btn btn-secondary" onClick={() => setReglages(true)}>Pilote des sessions</button> : null} />
      {reglages && <PiloteReglages onClose={() => { setReglages(false); load() }} />}
      {indispo && <Banner tone="warning">Les relances ne sont pas encore disponibles. Prévenez le support.</Banner>}
      {vue === 'liste' && <Tabs tabs={ONGLETS.map(([k, l]) => ({ id: k, label: l, count: compte[k] || 0 }))} value={onglet} onChange={setOnglet} />}
      <div className="flex flex-wrap items-center gap-2">
        <div className="order-last ml-auto"><ChoixVue vue={vue} onChange={setVue} /></div>
        {types.length > 1 && (<>
          <select className="select w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Type de relance">
            <option value="">Tous les types</option>
            {types.map((k) => <option key={k} value={k}>{KINDS[k] || k}</option>)}
          </select>
          {type && vue === 'liste' && onglet === 'a_valider' && prets.length > 1 && <button type="button" className="btn btn-sm btn-secondary" onClick={toutValider} disabled={busy}><Check className="w-4 h-4" /> Tout valider ({prets.length})</button>}
        </>)}
      </div>
      {items === null ? <Spinner /> : vue === 'colonnes' && items.length > 0 ? (
        <Kanban colonnes={colonnes} cle={(a) => a.id} label="Relances par état" labelMenu="Actions de la relance" vide="Aucune relance"
          onOuvrir={ouvrir}
          deplacable={(a) => !busy && passagesRelance(a).some((p) => p.parGlisser !== false)}
          peutDeposer={(a, code) => !busy && depotRelancePossible(a, code)}
          onDeposer={(a, code) => changer(a, code)}
          libelleMenu={(a) => `Actions : ${a.title}`}
          carte={(a) => (
            <>
              <div className="text-ui font-medium">{a.title}</div>
              <div className="text-ui-sm text-gray-500">
                {KINDS[a.kind]}{a.clients?.name ? ` · ${a.clients.name}` : ''}{a.due_on ? ` · échéance ${new Date(`${a.due_on}T12:00:00`).toLocaleDateString('fr-FR')}` : ''}
                {a.payload?.depasse ? ' · dépassée' : ''}
              </div>
              {a.blocked_reason && <div className="text-ui-sm text-[rgb(var(--c-warning))]">Bloquée : {a.blocked_reason}</div>}
              {a.status === 'valide' && a.error && <div className="text-ui-sm text-[rgb(var(--c-danger))]">Envoi échoué : {a.error}</div>}
            </>
          )}
          menu={({ ligne, choisir }) => (
            <>
              <button type="button" className={CLASSE_ITEM_MENU} onClick={() => choisir(() => ouvrir(ligne), false)}>Ouvrir (texte et destinataire)</button>
              {passagesRelance(ligne).map((p) => (
                <button key={p.status} type="button" className={CLASSE_ITEM_MENU} disabled={busy} onClick={() => choisir(() => changer(ligne, p.status))}>{p.label}</button>
              ))}
            </>
          )} />
      ) : liste.length === 0 ? (
        <EmptyState icon={Inbox} title={onglet === 'a_valider' ? 'Rien à valider' : 'Aucune relance ici'} compact>
          {onglet === 'a_valider' ? 'Chaque nuit, l\'outil prépare ici les relances utiles : recyclages à prévoir (formation arrivée à échéance), devis sans réponse, justificatifs à demander aux prestataires. Rien n\'est dû aujourd\'hui : la liste se remplit dès qu\'une échéance approche.' : null}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {liste.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => ouvrir(a)} className="card w-full text-left hover:bg-gray-50 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-gray-900">{a.title}</span>
                  <StatusBadge tone={STATUTS[a.status]?.[0]}>{STATUTS[a.status]?.[1]}</StatusBadge>
                </div>
                <div className="text-ui-sm text-gray-500">
                  {KINDS[a.kind]}{a.clients?.name ? ` · ${a.clients.name}` : ''}{a.due_on ? ` · échéance ${new Date(`${a.due_on}T12:00:00`).toLocaleDateString('fr-FR')}` : ''}
                  {a.payload?.depasse ? ' · dépassée' : ''}
                </div>
                {a.blocked_reason && <div className="text-ui-sm text-[rgb(var(--c-warning))]">Bloquée : {a.blocked_reason}</div>}
                {a.status === 'valide' && a.error && <div className="text-ui-sm text-[rgb(var(--c-danger))]">Envoi échoué : {a.error}</div>}
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
            {ouvert.status === 'a_valider' && !ouvert.blocked_reason && <button type="button" className="btn btn-primary" onClick={() => changer(ouvert, 'valide', ouvert.payload)} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Valider</button>}
            {ouvert.status === 'valide' && (ouvert.payload.destinataire
              ? <button type="button" className="btn btn-primary" onClick={() => envoyer(ouvert)} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Envoyer</button>
              : <button type="button" className="btn btn-primary" onClick={() => changer(ouvert, 'envoye', null, true)} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Marquer envoyée</button>)}
            {['envoye', 'ignore'].includes(ouvert.status) && <button type="button" className="btn btn-secondary" onClick={() => setOuvert(null)}>Fermer</button>}
          </>}>
          <div className="text-ui-sm text-gray-600">
            {ouvert.clients?.name && <Link to={`/clients/${ouvert.client_id}`} className="text-accent-700 hover:underline" onClick={() => setOuvert(null)}>{ouvert.clients.name}</Link>}
            {ouvert.payload?.lien && <Link to={ouvert.payload.lien} className="text-accent-700 hover:underline ml-3" onClick={() => setOuvert(null)}>{ouvert.session_id ? 'Ouvrir la session' : 'Ouvrir'}</Link>}
            {ouvert.payload?.note && <p className="text-[rgb(var(--c-warning))] mt-1">{ouvert.payload.note}</p>}
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
          {ouvert.status === 'valide' && ouvert.error && <Banner tone="danger">Dernier envoi échoué : {ouvert.error}. Vous pouvez réessayer.</Banner>}
          {ouvert.status === 'valide' && ouvert.payload.destinataire && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => voirApercu(ouvert)} disabled={busy}><Eye className="w-4 h-4" /> Voir le mail</button>
              <button type="button" className="btn btn-secondary" onClick={() => testAMoi(ouvert)} disabled={busy}><Mail className="w-4 h-4" /> Test à moi</button>
            </div>
          )}
          {ouvert.status === 'valide' && apercu && (
            <div className="space-y-1 text-ui-sm text-gray-600">
              <p>De : {apercu.expediteur || 'boîte d\'envoi non configurée'} · À : {apercu.destinataire || 'aucun destinataire'}{apercu.copieCachee ? ` · Copie cachée : ${apercu.copieCachee}` : ''}</p>
              <p>Objet : <span className="font-medium text-gray-900">{apercu.sujet}</span></p>
              <p>Pièces jointes : {apercu.piecesJointes?.length ? apercu.piecesJointes.map((x) => x.nom).join(', ') : 'aucune'}</p>
              {apercu.avertissement && <p className="text-[rgb(var(--c-warning))]">{apercu.avertissement}</p>}
              <iframe title="Aperçu du mail" className="w-full border rounded-ui bg-white" style={{ minHeight: 320 }} sandbox="" srcDoc={apercu.html} />
            </div>
          )}
          {ouvert.status === 'valide' && (
            <details className="text-ui-sm text-gray-600">
              <summary className="cursor-pointer">Envoyer plutôt depuis ma messagerie</summary>
              <div className="flex flex-wrap gap-2 mt-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => copier(ouvert)}><Copy className="w-4 h-4" /> Copier objet et texte</button>
                {mailto(ouvert) && <a className="btn btn-secondary btn-sm" href={mailto(ouvert)}><Mail className="w-4 h-4" /> Ouvrir dans ma messagerie</a>}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => changer(ouvert, 'envoye', null, true)} disabled={busy}><Check className="w-4 h-4" /> Marquer envoyée</button>
              </div>
              <p className="mt-1">Une fois le mail parti de votre messagerie, « Marquer envoyée ».</p>
            </details>
          )}
          {ouvert.status === 'envoye' && ouvert.envoi_boite && <p className="text-ui-sm text-gray-500">Envoyée depuis l'outil, par la boîte {ouvert.envoi_boite}{ouvert.sent_at ? ` le ${new Date(ouvert.sent_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}.</p>}
        </Sheet>
      )}
    </div>
  )
}
