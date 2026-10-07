// English / French. Strings are written in English in the code; FR maps each one to French.
import { FR } from './fr.js';

let lang = 'en';
try {
  const saved = localStorage.getItem('yl.lang');
  lang = saved === 'fr' || saved === 'en' ? saved : (navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
} catch { lang = (navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en'; }

export const getLang = () => lang;
export const loc = () => (lang === 'fr' ? 'fr-CA' : 'en-CA');
export function setLang(l) {
  lang = l === 'fr' ? 'fr' : 'en';
  try { localStorage.setItem('yl.lang', lang); } catch {}
  document.documentElement.lang = loc();
}
document.documentElement.lang = loc();

/** Translate an English template; {name} placeholders are filled from vars. */
export function t(s, vars) {
  let out = lang === 'fr' && FR[s] != null ? FR[s] : s;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  return out;
}
/** Plural helper: t1 for one, tn for many. */
export const tp = (n, one, many, vars = {}) => t(n === 1 ? one : many, { n, ...vars });

export const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juill.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
};
export const MONTHS_LONG = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
};
