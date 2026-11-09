export type Theme = "light" | "dark";

export const THEME_KEY = "amigo-secreto-theme";
export const DARK_MEDIA = "(prefers-color-scheme: dark)";

export function parseTheme(value: string | null): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export const themeBootstrap = `(()=>{let theme;try{theme=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch{}document.documentElement.dataset.theme=theme==="dark"||theme==="light"?theme:matchMedia(${JSON.stringify(DARK_MEDIA)}).matches?"dark":"light"})()`;
