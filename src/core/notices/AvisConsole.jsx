import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Megaphone, Plus, Loader2, ExternalLink, Sparkles } from 'lucide-react'
import { supabase } from '../supabase'
import { Toggle } from '../settings/shared'
import { Sheet } from '../../ui/Sheet'
import { DataTable } from '../../ui/DataTable'
import { StatusBadge } from '../../ui/StatusBadge'
import { Banner } from '../../ui/Banner'
import { useConfirm } from '../../ui/Confirm'
import { useNotices, PHRASE_DEMO } from './notices'

// Console du super administrateur : bandeau d'information et entrées « Quoi de neuf » (migration 0262).
// Les entrées proposées à chaque fusion sur main (action GitHub « Nouveautés ») arrivent en brouillon :
// rien n'est montré aux utilisateurs avant d'être relu, réécrit si besoin, puis publié ici.

const STATUTS = {
  brouillon: ['warning', 'Brouillon'],
  publie: ['success', 'Publiée'],
  archive: ['neutral', 'Archivée'],
}

function Section({ icon: Icon, title, children, actions }) {
  return (
    <section className="card space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="section-title flex items-center gap-2"><Icon className="w-5 h-5 text-accent-500" /> {title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function BandeauConsole() {
  const recharger = useNotices((s) => s.charger)
  const [ligne, setLigne] = useState(undefined)
  const [texte, setTexte] = useState('')
  const [demo, setDemo] = useState(true)
  const [actif, setActif] = useState(true)
  const [busy, setBusy] = useState(false)
  const [absent, setAbsent] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.from('platform_notices')
      .select('id, body, status, show_demo_line, updated_at')
      .eq('kind', 'bandeau').is('company_id', null)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (error) { setAbsent(true); setLigne(null); return }
    setLigne(data || null)
    setTexte(data?.body || '')
    setDemo(data ? data.show_demo_line : true)
    setActif(data ? data.status === 'publie' : false)
  }
  useEffect(() => { load() }, [])

  const enregistrer = async () => {
    const body = texte.trim()
    if (actif && !body) return toast.error('Le texte du bandeau est vide')
    setBusy(true)
    const champs = { body, show_demo_line: demo, status: actif ? 'publie' : 'archive' }
    const { error } = ligne
      ? await supabase.from('platform_notices').update(champs).eq('id', ligne.id)
      : await supabase.from('platform_notices').insert({ ...champs, kind: 'bandeau' })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(actif ? 'Bandeau enregistré : il réapparaît pour tous si le texte a changé' : 'Bandeau désactivé')
    await load()
    recharger()
  }

  const modifie = ligne === undefined ? false
    : texte.trim() !== (ligne?.body || '') || demo !== (ligne ? ligne.show_demo_line : true) || actif !== (ligne?.status === 'publie')

  return (
    <Section icon={Megaphone} title="Bandeau d'information">
      {absent ? (
        <p className="muted text-ui">Disponible après la migration 0262 (mise en service).</p>
      ) : ligne === undefined ? <p className="muted text-ui">Chargement</p> : (
        <>
          <p className="muted text-ui">Affiché en haut de l'application pour tous les comptes internes connectés. Chacun peut le fermer pour la journée ; il réapparaît dès que le texte change.</p>
          <Toggle checked={actif} onChange={setActif} label="Afficher le bandeau" />
          <div>
            <label className="label" htmlFor="bandeau-texte">Texte</label>
            <textarea id="bandeau-texte" className="input min-h-[72px]" maxLength={4000} value={texte} onChange={(e) => setTexte(e.target.value)} />
          </div>
          <Toggle checked={demo} onChange={setDemo} label="Ajouter la phrase sur les données fictives"
            hint={`« ${PHRASE_DEMO} » N'apparaît que tant que des données de démonstration existent.`} />
          {texte.trim() && actif && (
            <div>
              <div className="label">Aperçu</div>
              <Banner tone="info">
                <span>{texte.trim()}</span>{demo && <span> {PHRASE_DEMO}</span>}
              </Banner>
            </div>
          )}
          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" onClick={enregistrer} disabled={busy || !modifie}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Enregistrer
            </button>
          </div>
        </>
      )}
    </Section>
  )
}

