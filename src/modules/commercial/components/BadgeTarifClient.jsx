// Badge « tarif client » (0418) : la ligne est au prix négocié du client, pas au prix du catalogue
export default function BadgeTarifClient({ du_groupe = false }) {
  return (
    <span className="inline-block rounded-ui-sm border border-accent-300 bg-accent-50 px-1.5 py-0.5 text-[11px] font-medium text-accent-800 whitespace-nowrap"
      title={du_groupe ? 'Prix négocié du groupe du client' : 'Prix négocié du client'}>
      tarif client
    </span>
  )
}
