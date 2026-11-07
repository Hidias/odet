/** Session sans financeur extérieur prévu : financement « aucun » (ou pas encore choisi) ou « direct ». L'onglet
 *  Financement n'y affiche pas de « reste à financer » (A11, 07/11). La complétude, elle, continue de signaler un
 *  financement non choisi. */
export const sansFinanceurPrevu = (type) => !type || type === 'none' || type === 'direct'
