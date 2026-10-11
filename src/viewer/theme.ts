import { useEffect, useState, useSyncExternalStore } from "react";
import { getPrefs, setPref, subscribePrefs } from "./prefs.js";

// light | dark | the OS's -> the .dark class the utilities target. Applied
// at module load from the cached preferences, so the first paint is right.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = (theme: "light" | "dark" | undefined, osDark: boolean) => theme === "dark" || (!theme && osDark);
const applyTheme = (dark: boolean) => document.documentElement.classList.toggle("dark", dark);
applyTheme(isDark(getPrefs().theme, darkQuery.matches));

/** The theme and its toggle. The choice is the user's, saved for every
 * review; until one is made the OS decides, and an OS change re-renders. */
export function useTheme(): { dark: boolean; toggle: () => void } {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs);
  const [osDark, setOsDark] = useState(darkQuery.matches);
  useEffect(() => {
    const onChange = (): void => setOsDark(darkQuery.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);
  const dark = isDark(prefs.theme, osDark);
  useEffect(() => {
    applyTheme(dark);
  }, [dark]);
  return { dark, toggle: () => setPref("theme", dark ? "light" : "dark") };
}
