import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Inbox, Loader2, Megaphone, Plus } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { useAuthStore } from '../../../core/store'
import { PageHeader } from '../../../ui/PageHeader'
import { StatusBadge } from '../../../ui/StatusBadge'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { EmptyState, Spinner } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'

// Espace entreprise, côté organisme (lot 2, 0046) : demandes reçues des comptes entreprise (inscription à une session
// inter, demande de formation intra, remplacement, message) et actualités publiées dans les espaces.
// Les comptes se gèrent sur la fiche client (carte « Comptes de l'espace entreprise »).

const KINDS = { inscription_inter: 'Inscription inter', demande_intra: 'Formation intra', remplacement: 'Remplacement', message: 'Message' }
const STATUTS = { nouvelle: ['warning', 'Nouvelle'], en_cours: ['info', 'En cours'], traitee: ['success', 'Traitée'], refusee: ['neutral', 'Refusée'] }
const NEWS = { brouillon: ['neutral', 'Brouillon'], publie: ['success', 'Publiée'], archive: ['neutral', 'Archivée'] }
const fr = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '')

export default function EspaceEntrepriseAdmin() {
  const can = useAuthStore((s) => s.can)
  const peutTraiter = can('clients.fiches.modifier') !== false
  const peutPublier = can('clients.espace.gerer') !== false
  const [onglet, setOnglet] = useState('demandes')
  const [demandes, setDemandes] = useState(null)
  const [actus, setActus] = useState([])
  const [indispo, setIndispo] = useState(false)
  const [filtre, setFiltre] = useState('ouvertes')
  const [ouverte, setOuverte] = useState(null)
  const [actu, setActu] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [{ data, error }, { data: n }] = await Promise.all([
      supabase.from('client_requests').select('*, clients(id, name), sessions(reference, start_date), courses(title)').order('created_at', { ascending: false }).limit(300),
      supabase.from('client_news').select('*').order('created_at', { ascending: false }).limit(100),
    ])
    if (error) { setIndispo(true); setDemandes([]); return }
    setDemandes(data || [])
    setActus(n || [])
  }
  useEffect(() => { load() }, [])

  const liste = useMemo(() => (demandes || []).filter((r) => (filtre === 'ouvertes' ? ['nouvelle', 'en_cours'].includes(r.status) : true)), [demandes, filtre])

  const traiter = async (status) => {
    setBusy(true)
    const { error } = await supabase.from('client_requests').update({ status, response: ouverte.response || null }).eq('id', ouverte.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(status === 'traitee' ? 'Demande traitée' : status === 'refusee' ? 'Demande refusée' : 'Demande prise en charge')
    setOuverte(null)
    load()
  }

  const enregistrerActu = async (status) => {
    if (!actu.title?.trim()) return toast.error('Titre requis')
    setBusy(true)
    const champs = { title: actu.title.trim(), body: actu.body || null, link: actu.link || null, status: status || actu.status }
    const { error } = actu.id ? await supabase.from('client_news').update(champs).eq('id', actu.id) : await supabase.from('client_news').insert(champs)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(champs.status === 'publie' ? 'Actualité publiée dans les espaces' : 'Actualité enregistrée')
    setActu(null)
    load()
  }

  const supprimerActu = async () => {
    if (!(await confirmer('Supprimer cette actualité ?'))) return
    const { error } = await supabase.from('client_news').delete().eq('id', actu.id)
    if (error) return toast.error(error.message)
    toast.success('Actualité supprimée')
    setActu(null)
    load()
  }

  const nbOuvertes = (demandes || []).filter((r) => ['nouvelle', 'en_cours'].includes(r.status)).length

  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Espace entreprise" meta={<span>Demandes des clients et actualités publiées dans leurs espaces. Les comptes se créent sur la fiche client.</span>} />
      {indispo && <Banner tone="warning">L'espace entreprise n'est pas encore disponible sur cette instance (migration 0046).</Banner>}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Espace entreprise">
        <button type="button" role="tab" aria-selected={onglet === 'demandes'} onClick={() => setOnglet('demandes')} className={`btn btn-sm ${onglet === 'demandes' ? 'btn-primary' : 'btn-secondary'}`}>Demandes ({nbOuvertes})</button>
        <button type="button" role="tab" aria-selected={onglet === 'actus'} onClick={() => setOnglet('actus')} className={`btn btn-sm ${onglet === 'actus' ? 'btn-primary' : 'btn-secondary'}`}>Actualités ({actus.length})</button>
      </div>

      {onglet === 'demandes' && (
        <>
          <div className="flex gap-2 text-ui-sm">
            <label className="flex items-center gap-1.5"><input type="radio" name="filtre" checked={filtre === 'ouvertes'} onChange={() => setFiltre('ouvertes')} /> À traiter</label>
            <label className="flex items-center gap-1.5"><input type="radio" name="filtre" checked={filtre === 'toutes'} onChange={() => setFiltre('toutes')} /> Toutes</label>
          </div>
          {demandes === null ? <Spinner /> : liste.length === 0 ? <EmptyState icon={Inbox} title="Aucune demande" compact>Les demandes faites depuis les espaces entreprise arrivent ici.</EmptyState> : (
            <ul className="space-y-2">
              {liste.map((r) => (
                <li key={r.id}>
                  <button type="button" className="card w-full text-left hover:bg-gray-50 space-y-1" onClick={() => setOuverte({ ...r })}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-gray-900">{KINDS[r.kind]} · {r.clients?.name}</span>
                      <StatusBadge tone={STATUTS[r.status][0]}>{STATUTS[r.status][1]}</StatusBadge>
                    </div>
                    <div className="text-ui-sm text-gray-500 truncate">
                      {fr(r.created_at)}{r.sessions?.reference ? ` · ${r.sessions.reference} du ${fr(r.sessions.start_date)}` : ''}{r.courses?.title ? ` · ${r.courses.title}` : ''}{r.message ? ` · ${r.message}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {onglet === 'actus' && (
        <>
          {peutPublier && <div className="flex justify-end"><button type="button" className="btn btn-secondary" onClick={() => setActu({ title: '', body: '', link: '', status: 'brouillon' })}><Plus className="w-4 h-4" /> Nouvelle actualité</button></div>}
          {actus.length === 0 ? <EmptyState icon={Megaphone} title="Aucune actualité" compact>Veille réglementaire, nouvelles formations, dates d'inter : publiées dans tous les espaces entreprise.</EmptyState> : (
            <ul className="space-y-2">
              {actus.map((n) => (
                <li key={n.id}>
                  <button type="button" className="card w-full text-left hover:bg-gray-50 space-y-1" onClick={() => setActu({ ...n })}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-gray-900">{n.title}</span>
                      <StatusBadge tone={NEWS[n.status][0]}>{NEWS[n.status][1]}</StatusBadge>
                    </div>
                    <div className="text-ui-sm text-gray-500 truncate">{n.published_at ? `Publiée le ${fr(n.published_at)}` : `Créée le ${fr(n.created_at)}`}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {ouverte && (
        <Sheet title={`${KINDS[ouverte.kind]} · ${ouverte.clients?.name || ''}`} onClose={() => setOuverte(null)} size="lg"
          footer={peutTraiter && ['nouvelle', 'en_cours'].includes(ouverte.status) ? <>
            <button type="button" className="btn btn-ghost mr-auto" onClick={() => traiter('refusee')} disabled={busy}>Refuser</button>
            {ouverte.status === 'nouvelle' && <button type="button" className="btn btn-secondary" onClick={() => traiter('en_cours')} disabled={busy}>Prendre en charge</button>}
            <button type="button" className="btn btn-primary" onClick={() => traiter('traitee')} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Marquer traitée</button>
          </> : <button type="button" className="btn btn-secondary" onClick={() => setOuverte(null)}>Fermer</button>}>
          <div className="text-ui-sm text-gray-600 space-y-1">
            <div>Reçue le {fr(ouverte.created_at)} · <Link to={`/clients/${ouverte.client_id}`} className="text-accent-700 hover:underline" onClick={() => setOuverte(null)}>fiche client</Link></div>
            {ouverte.sessions?.reference && <div>Session {ouverte.sessions.reference} du {fr(ouverte.sessions.start_date)}</div>}
            {ouverte.courses?.title && <div>Formation : {ouverte.courses.title}</div>}
          </div>
          {ouverte.message && <p className="text-ui text-gray-800 whitespace-pre-line bg-gray-50 rounded-ui-sm p-3">{ouverte.message}</p>}
          {Array.isArray(ouverte.payload?.stagiaires) && ouverte.payload.stagiaires.length > 0 && (
            <div>
              <div className="label">Salariés</div>
              <ul className="text-ui text-gray-800 list-disc pl-5">
                {ouverte.payload.stagiaires.map((st, i) => <li key={i}>{[st.prenom, st.nom].filter(Boolean).join(' ')}{st.fonction ? ` · ${st.fonction}` : ''}{st.email ? ` · ${st.email}` : ''}</li>)}
              </ul>
            </div>
          )}
          {ouverte.payload?.periode && <div className="text-ui text-gray-800">Période souhaitée : {ouverte.payload.periode}</div>}
          {ouverte.payload?.effectif && <div className="text-ui text-gray-800">Nombre de personnes : {ouverte.payload.effectif}</div>}
          <div>
            <label className="label" htmlFor="ce-rep">Réponse visible par le client</label>
            <textarea id="ce-rep" className="input min-h-[80px]" value={ouverte.response || ''} disabled={!peutTraiter || !['nouvelle', 'en_cours'].includes(ouverte.status)}
              onChange={(e) => setOuverte((o) => ({ ...o, response: e.target.value }))} />
          </div>
        </Sheet>
      )}

      {actu && (
        <Sheet title={actu.id ? 'Actualité' : 'Nouvelle actualité'} onClose={() => setActu(null)} size="lg"
          footer={peutPublier ? <>
            {actu.id && <button type="button" className="btn btn-ghost mr-auto" onClick={supprimerActu}>Supprimer</button>}
            <button type="button" className="btn btn-secondary" onClick={() => enregistrerActu(actu.status === 'publie' ? 'archive' : 'brouillon')} disabled={busy}>{actu.status === 'publie' ? 'Retirer des espaces' : 'Enregistrer le brouillon'}</button>
            <button type="button" className="btn btn-primary" onClick={() => enregistrerActu('publie')} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Publier</button>
          </> : <button type="button" className="btn btn-secondary" onClick={() => setActu(null)}>Fermer</button>}>
          <fieldset disabled={!peutPublier} className="grid gap-3">
            <div>
              <label className="label" htmlFor="ac-titre">Titre</label>
              <input id="ac-titre" className="input" value={actu.title} onChange={(e) => setActu((a) => ({ ...a, title: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="ac-texte">Texte</label>
              <textarea id="ac-texte" className="input min-h-[160px]" value={actu.body || ''} onChange={(e) => setActu((a) => ({ ...a, body: e.target.value }))} />
            </div>
            <div>
              <label className="label" htmlFor="ac-lien">Lien (facultatif)</label>
              <input id="ac-lien" className="input" value={actu.link || ''} placeholder="https://" onChange={(e) => setActu((a) => ({ ...a, link: e.target.value }))} />
            </div>
          </fieldset>
        </Sheet>
      )}
    </div>
  )
}
