// Light, dark or the device's choice ("system"), kept per browser. The
// dark colours are the `.dark` tokens in globals.css.
export type ThemePref = "light" | "dark" | "system";
const KEY = "talimcrm-theme";

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(pref: ThemePref = getThemePref()) {
  if (typeof document === "undefined") return;
  const dark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  applyTheme(pref);
}

/** Run before the page paints (layout.tsx), so a dark page never flashes light. */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${KEY}");var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";}}catch(e){}})();`;
