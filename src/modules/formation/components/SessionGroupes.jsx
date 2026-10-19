import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Users, Loader2, FileSignature, Receipt } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { Sheet } from '../../../ui/Sheet'
import { Banner } from '../../../ui/Banner'
import { StatusBadge } from '../../../ui/StatusBadge'
import { EmptyState } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { downloadDocument } from '../pdf/pdfGenerator'

// Groupes d'une session inter (lot 2, 0044) : une entreprise (convention à son nom) ou un particulier qui paie
// lui-même (contrat de formation, rétractation 10 jours calculée par la base, paiements contrôlés par la base).
// Chaque stagiaire de la session se rattache à un groupe ; une facture par groupe.

const KINDS = { entreprise: 'Entreprise', particulier: 'Particulier' }
const PAYEURS = { entreprise: 'L\'entreprise', opco: 'Un OPCO', particulier: 'Le particulier', france_travail: 'France Travail', autre: 'Autre' }
const DOCS = { a_envoyer: ['neutral', 'À envoyer'], envoye: ['info', 'Envoyé'], signe: ['success', 'Signé'] }
const fmt = (d) => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('fr-FR') : '')

export default function SessionGroupes({ session, peutModifier }) {
  const navigate = useNavigate()
  const [groupes, setGroupes] = useState(null)
  const [inscrits, setInscrits] = useState([])
  const [clients, setClients] = useState([])
  const [indispo, setIndispo] = useState(false)
  const [edition, setEdition] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const [{ data: g, error }, { data: st }] = await Promise.all([
      supabase.from('session_groups').select('*, clients:client_id(id, name, client_type, address, postal_code, city, email, contact_email, phone, contact_phone)')
        .eq('session_id', session.id).order('created_at'),
      supabase.from('session_trainees').select('id, trainee_id, group_id, trainees(id, first_name, last_name, client_id)').eq('session_id', session.id),
    ])
    if (error) { setIndispo(true); setGroupes([]); return }
    setGroupes(g || [])
    setInscrits(st || [])
  }
  useEffect(() => { if (session?.id) load() }, [session?.id])

  const parGroupe = useMemo(() => {
    const m = {}
    inscrits.forEach((i) => { const k = i.group_id || 'sans'; (m[k] = m[k] || []).push(i) })
    return m
  }, [inscrits])

  const chargerClients = async () => {
    if (clients.length) return
    const { data } = await supabase.from('clients').select('id, name, client_type').neq('status', 'archive').order('name').limit(2000)
    setClients(data || [])
  }

  const ouvrir = async (g) => {
    await chargerClients()
    setEdition(g ? { ...g } : { kind: 'entreprise', client_id: '', payer_kind: 'entreprise', payer_client_id: '', dossier_number: '', price_total: '', price_per_person: '', notes: '', doc_status: 'a_envoyer' })
  }

  const enregistrer = async () => {
    const e = edition
    if (!e.client_id) return toast.error(e.kind === 'particulier' ? 'Choisissez la fiche du particulier' : 'Choisissez l\'entreprise')
    setBusy(true)
    const champs = {
      session_id: session.id, kind: e.kind, client_id: e.client_id,
      payer_kind: e.payer_kind || (e.kind === 'particulier' ? 'particulier' : 'entreprise'),
      payer_client_id: ['opco', 'autre', 'france_travail'].includes(e.payer_kind) ? e.payer_client_id || null : null,
      dossier_number: e.dossier_number || null, notes: e.notes || null,
      price_total: e.price_total === '' || e.price_total == null ? null : Number(String(e.price_total).replace(',', '.')),
      price_per_person: e.price_per_person === '' || e.price_per_person == null ? null : Number(String(e.price_per_person).replace(',', '.')),
      group_name: clients.find((c) => c.id === e.client_id)?.name || e.group_name || null,
    }
    const { error } = e.id
      ? await supabase.from('session_groups').update(champs).eq('id', e.id)
      : await supabase.from('session_groups').insert(champs)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(e.id ? 'Groupe enregistré' : 'Groupe ajouté')
    setEdition(null)
    load()
  }

  const docStatut = async (g, statut) => {
    const { error } = await supabase.from('session_groups').update({ doc_status: statut }).eq('id', g.id)
    if (error) return toast.error(error.message)
    toast.success(statut === 'signe' && g.kind === 'particulier' ? 'Contrat signé : le délai de rétractation de 10 jours commence' : 'Statut du document enregistré')
    load()
  }

  const rattacher = async (inscrit, groupId) => {
    const { error } = await supabase.from('session_trainees').update({ group_id: groupId }).eq('id', inscrit.id)
    if (error) return toast.error(error.message)
    setInscrits((l) => l.map((i) => (i.id === inscrit.id ? { ...i, group_id: groupId } : i)))
  }

  const supprimer = async (g) => {
    if (g.invoice_id) return toast.error('Ce groupe a une facture : il ne se supprime pas')
    if (!(await confirmer(`Supprimer le groupe « ${g.clients?.name || g.group_name || ''} » ? Ses stagiaires restent inscrits, sans groupe.`))) return
    await supabase.from('session_trainees').update({ group_id: null }).eq('session_id', session.id).eq('group_id', g.id)
    const { error } = await supabase.from('session_groups').delete().eq('id', g.id)
    if (error) return toast.error(error.message)
    setEdition(null)
    load()
  }

  const contrat = async (g) => {
    const stagiaires = (parGroupe[g.id] || []).map((i) => i.trainees).filter(Boolean)
    try {
      await downloadDocument('contratParticulier', session, { trainees: stagiaires, trainer: session.trainers || null, particulier: { group: g, client: g.clients || {} } })
    } catch (e) {
      toast.error(e.message || 'Contrat impossible à générer')
    }
  }

  if (indispo) return <Banner tone="warning">Les groupes ne sont pas encore disponibles sur cette instance (migration 0044).</Banner>
  if (groupes === null) return <p className="text-ui-sm text-gray-400">Chargement…</p>

  const sansGroupe = parGroupe.sans || []
  const choixClients = (kind) => clients.filter((c) => (kind === 'particulier' ? c.client_type === 'particulier' : c.client_type !== 'particulier' && c.client_type !== 'opco'))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-ui text-gray-600">Une entreprise ou un particulier par groupe ; une convention ou un contrat et une facture par groupe.</p>
        {peutModifier && <button type="button" className="btn btn-secondary btn-sm" onClick={() => ouvrir(null)}><Plus className="w-4 h-4" /> Ajouter un groupe</button>}
      </div>
      {groupes.length === 0 ? (
        <EmptyState icon={Users} title="Aucun groupe" compact>Ajoutez l'entreprise ou le particulier de chaque inscription.</EmptyState>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {groupes.map((g) => {
            const membres = parGroupe[g.id] || []
            return (
              <li key={g.id} className="card space-y-2">
                <button type="button" className="w-full text-left" onClick={() => ouvrir(g)}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-gray-900">{g.clients?.name || g.group_name || 'Groupe'}</span>
                    <StatusBadge tone={DOCS[g.doc_status]?.[0]}>{g.kind === 'particulier' ? 'Contrat' : 'Convention'} : {DOCS[g.doc_status]?.[1]}</StatusBadge>
                  </div>
                  <div className="text-ui-sm text-gray-500">
                    {KINDS[g.kind]} · {membres.length} stagiaire{membres.length > 1 ? 's' : ''} · payé par {PAYEURS[g.payer_kind] ? PAYEURS[g.payer_kind].toLowerCase() : '—'}
                    {g.dossier_number ? ` · dossier ${g.dossier_number}` : ''}
                  </div>
                  {g.retractation_end && (
                    <div className={`text-ui-sm ${new Date(`${g.retractation_end}T23:59:59`) >= new Date() ? 'text-[rgb(var(--c-warning))]' : 'text-gray-500'}`}>
                      Rétractation possible jusqu'au {fmt(g.retractation_end)} : aucun paiement avant cette date
                    </div>
                  )}
                </button>
                {peutModifier && (
                  <div className="flex flex-wrap gap-1.5">
                    {g.kind === 'particulier' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => contrat(g)}><FileSignature className="w-4 h-4" /> Contrat</button>}
                    {g.doc_status === 'a_envoyer' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => docStatut(g, 'envoye')}>Marquer envoyé</button>}
                    {g.doc_status !== 'signe' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => docStatut(g, 'signe')}>Marquer signé</button>}
                    {g.invoice_id
                      ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/factures?open=${g.invoice_id}`)}><Receipt className="w-4 h-4" /> Facture</button>
                      : <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/factures?from_session=${session.id}&group_id=${g.id}`)}><Receipt className="w-4 h-4" /> Facturer ce groupe</button>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {sansGroupe.length > 0 && groupes.length > 0 && (
        <Banner tone="info">{sansGroupe.length} stagiaire{sansGroupe.length > 1 ? 's' : ''} sans groupe : ouvrez un groupe pour les y rattacher.</Banner>
      )}

      {edition && (
        <Sheet title={edition.id ? (edition.clients?.name || 'Groupe') : 'Nouveau groupe'} onClose={() => setEdition(null)} size="lg"
          footer={peutModifier ? <>
            {edition.id && <button type="button" className="btn btn-ghost mr-auto" onClick={() => supprimer(edition)}>Supprimer</button>}
            <button type="button" className="btn btn-secondary" onClick={() => setEdition(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
          </> : <button type="button" className="btn btn-secondary" onClick={() => setEdition(null)}>Fermer</button>}>
          <div className="flex gap-2" role="radiogroup" aria-label="Nature du groupe">
            {Object.entries(KINDS).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={edition.kind === k} disabled={!!edition.id}
                onClick={() => setEdition({ ...edition, kind: k, client_id: '', payer_kind: k === 'particulier' ? 'particulier' : 'entreprise' })}
                className={`btn btn-sm ${edition.kind === k ? 'btn-primary' : 'btn-secondary'}`}>{l}</button>
            ))}
          </div>
          <div>
            <label className="label" htmlFor="grp-client">{edition.kind === 'particulier' ? 'Fiche client du particulier' : 'Entreprise'}</label>
            <select id="grp-client" className="input" value={edition.client_id || ''} onChange={(ev) => setEdition({ ...edition, client_id: ev.target.value })}>
              <option value="">Choisir…</option>
              {choixClients(edition.kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {edition.kind === 'particulier' && <p className="text-ui-sm text-gray-400 mt-1">Un particulier qui paie lui-même a une fiche client « Particulier » (Clients › Particuliers).</p>}
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="grp-payeur">Payé par</label>
              <select id="grp-payeur" className="input" value={edition.payer_kind || ''} onChange={(ev) => setEdition({ ...edition, payer_kind: ev.target.value })}>
                {Object.entries(PAYEURS).filter(([k]) => (edition.kind === 'particulier' ? k !== 'entreprise' : k !== 'particulier')).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            {['opco', 'autre', 'france_travail'].includes(edition.payer_kind) && (
              <div>
                <label className="label" htmlFor="grp-financeur">Financeur</label>
                <select id="grp-financeur" className="input" value={edition.payer_client_id || ''} onChange={(ev) => setEdition({ ...edition, payer_client_id: ev.target.value })}>
                  <option value="">Choisir…</option>
                  {clients.filter((c) => c.client_type === 'opco' || c.client_type === 'public').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <div>
              <label className="label" htmlFor="grp-dossier">N° de dossier</label>
              <input id="grp-dossier" className="input" value={edition.dossier_number || ''} onChange={(ev) => setEdition({ ...edition, dossier_number: ev.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="grp-prix">Prix du groupe (HT)</label>
              <input id="grp-prix" className="input" inputMode="decimal" value={edition.price_total ?? ''} onChange={(ev) => setEdition({ ...edition, price_total: ev.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="grp-pp">ou par personne (HT)</label>
              <input id="grp-pp" className="input" inputMode="decimal" value={edition.price_per_person ?? ''} onChange={(ev) => setEdition({ ...edition, price_per_person: ev.target.value })} />
            </div>
          </div>
          {edition.id && (
            <div>
              <div className="label">Stagiaires du groupe</div>
              {inscrits.length === 0 ? <p className="text-ui-sm text-gray-500">Aucun stagiaire inscrit à la session.</p> : (
                <ul className="grid sm:grid-cols-2 gap-1">
                  {inscrits.map((i) => (
                    <li key={i.id}>
                      <label className={`flex items-center gap-2 text-ui ${i.group_id && i.group_id !== edition.id ? 'text-gray-400' : 'text-gray-800'}`}>
                        <input type="checkbox" checked={i.group_id === edition.id} disabled={!peutModifier}
                          onChange={(ev) => rattacher(i, ev.target.checked ? edition.id : null)} />
                        {i.trainees ? `${(i.trainees.last_name || '').toUpperCase()} ${i.trainees.first_name || ''}` : 'Stagiaire'}
                        {i.group_id && i.group_id !== edition.id && <span className="text-ui-sm">(autre groupe)</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div>
            <label className="label" htmlFor="grp-notes">Notes</label>
            <textarea id="grp-notes" className="input min-h-[60px]" value={edition.notes || ''} onChange={(ev) => setEdition({ ...edition, notes: ev.target.value })} />
          </div>
          {edition.kind === 'particulier' && (
            <p className="text-ui-sm text-gray-500">Particulier qui paie : rétractation de 10 jours après la signature du contrat, aucun paiement avant, puis 30 % au plus avant le début de la formation (articles L6353-5 et L6353-6 du Code du travail) ; la base refuse un paiement qui ne respecte pas ces règles.</p>
          )}
        </Sheet>
      )}
    </div>
  )
}
