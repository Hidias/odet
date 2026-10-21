import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, HeartHandshake, Loader2, Pencil } from 'lucide-react'
import { supabase } from '../supabase'
import { PageHeader } from '../../ui/PageHeader'
import { Tabs } from '../../ui/Tabs'
import { Banner } from '../../ui/Banner'
import { Sheet } from '../../ui/Sheet'
import { EmptyState } from '../../ui/EmptyState'
import SearchSelect from '../../ui/SearchSelect'
import { fetchAll } from '../fetchAll'
import { agreger, facturesDe, periode, TYPES_APPORTEUR, METIERS_CA, valeurOrigine, lireOrigine } from './apports'
import OrigineSelect, { chargerOrigines } from './OrigineSelect'

// Qui a apporté quoi (0409) : chiffre facturé de la période, mis en regard de l'encaissé, par personne et par rôle
// (apport direct, via ses apporteurs, idée, vente, réalisation). Pas de commission : un point de temps en temps.

const eur = (n) => `${(Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`
const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '')
const PERIODES = [['mois', 'Ce mois'], ['mois_dernier', 'Mois dernier'], ['trimestre', 'Ce trimestre'], ['annee', 'Cette année'], ['douze_mois', '12 derniers mois'], ['annee_derniere', 'Année dernière'], ['libre', 'Dates choisies']]
const nomP = (p) => p.display_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email

