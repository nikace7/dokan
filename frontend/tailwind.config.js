import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      // Colors read the CSS custom properties in src/styles/tokens.css so a
      // future per-tenant accent can re-theme without a rebuild.
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        // Pastel icon-chip tints (StatTile, quick actions): `bg-tint-green` /
        // `text-tint-green-foreground`. Tokens live in styles/tokens.css.
        tint: {
          green: {
            DEFAULT: 'hsl(var(--tint-green))',
            foreground: 'hsl(var(--tint-green-foreground))',
          },
          blue: {
            DEFAULT: 'hsl(var(--tint-blue))',
            foreground: 'hsl(var(--tint-blue-foreground))',
          },
          amber: {
            DEFAULT: 'hsl(var(--tint-amber))',
            foreground: 'hsl(var(--tint-amber-foreground))',
          },
          rose: {
            DEFAULT: 'hsl(var(--tint-rose))',
            foreground: 'hsl(var(--tint-rose-foreground))',
          },
          violet: {
            DEFAULT: 'hsl(var(--tint-violet))',
            foreground: 'hsl(var(--tint-violet-foreground))',
          },
        },
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        'card-hover': 'var(--shadow-card-hover)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        // Inter Variable for Latin UI text + Noto Sans Devanagari fallback for
        // Nepali labels (docs/SYSTEM_DESIGN.md §7.2). Self-hosted — no CDN.
        sans: [
          'Inter Variable',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'Noto Sans Devanagari',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [animate],
};
