// Choix des formateurs d'une session (C6) : un formateur principal (documents, e-mails) et, à cocher, d'autres formateurs.
// Cases à cocher plutôt qu'une liste à sélection multiple : utilisable au doigt et sans raccourci clavier.
export default function ChoixFormateurs({ trainers = [], principalId = '', autresIds = [], onChange, idBase = 'formateurs', libellePrincipal = 'Formateur principal', videPrincipal = 'Non assigné' }) {
  const autres = trainers.filter((t) => t.id !== principalId)
  const changerPrincipal = (id) => onChange({ principalId: id, autresIds: (autresIds || []).filter((a) => a !== id) })
  const basculer = (id) => {
    const liste = autresIds || []
    onChange({ principalId, autresIds: liste.includes(id) ? liste.filter((a) => a !== id) : [...liste, id] })
  }
  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor={`${idBase}-principal`}>{libellePrincipal}</label>
        <select id={`${idBase}-principal`} className="input" value={principalId || ''} onChange={(e) => changerPrincipal(e.target.value)}>
          <option value="">{videPrincipal}</option>
          {trainers.map((t) => <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>)}
        </select>
      </div>
      {principalId && autres.length > 0 && (
        <fieldset>
          <legend className="label">Autres formateurs (facultatif)</legend>
          <p className="text-ui-sm text-gray-500 mb-2">Ils voient la session dans leur espace et peuvent faire émarger.</p>
          <div className="space-y-1">
            {autres.map((t) => (
              <label key={t.id} className="flex items-center gap-2 py-1.5 cursor-pointer">
                <input type="checkbox" className="w-5 h-5" checked={(autresIds || []).includes(t.id)} onChange={() => basculer(t.id)} />
                <span className="text-ui">{t.first_name} {t.last_name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  )
}
