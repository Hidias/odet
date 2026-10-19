import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { RefreshCw, Loader2, Image as ImageIcon, StickyNote } from 'lucide-react'
import { callApi } from '../api'
import { supabase } from '../supabase'
import { PageHeader } from '../../ui/PageHeader'
import { DataTable } from '../../ui/DataTable'
import { StatusBadge } from '../../ui/StatusBadge'
import { Sheet } from '../../ui/Sheet'
import { Banner } from '../../ui/Banner'
import { EmptyState } from '../../ui/EmptyState'
import { TYPE_LABELS, GRAVITE_LABELS, STATUTS, ORDRE_STATUTS } from './retours'

// Suivi des retours des utilisateurs (droit organisation.retours.suivre : super administrateur et administrateur).
// Liste, statut, réponse visible par l'auteur dans son post-it, lien vers l'entrée « Quoi de neuf » qui règle
// le retour, capture ouverte par un lien signé d'une minute (jamais envoyée hors de l'outil).

const FILTRES = [
  { id: 'ouverts', label: 'À traiter', statuts: ['nouveau', 'vu', 'en_cours'] },
  { id: 'fait', label: 'Faits', statuts: ['fait'] },
  { id: 'ecarte', label: 'Écartés', statuts: ['ecarte'] },
  { id: 'tous', label: 'Tous', statuts: null },
]

export default function RetoursSuivi() {
  const [items, setItems] = useState(null)
  const [erreur, setErreur] = useState(null)
  const [filtre, setFiltre] = useState('ouverts')
  const [ouvert, setOuvert] = useState(null)
  const [nouveautes, setNouveautes] = useState([])

  const load = async () => {
    setErreur(null)
    try {
      const res = await callApi('/api/retours?scope=tous', {}, { method: 'GET' })
      setItems(res.items || [])
    } catch (e) {
      setErreur(e.message)
      setItems([])
    }
  }
  useEffect(() => {
    load()
    supabase.from('platform_notices').select('id, title, status, published_at').eq('kind', 'nouveaute').neq('status', 'archive')
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setNouveautes(data || []))
  }, [])

  const compte = useMemo(() => {
    const c = {}
    for (const f of FILTRES) c[f.id] = (items || []).filter((it) => !f.statuts || f.statuts.includes(it.status)).length
    return c
  }, [items])
  const f = FILTRES.find((x) => x.id === filtre)
  const lignes = (items || []).filter((it) => !f.statuts || f.statuts.includes(it.status))

  const colonnes = [
    { key: 'message', label: 'Retour', mobile: 'title', render: (r) => <span className="line-clamp-2 break-words">{r.message}</span> },
    { key: 'author_label', label: 'Auteur', mobile: 'subtitle', render: (r) => `${r.author_label || 'Utilisateur'} · ${format(new Date(r.created_at), 'd MMM HH:mm', { locale: fr })}` },
    { key: 'kind', label: 'Type', render: (r) => (r.kind ? TYPE_LABELS[r.kind] : 'Remarque') + (r.severity ? ` · ${GRAVITE_LABELS[r.severity]}` : '') },
    { key: 'page', label: 'Page', render: (r) => r.page_title || r.page_path || '—' },
    { key: 'extra', label: '', mobile: false, render: (r) => (r.has_screenshot ? <ImageIcon className="w-4 h-4 text-gray-400" aria-label="Capture jointe" /> : null) },
    { key: 'status', label: 'Statut', mobile: 'aside', render: (r) => <StatusBadge tone={STATUTS[r.status]?.[0]}>{STATUTS[r.status]?.[1] || r.status}</StatusBadge> },
  ]

  const maj = (id, champs) => setItems((l) => (l || []).map((it) => (it.id === id ? { ...it, ...champs } : it)))

  // Ouvrir un retour nouveau le passe en « vu »
  // (le passage en « vu » est fait avant l'ouverture : la fiche part du bon statut)
  const ouvrir = async (r) => {
    if (r.status === 'nouveau') {
      try {
        await callApi('/api/retours', { id: r.id, status: 'vu' }, { method: 'PATCH' })
        maj(r.id, { status: 'vu' })
        setOuvert({ ...r, status: 'vu' })
        return
      } catch (_) { /* le statut reste « nouveau » */ }
    }
    setOuvert(r)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Retours des utilisateurs"
        meta={<span>Problèmes, idées et questions envoyés par le post-it « Une remarque ? ».</span>}
        actions={<button type="button" onClick={load} className="btn btn-secondary"><RefreshCw className="w-4 h-4" /> Actualiser</button>} />
      {erreur && <Banner tone="danger">Lecture impossible : {erreur}</Banner>}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrer les retours">
        {FILTRES.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={filtre === x.id} onClick={() => setFiltre(x.id)}
            className={`btn btn-sm ${filtre === x.id ? 'btn-primary' : 'btn-secondary'}`}>{x.label} ({compte[x.id] || 0})</button>
        ))}
      </div>
      <div className="card">
        <DataTable columns={colonnes} rows={lignes} loading={items === null} onRowClick={ouvrir} caption="Retours des utilisateurs"
          empty={<EmptyState icon={StickyNote} title="Aucun retour ici" compact />} />
      </div>
      {ouvert && <FicheRetour retour={ouvert} nouveautes={nouveautes} onClose={() => setOuvert(null)}
        onSaved={(champs) => { maj(ouvert.id, champs); setOuvert(null) }} />}
    </div>
  )
}

