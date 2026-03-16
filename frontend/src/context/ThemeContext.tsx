import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { applyTheme, loadSavedTheme, saveTheme } from '../config/themes';

interface ThemeContextValue {
  themeId: string;
  setTheme: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: 'dark',
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState(() => {
    const saved = loadSavedTheme();
    applyTheme(saved);
    return saved;
  });

  // Apply theme on mount (covers SSR hydration edge case)
  useEffect(() => {
    applyTheme(themeId);
  }, []);

  const setTheme = useCallback((id: string) => {
    setThemeId(id);
    applyTheme(id);
    saveTheme(id);
  }, []);

  return (
    <ThemeContext.Provider value={{ themeId, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
