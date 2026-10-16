// Barre d'actions : collée en bas de l'écran sur téléphone (au-dessus de la barre système),
// alignée à droite dans le flux sur PC. L'action principale se place en dernier.
export function ActionBar({ children, className = '' }) {
  return (
    <div className={`action-bar ${className}`}>
      {children}
    </div>
  )
}

export default ActionBar
