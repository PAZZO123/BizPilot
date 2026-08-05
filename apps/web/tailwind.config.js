/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Toggled by hand rather than following the OS, so a shopkeeper standing in a
  // bright doorway can force light even if their phone thinks it is night.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Teal reads as trustworthy-but-not-a-bank, and stays legible on the
        // cheap LCD phone screens most of these shops use.
        brand: {
          50: '#F0FDFA',
          100: '#CCFBF1',
          200: '#99F6E4',
          300: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
          800: '#115E59',
          900: '#134E4A',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Headlines only. A serif at large sizes gives the page a voice; used on
        // body copy it would slow down reading on a small screen.
        display: ['"Playfair Display"', 'Georgia', 'serif'],
      },
      keyframes: {
        'slide-up': {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        // Slow push-in on the hero photographs. The scale never returns to 1
        // during a slide's life, so the motion reads as continuous drift rather
        // than a loop snapping back.
        'ken-burns': {
          '0%': { transform: 'scale(1) translate3d(0, 0, 0)' },
          '100%': { transform: 'scale(1.12) translate3d(-1.5%, -1%, 0)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 180ms ease-out',
        'ken-burns': 'ken-burns 18s ease-out forwards',
      },
    },
  },
  plugins: [],
};