export function NouveautesConsole() {
  const recharger = useNotices((s) => s.charger)
  const confirm = useConfirm()
  const [items, setItems] = useState(null)
  const [absent, setAbsent] = useState(false)
  const [filtre, setFiltre] = useState('brouillon')
  const [edition, setEdition] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const { data, error } = await supabase.from('platform_notices')
      .select('id, title, body, status, source, source_ref, source_url, published_at, created_at, updated_at')
      .eq('kind', 'nouveaute')
      .order('created_at', { ascending: false }).limit(300)
    if (error) { setAbsent(true); setItems([]); return }
    setItems(data || [])
  }
  useEffect(() => { load() }, [])

  const enregistrer = async (statut) => {
    const title = (edition.title || '').trim()
    const body = (edition.body || '').trim()
    if (!title) return toast.error('Donnez un titre à l\'entrée')
    if (statut === 'publie' && !body) return toast.error('Écrivez quelques mots avant de publier')
    setBusy(true)
    const champs = { title, body, status: statut }
    const { error } = edition.id
      ? await supabase.from('platform_notices').update(champs).eq('id', edition.id)
      : await supabase.from('platform_notices').insert({ ...champs, kind: 'nouveaute' })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(statut === 'publie' ? 'Entrée publiée : la pastille « nouveau » apparaît pour tous' : statut === 'archive' ? 'Entrée archivée' : 'Brouillon enregistré')
    setEdition(null)
    await load()
    recharger()
  }

  const supprimer = async () => {
    const ok = await confirm({ title: 'Supprimer cette entrée ?', message: 'Elle disparaît de la Console et, si elle était publiée, de la page « Quoi de neuf ».', confirmLabel: 'Supprimer', danger: true })
    if (!ok) return
    setBusy(true)
    const { error } = await supabase.from('platform_notices').delete().eq('id', edition.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Entrée supprimée')
    setEdition(null)
    await load()
    recharger()
  }

  const compte = (s) => (items || []).filter((i) => s === 'tous' || i.status === s).length
  const lignes = (items || []).filter((i) => filtre === 'tous' || i.status === filtre)

  const colonnes = [
    { key: 'title', label: 'Entrée', mobile: 'title', render: (r) => r.title || 'Sans titre' },
    { key: 'body', label: 'Texte', mobile: 'subtitle', render: (r) => <span className="line-clamp-2 text-gray-600">{r.body || '—'}</span> },
    { key: 'source', label: 'Origine', render: (r) => (r.source === 'pull_request' ? (r.source_ref || 'Fusion') : 'Écrite à la main') },
    { key: 'date', label: 'Date', render: (r) => format(new Date(r.published_at || r.created_at), 'd MMM yyyy', { locale: fr }) },
    { key: 'status', label: 'Statut', mobile: 'aside', render: (r) => <StatusBadge tone={STATUTS[r.status]?.[0]}>{STATUTS[r.status]?.[1] || r.status}</StatusBadge> },
  ]

  return (
    <Section icon={Sparkles} title="Quoi de neuf"
      actions={!absent && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEdition({ title: '', body: '', status: 'brouillon' })}><Plus className="w-4 h-4" /> Écrire une entrée</button>}>
      {absent ? (
        <p className="muted text-ui">Disponible après la migration 0262 (mise en service).</p>
      ) : (
        <>
          <p className="muted text-ui">Chaque fusion sur main propose une entrée en brouillon, reprise du titre et de la description de la modification. Relisez-la en français simple, sans jargon ni donnée personnelle, puis publiez-la.</p>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrer les entrées">
            {[['brouillon', 'À relire'], ['publie', 'Publiées'], ['archive', 'Archivées'], ['tous', 'Toutes']].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filtre === id} onClick={() => setFiltre(id)}
                className={`btn btn-sm ${filtre === id ? 'btn-primary' : 'btn-ghost'}`}>{label} ({compte(id)})</button>
            ))}
          </div>
          <DataTable columns={colonnes} rows={lignes} loading={items === null} onRowClick={(r) => setEdition({ ...r })} caption="Entrées « Quoi de neuf »" />
        </>
      )}

      {edition && (
        <Sheet title={edition.id ? 'Entrée « Quoi de neuf »' : 'Nouvelle entrée'} onClose={() => setEdition(null)}
          footer={<>
            {edition.id && <button type="button" className="btn btn-ghost text-[rgb(var(--c-danger))] mr-auto" onClick={supprimer} disabled={busy}>Supprimer</button>}
            {edition.id && edition.status === 'publie' && <button type="button" className="btn btn-secondary" onClick={() => enregistrer('archive')} disabled={busy}>Archiver</button>}
            {edition.status !== 'publie' && <button type="button" className="btn btn-secondary" onClick={() => enregistrer('brouillon')} disabled={busy}>Garder en brouillon</button>}
            <button type="button" className="btn btn-primary" onClick={() => enregistrer('publie')} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} {edition.status === 'publie' ? 'Enregistrer' : 'Publier'}
            </button>
          </>}>
          {edition.source === 'pull_request' && (
            <Banner tone="info">
              Proposée par la fusion {edition.source_ref}.{' '}
              {edition.source_url && <a href={edition.source_url} target="_blank" rel="noreferrer" className="underline inline-flex items-center gap-1">Voir la modification <ExternalLink className="w-3.5 h-3.5" /></a>}
            </Banner>
          )}
          <div>
            <label className="label" htmlFor="nv-titre">Titre</label>
            <input id="nv-titre" className="input" maxLength={200} value={edition.title || ''} onChange={(e) => setEdition({ ...edition, title: e.target.value })} placeholder="Ex. : les avoirs se font en deux clics" />
          </div>
          <div>
            <label className="label" htmlFor="nv-texte">Ce qui change pour les utilisateurs</label>
            <textarea id="nv-texte" className="input min-h-[140px]" maxLength={4000} value={edition.body || ''} onChange={(e) => setEdition({ ...edition, body: e.target.value })}
              placeholder="En français simple : ce que l'on peut faire maintenant, où le trouver." />
          </div>
        </Sheet>
      )}
    </Section>
  )
}
