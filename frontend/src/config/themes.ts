export interface Theme {
  id: string;
  name: string;
  description: string;
  isDark: boolean;
  colors: {
    bg: string;
    'surface-1': string;
    'surface-2': string;
    'surface-3': string;
    border: string;
    text: string;
    'text-2': string;
    'text-3': string;
    accent: string;
    'accent-2': string;
    'accent-soft': string;
    green: string;
    'green-soft': string;
    'scrollbar-thumb': string;
    'scrollbar-thumb-hover': string;
  };
}

export const themes: Theme[] = [
  {
    id: 'dark',
    name: 'Dark',
    description: 'Default dark theme',
    isDark: true,
    colors: {
      bg: '#000000',
      'surface-1': '#111111',
      'surface-2': '#1a1a1a',
      'surface-3': '#222222',
      border: 'rgba(255,255,255,0.06)',
      text: '#ffffff',
      'text-2': '#a3a3a3',
      'text-3': '#737373',
      accent: '#1ECAB8',
      'accent-2': '#0a7a70',
      'accent-soft': 'rgba(30,202,184,0.1)',
      green: '#34d399',
      'green-soft': 'rgba(52,211,153,0.12)',
      'scrollbar-thumb': 'rgba(255,255,255,0.08)',
      'scrollbar-thumb-hover': 'rgba(255,255,255,0.15)',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Original deep purple-tinted dark theme',
    isDark: true,
    colors: {
      bg: '#171720',
      'surface-1': '#1e1e2a',
      'surface-2': '#252535',
      'surface-3': '#2e2e40',
      border: 'rgba(255,255,255,0.06)',
      text: '#eaeaf0',
      'text-2': '#9898aa',
      'text-3': '#5c5c70',
      accent: '#60a5fa',
      'accent-2': '#3b82f6',
      'accent-soft': 'rgba(96,165,250,0.1)',
      green: '#34d399',
      'green-soft': 'rgba(52,211,153,0.12)',
      'scrollbar-thumb': 'rgba(255,255,255,0.06)',
      'scrollbar-thumb-hover': 'rgba(255,255,255,0.12)',
    },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Clean light theme',
    isDark: false,
    colors: {
      bg: '#f5f5f5',
      'surface-1': '#ffffff',
      'surface-2': '#f0f0f0',
      'surface-3': '#e5e5e5',
      border: 'rgba(0,0,0,0.08)',
      text: '#171717',
      'text-2': '#525252',
      'text-3': '#a3a3a3',
      accent: '#0D9488',
      'accent-2': '#0F766E',
      'accent-soft': 'rgba(13,148,136,0.1)',
      green: '#16a34a',
      'green-soft': 'rgba(22,163,74,0.1)',
      'scrollbar-thumb': 'rgba(0,0,0,0.12)',
      'scrollbar-thumb-hover': 'rgba(0,0,0,0.2)',
    },
  },
  {
    id: 'github',
    name: 'GitHub Dark',
    description: "GitHub's official dark theme",
    isDark: true,
    colors: {
      bg: '#0d1117',
      'surface-1': '#161b22',
      'surface-2': '#21262d',
      'surface-3': '#30363d',
      border: 'rgba(48,54,61,0.8)',
      text: '#e6edf3',
      'text-2': '#8b949e',
      'text-3': '#6e7681',
      accent: '#58a6ff',
      'accent-2': '#1f6feb',
      'accent-soft': 'rgba(88,166,255,0.1)',
      green: '#3fb950',
      'green-soft': 'rgba(63,185,80,0.1)',
      'scrollbar-thumb': 'rgba(48,54,61,0.6)',
      'scrollbar-thumb-hover': 'rgba(72,79,88,0.8)',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    description: 'Classic Dracula color scheme',
    isDark: true,
    colors: {
      bg: '#282a36',
      'surface-1': '#21222c',
      'surface-2': '#343746',
      'surface-3': '#44475a',
      border: 'rgba(68,71,90,0.6)',
      text: '#f8f8f2',
      'text-2': '#bfbfbf',
      'text-3': '#6272a4',
      accent: '#bd93f9',
      'accent-2': '#caa9fa',
      'accent-soft': 'rgba(189,147,249,0.1)',
      green: '#50fa7b',
      'green-soft': 'rgba(80,250,123,0.1)',
      'scrollbar-thumb': 'rgba(68,71,90,0.6)',
      'scrollbar-thumb-hover': 'rgba(98,114,164,0.6)',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    description: 'Arctic, north-bluish theme',
    isDark: true,
    colors: {
      bg: '#2e3440',
      'surface-1': '#3b4252',
      'surface-2': '#434c5e',
      'surface-3': '#4c566a',
      border: 'rgba(76,86,106,0.5)',
      text: '#eceff4',
      'text-2': '#d8dee9',
      'text-3': '#a5b1c2',
      accent: '#88c0d0',
      'accent-2': '#8fbcbb',
      'accent-soft': 'rgba(136,192,208,0.1)',
      green: '#a3be8c',
      'green-soft': 'rgba(163,190,140,0.1)',
      'scrollbar-thumb': 'rgba(76,86,106,0.5)',
      'scrollbar-thumb-hover': 'rgba(94,103,121,0.6)',
    },
  },
  {
    id: 'tokyoNight',
    name: 'Tokyo Night',
    description: 'Tokyo city lights theme',
    isDark: true,
    colors: {
      bg: '#1a1b26',
      'surface-1': '#16161e',
      'surface-2': '#24283b',
      'surface-3': '#33467c',
      border: 'rgba(65,72,104,0.5)',
      text: '#c0caf5',
      'text-2': '#9aa5ce',
      'text-3': '#565f89',
      accent: '#7aa2f7',
      'accent-2': '#89b4fa',
      'accent-soft': 'rgba(122,162,247,0.1)',
      green: '#9ece6a',
      'green-soft': 'rgba(158,206,106,0.1)',
      'scrollbar-thumb': 'rgba(65,72,104,0.5)',
      'scrollbar-thumb-hover': 'rgba(86,95,137,0.6)',
    },
  },
  {
    id: 'monokai',
    name: 'Monokai Pro',
    description: 'Classic Monokai scheme',
    isDark: true,
    colors: {
      bg: '#2d2a2e',
      'surface-1': '#221f22',
      'surface-2': '#403e41',
      'surface-3': '#4a474b',
      border: 'rgba(91,89,92,0.5)',
      text: '#fcfcfa',
      'text-2': '#c1c0c0',
      'text-3': '#939293',
      accent: '#78dce8',
      'accent-2': '#9ce3ed',
      'accent-soft': 'rgba(120,220,232,0.1)',
      green: '#a9dc76',
      'green-soft': 'rgba(169,220,118,0.1)',
      'scrollbar-thumb': 'rgba(91,89,92,0.5)',
      'scrollbar-thumb-hover': 'rgba(114,112,114,0.6)',
    },
  },
  {
    id: 'solarizedDark',
    name: 'Solarized Dark',
    description: 'Solarized dark color scheme',
    isDark: true,
    colors: {
      bg: '#002b36',
      'surface-1': '#073642',
      'surface-2': '#0a4351',
      'surface-3': '#094352',
      border: 'rgba(88,110,117,0.4)',
      text: '#fdf6e3',
      'text-2': '#93a1a1',
      'text-3': '#657b83',
      accent: '#268bd2',
      'accent-2': '#2aa198',
      'accent-soft': 'rgba(38,139,210,0.1)',
      green: '#859900',
      'green-soft': 'rgba(133,153,0,0.1)',
      'scrollbar-thumb': 'rgba(88,110,117,0.4)',
      'scrollbar-thumb-hover': 'rgba(101,123,131,0.5)',
    },
  },
];

const THEME_STORAGE_KEY = 'gm_theme';

export const themeMap = new Map(themes.map((t) => [t.id, t]));

/** Display order for the theme picker (most popular first) */
export const themeOrder = [
  'dark', 'light', 'midnight', 'github', 'dracula',
  'nord', 'tokyoNight', 'monokai', 'solarizedDark',
];

export function applyTheme(themeId: string) {
  const theme = themeMap.get(themeId);
  if (!theme) return;

  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${key}`, value);
  }
}

export function loadSavedTheme(): string {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && themeMap.has(saved)) return saved;
  } catch {}
  return 'dark';
}

export function saveTheme(themeId: string) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, themeId);
  } catch {}
}
