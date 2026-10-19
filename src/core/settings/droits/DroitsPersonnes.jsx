import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { Euro, User, X, Plus, Search } from 'lucide-react'
import { supabase } from '../../supabase'
import { useAuthStore } from '../../store'
import { DataTable, Sheet, Banner, Spinner, useConfirm } from '../../../ui'
import { chargerCatalogue, chargerProfils, chargerPersonnes, apercuDroits, parDomaine, ROLES_DE_BASE } from './donnees'

// Paramètres › Droits des personnes (droit parametres.droits.attribuer, donc licence totale ou super administrateur).
// Une fiche par personne de la société courante : profil de base (il se change dans Utilisateurs), profils en plus,
// droits accordés ou retirés un par un, et l'aperçu des droits effectifs calculé par la base.

function Drapeaux({ droit }) {
  return (
    <span className="inline-flex gap-1 flex-none">
      {droit.shows_prices && <span className="inline-flex items-center text-gray-500" title="Montre des prix ou des montants"><Euro className="w-3 h-3" aria-hidden="true" /><span className="sr-only">prix</span></span>}
      {droit.own_scope && <span className="inline-flex items-center text-gray-500" title="Limité au périmètre de la personne"><User className="w-3 h-3" aria-hidden="true" /><span className="sr-only">son périmètre</span></span>}
    </span>
  )
}

