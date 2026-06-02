// Forge-188 — Localisation framework.
//
// Lightweight i18n: a `t(key, params?)` lookup against the active locale,
// a default-to-en-US fallback, and window.__forgeT / __forgeSetLocale /
// __forgeGetLocale / __forgeListLocales APIs.
//
// Locale catalogues are bundled inline (no dynamic import) so the
// translations are available during the first paint.

const STORAGE_KEY = 'forge.v4.locale';

export const LOCALES = {
  'en-US': {
    name: 'English (US)',
    strings: {
      'app.title':           'Forge',
      'menu.file':           'File',
      'menu.edit':           'Edit',
      'menu.view':           'View',
      'menu.tools':          'Tools',
      'menu.help':           'Help',
      'btn.save':            'Save',
      'btn.cancel':          'Cancel',
      'btn.run':             'Run',
      'btn.restore':         'Restore',
      'btn.discard':         'Discard',
      'btn.next':            'Next',
      'btn.back':            'Back',
      'btn.skip':            'Skip',
      'btn.done':            'Done',
      'wb.aero':             'Aero',
      'wb.geotech':          'Geotech',
      'wb.casting':          'Cast',
      'wb.moldflow':         'MoldFlow',
      'wb.acoustics':        'Acoust',
      'wb.welddist':         'WeldFEA',
      'wb.cost':             'Cost',
      'wb.carbon':           'Carbon',
      'wb.sunpath':          'SunPath',
      'wb.tolerance':        'Stackup',
      'wb.duct':             'Ductwork',
      'status.idle':         'idle',
      'autosave.banner':     'Autosave from {min} min ago available ({bodies} bodies, {feats} features).',
    },
  },

  'de-DE': {
    name: 'Deutsch (Deutschland)',
    strings: {
      'app.title':           'Forge',
      'menu.file':           'Datei',
      'menu.edit':           'Bearbeiten',
      'menu.view':           'Ansicht',
      'menu.tools':          'Werkzeuge',
      'menu.help':           'Hilfe',
      'btn.save':            'Speichern',
      'btn.cancel':          'Abbrechen',
      'btn.run':             'Ausführen',
      'btn.restore':         'Wiederherstellen',
      'btn.discard':         'Verwerfen',
      'btn.next':            'Weiter',
      'btn.back':            'Zurück',
      'btn.skip':            'Überspringen',
      'btn.done':            'Fertig',
      'wb.aero':             'Aero',
      'wb.geotech':          'Geotech',
      'wb.casting':          'Guss',
      'wb.moldflow':         'Spritzguss',
      'wb.acoustics':        'Akustik',
      'wb.welddist':         'Schweiß',
      'wb.cost':             'Kosten',
      'wb.carbon':           'CO₂',
      'wb.sunpath':          'Sonnenbahn',
      'wb.tolerance':        'Tol.kette',
      'wb.duct':             'Lüftung',
      'status.idle':         'leerlauf',
      'autosave.banner':     'Automatische Sicherung von vor {min} min verfügbar ({bodies} Körper, {feats} Funktionen).',
    },
  },

  'fr-FR': {
    name: 'Français (France)',
    strings: {
      'app.title':           'Forge',
      'menu.file':           'Fichier',
      'menu.edit':           'Édition',
      'menu.view':           'Affichage',
      'menu.tools':          'Outils',
      'menu.help':           'Aide',
      'btn.save':            'Enregistrer',
      'btn.cancel':          'Annuler',
      'btn.run':             'Exécuter',
      'btn.restore':         'Restaurer',
      'btn.discard':         'Supprimer',
      'btn.next':            'Suivant',
      'btn.back':            'Précédent',
      'btn.skip':            'Passer',
      'btn.done':            'Terminé',
      'wb.aero':             'Aéro',
      'wb.geotech':          'Géotech',
      'wb.casting':          'Fonderie',
      'wb.moldflow':         'Injection',
      'wb.acoustics':        'Acoust.',
      'wb.welddist':         'Soudure',
      'wb.cost':             'Coût',
      'wb.carbon':           'CO₂',
      'wb.sunpath':          'Soleil',
      'wb.tolerance':        'Tolér.',
      'wb.duct':             'Gaines',
      'status.idle':         'inactif',
      'autosave.banner':     'Sauvegarde automatique d\'il y a {min} min disponible ({bodies} corps, {feats} fonctionnalités).',
    },
  },

  'es-ES': {
    name: 'Español (España)',
    strings: {
      'app.title':           'Forge',
      'menu.file':           'Archivo',
      'menu.edit':           'Editar',
      'menu.view':           'Ver',
      'menu.tools':          'Herramientas',
      'menu.help':           'Ayuda',
      'btn.save':            'Guardar',
      'btn.cancel':          'Cancelar',
      'btn.run':             'Ejecutar',
      'btn.restore':         'Restaurar',
      'btn.discard':         'Descartar',
      'btn.next':            'Siguiente',
      'btn.back':            'Atrás',
      'btn.skip':            'Omitir',
      'btn.done':            'Listo',
      'wb.aero':             'Aero',
      'wb.geotech':          'Geotec.',
      'wb.casting':          'Fundic.',
      'wb.moldflow':         'Molde',
      'wb.acoustics':        'Acúst.',
      'wb.welddist':         'Soldad.',
      'wb.cost':             'Coste',
      'wb.carbon':           'CO₂',
      'wb.sunpath':          'Solar',
      'wb.tolerance':        'Toler.',
      'wb.duct':             'Conductos',
      'status.idle':         'inactivo',
      'autosave.banner':     'Autoguardado de hace {min} min disponible ({bodies} cuerpos, {feats} funciones).',
    },
  },

  'ja-JP': {
    name: '日本語 (日本)',
    strings: {
      'app.title':           'Forge',
      'menu.file':           'ファイル',
      'menu.edit':           '編集',
      'menu.view':           '表示',
      'menu.tools':          'ツール',
      'menu.help':           'ヘルプ',
      'btn.save':            '保存',
      'btn.cancel':          'キャンセル',
      'btn.run':             '実行',
      'btn.restore':         '復元',
      'btn.discard':         '破棄',
      'btn.next':            '次へ',
      'btn.back':            '戻る',
      'btn.skip':            'スキップ',
      'btn.done':            '完了',
      'wb.aero':             '航空',
      'wb.geotech':          '地盤',
      'wb.casting':          '鋳造',
      'wb.moldflow':         '射出',
      'wb.acoustics':        '音響',
      'wb.welddist':         '溶接',
      'wb.cost':             'コスト',
      'wb.carbon':           '炭素',
      'wb.sunpath':          '日射',
      'wb.tolerance':        '公差',
      'wb.duct':             'ダクト',
      'status.idle':         'アイドル',
      'autosave.banner':     '{min} 分前の自動保存があります ({bodies} ボディ, {feats} 機能)。',
    },
  },
};

