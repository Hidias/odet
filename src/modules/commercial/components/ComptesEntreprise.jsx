import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Copy, KeyRound, Link2, Loader2, Plus, Power, UserCog } from 'lucide-react'
import { supabase } from '../../../core/supabase'
import { callApi } from '../../../core/api'
import { Sheet } from '../../../ui/Sheet'
import { StatusBadge } from '../../../ui/StatusBadge'

// Comptes de l'espace entreprise (lot 2, 0046) : un compte par contact, au rôle « entreprise ».
// L'application n'envoie aucun email : à l'invitation, le lien d'accès est affiché pour être transmis par la personne
// qui invite (depuis sa messagerie). Options : tous les sites ou certains, inscrire des salariés, voir les factures.
// Le lien avec code (carte « Accès entreprise ») reste pour les contacts sans compte.

const fr = (d) => (d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const nomContact = (c) => (c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.name || c.email : '')

export default function ComptesEntreprise({ client, contacts = [] }) {
  const [comptes, setComptes] = useState(null)
  const [sites, setSites] = useState([])
  const [indispo, setIndispo] = useState(false)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [lien, setLien] = useState(null)

  const load = async () => {
    const [{ data, error }, { data: s }] = await Promise.all([
      supabase.rpc('client_accounts_etat', { p_client: client.id }),
      supabase.from('sites').select('id, name, city, is_default').eq('client_id', client.id).order('is_default', { ascending: false }),
    ])
    if (error) { setIndispo(true); setComptes([]); return }
    setComptes(data || [])
    setSites(s || [])
  }
  useEffect(() => { if (client?.id) load() }, [client?.id])

  if (indispo || client?.client_type === 'particulier') return null

  const contactDe = (id) => contacts.find((c) => c.id === id)
  const sansCompte = contacts.filter((c) => c.email && !(comptes || []).some((a) => a.contact_id === c.id))

  const inviter = async () => {
    if (!form.email) return toast.error('Adresse email requise')
    if (!form.all_sites && form.site_ids.length === 0) return toast.error('Choisissez au moins un site')
    setBusy(true)
    try {
      const r = await callApi('/api/espace-entreprise', { action: 'inviter', client_id: client.id, ...form })
      setForm(null)
      setLien({ email: form.email, link: r.link, nouveau: true })
      load()
    } catch (e) {
      toast.error(e.message)
    } finally { setBusy(false) }
  }

  const nouveauLien = async (a) => {
    setBusy(true)
    try {
      const r = await callApi('/api/espace-entreprise', { action: 'lien', account_id: a.id })
      setLien({ email: a.email, link: r.link, nouveau: false })
    } catch (e) {
      toast.error(e.message)
    } finally { setBusy(false) }
  }

  const changer = async (a, patch, msg) => {
    const { error } = await supabase.from('client_accounts').update(patch).eq('id', a.id)
    if (error) return toast.error(error.message)
    toast.success(msg)
    load()
  }

  const copier = async (t) => {
    try { await navigator.clipboard.writeText(t); toast.success('Lien copié') } catch { toast.error('Copie impossible') }
  }

  const ouvrirForm = (c) => setForm({
    contact_id: c?.id || '', email: c?.email || '', can_register: true, can_see_invoices: false, all_sites: true, site_ids: [],
  })

  return (
    <div className="bg-white rounded-ui border border-gray-200">
      <div className="flex items-center gap-2 px-5 py-3.5">
        <UserCog className="w-5 h-5 text-primary-600" />
        <h2 className="font-semibold text-gray-900">Comptes de l'espace entreprise</h2>
        {comptes?.length > 0 && <span className="text-ui-sm bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{comptes.length}</span>}
      </div>
      <div className="px-5 pb-4 space-y-2">
        <p className="text-ui-sm text-gray-500">Un compte personnel pour un contact : formations et documents, salariés et échéances, inscriptions et demandes, factures si vous l'autorisez.</p>
        {comptes === null ? <Loader2 className="w-4 h-4 animate-spin text-gray-400" /> : comptes.map((a) => (
          <div key={a.id} className="p-2.5 bg-gray-50 rounded-ui-sm space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-ui text-gray-900 truncate">{nomContact(contactDe(a.contact_id)) || a.email}</div>
                <div className="text-ui-sm text-gray-500 truncate">{a.email} · {a.last_seen_at ? `vu le ${fr(a.last_seen_at)}` : `invité le ${fr(a.invited_at)}, pas encore connecté`}</div>
              </div>
              <StatusBadge tone={a.is_active ? 'success' : 'neutral'}>{a.is_active ? 'Actif' : 'Désactivé'}</StatusBadge>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ui-sm">
              <label className="flex items-center gap-1.5 text-gray-700"><input type="checkbox" checked={a.can_register} onChange={(e) => changer(a, { can_register: e.target.checked }, 'Option enregistrée')} /> Inscrire des salariés</label>
              <label className="flex items-center gap-1.5 text-gray-700"><input type="checkbox" checked={a.can_see_invoices} onChange={(e) => changer(a, { can_see_invoices: e.target.checked }, 'Option enregistrée')} /> Voir les factures</label>
              <span className="text-gray-500">{a.all_sites ? 'Tous les sites' : `${(a.sites || []).length} site(s)`}</span>
            </div>
            <div className="flex flex-wrap gap-2 pt-0.5">
              {a.is_active && <button type="button" className="btn btn-sm btn-secondary" onClick={() => nouveauLien(a)} disabled={busy}><KeyRound className="w-3.5 h-3.5" /> Lien pour choisir un mot de passe</button>}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => changer(a, { is_active: !a.is_active }, a.is_active ? 'Compte désactivé' : 'Compte réactivé')}>
                <Power className="w-3.5 h-3.5" /> {a.is_active ? 'Désactiver' : 'Réactiver'}
              </button>
            </div>
          </div>
        ))}
        {sansCompte.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {sansCompte.slice(0, 4).map((c) => (
              <button key={c.id} type="button" className="btn btn-sm btn-secondary" onClick={() => ouvrirForm(c)}><Plus className="w-3.5 h-3.5" /> {nomContact(c)}</button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => ouvrirForm(null)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-ui text-primary-600 hover:bg-primary-50 rounded-ui-sm border border-dashed border-primary-300 transition-colors">
          <Plus className="w-4 h-4" /> Inviter une personne
        </button>
      </div>

      {form && (
        <Sheet title="Inviter dans l'espace entreprise" onClose={() => setForm(null)}
          footer={<>
            <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Annuler</button>
            <button type="button" className="btn btn-primary" onClick={inviter} disabled={busy}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Créer le compte</button>
          </>}>
          <div>
            <label className="label" htmlFor="ce-contact">Contact</label>
            <select id="ce-contact" className="input" value={form.contact_id}
              onChange={(e) => { const c = contactDe(e.target.value); setForm((f) => ({ ...f, contact_id: e.target.value, email: c?.email || f.email })) }}>
              <option value="">Aucun contact relié</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{nomContact(c)}{c.email ? ` · ${c.email}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ce-email">Adresse email de connexion</label>
            <input id="ce-email" type="email" className="input" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value.trim() }))} />
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2 text-ui text-gray-800"><input type="checkbox" checked={form.can_register} onChange={(e) => setForm((f) => ({ ...f, can_register: e.target.checked }))} /> Peut demander l'inscription de salariés</label>
            <label className="flex items-center gap-2 text-ui text-gray-800"><input type="checkbox" checked={form.can_see_invoices} onChange={(e) => setForm((f) => ({ ...f, can_see_invoices: e.target.checked }))} /> Peut voir les factures</label>
            {sites.length > 1 && <label className="flex items-center gap-2 text-ui text-gray-800"><input type="checkbox" checked={form.all_sites} onChange={(e) => setForm((f) => ({ ...f, all_sites: e.target.checked }))} /> Tous les sites</label>}
          </div>
          {!form.all_sites && (
            <div className="flex flex-wrap gap-1.5">
              {sites.map((s) => {
                const on = form.site_ids.includes(s.id)
                return (
                  <button key={s.id} type="button" aria-pressed={on}
                    onClick={() => setForm((f) => ({ ...f, site_ids: on ? f.site_ids.filter((x) => x !== s.id) : [...f.site_ids, s.id] }))}
                    className={`h-8 px-2.5 rounded-full text-ui-sm border ${on ? 'bg-accent-500 text-accent-fg border-accent-500' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                    {s.name}{s.city ? ` · ${s.city}` : ''}
                  </button>
                )
              })}
            </div>
          )}
          <p className="text-ui-sm text-gray-500">Aucun email n'est envoyé par l'application : le lien d'accès s'affiche ensuite, à transmettre vous-même.</p>
        </Sheet>
      )}

      {lien && (
        <Sheet title={lien.nouveau ? 'Compte créé' : 'Nouveau lien'} onClose={() => setLien(null)}
          footer={<button type="button" className="btn btn-primary" onClick={() => setLien(null)}>Terminé</button>}>
          <p className="text-ui text-gray-700">Transmettez ce lien à {lien.email} depuis votre messagerie : il permet de choisir un mot de passe, puis de se connecter à l'espace entreprise. Il ne sert qu'une fois.</p>
          {lien.link ? (
            <div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-ui-sm">
              <Link2 className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-ui-sm text-gray-700 truncate flex-1">{lien.link}</span>
              <button type="button" onClick={() => copier(lien.link)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded hover:bg-white" title="Copier le lien"><Copy className="w-3.5 h-3.5" /></button>
            </div>
          ) : <p className="text-ui-sm text-[rgb(var(--c-warning))]">Lien non disponible : utilisez « Lien pour choisir un mot de passe ».</p>}
        </Sheet>
      )}
    </div>
  )
}