function FicheRetour({ retour, nouveautes, onClose, onSaved }) {
  const [statut, setStatut] = useState(retour.status)
  const [reponse, setReponse] = useState(retour.response || '')
  const [notice, setNotice] = useState(retour.notice_id || '')
  const [image, setImage] = useState(null)
  const [busy, setBusy] = useState(false)

  const voirCapture = async () => {
    try {
      const res = await callApi(`/api/retours?capture=${retour.id}`, {}, { method: 'GET' })
      setImage(res.url)
    } catch (e) {
      toast.error(e.message)
    }
  }

  const enregistrer = async () => {
    setBusy(true)
    try {
      const champs = { status: statut, response: reponse.trim(), notice_id: notice || null }
      await callApi('/api/retours', { id: retour.id, ...champs }, { method: 'PATCH' })
      toast.success(reponse.trim() && reponse.trim() !== (retour.response || '') ? 'Enregistré : l\'auteur verra la réponse dans son post-it' : 'Enregistré')
      onSaved({ ...champs, response: champs.response || null, responded_at: champs.response ? new Date().toISOString() : null })
    } catch (e) {
      toast.error(e.message)
    }
    setBusy(false)
  }

  return (
    <Sheet title={retour.kind ? TYPE_LABELS[retour.kind] : 'Remarque'} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>
        <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer</button>
      </>}>
      <div className="text-ui-sm text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
        <span className="font-semibold text-gray-900">{retour.author_label || 'Utilisateur'}</span>
        <span>{format(new Date(retour.created_at), "d MMMM yyyy 'à' HH:mm", { locale: fr })}</span>
        {retour.severity && <span>Gravité : {GRAVITE_LABELS[retour.severity]}</span>}
        {retour.viewport && <span>Écran {retour.viewport}</span>}
      </div>
      {retour.page_path && (
        <div className="text-ui-sm">Page : <Link to={retour.page_path} className="text-accent-700 hover:underline" onClick={onClose}>{retour.page_title || retour.page_path}</Link></div>
      )}
      <p className="text-ui text-gray-900 whitespace-pre-wrap break-words rounded-ui border border-gray-200 p-3">{retour.message}</p>
      {retour.has_screenshot && (image
        ? <a href={image} target="_blank" rel="noreferrer"><img src={image} alt="Capture jointe au retour" className="max-h-80 rounded-ui border border-gray-200" /></a>
        : <div><button type="button" className="btn btn-secondary btn-sm" onClick={voirCapture}><ImageIcon className="w-4 h-4" /> Voir la capture</button></div>)}
      <div>
        <label className="label" htmlFor="retour-statut">Statut</label>
        <select id="retour-statut" className="input" value={statut} onChange={(e) => setStatut(e.target.value)}>
          {ORDRE_STATUTS.map((s) => <option key={s} value={s}>{STATUTS[s][1]}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="retour-reponse">Réponse à l'auteur</label>
        <textarea id="retour-reponse" className="input min-h-[100px]" maxLength={4000} value={reponse} onChange={(e) => setReponse(e.target.value)}
          placeholder="Visible par l'auteur dans son post-it (onglet « Mes retours »)." />
      </div>
      <div>
        <label className="label" htmlFor="retour-nouveaute">Réglé par la nouveauté</label>
        <select id="retour-nouveaute" className="input" value={notice} onChange={(e) => setNotice(e.target.value)}>
          <option value="">Aucune</option>
          {nouveautes.map((n) => <option key={n.id} value={n.id}>{n.title || 'Sans titre'}{n.status === 'brouillon' ? ' (brouillon)' : ''}</option>)}
        </select>
      </div>
    </Sheet>
  )
}