const DEFAULT_LOCALE = 'en-US';
const _listeners = new Set();
let _currentLocale = DEFAULT_LOCALE;

function readPersisted() {
  if (typeof window === 'undefined' || !window.localStorage) return DEFAULT_LOCALE;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return (v && LOCALES[v]) ? v : DEFAULT_LOCALE;
}

_currentLocale = readPersisted();

export function listLocales() {
  return Object.keys(LOCALES).map((id) => ({ id, name: LOCALES[id].name }));
}

export function getLocale() { return _currentLocale; }

export function setLocale(locale) {
  if (!LOCALES[locale]) return false;
  _currentLocale = locale;
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, locale);
  }
  for (const fn of _listeners) { try { fn(locale); } catch {} }
  return true;
}

export function onLocaleChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function t(key, params) {
  const lc = LOCALES[_currentLocale] || LOCALES[DEFAULT_LOCALE];
  const raw = (lc.strings[key] !== undefined)
    ? lc.strings[key]
    : (LOCALES[DEFAULT_LOCALE].strings[key] !== undefined
       ? LOCALES[DEFAULT_LOCALE].strings[key]
       : key);
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => params[k] != null ? String(params[k]) : `{${k}}`);
}

export function installWindowApis() {
  if (typeof window === 'undefined') return;
  window.__forgeT          = t;
  window.__forgeSetLocale  = setLocale;
  window.__forgeGetLocale  = getLocale;
  window.__forgeListLocales = listLocales;
  window.__forgeOnLocaleChange = onLocaleChange;
}

installWindowApis();
