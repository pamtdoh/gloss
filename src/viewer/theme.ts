import { useEffect, useState } from "react";

// light | dark | system -> the .dark class the utilities target. Applied
// once at module load so the first paint is already right.
export type ThemeMode = "light" | "dark" | "system";
const THEME_KEY = "rk-theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function storedTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
}

const initial = storedTheme();
applyTheme(initial === "dark" || (initial === "system" && darkQuery.matches));

/** The theme and its toggle; an OS scheme change re-renders so the icon
 * tracks the effective theme. */
export function useTheme(): { dark: boolean; toggle: () => void } {
  const [theme, setTheme] = useState<ThemeMode>(storedTheme);
  const [sysDark, setSysDark] = useState(darkQuery.matches);
  useEffect(() => {
    const onChange = (): void => setSysDark(darkQuery.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);
  const dark = theme === "dark" || (theme === "system" && sysDark);
  useEffect(() => {
    if (theme === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
    applyTheme(dark);
  }, [theme, dark]);
  return { dark, toggle: () => setTheme(dark ? "light" : "dark") };
}