export default function Apports() {
  const [onglet, setOnglet] = useState('ca')
  const [per, setPer] = useState('annee')
  const [dates, setDates] = useState(periode('annee'))
  const [lignes, setLignes] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [origines, setOrigines] = useState({ equipe: [], apporteurs: [] })
  const [metier, setMetier] = useState('')
  const [detail, setDetail] = useState(null)

  const recharger = () => chargerOrigines(true).then(setOrigines)
  useEffect(() => { recharger() }, [])
  useEffect(() => { if (per !== 'libre') setDates(periode(per)) }, [per])
  useEffect(() => {
    setLignes(null)
    supabase.rpc('ca_apports', { p_du: dates[0], p_au: dates[1] }).then(({ data, error }) => {
      if (error) { setErreur(error.message.includes('Accès') ? 'Réservé à la direction.' : 'Le point des apports n\'est pas encore disponible.'); setLignes([]); return }
      setErreur(null); setLignes(data || [])
    })
  }, [dates[0], dates[1]]) // eslint-disable-line react-hooks/exhaustive-deps

  const noms = useMemo(() => Object.fromEntries([
    ...origines.equipe.map((p) => [`p:${p.id}`, nomP(p)]),
    ...origines.apporteurs.map((a) => [`c:${a.id}`, a.name]),
  ]), [origines])
  const filtrees = useMemo(() => (lignes || []).filter((l) => !metier || l.metier === metier), [lignes, metier])
  const r = useMemo(() => agreger(filtrees, origines.apporteurs, noms), [filtrees, origines.apporteurs, noms])
  const parMetier = useMemo(() => Object.keys(METIERS_CA).map((k) => ({ k, ht: (lignes || []).filter((l) => l.metier === k).reduce((s, l) => s + Number(l.ht || 0), 0) })).filter((x) => x.ht), [lignes])

  return (
    <div className="space-y-4">
      <PageHeader title="Qui a apporté quoi" meta={<span>Chiffre facturé de la période (avoirs en moins), mis en regard de l'encaissé, selon l'origine notée sur les clients et les affaires.</span>} />
      <Tabs tabs={[{ id: 'ca', label: 'Chiffre par personne' }, { id: 'apporteurs', label: 'Apporteurs extérieurs', count: origines.apporteurs.length }]} value={onglet} onChange={setOnglet} />

      {onglet === 'apporteurs' ? <ListeApporteurs origines={origines} onChange={recharger} /> : <>
        <div className="flex flex-wrap items-end gap-2">
          <select className="select w-auto" value={per} onChange={(e) => setPer(e.target.value)} aria-label="Période">
            {PERIODES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {per === 'libre' && <>
            <input type="date" className="input w-auto" value={dates[0]} onChange={(e) => setDates([e.target.value, dates[1]])} aria-label="Du" />
            <input type="date" className="input w-auto" value={dates[1]} onChange={(e) => setDates([dates[0], e.target.value])} aria-label="Au" />
          </>}
          <select className="select w-auto" value={metier} onChange={(e) => setMetier(e.target.value)} aria-label="Métier">
            <option value="">Tous les métiers</option>
            {Object.entries(METIERS_CA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <span className="text-ui-sm text-gray-500 ml-auto">Du {fr(dates[0])} au {fr(dates[1])}</span>
        </div>
        {erreur && <Banner tone="warning">{erreur}</Banner>}
        {lignes === null ? <div className="text-ui-sm text-gray-500">Chargement…</div> : <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tuile titre="Facturé" valeur={eur(r.total)} sous={`${filtrees.length} facture${filtrees.length > 1 ? 's' : ''}`} />
            <Tuile titre="Encaissé" valeur={eur(r.encaisse)} sous={r.total ? `${Math.round((r.encaisse / r.total) * 100)} % du facturé` : ''} />
            <Tuile titre="Origine renseignée" valeur={r.total ? `${Math.round(((r.total - r.sansOrigine) / r.total) * 100)} %` : '—'} sous={r.sansOrigine ? `${eur(r.sansOrigine)} sans origine` : 'tout est renseigné'} />
            <Tuile titre="Par métier" valeur={parMetier.map((x) => `${METIERS_CA[x.k]} ${eur(x.ht)}`).join(' · ') || '—'} petit />
          </div>

          {r.personnes.length === 0 ? (
            <div className="card"><EmptyState icon={HeartHandshake} title="Aucun apport noté sur la période" compact>Notez sur chaque client qui l'a apporté (bloc Commercial de la fiche), et sur les affaires qui a eu l'idée.</EmptyState></div>
          ) : (
            <div className="card overflow-x-auto">
              <table>
                <thead><tr>
                  <th>Personne</th><th className="text-right">Apporté</th><th className="text-right">Via ses apporteurs</th>
                  <th className="text-right">Idées</th><th className="text-right">Vendu</th><th className="text-right">Réalisé</th><th className="text-right">Factures</th>
                </tr></thead>
                <tbody>
                  {r.personnes.map((p) => (
                    <tr key={p.cle} className="cursor-pointer hover:bg-gray-50" onClick={() => setDetail(p)}>
                      <td><span className="font-medium">{p.nom}</span>{p.externe && <span className="status status-neutral ml-2">Extérieur</span>}</td>
                      <td className="text-right"><Montant ht={p.apport_ht} enc={p.apport_enc} /></td>
                      <td className="text-right"><Montant ht={p.indirect_ht} enc={p.indirect_enc} /></td>
                      <td className="text-right">{p.idee_ht ? eur(p.idee_ht) : '—'}</td>
                      <td className="text-right"><Montant ht={p.vente_ht} enc={p.vente_enc} /></td>
                      <td className="text-right">{p.realise_ht ? eur(p.realise_ht) : '—'}</td>
                      <td className="text-right">{p.nb}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-ui-sm text-gray-500 px-3 py-2">Une même facture compte pour chaque rôle (apport, idée, vente, réalisation) : les colonnes ne s'additionnent pas. Montants hors taxes ; sous chaque montant, la part encaissée.</p>
            </div>
          )}

          {r.sansOrigineClients.length > 0 && (
            <details className="surface px-4 py-3">
              <summary className="text-ui cursor-pointer">{r.sansOrigineClients.length} client{r.sansOrigineClients.length > 1 ? 's' : ''} facturé{r.sansOrigineClients.length > 1 ? 's' : ''} sans origine notée ({eur(r.sansOrigine)})</summary>
              <ul className="mt-2 grid sm:grid-cols-2 gap-1">
                {r.sansOrigineClients.map((c) => <li key={c.id}><Link to={`/clients/${c.id}`} className="text-ui-sm text-accent-700 hover:underline">{c.name}</Link></li>)}
              </ul>
            </details>
          )}
        </>}
      </>}

      {detail && (
        <Sheet title={detail.nom} size="lg" onClose={() => setDetail(null)} footer={<button type="button" className="btn btn-secondary" onClick={() => setDetail(null)}>Fermer</button>}>
          <table>
            <thead><tr><th>Facture</th><th>Client</th><th>Rôle</th><th className="text-right">HT</th><th className="text-right">Encaissé</th></tr></thead>
            <tbody>
              {facturesDe(filtrees, detail.cle, origines.apporteurs).map((l) => (
                <tr key={l.invoice_id}>
                  <td><Link to={`/factures?open=${l.invoice_id}`} className="text-accent-700 hover:underline">{l.reference}</Link><div className="text-ui-sm text-gray-500">{fr(l.date)}{l.affaire ? ` · ${l.affaire}` : ''}</div></td>
                  <td>{l.client}<div className="text-ui-sm text-gray-500">{METIERS_CA[l.metier]}</div></td>
                  <td className="text-ui-sm">{l.roles.join(', ')}</td>
                  <td className="text-right">{eur(l.ht)}</td>
                  <td className="text-right">{eur(l.encaisse_ht)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Sheet>
      )}
    </div>
  )
}

function Tuile({ titre, valeur, sous, petit }) {
  return (
    <div className="surface p-3">
      <div className="text-ui-sm text-gray-500">{titre}</div>
      <div className={petit ? 'text-ui font-medium mt-1' : 'text-xl font-semibold mt-1'}>{valeur}</div>
      {sous && <div className="text-ui-sm text-gray-500">{sous}</div>}
    </div>
  )
}

function Montant({ ht, enc }) {
  if (!ht) return '—'
  return <div><div>{eur(ht)}</div><div className="text-ui-sm text-gray-500">{eur(enc)} encaissés</div></div>
}

const VIDE = { id: null, name: '', kind: 'prescripteur', origine: '', client_id: '', email: '', phone: '', notes: '', active: true }

function ListeApporteurs({ origines, onChange }) {
  const [form, setForm] = useState(null)
  const [clients, setClients] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetchAll(() => supabase.from('clients').select('id, name').order('name')).then(({ data }) => setClients(data || [])) }, [])
  const noms = Object.fromEntries([...origines.equipe.map((p) => [`p:${p.id}`, nomP(p)]), ...origines.apporteurs.map((a) => [`c:${a.id}`, a.name])])

  const enregistrer = async () => {
    setBusy(true)
    const o = lireOrigine(form.origine)
    const ligne = { name: form.name.trim(), kind: form.kind, client_id: form.client_id || null, email: form.email.trim() || null, phone: form.phone.trim() || null,
      notes: form.notes.trim() || null, active: form.active, introduced_by_profile: o.introduced_by_profile, introduced_by_contributor: o.introduced_by_contributor === form.id ? null : o.introduced_by_contributor }
    const { error } = form.id ? await supabase.from('business_contributors').update(ligne).eq('id', form.id) : await supabase.from('business_contributors').insert(ligne)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Apporteur enregistré'); setForm(null); onChange()
  }

  return (
    <div className="space-y-3">
      <div className="flex">
        <button type="button" className="btn btn-primary ml-auto" onClick={() => setForm({ ...VIDE })}><Plus className="w-4 h-4" />Nouvel apporteur</button>
      </div>
      {origines.apporteurs.length === 0 ? (
        <div className="card"><EmptyState icon={HeartHandshake} title="Aucun apporteur extérieur" compact>Prescripteurs, partenaires ou clients qui vous recommandent : notez qui les a amenés pour suivre la chaîne.</EmptyState></div>
      ) : (
        <div className="card overflow-x-auto">
          <table>
            <thead><tr><th>Apporteur</th><th>Type</th><th>Amené par</th><th>Contact</th><th></th></tr></thead>
            <tbody>
              {origines.apporteurs.map((a) => (
                <tr key={a.id} className={a.active === false ? 'opacity-60' : ''}>
                  <td className="font-medium">{a.name}{a.active === false && <span className="status status-neutral ml-2">Inactif</span>}</td>
                  <td>{TYPES_APPORTEUR[a.kind]}</td>
                  <td>{noms[valeurOrigine(a.introduced_by_profile, a.introduced_by_contributor)] || '—'}</td>
                  <td className="text-ui-sm">{[a.email, a.phone].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="text-right"><button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                    const { data } = await supabase.from('business_contributors').select('*').eq('id', a.id).single()
                    setForm({ ...VIDE, ...data, origine: valeurOrigine(data.introduced_by_profile, data.introduced_by_contributor), client_id: data.client_id || '', email: data.email || '', phone: data.phone || '', notes: data.notes || '' })
                  }}><Pencil className="w-4 h-4" />Modifier</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {form && (
        <Sheet title={form.id ? 'Modifier l\'apporteur' : 'Nouvel apporteur'} onClose={() => setForm(null)}
          footer={<><button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy || form.name.trim().length < 2}>{busy && <Loader2 className="w-4 h-4 animate-spin" />}Enregistrer</button></>}>
          <div className="space-y-3">
            <div><label className="label" htmlFor="ap-nom">Nom</label><input id="ap-nom" className="input" maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex. : Pierre Martin, expert-comptable" /></div>
            <div><label className="label" htmlFor="ap-type">Type</label>
              <select id="ap-type" className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(TYPES_APPORTEUR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="label" htmlFor="ap-par">Amené par</label>
              <OrigineSelect id="ap-par" value={form.origine} onChange={(v) => setForm({ ...form, origine: v })} origines={{ ...origines, apporteurs: origines.apporteurs.filter((a) => a.id !== form.id) }} vide="Personne en particulier" />
              <p className="text-ui-sm text-gray-500 mt-1">Ce qu'il apporte compte aussi pour la personne qui l'a amené (« via ses apporteurs »).</p></div>
            {form.kind === 'client' && (
              <div><label className="label" htmlFor="ap-cl">Client</label>
                <SearchSelect id="ap-cl" value={form.client_id} onChange={(v) => setForm({ ...form, client_id: v })} placeholder="Choisir le client" options={clients.map((c) => ({ value: c.id, label: c.name, testTbl: 'clients' }))} /></div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className="label" htmlFor="ap-mail">Email</label><input id="ap-mail" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div><label className="label" htmlFor="ap-tel">Téléphone</label><input id="ap-tel" className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div><label className="label" htmlFor="ap-notes">Notes</label><textarea id="ap-notes" className="input min-h-[70px]" maxLength={2000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <label className="inline-flex items-center gap-2 text-ui"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Actif</label>
          </div>
        </Sheet>
      )}
    </div>
  )
}
