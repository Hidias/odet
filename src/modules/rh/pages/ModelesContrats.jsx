// Contrats de travail (0525) : réglages des mentions communes (convention collective, caisses, modalités de paie) et
// modèles de la société (CDI, CDD, avenant). Un modèle reste « projet » tant que l'avocat ne l'a pas validé ; validé,
// son texte est figé. Aucune clause facultative (mobilité, non-concurrence, exclusivité, astreinte) avant l'avocat.

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { FileText } from 'lucide-react'
import { Spinner, EmptyState } from '../../../ui/EmptyState'
import { confirmer } from '../../../ui/Confirm'
import { enVueGroupe, societeEnCours } from '../../../core/company/societes'
import {
  TYPES_MODELE, chargerModeles, poserModeles, validerModele, chargerReglagesContrat, enregistrerReglagesContrat,
} from '../lib/rhContrats'

const fr = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const aujourdhui = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Champ({ label, aide, children }) {
  return <label className="block"><span className="label">{label}</span>{children}{aide && <span className="text-ui-sm muted">{aide}</span>}</label>
}

function Reglages({ companyId, peutConfigurer }) {
  const [v, setV] = useState(null)
  const [societe, setSociete] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    chargerReglagesContrat(companyId).then(({ reglages, societe: s }) => {
      setSociete(s)
      setV({
        collective_agreement_name: reglages.collective_agreement_name || '', retirement_fund: reglages.retirement_fund || '',
        prevoyance_org: reglages.prevoyance_org || '', pay_terms: reglages.pay_terms || '',
      })
    }).catch((e) => toast.error(e.message))
  }, [companyId])
  if (!v) return <Spinner />
  const m = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const enregistrer = async (e) => {
    e.preventDefault()
    setBusy(true)
    try { await enregistrerReglagesContrat(companyId, v); toast.success('Réglages enregistrés') } catch (er) { toast.error(er.message) }
    setBusy(false)
  }
  return (
    <form onSubmit={enregistrer} className="card space-y-3">
      <h2 className="section-title">Mentions communes à tous les contrats</h2>
      <p className="text-ui-sm text-gray-600">Reprises dans chaque contrat généré (L1242-12, R1221-34). Rien n'est rempli d'office : saisissez-les d'après vos bulletins de paie et vos contrats d'adhésion.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Champ label="Convention collective (intitulé)">
          <input className="input" maxLength={300} disabled={!peutConfigurer} value={v.collective_agreement_name} onChange={m('collective_agreement_name')} />
        </Champ>
        <Champ label="IDCC" aide="Celui de la société (Paramètres › Sociétés), pour ne pas le saisir deux fois.">
          <input className="input" disabled value={societe.idcc || 'À saisir dans Paramètres › Sociétés'} />
        </Champ>
        <Champ label="Caisse de retraite complémentaire (nom et adresse)">
          <input className="input" maxLength={300} disabled={!peutConfigurer} value={v.retirement_fund} onChange={m('retirement_fund')} />
        </Champ>
        <Champ label="Organisme de prévoyance, le cas échéant (nom et adresse)">
          <input className="input" maxLength={300} disabled={!peutConfigurer} value={v.prevoyance_org} onChange={m('prevoyance_org')} />
        </Champ>
        <Champ label="Modalités de paie" aide="Périodicité et mode de paiement, par exemple « mensuellement, par virement bancaire ».">
          <input className="input" maxLength={300} disabled={!peutConfigurer} value={v.pay_terms} onChange={m('pay_terms')} />
        </Champ>
      </div>
      {peutConfigurer && <button type="submit" className="btn btn-primary btn-sm min-h-[44px]" disabled={busy}>Enregistrer</button>}
    </form>
  )
}

