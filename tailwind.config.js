/** @type {import('tailwindcss').Config} */

// Les couleurs de marque viennent de variables CSS posées à l'exécution par BrandingProvider
// (canaux RGB, ce qui garde les modificateurs d'opacité : bg-primary-500/10).
const scale = (name) => ({
  50: `rgb(var(--c-${name}-50) / <alpha-value>)`,
  100: `rgb(var(--c-${name}-100) / <alpha-value>)`,
  200: `rgb(var(--c-${name}-200) / <alpha-value>)`,
  300: `rgb(var(--c-${name}-300) / <alpha-value>)`,
  400: `rgb(var(--c-${name}-400) / <alpha-value>)`,
  500: `rgb(var(--c-${name}-500) / <alpha-value>)`,
  600: `rgb(var(--c-${name}-600) / <alpha-value>)`,
  700: `rgb(var(--c-${name}-700) / <alpha-value>)`,
  800: `rgb(var(--c-${name}-800) / <alpha-value>)`,
  900: `rgb(var(--c-${name}-900) / <alpha-value>)`,
  DEFAULT: `rgb(var(--c-${name}-500) / <alpha-value>)`,
  fg: `rgb(var(--c-${name}-fg) / <alpha-value>)`,
})

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: scale('primary'),
        accent: scale('accent'),
        highlight: scale('highlight'),
        nav: {
          DEFAULT: 'rgb(var(--c-nav) / <alpha-value>)',
          fg: 'rgb(var(--c-nav-fg) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        ui: 'var(--radius-ui)',
        'ui-lg': 'var(--radius-ui-lg)',
        'ui-sm': 'var(--radius-ui-sm)',
      },
      spacing: {
        'ui-1': 'var(--space-1)',
        'ui-2': 'var(--space-2)',
        'ui-3': 'var(--space-3)',
        'ui-4': 'var(--space-4)',
      },
      fontSize: {
        ui: ['var(--text-ui)', { lineHeight: '1.45' }],
        'ui-sm': ['var(--text-ui-sm)', { lineHeight: '1.4' }],
      },
    },
  },
  plugins: [],
}
