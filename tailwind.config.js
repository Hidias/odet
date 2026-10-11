/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Bleu pétrole Access Formation
        primary: {
          50: '#e6f0f2',
          100: '#cce1e5',
          200: '#99c3cb',
          300: '#66a5b1',
          400: '#338797',
          500: '#0F2D35',
          600: '#0d2830',
          700: '#0b2329',
          800: '#091e22',
          900: '#07191b',
        },
        // Jaune/Or Access Formation
        accent: {
          50: '#fef9ed',
          100: '#fdf3db',
          200: '#fbe7b7',
          300: '#f9db93',
          400: '#f7cf6f',
          500: '#E9B44C',
          600: '#d4a043',
          700: '#bf8c3a',
          800: '#aa7831',
          900: '#956428',
        }
      }
    },
  },
  plugins: [],
}
