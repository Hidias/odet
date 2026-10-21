// Contrôle des noms non définis (21/10) : un nom absent ne se voit qu'au moment où l'écran ou la route s'exécute
// (huit cas trouvés d'un coup, dont l'agenda iCal en panne). Lancé par la vérification de chaque PR.
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default [{
  files: ['**/*.{js,jsx,mjs}'],
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { ...globals.browser, ...globals.node, __BUILD_ID__: 'readonly' },
  },
  // Les commentaires « eslint-disable … react-hooks » du code doivent connaître la règle, laissée éteinte
  plugins: { react, 'react-hooks': reactHooks },
  linterOptions: { reportUnusedDisableDirectives: 'off' },
  rules: { 'no-undef': 'error', 'react/jsx-no-undef': 'error', 'react-hooks/exhaustive-deps': 'off' },
}]
