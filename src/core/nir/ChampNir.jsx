import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { verifierNir, formaterNir } from './verifierNir'

// Champ de n° de sécurité sociale avec vérification immédiate (15 caractères, clé, cohérence avec la fiche),
// commun à l'espace entreprise, au portail stagiaire et à la fiche stagiaire (22/10).
export default function ChampNir({ id, value, onChange, ctx = {}, placeholder = '1 85 05 78 006 084 36', disabled = false, className = 'input w-full', label = null, aide = null }) {
  const v = verifierNir(value, ctx)
  const complet = String(value || '').replace(/[\s.\-_]/g, '').length >= 13
  return (
    <div>
      {label && <label htmlFor={id} className="block text-sm"><span className="text-gray-600">{label}</span></label>}
      <input id={id} className={`${className} font-mono ${label ? 'mt-1' : ''} ${!v.vide && !v.ok && complet ? 'border-[rgb(var(--c-danger))]' : ''}`}
        value={formaterNir(value)} onChange={(e) => onChange(formaterNir(e.target.value).replace(/\s/g, ''))}
        inputMode="text" autoComplete="off" autoCapitalize="characters" maxLength={21} placeholder={placeholder} disabled={disabled} aria-invalid={!v.vide && !v.ok} />
      {!v.vide && v.ok && v.alertes.length === 0 && <p className="mt-1 text-xs text-[rgb(var(--c-success))] flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />Numéro valide (clé vérifiée)</p>}
      {!v.vide && v.ok && v.alertes.map((a) => <p key={a} className="mt-1 text-xs text-[rgb(var(--c-warning))] flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />{a}</p>)}
      {!v.vide && !v.ok && complet && v.erreurs.map((e) => <p key={e} className="mt-1 text-xs text-[rgb(var(--c-danger))] flex items-start gap-1"><XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />{e}</p>)}
      {aide && <p className="mt-1 text-xs text-gray-500">{aide}</p>}
    </div>
  )
}
