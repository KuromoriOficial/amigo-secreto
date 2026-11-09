"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DARK_MEDIA, parseTheme, THEME_KEY, type Theme } from "./theme-preference";

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const preference = useRef<Theme | null>(null);

  useEffect(() => {
    const system = window.matchMedia(DARK_MEDIA);
    try {
      preference.current = parseTheme(localStorage.getItem(THEME_KEY));
    } catch {
      // Theme changes can still apply in this tab when storage is unavailable.
    }

    function syncTheme() {
      const theme = preference.current ?? (system.matches ? "dark" : "light");
      document.documentElement.dataset.theme = theme;
      setDark(theme === "dark");
    }

    function onStorage(event: StorageEvent) {
      if (event.storageArea !== localStorage || (event.key !== THEME_KEY && event.key !== null)) return;
      preference.current = parseTheme(event.newValue);
      syncTheme();
    }

    syncTheme();
    system.addEventListener("change", syncTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      system.removeEventListener("change", syncTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  function toggleTheme() {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    preference.current = theme;
    document.documentElement.dataset.theme = theme;
    setDark(theme === "dark");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // The theme is already applied to the document.
    }
  }

  return (
    <button className="as-theme-toggle" type="button" aria-label="Tema escuro" aria-pressed={dark} title={dark ? "Ativar tema claro" : "Ativar tema escuro"} onClick={toggleTheme}>
      <Moon className="as-theme-moon" size={17} strokeWidth={1.8} aria-hidden="true" />
      <Sun className="as-theme-sun" size={18} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}