function FichePersonne({ personne, catalogue, profils, onClose, onChange }) {
  const confirm = useConfirm()
  const [apercu, setApercu] = useState(null)
  const [filtre, setFiltre] = useState('')
  const [occupe, setOccupe] = useState(false)
  const profileId = personne.profile_id

  const charger = () => apercuDroits(profileId).then(setApercu).catch((e) => { setApercu(null); toast.error(e.message) })
  useEffect(() => { charger() }, [profileId])

  const ajustement = (code) => personne.ajustements.find((a) => a.right_code === code)?.effect || ''
  const domaines = useMemo(() => {
    const f = filtre.trim().toLowerCase()
    return parDomaine(catalogue)
      .map((g) => ({ ...g, droits: g.droits.filter((d) => !f || d.label.toLowerCase().includes(f) || d.code.includes(f)) }))
      .filter((g) => g.droits.length > 0)
  }, [catalogue, filtre])
  const attribuables = profils.filter((p) => !['superadmin', 'membre'].includes(p.key)
    && p.key !== personne.role && !personne.profilsEnPlus.some((r) => r.role_key === p.key))

  const apres = async (promesse, message) => {
    setOccupe(true)
    try {
      const { error } = await promesse
      if (error) throw error
      toast.success(message)
      await onChange()
      await charger()
    } catch (e) {
      toast.error(e.message || 'Enregistrement refusé')
    } finally {
      setOccupe(false)
    }
  }

  const ajouterProfil = (cle) => cle && apres(
    supabase.from('company_member_roles').insert({ member_id: personne.id, role_key: cle }), 'Profil ajouté')
  const retirerProfil = async (r) => {
    const libelle = profils.find((p) => p.key === r.role_key)?.actif.label || r.role_key
    if (!await confirm({ title: 'Retirer ce profil ?', message: `${personne.nom} perdra les droits du profil « ${libelle} » qui ne lui viennent pas d'ailleurs.`, confirmLabel: 'Retirer' })) return
    apres(supabase.from('company_member_roles').delete().eq('id', r.id), 'Profil retiré')
  }
  const regler = (droit, effet) => {
    const existant = personne.ajustements.find((a) => a.right_code === droit.code)
    if (!effet) return existant && apres(supabase.from('company_member_rights').delete().eq('id', existant.id), 'Revenu aux profils')
    if (existant) return apres(supabase.from('company_member_rights').update({ effect: effet }).eq('id', existant.id), 'Droit réglé')
    return apres(supabase.from('company_member_rights').insert({
      member_id: personne.id, company_id: personne.company_id, right_code: droit.code, effect: effet,
    }), 'Droit réglé')
  }

  const libelleProfil = (cle) => profils.find((p) => p.key === cle)?.actif.label || ROLES_DE_BASE[cle] || cle

  return (
    <Sheet title={personne.nom} size="lg" onClose={onClose}
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Fermer</button>}>
      <div className="grid gap-1">
        <div className="text-ui-sm text-gray-500">{personne.email}</div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui-sm text-gray-600">Profil de base :</span>
          <span className="badge">{ROLES_DE_BASE[apercu?.role] || ROLES_DE_BASE[personne.role] || personne.role}</span>
          <Link to="/parametres?section=utilisateurs" className="text-ui-sm underline text-gray-600">se change dans Utilisateurs</Link>
        </div>
      </div>

      <section className="grid gap-2">
        <h3 className="font-semibold">Profils en plus</h3>
        <div className="flex flex-wrap gap-2">
          {personne.profilsEnPlus.length === 0 && <span className="text-ui-sm text-gray-500">Aucun</span>}
          {personne.profilsEnPlus.map((r) => (
            <span key={r.id} className="badge inline-flex items-center gap-1">
              {libelleProfil(r.role_key)}
              <button type="button" className="p-0.5" aria-label={`Retirer le profil ${libelleProfil(r.role_key)}`} disabled={occupe} onClick={() => retirerProfil(r)}><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        {attribuables.length > 0 && (
          <label className="flex items-center gap-2 max-w-md">
            <Plus className="w-4 h-4 text-gray-500 flex-none" aria-hidden="true" />
            <select className="select" value="" disabled={occupe} onChange={(e) => ajouterProfil(e.target.value)} aria-label="Ajouter un profil">
              <option value="">Ajouter un profil…</option>
              {attribuables.map((p) => <option key={p.key} value={p.key}>{p.actif.label}</option>)}
            </select>
          </label>
        )}
      </section>

      <section className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <h3 className="font-semibold">Droits {apercu && <span className="text-ui-sm font-normal text-gray-500">({apercu.rights.size} au total)</span>}</h3>
          <label className="relative flex-1 min-w-[12rem] max-w-xs">
            <Search className="w-4 h-4 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input className="input pl-8" placeholder="Chercher un droit" value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Chercher un droit" />
          </label>
        </div>
        <p className="text-ui-sm text-gray-500">« Oui » ou « Non » est calculé par la base à partir des profils et des réglages ci-dessous. Un réglage individuel l'emporte sur les profils.</p>
        {!apercu ? <Spinner /> : domaines.map((g) => (
          <details key={g.cle} className="border hairline rounded-ui" open={!!filtre}>
            <summary className="cursor-pointer px-3 py-2 font-medium flex items-center gap-2">
              <span className="flex-1">{g.libelle}</span>
              <span className="text-ui-sm text-gray-500">{g.droits.filter((d) => apercu.rights.has(d.code)).length} / {g.droits.length}</span>
            </summary>
            <ul className="divide-y hairline">
              {g.droits.map((d) => {
                const oui = apercu.rights.has(d.code)
                return (
                  <li key={d.code} className="px-3 py-2 grid gap-1 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><span className="font-medium">{d.label}</span><Drapeaux droit={d} /></div>
                      <div className="text-ui-sm text-gray-500">{d.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`badge ${oui ? 'badge-success' : 'badge-neutral'}`}>{oui ? 'Oui' : 'Non'}</span>
                      <select className="select" style={{ minHeight: 32, width: 170 }} value={ajustement(d.code)} disabled={occupe}
                        aria-label={`Réglage individuel : ${d.label}`} onChange={(e) => regler(d, e.target.value)}>
                        <option value="">Selon les profils</option>
                        <option value="grant">Accorder</option>
                        <option value="revoke">Retirer</option>
                      </select>
                    </div>
                  </li>
                )
              })}
            </ul>
          </details>
        ))}
      </section>
    </Sheet>
  )
}

export default function DroitsPersonnes() {
  const rights = useAuthStore((s) => s.rights)
  const companyId = rights?.companyId || null
  const [catalogue, setCatalogue] = useState([])
  const [profils, setProfils] = useState([])
  const [personnes, setPersonnes] = useState(null)
  const [ouverte, setOuverte] = useState(null)

  const charger = async () => {
    if (!companyId) return
    try {
      const [c, p, m] = await Promise.all([chargerCatalogue(), chargerProfils(companyId), chargerPersonnes(companyId)])
      setCatalogue(c); setProfils(p); setPersonnes(m)
      setOuverte((o) => (o ? m.find((x) => x.id === o.id) || null : null))
    } catch (e) {
      toast.error(e.message)
      setPersonnes([])
    }
  }
  useEffect(() => { charger() }, [companyId])

  if (!companyId) return <Banner tone="info" title="Droits indisponibles">Les droits par société ne sont pas encore actifs sur cette base.</Banner>

  const libelleProfil = (cle) => profils.find((p) => p.key === cle)?.actif.label || ROLES_DE_BASE[cle] || cle
  const colonnes = [
    { key: 'nom', label: 'Personne', mobile: 'title', render: (m) => <span className="font-medium">{m.nom}</span> },
    { key: 'email', label: 'Email', mobile: 'subtitle' },
    { key: 'role', label: 'Profil de base', render: (m) => ROLES_DE_BASE[m.role] || m.role },
    { key: 'plus', label: 'Profils en plus', render: (m) => m.profilsEnPlus.map((r) => libelleProfil(r.role_key)).join(', ') || '—' },
    { key: 'aj', label: 'Réglages individuels', align: 'right', render: (m) => m.ajustements.length || '—' },
    { key: 'actif', label: 'Actif', mobile: 'aside', render: (m) => (m.is_active && m.profiles?.is_active !== false ? <span className="badge badge-success">Actif</span> : <span className="badge badge-neutral">Inactif</span>) },
  ]

  return (
    <>
      <h2 className="section-title">Droits des personnes</h2>
      <p className="text-ui-sm text-gray-500">Chaque personne a un profil de base (son rôle), des profils en plus si besoin, et des droits accordés ou retirés un par un. Les comptes se créent et se désactivent dans Utilisateurs.</p>
      <DataTable columns={colonnes} rows={personnes || []} loading={personnes === null} onRowClick={setOuverte} caption="Personnes de la société" />
      {ouverte && <FichePersonne personne={ouverte} catalogue={catalogue} profils={profils} onClose={() => setOuverte(null)} onChange={charger} />}
    </>
  )
}
