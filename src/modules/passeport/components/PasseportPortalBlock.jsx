// Portail stagiaire : bloc « Votre Passeport de prévention » de la fiche de renseignement.
// Affiché seulement quand le module est actif. Le numéro saisi part chiffré par le serveur et n'est jamais
// renvoyé : au retour, on n'affiche que ses 3 derniers caractères.

const inputClass = 'w-full px-3 py-2.5 border border-gray-200 rounded-ui text-base focus:border-accent-400 focus:ring-2 focus:ring-accent-100'
const labelClass = 'block text-ui font-medium text-gray-800 mb-1'
const errorClass = 'text-ui-sm text-[rgb(var(--c-danger))] mt-1'

export default function PasseportPortalBlock({ value, onChange, error }) {
  const v = value || {}
  const set = (patch) => onChange({ ...v, ...patch })
  return (
    <div className="rounded-ui-lg border-2 border-gray-900 p-3 space-y-3">
      <div>
        <div className="font-display font-semibold text-gray-900">Votre Passeport de prévention</div>
        <p className="text-ui-sm text-gray-600 mt-1 leading-relaxed">
          Cette formation sera inscrite sur votre Passeport de prévention, l'espace en ligne de l'État qui garde vos formations sécurité.
          Les deux informations ci-dessous servent <b>uniquement pour alimenter votre Passeport de prévention</b>.
        </p>
      </div>
      <div>
        <label className={labelClass} htmlFor="pp-nom-naissance">Nom de naissance {!v.refuse && '*'}</label>
        <input id="pp-nom-naissance" type="text" value={v.nom || ''} disabled={v.refuse} autoComplete="family-name"
          onChange={(e) => set({ nom: e.target.value })} className={`${inputClass} ${v.refuse ? 'bg-gray-50 text-gray-400' : ''}`} />
        <p className="text-ui-sm text-gray-500 mt-1">Le nom inscrit sur votre acte de naissance, même si vous en utilisez un autre aujourd'hui.</p>
      </div>
      <div>
        <label className={labelClass} htmlFor="pp-nir">Numéro de sécurité sociale {!v.refuse && !v.nir_present && '*'}</label>
        <input id="pp-nir" type="text" inputMode="text" autoComplete="off" value={v.nir || ''} disabled={v.refuse} maxLength={21}
          placeholder={v.refuse ? 'Non communiqué' : (v.nir_present ? `Déjà enregistré, se termine par ${v.fin}` : '1 23 45 67 890 123 45')}
          onChange={(e) => set({ nir: e.target.value.toUpperCase() })} className={`${inputClass} font-mono ${v.refuse ? 'bg-gray-50 text-gray-400' : ''}`} />
        <p className="text-ui-sm text-gray-500 mt-1">
          {v.nir_present && !v.refuse ? 'Laissez vide pour le conserver, ou saisissez-le pour le corriger. ' : 'Sur votre carte Vitale. '}
          Il est chiffré dès l'envoi et ne s'affichera plus jamais en entier.
        </p>
      </div>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={!!v.refuse} onChange={(e) => set({ refuse: e.target.checked, nir: e.target.checked ? '' : v.nir })}
          className="w-4 h-4 mt-0.5 accent-[rgb(var(--c-accent-500))]" />
        <span className="text-ui-sm text-gray-600">Je ne souhaite pas communiquer mon numéro. Ma formation ne pourra pas être inscrite à mon Passeport.</span>
      </label>
      {error && <p className={errorClass}>{error}</p>}
      {v.warning && <p className="text-ui-sm text-[rgb(var(--c-warning))]">{v.warning}</p>}
    </div>
  )
}