function Modele({ modele, peutConfigurer, onChange }) {
  const [ouvert, setOuvert] = useState(false)
  const [val, setVal] = useState(null)
  const valider = async (e) => {
    e.preventDefault()
    if (!(await confirmer(`Marquer « ${modele.title} » version ${modele.version} comme validé par l'avocat ? Son texte ne pourra plus changer (une nouvelle version sera nécessaire) et les contrats générés seront rangés dans les documents.`))) return
    try { await validerModele(modele.id, val); setVal(null); onChange() } catch (er) { toast.error(er.message) }
  }
  return (
    <li className="py-3 space-y-2">
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-[12rem]">
          <div className="font-semibold text-ui">{TYPES_MODELE[modele.kind]} · {modele.title} · version {modele.version}</div>
          <div className="text-ui-sm muted">
            {modele.status === 'valide' ? `Validé le ${fr(modele.validated_on)} par ${modele.validated_by_name}` : 'Projet à valider par l\'avocat : les PDF sortent marqués PROJET et ne sont pas rangés'}
          </div>
          {modele.note && <div className="text-ui-sm text-gray-600">{modele.note}</div>}
        </div>
        <span className={`badge ${modele.status === 'valide' ? 'badge-success' : 'badge-warning'}`}>{modele.status === 'valide' ? 'Validé' : 'Projet'}</span>
        <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => setOuvert(!ouvert)}><FileText className="w-4 h-4" aria-hidden="true" />{ouvert ? 'Masquer le texte' : 'Voir le texte'}</button>
        {peutConfigurer && modele.status !== 'valide' && !val && (
          <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => setVal({ validated_on: aujourdhui(), validated_by_name: '' })}>Marquer validé par l'avocat</button>
        )}
      </div>
      {val && (
        <form onSubmit={valider} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] items-end">
          <Champ label="Validé le"><input className="input" type="date" required max={aujourdhui()} value={val.validated_on} onChange={(e) => setVal({ ...val, validated_on: e.target.value })} /></Champ>
          <Champ label="Par (nom de l'avocat)"><input className="input" required maxLength={200} value={val.validated_by_name} onChange={(e) => setVal({ ...val, validated_by_name: e.target.value })} /></Champ>
          <div className="flex gap-1"><button type="submit" className="btn btn-primary btn-sm min-h-[44px]">Valider</button><button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => setVal(null)}>Annuler</button></div>
        </form>
      )}
      {ouvert && (
        <ol className="list-decimal pl-5 space-y-2 text-ui-sm">
          {(modele.articles || []).map((a, i) => (
            <li key={i}>
              <span className="font-semibold">{a.titre}</span>{a.si && <span className="muted"> (si : {a.si.replace(/_/g, ' ')})</span>}
              <div className="text-gray-700 whitespace-pre-line">{a.texte}</div>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

export default function ModelesContrats({ peutConfigurer }) {
  const [modeles, setModeles] = useState(null)
  const companyId = societeEnCours()
  const charger = useCallback(() => { chargerModeles().then(setModeles).catch((e) => { toast.error(e.message); setModeles([]) }) }, [])
  useEffect(() => { charger() }, [charger])
  if (enVueGroupe() || !companyId) return <EmptyState icon={FileText} title="Choisissez une société" compact>Les contrats se règlent société par société.</EmptyState>
  if (!modeles) return <Spinner />
  const manque = ['cdi', 'cdd', 'avenant'].filter((k) => !modeles.some((m) => m.kind === k && m.company_id === companyId))
  return (
    <div className="space-y-4">
      <Reglages companyId={companyId} peutConfigurer={peutConfigurer} />
      <section className="card space-y-2">
        <h2 className="section-title">Modèles</h2>
        <p className="text-ui-sm text-gray-600">Base proposée : seulement les mentions imposées par le Code du travail, avec les renvois aux textes permis par l'article R1221-35. Faites-la valider par votre avocat avant tout usage.</p>
        {manque.length > 0 && peutConfigurer && (
          <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={async () => {
            try { await poserModeles(companyId); charger() } catch (e) { toast.error(e.message) }
          }}>Poser les modèles de départ ({manque.map((k) => TYPES_MODELE[k]).join(', ')})</button>
        )}
        <ul className="divide-y hairline">
          {modeles.filter((m) => m.company_id === companyId).map((m) => <Modele key={m.id} modele={m} peutConfigurer={peutConfigurer} onChange={charger} />)}
        </ul>
      </section>
    </div>
  )
}
