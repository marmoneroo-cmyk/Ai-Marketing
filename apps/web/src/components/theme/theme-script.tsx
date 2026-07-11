/**
 * No-flash theme bootstrap. Rendered in <head> so it runs before first paint:
 * it reads the persisted choice (localStorage) or the OS preference and applies
 * the matching `.dark`/`.light` class to <html>, preventing a light→dark flash.
 *
 * Kept as a stringified IIFE injected via dangerouslySetInnerHTML because it
 * must execute synchronously before the body renders.
 */
export const THEME_STORAGE_KEY = "brandpilot-theme";

const SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var c=localStorage.getItem(k);var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var d=document.documentElement;if(c==='dark'||((c===null||c==='system')&&m)){d.classList.add('dark');d.classList.remove('light');}else{d.classList.add('light');d.classList.remove('dark');}}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
