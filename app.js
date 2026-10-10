/*
 * 單字卡 — UI layer (screens, routing, dialogs, persistence).
 * Uses only the window.VC API from core.js and optionally window.VC_SAMPLE from sample.js.
 * All user text is rendered with textContent / DOM nodes (never innerHTML with user data).
 *
 * ---------------------------------------------------------------------------------------
 * Test hooks (stable selectors for E2E tests)
 * ---------------------------------------------------------------------------------------
 * window.VCApp = { getState(), setState(obj), save(), reload(), render(), setClock(fn), importText(text, opts),
 *                  setPlatform(obj), setRandom(fn) }
 *   getState()          deep copy of the persisted state object
 *   setState(obj)       replace the whole state (normalised), save immediately, re-render
 *   save()              flush pending save to localStorage now (returns true on success)
 *   reload()            re-read state from localStorage and re-render
 *   render()            re-render the current route
 *   setClock(fn)        fn() -> ms; replaces Date.now for all app logic (pass null to reset)
 *   importText(text, opts) -> { added, updated, skipped, errors, deckIds, failed? }
 *       opts: { deckName?: string, deckId?: string, dupMode?: 'skip' | 'update', fileName?: string }
 *       Cards outside #deck sections go to deckId (existing deck) or the deck named deckName
 *       (existing deck with that name — case/space-insensitive — else a new one; default 「我的單字」).
 *       fileName ending in .csv parses the text as CSV. failed: true = storage full, nothing imported.
 *   setPlatform(obj)    override platform detection, e.g. { ios: true, standalone: false } (tests,
 *                       screenshots); pass null to go back to the real values. Re-renders.
 *   setRandom(fn)       fn() -> number in [0, 1); replaces Math.random for picking quiz questions and
 *                       answer order and for the flashcard shuffle seed (pass null to reset)
 *
 * Routes: #/  #/deck/<deckId>  #/deck/<deckId>/words  #/cards/<deckId>  #/quiz/<deckId>/choice
 *         #/quiz/<deckId>/spell  #/import  #/settings          (v1 links #/study/<deckId> open the deck)
 * Root screen element: <main class="screen" data-screen="home|deck|browse|cards|quiz|import|settings">
 *
 * data-action (all are <button>s unless noted):
 *   Home      open-settings, open-import (bottom primary), deck-open (data-deck-id; second line
 *             .deck-total 「共 N 字」 and .deck-scores 「選擇 8/10 · 拼字 6/10」 once a quiz was finished),
 *             deck-menu (⋯, data-deck-id), new-deck, empty-import-file, empty-paste, load-sample,
 *             empty-claude, empty-restore; iPhone Safari hint on the empty state: .empty-ios
 *             notice card #home-notice[data-notice="corrupt|newer|corrupt-copy|ios|backup"]:
 *               notice-backup (export now), notice-dismiss, download-raw, reset-corrupt, reload-app,
 *               delete-corrupt-copy
 *   Deck menu sheet-browse, sheet-settings, sheet-export, sheet-delete
 *   Deck hub  back, deck-settings, word count #hub-count 「共 N 字」;
 *             tiles hub-cards, hub-choice, hub-spell (.tile; .tile-meta on the right: 「看到第 12 張」,
 *             「上次 8/10」, 「可出 32 題」; a tile that cannot make any question is disabled and says why
 *             in .tile-desc); questions per quiz quiz-count-10, quiz-count-20, quiz-count-all (aria-pressed;
 *             only the counts that fit the deck are offered; a deck of 10 words or fewer shows the text
 *             #quiz-count-fixed 「全部 (8)」 instead); hub-words (瀏覽與編輯單字);
 *             empty deck (#hub-empty): import-to-deck, add-card
 *   Cards     back, shuffle (aria-pressed), edit-card, card (the tappable flashcard #flash-card
 *             [data-card-id], .flipped while its back shows), speak, prev, flip, next;
 *             progress text #flash-progress 「12 / 40」; swipe left/right on the card = next/prev;
 *             end view #flash-end: flash-restart, flash-to-choice, flash-to-spell, flash-home
 *   Quiz      quiz-quit (✕), counter #quiz-count 「3 / 10」, speak; feedback #quiz-feedback (.ok / .bad);
 *             quiz-next (下一題, 「看結果」 on the last question); the question (.quiz-prompt for choice,
 *             .quiz-card for spell) has data-card-id of the card it asks
 *             choice: options option-0 .. option-3 (.opt; once answered the right one has .correct, a
 *               wrong pick .wrong, the tapped one .chosen); the example then shows in .quiz-explain
 *             spell: sentence .cloze with the hidden word .cloze-mask (its text is the mask, e.g.
 *               a_______d; after answering a <mark> with the word), hint .quiz-hint, input #spell-input,
 *               spell-submit, spell-giveup (不會，看答案)
 *             results #quiz-results: #quiz-score 「8 / 10」, wrong words .wrong-list (rows .wl-row
 *               [data-card-id]), retry-wrong (only when something was wrong), quiz-again, quiz-home;
 *             no question possible: #quiz-empty with quiz-home
 *   Browse    back, deck-settings, add-card, card-row (data-card-id; pill .p-wrong 「錯 N」 when the word
 *             was answered wrong in a quiz), show-more, search input #browse-search, clear-search;
 *             empty deck: .list-empty with import-to-deck
 *   Card sheet inputs #f-word #f-phonetic #f-meaning #f-example #f-exampleZh #f-note;
 *             quiz record .sheet-meta 「測驗：答對 x・答錯 y」 (when there is one);
 *             card-save, card-save-next (new cards only), card-delete
 *   Deck settings sheet input #ds-name; 字卡正面 dir-en2zh (英文) / dir-zh2en (中文),
 *             ds-save, ds-export, ds-delete
 *   Import    back, file input #file-input (inside the dropzone label), remove-file (data-file-id),
 *             textarea #import-text, select #import-target ('new' or a deck id),
 *             deck-name inputs .import-deck-name (data-source-id), dup-skip, dup-update (only when
 *             some words are already in the deck), summary #import-summary (zero counts left out),
 *             import-confirm, copy-claude-rules (.claude-cta), copy-example (in details.help),
 *             show-format-help (shown when nothing can be imported); hints .import-note
 *   Settings  back, theme-auto, theme-light, theme-dark, #pref-autospeak (checkbox),
 *             #pref-rate (range), #pref-voice (select), voice-test, export-backup
 *             (sub-label #last-backup), restore-backup, clear-all
 *   Dialogs   modal-ok, modal-cancel, #modal-input; sheet-close; toasts in #toasts (.toast)
 *   Sheets/modals are appended to <body> as <div class="overlay" data-overlay="sheet|modal">.
 */
(function () {
  'use strict';

  var VC = window.VC;
  var APP_VERSION = '2.0'; // must equal VC.version in core.js

  /* =====================================================================================
   * Small utilities
   * ===================================================================================== */

  var clockFn = null;
  function now() { return clockFn ? clockFn() : Date.now(); }

  var randomFn = null; // VCApp.setRandom (tests)
  /** Random number in [0, 1) for quiz questions, answer order and the flashcard shuffle. */
  function rand() {
    var r = randomFn ? +randomFn() : Math.random();
    return r >= 0 && r < 1 ? r : 0;
  }

  function perfNow() { return (window.performance && performance.now()) || Date.now(); }

  /** Minimal DOM builder. h('div', {class:'x', onclick: fn, 'data-action':'go'}, 'text', child) */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'hidden') el[k] = !!v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  var ICONS = {
    back: '<path d="M15 18l-6-6 6-6"/>',
    chevron: '<path d="M9 18l6-6-6-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    speaker: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    upload: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6M9 15l3-3 3 3"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    restore: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    cards: '<rect x="3" y="7" width="13" height="14" rx="2.5"/><path d="M8 3.5h10.5A2.5 2.5 0 0 1 21 6v11"/>',
    choice: '<path d="M11 6h10M11 12h10M11 18h10"/><path d="M3 6l1.6 1.6L7.5 4.7"/><circle cx="5" cy="12.2" r="1.9"/><circle cx="5" cy="18.2" r="1.9"/>',
    spell: '<rect x="2" y="6" width="20" height="13" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 15h10"/>',
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'
  };

  /** Static SVG icon (markup is a fixed string from ICONS — never user data). */
  function icon(name, cls) {
    var wrap = document.createElement('span');
    wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>';
    if (cls) wrap.firstChild.setAttribute('class', cls);
    return wrap.firstChild;
  }

  function iconBtn(name, label, action, onclick, extraClass) {
    return h('button', {
      type: 'button', class: 'icon-btn' + (extraClass ? ' ' + extraClass : ''),
      'aria-label': label, title: label, 'data-action': action, onclick: onclick
    }, icon(name));
  }

  function uid() {
    var rnd = '';
    try {
      var a = new Uint32Array(2);
      window.crypto.getRandomValues(a);
      rnd = a[0].toString(36) + a[1].toString(36);
    } catch (e) {
      rnd = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    }
    return Date.now().toString(36) + rnd.slice(0, 8);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function clampInt(v, lo, hi, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function safeFileName(name) {
    var s = str(name).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim();
    return (s || '單字卡').slice(0, 80);
  }

  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var platformOverride = null; // VCApp.setPlatform (tests / screenshots)

  function onIOS() { return platformOverride && 'ios' in platformOverride ? !!platformOverride.ios : isIOS; }

  /** Opened from the home screen icon (not inside a browser tab)? */
  function isStandalone() {
    if (platformOverride && 'standalone' in platformOverride) return !!platformOverride.standalone;
    try {
      return navigator.standalone === true ||
        !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    } catch (e) { return false; }
  }

  /* =====================================================================================
   * State & persistence
   * ===================================================================================== */

  var STORAGE_KEY = (function () {
    try {
      var sk = new URLSearchParams(location.search).get('sk');
      if (sk) return sk;
    } catch (e) { /* old browsers: fall through */ }
    return 'vocabcards.v1';
  })();

  var SCHEMA_VERSION = 2; // state.version this app writes; version 1 (v1.x, spaced repetition) is migrated
  var DEFAULT_PREFS = {
    theme: 'auto', autoSpeak: false, speechRate: 0.9, voiceURI: null,
    quizCount: 10,           // questions per quiz: 10 | 20 | 0 (= all)
    lastBackupAt: null,      // ms of the last successful 「匯出備份」
    backupNagAt: null,       // ms of the last 「之後再說」 on the backup reminder
    iosTipDismissed: false   // the one-time iPhone Safari notice on home
  };
  var QUIZ_COUNTS = [10, 20, 0];
  var QUIZ_MODES = ['choice', 'spell'];
  var QUIZ_TITLES = { choice: '選擇題', spell: '拼字題' };
  var QUIZ_SHORT = { choice: '選擇', spell: '拼字' };
  var CARD_TEXT_FIELDS = ['word', 'phonetic', 'meaning', 'example', 'exampleZh', 'note'];
  var DAY_MS = 86400000;
  var BACKUP_REMIND_DAYS = 14;
  var BACKUP_REMIND_CARDS = 50;
  var AUTO_NEXT_MS = 900; // a right answer moves on by itself after this long

  var state = freshState();
  var saveTimer = null;
  var lastSavedJSON = null;
  var persistAsked = false;
  // Set when saving must not overwrite what is stored: 'corrupt' (unreadable data that could not
  // be copied aside) or 'newer' (data written by a newer version of the app).
  var saveBlocked = null;
  var blockedRaw = null;
  var lastSaveError = null; // 'full' | 'denied' | 'blocked' after a failed flushSave()
  var blockedToastAt = 0;

  function freshState() {
    return { version: SCHEMA_VERSION, decks: [], cards: [], seq: 0, prefs: clone(DEFAULT_PREFS) };
  }

  function defaultSettings() {
    var d = VC && VC.DEFAULT_DECK_SETTINGS;
    return { direction: d && d.direction === 'zh2en' ? 'zh2en' : 'en2zh' };
  }

  /** Flashcard position of a deck: index into the (possibly shuffled) order. */
  function freshFlash() { return { index: 0, shuffle: false, seed: 0 }; }

  /** deck.lastQuiz: { choice?: { score, total, at }, spell?: … } — the last finished quiz of each kind. */
  function normalizeLastQuiz(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    QUIZ_MODES.forEach(function (m) {
      var r = raw[m];
      var total = r && typeof r === 'object' ? clampInt(r.total, 0, 1e6, 0) : 0;
      if (total) out[m] = { score: clampInt(r.score, 0, total, 0), total: total, at: +r.at || 0 };
    });
    return out;
  }

  /**
   * Make any loaded / restored object safe to use: fill defaults, drop garbage. Version 1 data
   * (spaced repetition) is migrated here: the schedule fields of every card, the day statistics
   * and the daily limits go; every word, deck and preference stays.
   */
  function normalizeState(raw) {
    var s = freshState();
    if (!raw || typeof raw !== 'object') return s;
    var deckIds = {};
    (Array.isArray(raw.decks) ? raw.decks : []).forEach(function (d) {
      if (!d || typeof d !== 'object' || !d.id || deckIds[d.id]) return;
      deckIds[d.id] = true;
      var set = d.settings && typeof d.settings === 'object' ? d.settings : {};
      var fl = d.flash && typeof d.flash === 'object' ? d.flash : {};
      s.decks.push({
        id: String(d.id), name: str(d.name).trim() || '未命名牌組', created: +d.created || now(),
        settings: { direction: set.direction === 'zh2en' ? 'zh2en' : 'en2zh' },
        flash: { index: clampInt(fl.index, 0, 1e7, 0), shuffle: !!fl.shuffle, seed: (+fl.seed || 0) >>> 0 },
        lastQuiz: normalizeLastQuiz(d.lastQuiz)
      });
    });
    var maxSeq = 0;
    var cardIds = {};
    (Array.isArray(raw.cards) ? raw.cards : []).forEach(function (c) {
      if (!c || typeof c !== 'object' || !c.id || !deckIds[c.deckId] || cardIds[c.id]) return;
      cardIds[c.id] = true;
      // deck ids are strings; a numeric deckId would never match
      var card = { id: String(c.id), deckId: String(c.deckId) };
      CARD_TEXT_FIELDS.forEach(function (f) { card[f] = str(c[f]); });
      card.created = +c.created || 0;
      card.seq = typeof c.seq === 'number' && isFinite(c.seq) ? c.seq : ++maxSeq;
      if (card.seq > maxSeq) maxSeq = card.seq;
      card.right = clampInt(c.right, 0, 1e9, 0); // quiz answers (both kinds)
      card.wrong = clampInt(c.wrong, 0, 1e9, 0);
      s.cards.push(card);
    });
    s.seq = Math.max(+raw.seq || 0, maxSeq);
    s.prefs = Object.assign(clone(DEFAULT_PREFS), raw.prefs && typeof raw.prefs === 'object' ? raw.prefs : {});
    delete s.prefs.rateHints; // v1: how often the rating buttons were explained
    if (['auto', 'light', 'dark'].indexOf(s.prefs.theme) < 0) s.prefs.theme = 'auto';
    s.prefs.speechRate = Math.max(0.5, Math.min(1.5, +s.prefs.speechRate || 0.9));
    s.prefs.autoSpeak = !!s.prefs.autoSpeak;
    s.prefs.quizCount = QUIZ_COUNTS.indexOf(+s.prefs.quizCount) >= 0 ? +s.prefs.quizCount : DEFAULT_PREFS.quizCount;
    s.prefs.lastBackupAt = +s.prefs.lastBackupAt || null;
    s.prefs.backupNagAt = +s.prefs.backupNagAt || null;
    s.prefs.iosTipDismissed = !!s.prefs.iosTipDismissed;
    return s;
  }

  function parseStored(raw) {
    try {
      var obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    } catch (e) { return null; }
  }

  /** Data written by a newer version of the app (an old cached copy must not rewrite it). */
  function isNewerSchema(obj) { return !!obj && +obj.version > SCHEMA_VERSION; }

  function loadState() {
    saveBlocked = null;
    blockedRaw = null;
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) { state = freshState(); lastSavedJSON = null; return; }
    var obj = parseStored(raw);
    if (obj && isNewerSchema(obj)) {
      state = normalizeState(obj); // shown read-only; nothing is saved over it
      lastSavedJSON = raw;
      saveBlocked = 'newer';
      setTimeout(function () { toast(BLOCKED_TEXT.newer, 'error', 6000); }, 300);
      return;
    }
    if (obj) {
      state = normalizeState(obj);
      lastSavedJSON = raw;
      if (!(+obj.version >= SCHEMA_VERSION)) scheduleSave(); // store the migrated version-1 data
      return;
    }
    // Unreadable data: copy it aside before starting over. If even the copy does not fit,
    // never overwrite the original — saving stays off until the user decides (home notice).
    var copied = false;
    try { localStorage.setItem(STORAGE_KEY + '.corrupt-' + Date.now(), raw); copied = true; } catch (e2) { copied = false; }
    state = freshState();
    if (copied) {
      lastSavedJSON = null;
      setTimeout(function () { toast('資料讀取失敗，已重新開始（舊資料已另外保存，請看首頁的說明）。', 'error', 5000); }, 300);
    } else {
      lastSavedJSON = raw;
      saveBlocked = 'corrupt';
      blockedRaw = raw;
      setTimeout(function () { toast(BLOCKED_TEXT.corrupt, 'error', 6000); }, 300);
    }
  }

  var BLOCKED_TEXT = {
    corrupt: '資料讀取失敗，為了不覆蓋舊資料，目前不會儲存任何變更（請看首頁的說明）。',
    newer: '這份資料是用較新版本的單字卡存的，請重新整理頁面更新 App；在那之前不會儲存任何變更。'
  };

  function scheduleSave() {
    // A save already on its way takes this change along: a steady stream of answers must not
    // keep postponing it. Big collections: one save re-writes megabytes, so batch a few
    // answers together (pagehide / visibilitychange still flush right away).
    if (saveTimer) return;
    saveTimer = setTimeout(flushSave, lastSavedJSON && lastSavedJSON.length > 500000 ? 2000 : 300);
  }

  /**
   * Write the state now. Returns success.
   *   opts.quiet:   no error toast (the caller reports it)
   *   opts.replace: overwrite whatever is stored (restore, clear all); otherwise a save made by
   *                 another tab since our last one is merged in first.
   */
  function flushSave(opts) {
    var quiet = !!(opts && opts.quiet);
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!saveBlocked && !(opts && opts.replace)) {
      var stored = readStored(STORAGE_KEY);
      if (stored && stored !== lastSavedJSON) {
        adoptStored(stored); // another tab saved and its storage event has not arrived yet
        setTimeout(refreshForOtherTab, 0); // show its changes too
      }
    }
    if (saveBlocked) {
      lastSaveError = 'blocked';
      if (!quiet && now() - blockedToastAt > 8000) {
        blockedToastAt = now();
        toast(BLOCKED_TEXT[saveBlocked], 'error', 6000);
      }
      return false;
    }
    var json = JSON.stringify(state);
    if (json === lastSavedJSON) return true;
    try {
      localStorage.setItem(STORAGE_KEY, json);
      lastSavedJSON = json;
      lastSaveError = null;
      askPersist();
      return true;
    } catch (e) {
      var full = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);
      lastSaveError = full ? 'full' : 'denied';
      if (!quiet) {
        toast(full ? '儲存空間已滿，無法儲存！請先「匯出備份」，再刪除用不到的牌組。'
                   : '無法儲存資料（瀏覽器可能禁止了本機儲存）。', 'error', 6000);
      }
      return false;
    }
  }

  /** Unreadable data copied aside by loadState (oldest first). */
  function corruptCopies() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(STORAGE_KEY + '.corrupt-') === 0) keys.push(k);
      }
    } catch (e) { /* storage unavailable */ }
    return keys.sort();
  }

  function readStored(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  /**
   * Another tab (or the installed app) saved raw: take its data, and re-apply on top of it what
   * this tab changed since its own last save. Returns true when such changes were merged in
   * (they still have to be saved).
   */
  function adoptStored(raw) {
    var obj = raw ? parseStored(raw) : null;
    if (raw && !obj) return false;
    if (obj && isNewerSchema(obj)) { saveBlocked = 'newer'; lastSavedJSON = raw; return false; }
    var incoming = obj ? normalizeState(obj) : freshState();
    var unsaved = JSON.stringify(state) !== lastSavedJSON;
    if (unsaved) {
      var base = lastSavedJSON && parseStored(lastSavedJSON);
      state = mergeStates(base ? normalizeState(base) : freshState(), state, incoming);
    } else {
      state = incoming;
    }
    lastSavedJSON = raw;
    if (saveBlocked === 'corrupt') { saveBlocked = null; blockedRaw = null; } // the unreadable data is gone
    return unsaved;
  }

  /**
   * Three-way merge of two tabs' data: base = what this tab saved last, mine = this tab now,
   * theirs = what the other tab saved since. Cards, decks and settings changed (or added or
   * deleted) only here keep this tab's version. A card changed in both keeps the text edited
   * here (else theirs) and the quiz answers of both tabs add up; a deck changed in both keeps
   * this tab's version plus the latest quiz result of each kind.
   */
  function mergeStates(base, mine, theirs) {
    var same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    var byId = function (list) {
      var o = Object.create(null);
      list.forEach(function (x) { o[x.id] = x; });
      return o;
    };
    var mergeList = function (b, m, t, pickBoth) {
      var B = byId(b), M = byId(m), T = byId(t);
      var out = [];
      t.forEach(function (x) {
        var mx = M[x.id], bx = B[x.id];
        if (!mx) { if (!bx) out.push(x); }            // added there (deleted here: dropped)
        else if (bx && same(mx, bx)) out.push(x);     // not changed here
        else if (bx && same(x, bx)) out.push(mx);     // changed only here
        else out.push(bx ? pickBoth(mx, x, bx) : mx); // changed in both
      });
      m.forEach(function (x) { if (!T[x.id] && !B[x.id]) out.push(x); }); // added here
      return out;
    };
    var merged = theirs;
    merged.decks = mergeList(base.decks, mine.decks, theirs.decks, function (m, t) {
      var d = clone(m);
      QUIZ_MODES.forEach(function (k) {
        var tq = t.lastQuiz[k];
        if (tq && (!d.lastQuiz[k] || tq.at > d.lastQuiz[k].at)) d.lastQuiz[k] = tq;
      });
      return d;
    });
    merged.cards = mergeList(base.cards, mine.cards, theirs.cards, function (m, t, b) {
      var c = Object.assign({}, t);
      CARD_TEXT_FIELDS.forEach(function (f) { if (m[f] !== b[f]) c[f] = m[f]; });
      ['right', 'wrong'].forEach(function (k) { c[k] = Math.max(0, t[k] + m[k] - b[k]); });
      return c;
    });
    Object.keys(mine.prefs).forEach(function (k) {
      if (!same(mine.prefs[k], base.prefs[k])) merged.prefs[k] = mine.prefs[k];
    });
    merged.seq = Math.max(+mine.seq || 0, +theirs.seq || 0);
    return normalizeState(merged); // also drops cards of decks that are gone
  }

  /** Message for an import / restore that was rolled back because it could not be saved. */
  function notSavedText(what) {
    if (lastSaveError === 'blocked') return BLOCKED_TEXT[saveBlocked] || '目前無法儲存。';
    if (lastSaveError === 'full') return '單字太多，超過這個瀏覽器能儲存的空間，沒有' + what + '。可以先刪除用不到的牌組再試一次。';
    return '無法儲存資料（瀏覽器可能禁止了本機儲存），沒有' + what + '。';
  }

  /** Run fn (which changes the state); if the result cannot be saved, put everything back. */
  function transaction(fn) {
    var snap = { decks: state.decks.slice(), cards: state.cards.slice(), seq: state.seq };
    var changed = fn();
    if (!changed || flushSave({ quiet: true })) return true;
    state.decks = snap.decks;
    state.cards = snap.cards;
    state.seq = snap.seq;
    if (JSON.stringify(state) !== lastSavedJSON) scheduleSave(); // earlier unsaved changes stay pending
    return false;
  }

  function askPersist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    } catch (e) { /* ignore */ }
  }

  /* ---------- State helpers ---------- */

  function deckById(id) {
    for (var i = 0; i < state.decks.length; i++) if (state.decks[i].id === id) return state.decks[i];
    return null;
  }

  function deckByName(name) {
    var n = str(name).trim();
    for (var i = 0; i < state.decks.length; i++) if (state.decks[i].name === n) return state.decks[i];
    return null;
  }

  /** Deck names that only differ in case, width or spaces ("我的 牌組" / "我的牌組") are the same deck. */
  function deckKey(name) {
    var s = str(name);
    if (s.normalize) s = s.normalize('NFKC');
    return s.toLowerCase().replace(/\s+/g, '');
  }

  function deckByLooseName(name) {
    var exact = deckByName(name);
    if (exact) return exact;
    var k = deckKey(name);
    for (var i = 0; i < state.decks.length; i++) if (deckKey(state.decks[i].name) === k) return state.decks[i];
    return null;
  }

  function cardById(id) {
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].id === id) return state.cards[i];
    return null;
  }

  function replaceCard(card) {
    for (var i = 0; i < state.cards.length; i++) {
      if (state.cards[i].id === card.id) { state.cards[i] = card; return; }
    }
  }

  function cardsOfDeck(deckId) {
    return state.cards.filter(function (c) { return c.deckId === deckId; })
      .sort(function (a, b) { return a.seq - b.seq; });
  }

  /** Number of cards per deck id. */
  function cardCounts() {
    var n = Object.create(null);
    state.cards.forEach(function (c) { n[c.deckId] = (n[c.deckId] || 0) + 1; });
    return n;
  }

  function createDeck(name) {
    var deck = {
      id: uid(), name: str(name).trim() || '我的單字', created: now(),
      settings: defaultSettings(), flash: freshFlash(), lastQuiz: {}
    };
    state.decks.push(deck);
    return deck;
  }

  function deleteDeck(deckId) {
    state.decks = state.decks.filter(function (d) { return d.id !== deckId; });
    state.cards = state.cards.filter(function (c) { return c.deckId !== deckId; });
  }

  function cardFields(src) {
    var f = {};
    CARD_TEXT_FIELDS.forEach(function (k) { f[k] = str(src && src[k]).trim(); });
    return f;
  }

  function addCard(deckId, fields) {
    state.seq = (state.seq || 0) + 1;
    var card = VC.newCard(cardFields(fields), deckId, now(), uid(), state.seq);
    state.cards.push(card);
    return card;
  }

  /* =====================================================================================
   * Theme
   * ===================================================================================== */

  function applyTheme() {
    var t = state.prefs.theme;
    var root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t);
    else root.removeAttribute('data-theme');
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var media = metas[i].getAttribute('media') || '';
      var isDarkMeta = media.indexOf('dark') >= 0;
      var color = t === 'auto' ? (isDarkMeta ? '#141416' : '#FAFAF9') : (t === 'dark' ? '#141416' : '#FAFAF9');
      metas[i].setAttribute('content', color);
    }
  }

  /* =====================================================================================
   * History: routes and overlays share one model, so the Android back button closes the
   * top sheet/dialog first and then goes to the previous screen.
   *
   * Every history entry the app creates carries state { vc: 1, idx, h, ov }:
   *   idx  position among the app's own entries (0 = the entry the app was opened on).
   *        New entries are only ever made with history.pushState (exactly +1), so idx > 0
   *        guarantees the previous entry is ours too: history.back() can never leave the app.
   *        (Assigning location.hash is NOT used: browsers may turn that into a replace.)
   *   h    the route hash of the entry;  ov: true for an entry pushed for an open overlay.
   * Traversals are serialised (one history.go() in flight at a time); popstate reports
   * where we actually landed. Going back to a screen is goal-driven (nav.goal): if we land
   * short (e.g. entries made by the address bar), we keep stepping back until we arrive.
   * ===================================================================================== */

  var nav = { idx: 0, base: 0, busy: false, broken: false, timer: null, waiters: [], goal: null };
  var routes = [];            // routes[idx] = hash of entries created or visited by this page
  var currentHash = '#/';
  var overlays = [];
  var reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function entryState(idx, hash, ov) { return { vc: 1, idx: idx, h: hash, ov: !!ov }; }

  function initHistory() {
    var st = history.state;
    currentHash = normHash(location.hash);
    nav.idx = st && st.vc && typeof st.idx === 'number' && st.idx >= 0 ? st.idx : 0;
    nav.base = nav.idx;
    routes[nav.idx] = currentHash;
    try { history.replaceState(entryState(nav.idx, currentHash, false), ''); } catch (e) { nav.broken = true; }
  }

  /** Go back/forward by delta entries (callers make sure nothing else is in flight). */
  function traverse(delta) {
    if (!delta) return;
    nav.busy = true;
    clearTimeout(nav.timer);
    nav.timer = setTimeout(onTraverseTimeout, 1500);
    history.go(delta);
  }

  function onTraverseTimeout() {
    // No popstate arrived (some embedded browsers): stop using history for overlays.
    nav.busy = false;
    nav.goal = null;
    var st = history.state;
    if (st && st.vc) nav.idx = st.idx; else nav.broken = true;
    if (nav.idx > nav.base) nav.broken = true;
    settleNav();
  }

  function flushNavWaiters() {
    var w = nav.waiters;
    nav.waiters = [];
    w.forEach(function (f) { f(); });
  }

  /** Make history match the open overlays: pop entries of closed ones, push for new ones. */
  function settleNav() {
    if (nav.busy) return;
    if (!nav.broken) {
      var want = nav.base;
      overlays.forEach(function (o) { if (o.pushed && o.idx > want) want = o.idx; });
      if (nav.idx > want) { traverse(want - nav.idx); return; }
      overlays.forEach(function (o) {
        if (o.closed || o.pushed) return;
        try {
          history.pushState(entryState(nav.idx + 1, currentHash, true), '');
          nav.idx++;
          o.pushed = true;
          o.idx = nav.idx;
        } catch (e) { /* the overlay still works, only without the back button */ }
      });
    }
    flushNavWaiters();
  }

  /** Resolves once history has caught up with the overlays (no traversal in flight). */
  function whenNavSettled() {
    if (!nav.busy) return Promise.resolve();
    return new Promise(function (resolve) { nav.waiters.push(resolve); });
  }

  function onPopState(e) {
    var st = e.state;
    if (!st || !st.vc) return; // a fragment navigation we did not make: onHashChange handles it
    nav.idx = st.idx;
    if (nav.busy) { nav.busy = false; clearTimeout(nav.timer); }
    // Back button: close every overlay whose entry we just moved past.
    for (var i = overlays.length - 1; i >= 0; i--) {
      var o = overlays[i];
      if (o.pushed && o.idx > st.idx) { o.pushed = false; closeOverlay(o); }
    }
    var onOverlayEntry = overlays.some(function (o) { return o.pushed && o.idx === st.idx; });
    if (!onOverlayEntry) nav.base = st.idx;
    var hash = normHash(location.hash);
    routes[st.idx] = hash;
    if (nav.goal && continueToGoal(hash)) return;
    if (hash !== currentHash) {
      currentHash = hash;
      dropAllOverlays();
      render();
    }
    settleNav();
  }

  /** goBack/goHome landed somewhere else: step back again. Returns true while still travelling. */
  function continueToGoal(hash) {
    var g = nav.goal;
    if (g.hash ? hash === g.hash : hash !== g.notHash) { nav.goal = null; return false; }
    if (nav.idx > 0 && !nav.broken) {
      var j = g.hash ? routes.lastIndexOf(g.hash, nav.idx - 1) : nav.idx - 1;
      traverse((j >= 0 ? j : nav.idx - 1) - nav.idx);
      return true;
    }
    nav.goal = null; // reached the app's first entry: show the target in place
    navigate(g.hash || '#/', true);
    return true;
  }

  function openOverlay(root, opts) {
    var ov = { root: root, opts: opts || {}, prevFocus: document.activeElement, pushed: false, closed: false, idx: -1 };
    document.body.appendChild(root);
    overlays.push(ov);
    document.body.classList.add('no-scroll');
    settleNav(); // pushes its history entry now, or once a traversal in flight has landed
    return ov;
  }

  function closeOverlay(ov) {
    if (!ov || ov.closed) return whenNavSettled();
    ov.closed = true;
    var i = overlays.indexOf(ov);
    if (i >= 0) overlays.splice(i, 1);
    if (!overlays.length) document.body.classList.remove('no-scroll');
    var root = ov.root;
    root.classList.add('closing');
    root.setAttribute('aria-hidden', 'true');
    setTimeout(function () { if (root.parentNode) root.parentNode.removeChild(root); }, reducedMotion ? 0 : 190);
    var pf = ov.prevFocus;
    if (pf && pf.focus && document.documentElement.contains(pf)) {
      try { pf.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
    if (ov.opts.onClose) ov.opts.onClose();
    settleNav();
    return whenNavSettled();
  }

  function closeAllOverlays() {
    overlays.slice().reverse().forEach(function (ov) { closeOverlay(ov); });
    return whenNavSettled();
  }

  /** Close overlays after the route already changed (their entries stay behind us). */
  function dropAllOverlays() {
    overlays.slice().reverse().forEach(function (ov) { ov.pushed = false; closeOverlay(ov); });
  }

  function topOverlay() { return overlays[overlays.length - 1] || null; }

  function focusables(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  /**
   * Bottom sheet. opts: { title, body: Node, foot?: Node, focus?: Element, onClose?, label? }
   * Returns the overlay handle (pass to closeOverlay).
   */
  function openSheet(opts) {
    var ov;
    var close = function () { closeOverlay(ov); };
    var head = opts.title ? h('div', { class: 'sheet-head' },
      h('h2', { class: 'sheet-title', text: opts.title }),
      iconBtn('close', '關閉', 'sheet-close', close, 'muted')) : null;
    var sheet = h('div', {
      class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
      'aria-label': opts.title || opts.label || '選單'
    }, h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }), head, opts.body, opts.foot || null);
    var root = h('div', { class: 'overlay', 'data-overlay': 'sheet' },
      h('div', { class: 'backdrop', onclick: close }), sheet);
    var stopKeyboard = trackKeyboard(root);
    ov = openOverlay(root, Object.assign({}, opts, {
      onClose: function () { stopKeyboard(); if (opts.onClose) opts.onClose(); }
    }));
    enableSwipeDown(sheet, close);
    setTimeout(function () {
      try { (opts.focus || sheet).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }, 30);
    return ov;
  }

  /**
   * iOS Safari keeps the on-screen keyboard over position:fixed content, which would hide the
   * sheet's 儲存 buttons. While a sheet is open, --kb on the overlay = the keyboard's height, and
   * the sheet sits above it. (Android uses interactive-widget=resizes-content instead, so --kb is 0.)
   */
  function trackKeyboard(root) {
    var vv = window.visualViewport;
    if (!vv || !vv.addEventListener) return function () {};
    var frame = 0;
    var update = function () {
      frame = 0;
      var kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb', (kb > 60 ? kb : 0) + 'px');
    };
    var schedule = function () { if (!frame) frame = requestAnimationFrame(update); };
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    update();
    return function () {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }

  /** Drag the sheet's top area down to dismiss it. */
  function enableSwipeDown(sheet, onDismiss) {
    var startY = 0, dy = 0, dragging = false;
    function isGrabArea(target) {
      return target.closest && (target.closest('.sheet-handle') || (target.closest('.sheet-head') && !target.closest('button')));
    }
    sheet.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || !isGrabArea(e.target)) return;
      dragging = true; dy = 0; startY = e.touches[0].clientY;
      sheet.style.transition = 'none';
    }, { passive: true });
    sheet.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      dy = Math.max(0, e.touches[0].clientY - startY);
      sheet.style.transform = 'translate(-50%, ' + dy + 'px)';
    }, { passive: true });
    function end() {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = 'transform 0.18s ease';
      if (dy > 90) { sheet.style.transform = 'translate(-50%, 100%)'; onDismiss(); }
      else sheet.style.transform = '';
    }
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
  }

  /**
   * Modal dialog. opts: { title, message?, okText?, cancelText?, danger?, input?: {value, placeholder, maxlength} }
   * Resolves true/false (confirm) or the entered string / null (prompt).
   */
  function modal(opts) {
    return new Promise(function (resolve) {
      var ov, input = null, done = false;
      var hasInput = !!opts.input;
      function finish(ok) {
        if (done) return;
        done = true;
        resolve(hasInput ? (ok ? input.value : null) : !!ok);
        closeOverlay(ov);
      }
      if (hasInput) {
        input = h('input', {
          id: 'modal-input', class: 'input', type: 'text', value: opts.input.value || '',
          placeholder: opts.input.placeholder || '', maxlength: opts.input.maxlength || 100,
          autocomplete: 'off', enterkeyhint: 'done',
          onkeydown: function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); } }
        });
      }
      var cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary', 'data-action': 'modal-cancel',
        text: opts.cancelText || '取消', onclick: function () { finish(false); } });
      var okBtn = h('button', { type: 'button', class: 'btn ' + (opts.danger ? 'btn-danger' : 'btn-primary'),
        'data-action': 'modal-ok', text: opts.okText || '確定', onclick: function () { finish(true); } });
      var box = h('div', { class: 'modal', role: opts.danger ? 'alertdialog' : 'dialog', 'aria-modal': 'true',
        'aria-labelledby': 'modal-title' },
        h('h3', { id: 'modal-title', text: opts.title }),
        opts.message ? h('p', { text: opts.message }) : null,
        input,
        h('div', { class: 'modal-actions' }, opts.hideCancel ? null : cancelBtn, okBtn));
      var root = h('div', { class: 'overlay', 'data-overlay': 'modal' },
        h('div', { class: 'backdrop', onclick: function () { finish(false); } }), box);
      ov = openOverlay(root, { onClose: function () { if (!done) { done = true; resolve(hasInput ? null : false); } } });
      setTimeout(function () {
        var target = input || (opts.danger ? cancelBtn : okBtn);
        try { target.focus({ preventScroll: true }); if (input) input.select(); } catch (e) { /* ignore */ }
      }, 30);
    });
  }

  function confirmDialog(opts) { return modal(opts); }
  function promptDialog(opts) {
    return modal(Object.assign({}, opts, { input: { value: opts.value, placeholder: opts.placeholder, maxlength: opts.maxlength } }));
  }

  /* ---------- Toasts ---------- */

  function toast(message, type, ms) {
    var root = document.getElementById('toasts');
    if (!root) return;
    var el = h('div', { class: 'toast' + (type === 'error' ? ' error' : ''), text: message });
    root.appendChild(el);
    while (root.children.length > 3) root.removeChild(root.firstChild);
    setTimeout(function () {
      el.classList.add('leaving');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, ms || 2400);
  }

  /* =====================================================================================
   * Routing (hash based; see the History section above for how entries are managed).
   * ===================================================================================== */

  var lastRenderKey = null;

  function normHash(hash) {
    var h0 = str(hash);
    if (!h0 || h0 === '#' || h0 === '#/') return '#/';
    return h0.charAt(1) === '/' ? h0 : '#/' + h0.slice(1);
  }

  function parseRoute(hash) {
    var parts = normHash(hash).slice(2).split('/');
    var name = parts[0] || '';
    var id = '';
    try { id = parts[1] ? decodeURIComponent(parts[1]) : ''; } catch (e) { id = ''; }
    var sub = parts[2] || '';
    if (name === 'deck' && id) return sub === 'words' ? { name: 'browse', id: id } : { name: 'deck', id: id };
    if (name === 'cards' && id) return { name: 'cards', id: id };
    if (name === 'quiz' && id && QUIZ_MODES.indexOf(sub) >= 0) return { name: 'quiz', id: id, mode: sub };
    if ((name === 'quiz' || name === 'study') && id) return { name: 'deck', id: id }; // v1 links, unknown quiz kinds
    if (name === 'import') return { name: 'import' };
    if (name === 'settings') return { name: 'settings' };
    return { name: 'home' };
  }

  function deckHash(deckId) { return '#/deck/' + enc(deckId); }
  function wordsHash(deckId) { return '#/deck/' + enc(deckId) + '/words'; }
  function cardsHash(deckId) { return '#/cards/' + enc(deckId); }
  function quizHash(deckId, mode) { return '#/quiz/' + enc(deckId) + '/' + mode; }

  function currentRoute() { return parseRoute(location.hash); }

  /** Show a route: push a new history entry (or replace the current one) and render. */
  function navigate(hash, replace) {
    hash = normHash(hash);
    if (hash === currentHash && !replace) { render(); return; }
    try {
      if (replace) {
        history.replaceState(entryState(nav.idx, hash, false), '', hash);
      } else {
        history.pushState(entryState(nav.idx + 1, hash, false), '', hash);
        nav.idx++;
        routes.length = nav.idx;
      }
    } catch (e) {
      location.hash = hash; // history API unavailable: onHashChange takes over
      return;
    }
    nav.base = nav.idx;
    routes[nav.idx] = hash;
    currentHash = hash;
    dropAllOverlays();
    render();
  }

  function go(hash) {
    return closeAllOverlays().then(function () { navigate(hash); });
  }

  /** Previous screen: back through history when the previous entry is ours, else home. */
  function goBack() {
    return closeAllOverlays().then(function () {
      if (nav.idx <= 0 || nav.broken) { navigate('#/', true); return; }
      nav.goal = { notHash: currentHash };
      traverse(-1);
    });
  }

  /**
   * Back to an earlier screen (home, a deck): jump back to its latest history entry if there is
   * one (keeps the back-button order), else show it in place of the current screen.
   */
  function goBackTo(hash) {
    hash = normHash(hash);
    return closeAllOverlays().then(function () {
      if (currentHash === hash) { render(); return; }
      var i = nav.idx > 0 && !nav.broken ? routes.lastIndexOf(hash, nav.idx - 1) : -1;
      if (i < 0) { navigate(hash, true); return; }
      nav.goal = { hash: hash };
      traverse(i - nav.idx);
    });
  }

  function goHome() { return goBackTo('#/'); }

  /** Fragment navigations the app did not make itself (address bar, links, tests). */
  function onHashChange() {
    var hash = normHash(location.hash);
    // Traversals between our own entries are handled by onPopState (which fires first).
    if (hash === currentHash || nav.busy || nav.goal) return;
    var st = history.state;
    if (st && st.vc) {
      nav.idx = st.idx;
    } else {
      // Unknown entry (it may have been pushed or replaced): keep idx, never over-count.
      try { history.replaceState(entryState(nav.idx, hash, false), ''); } catch (e) { /* ignore */ }
    }
    nav.base = nav.idx;
    routes[nav.idx] = hash;
    currentHash = hash;
    dropAllOverlays();
    render();
  }

  /* =====================================================================================
   * Files: download, read
   * ===================================================================================== */

  function anchorDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 2000);
  }

  /**
   * Save a text file. iOS (esp. home-screen apps) handles the share sheet better than <a download>.
   * Resolves true once the file was handed over (download started / share sheet completed) and
   * false when the user closed the share sheet without saving.
   */
  function downloadFile(filename, text, mime) {
    var type = (mime || 'text/plain') + ';charset=utf-8';
    var blob = new Blob([text], { type: type });
    if (onIOS() && navigator.canShare && navigator.share && typeof File === 'function') {
      try {
        var file = new File([blob], filename, { type: mime || 'text/plain' });
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file], title: filename }).then(function () { return true; }, function (err) {
            if (err && err.name === 'AbortError') return false;
            anchorDownload(blob, filename);
            return true;
          });
        }
      } catch (e) { /* fall back below */ }
    }
    anchorDownload(blob, filename);
    return Promise.resolve(true);
  }

  function readFileBytes(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(r.error || new Error('read failed')); };
      r.readAsArrayBuffer(file);
    });
  }

  function stripExt(name) { return str(name).replace(/\.[^.\/\\]{1,6}$/, '').trim(); }
  function isJsonFile(file) { return /\.json$/i.test(file.name) || file.type === 'application/json'; }

  /* =====================================================================================
   * Text-to-speech
   * ===================================================================================== */

  var tts = {
    supported: typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined',
    voices: []
  };

  function loadVoices() {
    if (!tts.supported) return;
    try { tts.voices = window.speechSynthesis.getVoices() || []; } catch (e) { tts.voices = []; }
  }

  function englishVoices() {
    return tts.voices.filter(function (v) { return /^en([-_]|$)/i.test(v.lang || ''); });
  }

  function pickVoice() {
    var list = englishVoices();
    if (!list.length) return null;
    var want = state.prefs.voiceURI;
    if (want) {
      for (var i = 0; i < list.length; i++) if (list[i].voiceURI === want) return list[i];
    }
    var best = null, bestScore = -1;
    list.forEach(function (v) {
      var s = 0;
      var lang = (v.lang || '').replace('_', '-').toLowerCase();
      if (lang === 'en-us') s += 4; else if (lang === 'en-gb') s += 2;
      if (/natural|neural|enhanced|premium/i.test(v.name)) s += 5;
      if (/google us english|samantha|\bava\b|aria|jenny|zira|allison|susan/i.test(v.name)) s += 2;
      if (v.localService) s += 1;
      if (s > bestScore) { bestScore = s; best = v; }
    });
    return best;
  }

  function speak(text) {
    if (!tts.supported || !text) return;
    try {
      var synth = window.speechSynthesis;
      synth.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      var v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = state.prefs.speechRate || 0.9;
      synth.speak(u);
    } catch (e) { /* speech is best-effort */ }
  }

  /* =====================================================================================
   * Shared UI pieces
   * ===================================================================================== */

  function enc(id) { return encodeURIComponent(id); }

  function screen(name, children, extraClass) {
    return h('main', { class: 'screen' + (extraClass ? ' ' + extraClass : ''), 'data-screen': name }, children);
  }

  function topbar(title, left, right) {
    return h('header', { class: 'topbar' },
      left || h('span', { class: 'spacer' }),
      h('h1', { class: 'topbar-title', text: title }),
      right && right.length ? right : (right || h('span', { class: 'spacer' })));
  }

  function backBtn() { return iconBtn('back', '返回', 'back', function () { goBack(); }); }

  function mount(el, key) {
    var app = document.getElementById('app');
    var same = key === lastRenderKey;
    var y = window.pageYOffset || 0;
    if (same) el.classList.add('no-anim');
    clear(app);
    app.appendChild(el);
    lastRenderKey = key;
    window.scrollTo(0, same ? y : 0);
  }

  function field(label, control, hint, required) {
    var isInput = /^(INPUT|TEXTAREA|SELECT)$/.test(control.tagName);
    return h(isInput ? 'label' : 'div', { class: 'field' },
      h('span', { class: 'field-label' }, label, required ? h('span', { class: 'req', text: '*' }) : null),
      control,
      hint ? h('p', { class: 'field-hint', text: hint }) : null);
  }

  /** Segmented control. options: [{ value, label, action }] */
  function segmented(options, value, onChange, label, extraClass) {
    var seg = h('div', { class: 'seg' + (extraClass ? ' ' + extraClass : ''), role: 'group', 'aria-label': label || null });
    options.forEach(function (o) {
      seg.appendChild(h('button', {
        type: 'button', 'data-action': o.action, 'data-value': o.value, text: o.label,
        'aria-pressed': String(o.value === value),
        onclick: function () {
          Array.prototype.forEach.call(seg.children, function (b) {
            b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === o.value));
          });
          onChange(o.value);
        }
      }));
    });
    return seg;
  }

  /** Textarea that grows with its content. */
  function autoGrow(ta) {
    ta.classList.add('grow');
    var fit = function () { ta.style.height = 'auto'; ta.style.height = (ta.scrollHeight + 2) + 'px'; };
    ta.addEventListener('input', fit);
    setTimeout(fit, 0);
    return ta;
  }

  function menuItem(iconName, label, action, onclick, cls) {
    return h('button', { type: 'button', class: 'menu-item' + (cls ? ' ' + cls : ''), 'data-action': action, onclick: onclick },
      icon(iconName), h('span', { text: label }));
  }

  /* =====================================================================================
   * Home / decks
   * ===================================================================================== */

  var flashDeckIds = [];

  function renderHome() {
    var decks = state.decks.slice().sort(function (a, b) { return a.created - b.created; });
    var head = h('header', { class: 'home-head' },
      h('div', { class: 'home-titles' }, h('h1', { class: 'app-title', text: '單字卡' })),
      iconBtn('gear', '設定', 'open-settings', function () { go('#/settings'); }));

    var note = homeNotice();
    if (!decks.length) {
      mount(screen('home', [head, h('div', { class: 'content no-bottombar' }, note, emptyState())]), 'home');
      return;
    }

    var counts = cardCounts();
    var list = h('div', { class: 'deck-list' });
    decks.forEach(function (d) { list.appendChild(deckRow(d, counts[d.id] || 0)); });

    var content = h('div', { class: 'content' },
      note,
      h('h2', { class: 'section-title', text: '我的牌組' }),
      list,
      h('div', { class: 'list-foot' },
        h('button', { type: 'button', class: 'text-link', 'data-action': 'new-deck', onclick: newDeckFlow },
          icon('plus'), '建立空白牌組')));

    var bottom = h('div', { class: 'bottombar' },
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'open-import',
        onclick: function () { openImport(); } }, icon('plus'), '匯入單字'));

    mount(screen('home', [head, content, bottom]), 'home');

    if (flashDeckIds.length) {
      flashDeckIds.forEach(function (id) {
        var row = list.querySelector('[data-deck-row="' + cssEscape(id) + '"]');
        if (row) {
          row.classList.add('flash');
          if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
        }
      });
      flashDeckIds = [];
    }
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  }

  function daysSince(ms) { return ms ? Math.floor((now() - ms) / DAY_MS) : Infinity; }

  function notice(kind, title, text, buttons) {
    return h('section', { class: 'notice notice-' + kind, id: 'home-notice', 'data-notice': kind, role: 'note' },
      h('h2', { class: 'notice-title', text: title }),
      h('p', { class: 'notice-text', text: text }),
      h('div', { class: 'notice-actions' }, buttons));
  }

  function noticeBtn(label, action, primary, onclick) {
    return h('button', { type: 'button', class: 'btn btn-sm ' + (primary ? 'btn-primary' : 'btn-ghost'),
      'data-action': action, text: label, onclick: onclick });
  }

  /** One card at the top of home: storage problems first, then the iPhone tip, then a backup reminder. */
  function homeNotice() {
    var p = state.prefs;
    if (saveBlocked === 'corrupt') {
      return notice('corrupt', '資料讀取失敗',
        '這個瀏覽器裡的單字資料損壞了，無法讀取。為了不覆蓋它，App 目前不會儲存任何變更。' +
        '請先下載原始資料保存起來（可以請人幫忙修復），再選擇重新開始。', [
          noticeBtn('下載原始資料', 'download-raw', true, function () {
            downloadFile('單字卡_原始資料_' + ymd(now()) + '.txt', blockedRaw || '', 'text/plain');
          }),
          noticeBtn('重新開始', 'reset-corrupt', false, resetCorrupt)]);
    }
    if (saveBlocked === 'newer') {
      return notice('newer', '請更新 App',
        '這份資料是用較新版本的單字卡存的。請重新整理頁面（或把 App 關掉再打開）更新到新版；在那之前不會儲存任何變更。', [
          noticeBtn('重新整理', 'reload-app', true, function () { location.reload(); })]);
    }
    var copies = corruptCopies();
    if (copies.length) {
      var copy = copies[0];
      return notice('corrupt-copy', '舊資料另外保存了一份',
        '之前這個瀏覽器裡的單字資料損壞、無法讀取，App 已經重新開始，並把那份資料另外保存起來' +
        (copies.length > 1 ? '（共 ' + copies.length + ' 份）' : '') +
        '。可以下載下來保存（可以請人幫忙修復）；不需要的話就刪除，釋放空間。', [
          noticeBtn('下載原始資料', 'download-raw', true, function () {
            downloadFile('單字卡_原始資料_' + ymd(+copy.split('.corrupt-').pop() || now()) + '.txt', readStored(copy) || '', 'text/plain');
          }),
          noticeBtn('刪除', 'delete-corrupt-copy', false, function () {
            confirmDialog({ title: '刪除損壞的舊資料？', message: '請先確定已經「下載原始資料」。刪除後就無法復原了。',
              okText: '刪除', danger: true }).then(function (ok) {
              if (!ok) return;
              try { localStorage.removeItem(copy); } catch (e) { /* ignore */ }
              render();
            });
          })]);
    }
    if (!state.cards.length) return null;
    if (onIOS() && !isStandalone() && !p.iosTipDismissed) {
      return notice('ios', 'iPhone 小提醒',
        'Safari 如果大約一週沒打開這個網站，資料可能被系統清掉，建議「加入主畫面」使用。' +
        '但主畫面的 App 是另一份資料（不會自動帶過去）：請先在這裡「匯出備份」，再到主畫面的 App 裡「還原備份」。', [
          noticeBtn('匯出備份', 'notice-backup', true, function () { exportBackup(); }),
          noticeBtn('知道了', 'notice-dismiss', false, function () { p.iosTipDismissed = true; scheduleSave(); render(); })]);
    }
    if (state.cards.length > BACKUP_REMIND_CARDS) {
      var since = p.lastBackupAt || Math.min.apply(null, state.decks.map(function (d) { return d.created || now(); }));
      if (daysSince(since) >= BACKUP_REMIND_DAYS && daysSince(p.backupNagAt) >= BACKUP_REMIND_DAYS) {
        return notice('backup', '記得備份',
          (p.lastBackupAt ? '已經 ' + daysSince(p.lastBackupAt) + ' 天沒有備份了。' : '你還沒有備份過。') +
          '資料只存在這個瀏覽器裡，換手機或清除瀏覽資料就會不見。', [
            noticeBtn('匯出備份', 'notice-backup', true, function () { exportBackup(); }),
            noticeBtn('之後再說', 'notice-dismiss', false, function () { p.backupNagAt = now(); scheduleSave(); render(); })]);
      }
    }
    return null;
  }

  function resetCorrupt() {
    confirmDialog({
      title: '清除損壞的資料，重新開始？',
      message: '請先確定已經「下載原始資料」。清除後就無法復原了。',
      okText: '清除並重新開始', danger: true
    }).then(function (ok) {
      if (!ok) return;
      saveBlocked = null;
      blockedRaw = null;
      lastSavedJSON = null;
      flushSave({ replace: true });
      toast('已重新開始');
      render();
    });
  }

  /** 「選擇 8/10 · 拼字 6/10」: the deck's last finished quizzes, '' when there are none. */
  function quizScoresText(deck) {
    var lq = deck.lastQuiz || {};
    return QUIZ_MODES.filter(function (m) { return lq[m]; }).map(function (m) {
      return QUIZ_SHORT[m] + ' ' + lq[m].score + '/' + lq[m].total;
    }).join(' · ');
  }

  function deckRow(deck, total) {
    var scores = quizScoresText(deck);
    var meta = h('div', { class: 'deck-meta' },
      h('span', { class: 'deck-total', text: '共 ' + fmtNum(total) + ' 字' }),
      scores ? h('span', { class: 'deck-scores', text: scores }) : null);
    var open = h('button', {
      type: 'button', class: 'deck-open', 'data-action': 'deck-open', 'data-deck-id': deck.id,
      'aria-label': deck.name + '，共 ' + total + ' 字' + (scores ? '，上次測驗 ' + scores : ''),
      onclick: function () { go(deckHash(deck.id)); }
    }, h('div', { class: 'deck-name', text: deck.name }), meta);
    var more = iconBtn('more', '「' + deck.name + '」的選項', 'deck-menu', function () { openDeckMenu(deck.id); }, 'muted deck-more');
    more.setAttribute('data-deck-id', deck.id);
    return h('div', { class: 'deck-row', 'data-deck-row': deck.id }, open, more);
  }

  var EMPTY_ART =
    '<svg class="empty-art" viewBox="0 0 132 112" fill="none" aria-hidden="true">' +
    '<g class="card-back-art"><rect x="40" y="6" width="70" height="92" rx="13" transform="rotate(9 75 52)" style="fill:var(--accent-soft)"/></g>' +
    '<rect x="24" y="14" width="70" height="92" rx="13" style="fill:var(--surface)" stroke="currentColor" stroke-width="2"/>' +
    '<text x="59" y="66" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-size="28" font-weight="600" fill="currentColor">Aa</text>' +
    '<path d="M44 84h30" stroke="currentColor" stroke-opacity=".25" stroke-width="4" stroke-linecap="round"/>' +
    '</svg>';

  function emptyState() {
    var art = h('div');
    art.innerHTML = EMPTY_ART; // static markup
    var hasSample = !!(window.VC_SAMPLE && window.VC_SAMPLE.text);
    return h('div', { class: 'empty' },
      art.firstChild,
      h('h2', { text: '還沒有任何單字' }),
      h('p', null, '匯入一個單字文字檔，', h('br'), '就能開始一張一張背起來。'),
      h('div', { class: 'empty-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'empty-import-file', onclick: pickFilesFromHome },
          icon('upload'), '匯入文字檔'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-lg', 'data-action': 'empty-paste',
          onclick: function () { openImport(null, true); } }, icon('clipboard'), '貼上文字'),
        hasSample ? h('button', { type: 'button', class: 'btn btn-tonal btn-lg', 'data-action': 'load-sample', onclick: loadSample },
          icon('sparkle'), '載入範例牌組') : null),
      h('button', { type: 'button', class: 'text-link empty-claude', 'data-action': 'empty-claude',
        onclick: function () { openImport(); } }, icon('sparkle'), '沒有單字檔？請 Claude 幫你做'),
      h('button', { type: 'button', class: 'text-link empty-restore', 'data-action': 'empty-restore', onclick: pickBackupFile },
        icon('restore'), onIOS() && isStandalone() ? '從 Safari 搬過來？還原備份' : '有備份檔？還原備份'),
      // Before there is any data: one step (add to the home screen first) instead of a backup move later.
      onIOS() && !isStandalone() ? h('p', { class: 'empty-ios' },
        '用 iPhone？建議先「加入主畫面」再開始，資料比較不會被 Safari 清掉：Safari 的「分享」（iOS 26 在右下「⋯」裡）→「加入主畫面」。') : null);
  }

  function pickFilesFromHome() {
    var old = document.getElementById('home-file-input');
    if (old) old.parentNode.removeChild(old);
    var input = h('input', { type: 'file', id: 'home-file-input', accept: IMPORT_ACCEPT, multiple: true, class: 'sr-only', tabindex: '-1' });
    input.addEventListener('change', function () {
      var files = Array.prototype.slice.call(input.files || []);
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!files.length) return;
      openImport().then(function () { handleImportFiles(files); });
    });
    document.body.appendChild(input);
    input.click();
  }

  function loadSample() {
    var sample = window.VC_SAMPLE;
    if (!sample || !sample.text) return;
    var res = runImport([{ id: 'sample', name: sample.name, defaultDeckName: sample.name || '範例牌組', text: sample.text }],
      { target: 'new', names: {}, dupMode: 'skip' });
    if (res.failed) toast(notSavedText('載入'), 'error', 6000);
    else if (res.added) toast('已載入範例牌組（' + res.added + ' 張）');
    else toast('範例牌組已經在你的牌組裡了');
    flashDeckIds = res.deckIds;
    render();
  }

  function newDeckFlow() {
    promptDialog({ title: '建立空白牌組', message: '建立後可以在牌組裡一個一個新增單字。', placeholder: '牌組名稱', okText: '建立', maxlength: 60 })
      .then(function (name) {
        if (name === null) return;
        name = name.trim();
        if (!name) { toast('請輸入牌組名稱', 'error'); return; }
        var deck = createDeck(name);
        scheduleSave();
        go(deckHash(deck.id));
      });
  }

  function openDeckMenu(deckId) {
    var deck = deckById(deckId);
    if (!deck) return;
    var ov;
    var body = h('div', { class: 'menu' },
      menuItem('list', '瀏覽與編輯單字', 'sheet-browse', function () { go(wordsHash(deck.id)); }),
      menuItem('sliders', '牌組設定', 'sheet-settings', function () {
        closeOverlay(ov).then(function () { openDeckSettings(deck.id); });
      }),
      menuItem('download', '匯出文字檔', 'sheet-export', function () { exportDeck(deck.id); closeOverlay(ov); }),
      h('div', { class: 'menu-sep' }),
      menuItem('trash', '刪除牌組', 'sheet-delete', function () {
        closeOverlay(ov).then(function () { confirmDeleteDeck(deck.id); });
      }, 'danger'));
    ov = openSheet({ title: deck.name, body: body });
  }

  function exportDeck(deckId) {
    var deck = deckById(deckId);
    if (!deck) return;
    var cards = cardsOfDeck(deck.id);
    var name = deck.name;
    downloadFile(safeFileName(name) + '.txt', VC.serializeDeck(name, cards), 'text/plain').then(function (ok) {
      if (ok) toast('已匯出「' + name + '」（' + cards.length + ' 字）');
    });
  }

  function confirmDeleteDeck(deckId) {
    var deck = deckById(deckId);
    if (!deck) return Promise.resolve(false);
    var n = cardsOfDeck(deckId).length;
    return confirmDialog({
      title: '刪除「' + deck.name + '」？',
      message: '牌組裡的 ' + n + ' 個單字和測驗紀錄都會被刪除，無法復原。',
      okText: '刪除', danger: true
    }).then(function (ok) {
      if (!ok) return false;
      deleteDeck(deckId);
      scheduleSave();
      toast('已刪除牌組');
      if (currentRoute().id === deckId) goHome();
      else render();
      return true;
    });
  }

  function openDeckSettings(deckId) {
    var deck = deckById(deckId);
    if (!deck) return;
    var dir = deck.settings.direction === 'zh2en' ? 'zh2en' : 'en2zh';
    var ov;
    var nameIn = h('input', { id: 'ds-name', class: 'input', type: 'text', value: deck.name, maxlength: 60, autocomplete: 'off' });
    var seg = segmented([
      { value: 'en2zh', label: '英文', action: 'dir-en2zh' },
      { value: 'zh2en', label: '中文', action: 'dir-zh2en' }
    ], dir, function (v) { dir = v; }, '字卡正面');

    function save() {
      var name = nameIn.value.trim();
      if (!name) { toast('請輸入牌組名稱', 'error'); nameIn.focus(); return; }
      // Look the deck up again: another tab may have replaced the state while the sheet was open.
      var d = deckById(deckId);
      if (!d) { toast('找不到這個牌組', 'error'); closeOverlay(ov); return; }
      d.name = name;
      d.settings.direction = dir;
      scheduleSave();
      render();
      closeOverlay(ov);
      toast('已儲存設定');
    }

    var body = h('div', { class: 'sheet-body' },
      field('牌組名稱', nameIn),
      field('字卡正面', seg, '英文：先看英文單字，翻面看中文意思；中文：先看中文意思，想想英文怎麼說。'),
      h('div', { class: 'menu-sep' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-block', 'data-action': 'ds-export',
        onclick: function () { exportDeck(deck.id); } }, icon('download'), '匯出文字檔'),
      h('button', { type: 'button', class: 'btn btn-danger-text btn-block', 'data-action': 'ds-delete',
        onclick: function () {
          closeOverlay(ov).then(function () { confirmDeleteDeck(deck.id); });
        } }, icon('trash'), '刪除牌組'));
    var foot = h('div', { class: 'sheet-foot' },
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'ds-save', text: '儲存', onclick: save }));
    ov = openSheet({ title: '牌組設定', body: body, foot: foot });
  }

  /* =====================================================================================
   * Deck hub (#/deck/<deckId>): 字卡 · 選擇題 · 拼字題
   * ===================================================================================== */

  var NO_QUESTION = {
    choice: '要有兩個以上不同中文意思的單字才能出題',
    spell: '例句裡找不到單字，無法出題'
  };

  /** Why a quiz can't be made from these cards (a deck without any example sentences says so). */
  function noQuestionText(mode, deckCards) {
    if (mode === 'spell' && !deckCards.some(function (c) { return str(c.example).trim(); })) {
      return '單字都沒有例句，無法出題';
    }
    return NO_QUESTION[mode];
  }

  /** Meaning text the way the quiz compares it: one line, trimmed, case-insensitive. */
  function meaningKey(meaning) {
    return VC.meaningKey ? VC.meaningKey(meaning) : oneLine(meaning).trim().toLowerCase();
  }

  /**
   * Cards the multiple-choice distractors come from: the deck itself, or every deck when the
   * deck has fewer than 4 different meanings (so a small deck still gets four options).
   */
  function choicePool(deckCards) {
    var seen = Object.create(null);
    var n = 0;
    for (var i = 0; i < deckCards.length && n < 4; i++) {
      var k = meaningKey(deckCards[i].meaning);
      if (k && !seen[k]) { seen[k] = true; n++; }
    }
    return n >= 4 ? deckCards : state.cards;
  }

  /** How many questions each quiz can make from these cards: { choice, spell }. */
  function quizEligible(deckCards) {
    return deckCards.length ? VC.quizEligible(deckCards, choicePool(deckCards)) : { choice: 0, spell: 0 };
  }

  function deckSize(deckId) {
    var n = 0;
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].deckId === deckId) n++;
    return n;
  }

  /** Start a new quiz (a fresh random set of questions) and show it. */
  function openQuiz(deckId, mode) {
    startQuiz(deckId, mode);
    return go(quizHash(deckId, mode));
  }

  /** o: { action, icon, title, desc, meta: [Node|null] (right of the title), disabled, onclick } */
  function hubTile(o) {
    var meta = (o.meta || []).filter(Boolean);
    return h('button', { type: 'button', class: 'tile', 'data-action': o.action, disabled: o.disabled, onclick: o.onclick },
      h('span', { class: 'tile-icon' }, icon(o.icon)),
      h('span', { class: 'tile-text' },
        h('span', { class: 'tile-head' },
          h('span', { class: 'tile-title', text: o.title }),
          meta.length ? h('span', { class: 'tile-meta' }, meta) : null),
        h('span', { class: 'tile-desc', text: o.desc })),
      o.disabled ? null : icon('chevron', 'tile-chev'));
  }

  /**
   * 每次測驗題數 (prefs.quizCount, shared by all decks): only the counts smaller than the deck are
   * offered. A deck of 10 words or fewer has no choice to make: it just says 「全部 (8)」 (a lone
   * button would only change the setting of the bigger decks).
   */
  function quizCountControl(n) {
    if (n <= 10) return h('span', { class: 'quiz-count-fixed', id: 'quiz-count-fixed', text: '全部 (' + n + ')' });
    var opts = [];
    if (n > 10) opts.push({ value: '10', label: '10', action: 'quiz-count-10' });
    if (n > 20) opts.push({ value: '20', label: '20', action: 'quiz-count-20' });
    opts.push({ value: '0', label: n > 20 ? '全部' : '全部 (' + n + ')', action: 'quiz-count-all' });
    var pref = state.prefs.quizCount;
    return segmented(opts, pref && pref < n ? String(pref) : '0', function (v) {
      state.prefs.quizCount = +v;
      scheduleSave();
    }, '每次測驗題數', 'compact quiz-seg');
  }

  function renderHub(deckId) {
    var deck = deckById(deckId);
    if (!deck) { toast('找不到這個牌組'); navigate('#/', true); return; }
    var cards = cardsOfDeck(deckId);
    var n = cards.length;
    var gear = iconBtn('sliders', '牌組設定', 'deck-settings', function () { openDeckSettings(deckId); });
    var content = h('div', { class: 'content no-bottombar' });

    if (!n) {
      content.appendChild(hubEmpty(deckId));
    } else {
      var can = quizEligible(cards);
      var meta = function (text, cls) { return h('span', { class: cls || null, text: text }); };
      var last = function (mode) {
        var r = deck.lastQuiz[mode];
        return r ? meta('上次 ' + r.score + '/' + r.total, 'meta-score') : null;
      };
      var pos = deck.flash.index;
      content.appendChild(h('p', { class: 'hub-count', id: 'hub-count', text: '共 ' + fmtNum(n) + ' 字' }));
      content.appendChild(h('div', { class: 'tiles' },
        hubTile({ action: 'hub-cards', icon: 'cards', title: '字卡', desc: '翻面背單字',
          meta: [pos > 0 && pos < n ? meta('看到第 ' + (pos + 1) + ' 張') : null],
          onclick: function () { go(cardsHash(deckId)); } }),
        hubTile({ action: 'hub-choice', icon: 'choice', title: '選擇題',
          desc: can.choice ? '看英文，選出中文意思' : NO_QUESTION.choice, disabled: !can.choice,
          meta: can.choice ? [last('choice')] : [],
          onclick: function () { openQuiz(deckId, 'choice'); } }),
        hubTile({ action: 'hub-spell', icon: 'spell', title: '拼字題',
          desc: can.spell ? '看例句，拼出單字' : noQuestionText('spell', cards), disabled: !can.spell,
          meta: can.spell ? [last('spell'), can.spell < n ? meta('可出 ' + can.spell + ' 題') : null] : [],
          onclick: function () { openQuiz(deckId, 'spell'); } })));
      content.appendChild(h('div', { class: 'group hub-more' },
        h('div', { class: 'set-row' }, h('div', { class: 'set-label', text: '每次測驗題數' }), quizCountControl(n)),
        h('button', { type: 'button', class: 'set-row', 'data-action': 'hub-words', onclick: function () { go(wordsHash(deckId)); } },
          icon('list'), h('div', { class: 'set-label', text: '瀏覽與編輯單字' }), icon('chevron', 'chev'))));
    }

    mount(screen('deck', [topbar(deck.name, backBtn(), gear), content]), 'deck:' + deckId);
  }

  function hubEmpty(deckId) {
    var art = h('div');
    art.innerHTML = EMPTY_ART; // static markup
    return h('div', { class: 'empty hub-empty', id: 'hub-empty' },
      art.firstChild,
      h('h2', { text: '這個牌組還沒有單字' }),
      h('p', null, '匯入單字文字檔，', h('br'), '或一個一個新增單字。'),
      h('div', { class: 'empty-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'import-to-deck',
          onclick: function () { openImport(deckId); } }, icon('upload'), '匯入單字到這個牌組'),
        h('button', { type: 'button', class: 'btn btn-secondary btn-lg', 'data-action': 'add-card',
          onclick: function () { openCardSheet({ deckId: deckId, onChange: function () { renderHub(deckId); } }); } },
          icon('plus'), '新增單字')));
  }

  /** Centered message with buttons (end of the flashcards, a quiz without questions…). */
  function messageView(id, emoji, title, text, actions) {
    return h('div', { class: 'done', id: id },
      h('div', { class: 'done-emoji', 'aria-hidden': 'true', text: emoji }),
      h('h2', { text: title }),
      text ? h('p', { class: 'done-sub', text: text }) : null,
      h('div', { class: 'done-actions' }, actions));
  }

  function progressRow(i, n, id) {
    var pct = n ? Math.round(i / n * 100) : 0;
    return h('div', { class: 'progress-row' },
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': '進度', 'aria-valuemin': '0',
        'aria-valuemax': String(n), 'aria-valuenow': String(i) }, h('i', { style: 'width:' + pct + '%' })),
      h('span', { class: 'progress-text', id: id, text: i + ' / ' + n }));
  }

  /* =====================================================================================
   * Flashcards (#/cards/<deckId>): flip, previous / next (buttons, swipe, ← →), shuffle.
   * The position (deck.flash) is saved; flipped / end view live in `fc` only.
   * ===================================================================================== */

  // { deckId, flipped, end, enter: 'in' | 'next' | 'prev' | '', shown (cards shown so far), spoken }
  var fc = null;
  var lastSwipeAt = -1e9; // perfNow() of the last swipe (the tap that ends it must not flip the card)

  /** The deck's cards in flashcard order: as added, or shuffled with the deck's saved seed. */
  function flashOrder(deck) {
    var cards = cardsOfDeck(deck.id);
    return deck.flash.shuffle ? VC.shuffle(cards, VC.seededRng(deck.flash.seed)) : cards;
  }

  function renderCards(deckId) {
    var deck = deckById(deckId);
    if (!deck) { toast('找不到這個牌組'); navigate('#/', true); return; }
    var key = 'cards:' + deckId;
    if (!fc || fc.deckId !== deckId || lastRenderKey !== key) {
      fc = { deckId: deckId, flipped: false, end: false, enter: 'in', shown: 0, spoken: '' };
    }
    var order = flashOrder(deck);
    var n = order.length;
    var index = Math.max(0, Math.min(deck.flash.index, n - 1)); // cards may have been deleted
    if (index !== deck.flash.index) { deck.flash.index = index; scheduleSave(); }
    var card = n && !fc.end ? order[index] : null;

    var shuffleBtn = iconBtn('shuffle', '隨機順序', 'shuffle', function () { toggleShuffle(deckId); });
    shuffleBtn.setAttribute('aria-pressed', String(deck.flash.shuffle));
    shuffleBtn.disabled = n < 2;
    var editBtn = iconBtn('edit', '編輯這張卡片', 'edit-card', function () {
      if (card) openCardSheet({ deckId: deckId, cardId: card.id, onChange: function () { renderCards(deckId); } });
    });
    editBtn.disabled = !card;

    var children = [h('div', { class: 'fc-top' },
      h('header', { class: 'topbar' }, backBtn(), h('span', { class: 'spacer', 'aria-hidden': 'true' }),
        h('h1', { class: 'topbar-title', text: deck.name }), shuffleBtn, editBtn),
      n ? progressRow(fc.end ? n : index + 1, n, 'flash-progress') : null)];
    if (!n) {
      children.push(messageView('flash-empty', '📭', '這個牌組還沒有單字', '先匯入或新增一些單字，再回來背吧。', [
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'flash-home', text: '回到牌組',
          onclick: function () { goBackTo(deckHash(deckId)); } })]));
    } else if (fc.end) {
      children.push(flashEndView(deck, order));
    } else {
      children.push(h('div', { class: 'fc-body' }, flashCardView(deck, card)));
      children.push(flashActions(index));
    }
    mount(screen('cards', children, 'fc'), key);
    fc.enter = '';

    // 自動朗讀: the English word, once each time it comes into view.
    if (card && state.prefs.autoSpeak && (deck.settings.direction !== 'zh2en' || fc.flipped)) {
      var tag = card.id + ':' + fc.shown;
      if (fc.spoken !== tag) { fc.spoken = tag; speak(card.word); }
    }
  }

  function flashCardView(deck, card) {
    var zh2en = deck.settings.direction === 'zh2en';
    var front = zh2en
      ? h('div', { class: 'card-front' }, h('h2', { class: 'front-meaning', text: card.meaning }))
      : h('div', { class: 'card-front' },
          h('h2', { class: 'word ' + lenClass(card.word), lang: 'en', text: card.word }),
          phoneticRow(card));
    var back = fc.flipped ? h('div', { class: 'card-back' },
      zh2en
        ? h('div', { class: 'back-word' },
            h('h3', { class: 'word ' + lenClass(card.word), lang: 'en', text: card.word }), phoneticRow(card))
        : h('p', { class: 'meaning', text: card.meaning }),
      exampleBlock(card),
      card.note ? h('p', { class: 'note', text: card.note }) : null) : null;

    // Tapping anywhere on the card flips it. No role/label on the card itself, so screen
    // readers read the word; the 「翻面」 button below is the accessible control.
    var el = h('div', {
      class: 'flashcard' + (fc.flipped ? ' flipped' : '') + (fc.enter ? ' enter-' + fc.enter : ''),
      id: 'flash-card', 'data-action': 'card', 'data-card-id': card.id,
      onclick: function () {
        if (perfNow() - lastSwipeAt < 400) return; // the end of a swipe
        var sel = window.getSelection && window.getSelection();
        if (sel && String(sel).length) return;     // selecting text (to copy it)
        flipCard();
      }
    }, front, back);
    enableSwipe(el, function () { flashStep(1); }, function () { flashStep(-1); }, true);
    return el;
  }

  function flashActions(index) {
    return h('div', { class: 'fc-actions' },
      h('div', { class: 'fc-nav' },
        h('button', { type: 'button', class: 'btn btn-secondary', 'data-action': 'prev', disabled: index === 0,
          onclick: function () { flashStep(-1); } }, icon('back'), h('span', { text: '上一張' })),
        h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'flip', text: '翻面', onclick: flipCard }),
        h('button', { type: 'button', class: 'btn btn-secondary', 'data-action': 'next',
          onclick: function () { flashStep(1); } }, h('span', { text: '下一張' }), icon('chevron'))),
      h('p', { class: 'kbd-hint', text: '← → 換卡 · 空白鍵 翻面 · S 朗讀' }));
  }

  function flashEndView(deck, order) {
    var can = quizEligible(order);
    var view = messageView('flash-end', '🎉', '看完了！共 ' + order.length + ' 張', '接著做個小測驗，看看記住了多少吧！', [
      h('button', { type: 'button', class: 'btn btn-secondary btn-lg', 'data-action': 'flash-restart', onclick: restartFlash },
        icon('reset'), '從頭再看一次'),
      h('button', { type: 'button', class: 'btn btn-tonal btn-lg', 'data-action': 'flash-to-choice', disabled: !can.choice,
        onclick: function () { openQuiz(deck.id, 'choice'); } }, icon('choice'), '選擇題測驗'),
      h('button', { type: 'button', class: 'btn btn-tonal btn-lg', 'data-action': 'flash-to-spell', disabled: !can.spell,
        onclick: function () { openQuiz(deck.id, 'spell'); } }, icon('spell'), '拼字題測驗'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-lg', 'data-action': 'flash-home', text: '回到牌組',
        onclick: function () { goBackTo(deckHash(deck.id)); } })]);
    enableSwipe(view, null, function () { flashStep(-1); }, false); // swipe right: back to the last card
    return view;
  }

  function flipCard() {
    if (!fc || fc.end) return;
    fc.flipped = !fc.flipped;
    renderCards(fc.deckId);
  }

  /** Previous (-1) / next (+1) card. Past the last card comes the end view. */
  function flashStep(delta) {
    var deck = fc && deckById(fc.deckId);
    var n = deck ? deckSize(deck.id) : 0;
    if (!n) return;
    var fl = deck.flash;
    if (fc.end) {
      if (delta > 0) return;
      fc.end = false;
      fl.index = n - 1;
    } else {
      var i = Math.min(fl.index, n - 1) + delta;
      if (i < 0) return;
      if (i < n) fl.index = i;
      else { fc.end = true; fl.index = 0; } // seen them all: next time starts from the first card
    }
    fc.flipped = false; // a new card always shows its front
    fc.enter = delta > 0 ? 'next' : 'prev';
    fc.shown++;
    scheduleSave();
    renderCards(deck.id);
  }

  function restartFlash() {
    var deck = fc && deckById(fc.deckId);
    if (!deck) return;
    deck.flash.index = 0;
    fc.end = false;
    fc.flipped = false;
    fc.enter = 'in';
    fc.shown++;
    scheduleSave();
    renderCards(deck.id);
  }

  /** Shuffle on: a new random order from the first card. Off: the original order, same card. */
  function toggleShuffle(deckId) {
    var deck = deckById(deckId);
    if (!deck || !fc) return;
    var fl = deck.flash;
    if (fl.shuffle) {
      var order = flashOrder(deck);
      var cur = fc.end ? null : order[Math.min(fl.index, order.length - 1)];
      fl.shuffle = false;
      fl.index = cur ? Math.max(0, cardsOfDeck(deckId).indexOf(cur)) : 0;
      toast('已恢復原本順序');
    } else {
      fl.shuffle = true;
      fl.seed = Math.floor(rand() * 4294967296) >>> 0;
      fl.index = 0;
      toast('已隨機排序');
    }
    fc.end = false;
    fc.flipped = false;
    fc.enter = 'in';
    fc.shown++;
    scheduleSave();
    renderCards(deckId);
  }

  /**
   * Horizontal swipe on el: more than 50px and more sideways than up/down. onLeft = the finger
   * moved to the left (either may be null). Up/down still scrolls (touch-action: pan-y in CSS);
   * with follow, the element moves a little with a sideways finger.
   */
  function enableSwipe(el, onLeft, onRight, follow) {
    var x0 = 0, y0 = 0, dx = 0, dy = 0, active = false, sideways = null;
    var settle = function () { el.style.transition = ''; el.style.transform = ''; };
    el.addEventListener('touchstart', function (e) {
      active = e.touches.length === 1;
      sideways = null;
      dx = dy = 0;
      if (!active) { settle(); return; }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchmove', function (e) {
      if (!active) return;
      dx = e.touches[0].clientX - x0;
      dy = e.touches[0].clientY - y0;
      if (sideways === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) sideways = Math.abs(dx) > Math.abs(dy);
      if (sideways && follow && !reducedMotion) {
        el.style.transition = 'none';
        el.style.transform = 'translateX(' + Math.round(dx * 0.35) + 'px)';
      }
    }, { passive: true });
    el.addEventListener('touchend', function () {
      if (!active) return;
      active = false;
      settle();
      var fn = dx < 0 ? onLeft : onRight;
      if (sideways && fn && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        lastSwipeAt = perfNow();
        fn();
      }
    });
    el.addEventListener('touchcancel', function () { active = false; settle(); });
  }

  /* ---------- Card faces (flashcards, quiz) ---------- */

  function lenClass(word) {
    var n = str(word).length;
    return n <= 9 ? '' : n <= 13 ? 'len-m' : n <= 18 ? 'len-l' : 'len-xl';
  }

  function speakButton(word) {
    if (!tts.supported) return null;
    return iconBtn('speaker', '朗讀', 'speak', function (e) { e.stopPropagation(); speak(word); }, 'speak-btn');
  }

  /** Phonetic + 🔊 of { word, phonetic } (a card or a quiz question). */
  function phoneticRow(card) {
    var sp = speakButton(card.word);
    if (!card.phonetic && !sp) return null;
    return h('div', { class: 'phonetic-row' },
      card.phonetic ? h('span', { class: 'phonetic', text: card.phonetic }) : null, sp);
  }

  function exampleBlock(card) {
    if (!card.example && !card.exampleZh) return null;
    return h('div', { class: 'example-block' },
      card.example ? h('p', { class: 'example', lang: 'en' }, highlightNodes(card.example, card.word)) : null,
      card.exampleZh ? h('p', { class: 'example-zh', text: card.exampleZh }) : null);
  }

  /** DOM nodes for `sentence` with every occurrence of the headword (VC.headwordRegex) in a <mark>. */
  function highlightNodes(sentence, word) {
    var re = VC.headwordRegex(word);
    if (!re) return [document.createTextNode(sentence)];
    if (!re.global) re = new RegExp(re.source, re.flags + 'g');
    var nodes = [];
    var last = 0;
    var m;
    while ((m = re.exec(sentence)) !== null) {
      // Group 1: the character before the word (or ''), group 2: the word itself.
      var text = m[2] !== undefined ? m[2] : m[0];
      var start = m.index + (m[2] !== undefined ? (m[1] || '').length : 0);
      if (text) {
        if (start > last) nodes.push(document.createTextNode(sentence.slice(last, start)));
        nodes.push(h('mark', { text: text }));
        last = start + text.length;
      }
      if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
    }
    if (last < sentence.length) nodes.push(document.createTextNode(sentence.slice(last)));
    return nodes;
  }

  /* =====================================================================================
   * Quiz (#/quiz/<deckId>/choice | spell)
   *
   * quiz = { id, deckId, mode, questions, i, retry, finished, timer, answeredAt, enter, spoken, ui }
   *   questions  from VC.buildQuiz; an answered question gets
   *              q.result = { correct, chosen? (choice), input?, gaveUp? (spell), word, meaning }
   *   retry      a 「重測答錯的題目」 round: its score is not kept as the deck's last result
   *   ui         the parts of the question screen that change in place. The next question re-uses
   *              the same answer box, so the phone keyboard stays open from question to question.
   * The session is in memory only: back and then forward again continues it; every way of
   * starting a quiz (deck tiles, 「再測一次」, the end of the flashcards) makes a fresh set.
   * ===================================================================================== */

  var quiz = null;
  var quizSerial = 0;

  function newQuizSession(deckId, mode, questions, retry) {
    return {
      id: ++quizSerial, deckId: deckId, mode: mode, questions: questions, i: 0, retry: !!retry,
      finished: false, timer: null, answeredAt: 0, enter: true, spoken: '', ui: null
    };
  }

  function startQuiz(deckId, mode) {
    stopQuizTimer();
    var cards = cardsOfDeck(deckId);
    var pool = mode === 'choice' ? choicePool(cards) : cards;
    var questions = cards.length ? VC.buildQuiz(cards, mode, state.prefs.quizCount, rand, pool) || [] : [];
    quiz = newQuizSession(deckId, mode, questions, false);
  }

  function stopQuizTimer() {
    if (quiz && quiz.timer) { clearTimeout(quiz.timer); quiz.timer = null; }
  }

  function currentQuestion() {
    return quiz && !quiz.finished ? quiz.questions[quiz.i] || null : null;
  }

  function quizScore() {
    return quiz.questions.filter(function (q) { return q.result && q.result.correct; }).length;
  }

  function renderQuiz(deckId, mode) {
    var deck = deckById(deckId);
    if (!deck) { toast('找不到這個牌組'); navigate('#/', true); return; }
    if (!quiz || quiz.deckId !== deckId || quiz.mode !== mode) startQuiz(deckId, mode);
    var title = QUIZ_TITLES[mode];
    var quit = iconBtn('close', quiz.finished ? '關閉' : '結束測驗', 'quiz-quit', quitQuiz);
    if (!quiz.questions.length) {
      var why = noQuestionText(mode, cardsOfDeck(deckId)) + (mode === 'spell' ? '。\n可以在「瀏覽與編輯單字」裡，幫單字加上含有它的例句。' : '。');
      mount(screen('quiz', [topbar(title, quit), messageView('quiz-empty', '🤔', '沒辦法出' + title, why, [
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'quiz-home', text: '回到牌組',
          onclick: function () { goBackTo(deckHash(deckId)); } })])]), 'quiz-empty:' + deckId);
      return;
    }
    if (quiz.finished) {
      mount(screen('quiz', [topbar(title, quit), resultsView(deck)]), 'quiz-results:' + quiz.id);
      return;
    }
    renderQuestionScreen(title, quit);
  }

  function renderQuestionScreen(title, quit) {
    var spell = quiz.mode === 'spell';
    var prev = quiz.ui;
    var ui = quiz.ui = {
      count: h('span', { class: 'topbar-count', id: 'quiz-count' }),
      bar: h('i'),
      prompt: h('div'),
      feedback: h('div', { id: 'quiz-feedback', role: 'status' }),
      bottom: spell ? null : h('div', { class: 'bottombar' })
    };
    var body;
    if (spell) {
      buildSpellControls(ui);
      if (prev && prev.input) ui.input.value = prev.input.value; // re-rendered while typing
      body = [ui.prompt,
        h('div', { class: 'spell-form' }, h('div', { class: 'spell-row' }, ui.input, ui.submit, ui.next), ui.giveup),
        ui.feedback];
    } else {
      ui.options = h('div', { role: 'group', 'aria-label': '選出中文意思' });
      ui.explain = h('div');
      body = [ui.prompt, ui.options, ui.feedback, ui.explain];
    }
    var main = screen('quiz', [
      topbar(title, quit, ui.count),
      h('div', { class: 'progress quiz-progress', 'aria-hidden': 'true' }, ui.bar),
      h('div', { class: 'content quiz-content' + (spell ? ' no-bottombar' : '') }, body),
      ui.bottom
    ]);
    main.addEventListener('click', onQuizScreenClick);
    mount(main, 'quiz:' + quiz.id);
    fillQuestion();
    if (spell && !currentQuestion().result) focusSpellInput();
    speakQuestion();
  }

  /** Show the current question (and its feedback once answered) in the question screen. */
  function fillQuestion() {
    var ui = quiz.ui;
    var q = currentQuestion();
    var total = quiz.questions.length;
    ui.count.textContent = (quiz.i + 1) + ' / ' + total;
    ui.bar.style.width = Math.round((quiz.i + (q.result ? 1 : 0)) / total * 100) + '%';
    if (quiz.mode === 'spell') fillSpell(q); else fillChoice(q);
    ui.prompt.setAttribute('data-card-id', q.cardId);
    quiz.enter = false;
  }

  function nextLabel() { return quiz.i + 1 >= quiz.questions.length ? '看結果' : '下一題'; }

  function fillChoice(q) {
    var ui = quiz.ui;
    var res = q.result;
    clear(ui.prompt);
    ui.prompt.className = 'quiz-prompt' + (quiz.enter ? ' enter' : '');
    ui.prompt.appendChild(h('h2', { class: 'word ' + lenClass(q.word), lang: 'en', text: q.word }));
    append(ui.prompt, phoneticRow(q));

    clear(ui.options);
    ui.options.className = 'opts' + (res ? ' answered' : '') + (quiz.enter ? ' enter' : '');
    q.options.forEach(function (text, i) {
      var mark = !res ? '' : i === q.answerIndex ? ' correct' : i === res.chosen ? ' wrong' : ' dim';
      ui.options.appendChild(h('button', {
        type: 'button', class: 'opt' + mark + (res && i === res.chosen ? ' chosen' : ''),
        'data-action': 'option-' + i, 'aria-disabled': res ? 'true' : null,
        onclick: function () { answerChoice(i); }
      },
        h('span', { class: 'opt-key', 'aria-hidden': 'true', text: String(i + 1) }),
        h('span', { class: 'opt-text', text: oneLine(text) }),
        mark === ' correct' ? icon('check', 'opt-mark') : mark === ' wrong' ? icon('close', 'opt-mark') : null));
    });

    ui.feedback.className = 'sr-only' + (res ? (res.correct ? ' ok' : ' bad') : '');
    ui.feedback.textContent = !res ? '' : res.correct ? '答對了' : '答錯了，正確答案是 ' + oneLine(q.options[q.answerIndex]);

    clear(ui.explain);
    var card = res && cardById(q.cardId);
    var ex = card && exampleBlock(card);
    ui.explain.className = ex ? 'quiz-explain' : '';
    append(ui.explain, ex);

    clear(ui.bottom);
    if (res) {
      ui.bottom.appendChild(h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'quiz-next',
        text: nextLabel(), onclick: nextQuestion }));
    }
  }

  function answerChoice(i) {
    var q = currentQuestion();
    if (!q || q.result || quiz.mode !== 'choice' || !(i >= 0 && i < q.options.length)) return;
    q.result = { correct: i === q.answerIndex, chosen: i };
    recordAnswer(q);
    fillQuestion();
    if (q.result.correct) quiz.timer = setTimeout(nextQuestion, AUTO_NEXT_MS);
  }

  /** Choice quiz: after a right answer, a tap anywhere moves on without waiting. */
  function onQuizScreenClick(e) {
    if (!quiz || !quiz.timer || quiz.mode !== 'choice' || perfNow() - quiz.answeredAt < 150) return;
    var t = e.target;
    if (t && t.closest && t.closest('[data-action="quiz-quit"], [data-action="speak"]')) return;
    nextQuestion();
  }

  /** A tap on these keeps the focus (and so the phone keyboard) in the answer box. */
  function keepFocus(btn) {
    btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    return btn;
  }

  function buildSpellControls(ui) {
    ui.input = h('input', {
      id: 'spell-input', class: 'input spell-input', type: 'text', lang: 'en', placeholder: '輸入完整單字',
      autocapitalize: 'none', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done',
      'aria-label': '輸入完整單字'
    });
    ui.input.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (e.repeat) return;
      var q = currentQuestion();
      if (q && q.result) nextQuestion(); else submitSpell(false);
    });
    // Answered: the box keeps what was typed. It is not made read-only, so it keeps the focus and
    // the phone keyboard stays up for the next question.
    ui.input.addEventListener('beforeinput', function (e) { if (ui.locked) e.preventDefault(); });
    ui.input.addEventListener('input', function () { if (ui.locked) ui.input.value = ui.lockedValue; });
    ui.submit = keepFocus(h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'spell-submit',
      text: '確認', onclick: function () { submitSpell(false); } }));
    ui.next = keepFocus(h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'quiz-next',
      onclick: nextQuestion }));
    ui.giveup = keepFocus(h('button', { type: 'button', class: 'text-link spell-giveup', 'data-action': 'spell-giveup',
      text: '不會，看答案', onclick: function () { submitSpell(true); } }));
  }

  /** The hidden word: kept letters as text, every hidden letter a '_' (text = the mask, e.g. a_______d). */
  function clozeMask(masked) {
    var el = h('span', { class: 'cloze-mask' });
    str(masked).split('').forEach(function (ch) {
      append(el, ch === '_' ? h('span', { class: 'gap', text: '_' }) : ch);
    });
    return el;
  }

  function fillSpell(q) {
    var ui = quiz.ui;
    var res = q.result;
    var cz = q.cloze;
    clear(ui.prompt);
    ui.prompt.className = 'quiz-card' + (quiz.enter ? ' enter' : '');
    ui.prompt.appendChild(h('p', { class: 'cloze', lang: 'en' },
      cz.before,
      res ? h('mark', { class: res.correct ? 'ok' : 'bad', text: cz.answer }) : clozeMask(cz.masked),
      cz.after));
    if (q.hint) ui.prompt.appendChild(h('p', { class: 'quiz-hint', text: q.hint }));

    ui.locked = !!res;
    ui.lockedValue = ui.input.value;
    ui.input.classList.toggle('ok', !!res && res.correct);
    ui.input.classList.toggle('bad', !!res && !res.correct);
    ui.input.setAttribute('aria-readonly', String(!!res));
    ui.submit.hidden = !!res;
    ui.giveup.hidden = !!res;
    ui.next.hidden = !res;
    ui.next.textContent = nextLabel();

    clear(ui.feedback);
    ui.feedback.className = 'quiz-feedback' + (res ? (res.correct ? ' ok' : ' bad') : '');
    if (!res) return;
    if (res.correct) {
      ui.feedback.appendChild(h('p', { class: 'fb-title' }, icon('check'), '答對了'));
      return;
    }
    ui.feedback.appendChild(h('p', { class: 'fb-title' }, icon('close'), '正確答案：',
      h('b', { class: 'fb-answer', lang: 'en', text: cz.answer })));
    if (res.input) {
      ui.feedback.appendChild(h('p', { class: 'fb-line' }, '你的答案：', h('span', { class: 'fb-input', lang: 'en', text: res.input })));
    }
    if (res.meaning) {
      ui.feedback.appendChild(h('p', { class: 'fb-meaning' },
        h('b', { lang: 'en', text: res.word }), h('span', { text: oneLine(res.meaning) })));
    }
  }

  function submitSpell(giveUp) {
    var q = currentQuestion();
    if (!q || q.result || quiz.mode !== 'spell') return;
    var typed = quiz.ui.input.value.trim();
    if (!giveUp && !typed) { focusSpellInput(); return; } // empty: nothing to check yet
    q.result = { correct: !giveUp && VC.checkSpelling(typed, q.cloze.answer), input: giveUp ? '' : typed, gaveUp: !!giveUp };
    recordAnswer(q);
    fillQuestion();
    if (q.result.correct) {
      quiz.timer = setTimeout(nextQuestion, AUTO_NEXT_MS);
    } else if (quiz.ui.feedback.scrollIntoView) {
      quiz.ui.feedback.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    }
  }

  function focusSpellInput() {
    var input = quiz && quiz.ui && quiz.ui.input;
    if (!input || document.activeElement === input) return;
    try { input.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  /** Count the answer on the card (card.right / card.wrong); keep the word for the results list. */
  function recordAnswer(q) {
    var res = q.result;
    var card = cardById(q.cardId);
    res.word = card ? card.word : q.word || (q.cloze && q.cloze.answer) || '';
    res.meaning = card ? card.meaning : q.options ? q.options[q.answerIndex] : '';
    if (card) {
      if (res.correct) card.right = (card.right || 0) + 1;
      else card.wrong = (card.wrong || 0) + 1;
      scheduleSave();
    }
    quiz.answeredAt = perfNow();
    try { if (navigator.vibrate) navigator.vibrate(res.correct ? 8 : [14, 70, 14]); } catch (e) { /* ignore */ }
  }

  function nextQuestion() {
    stopQuizTimer();
    var q = currentQuestion();
    if (!q || !q.result) return;
    if (quiz.i + 1 >= quiz.questions.length) { finishQuiz(); return; }
    quiz.i++;
    quiz.enter = true;
    if (!quiz.ui || !document.documentElement.contains(quiz.ui.prompt)) { render(); return; }
    if (quiz.ui.input) quiz.ui.input.value = '';
    window.scrollTo(0, 0);
    fillQuestion();
    if (quiz.mode === 'spell') focusSpellInput();
    speakQuestion();
  }

  /** 自動朗讀 in the choice quiz: the English word of each question, once. */
  function speakQuestion() {
    var q = currentQuestion();
    if (!q || quiz.mode !== 'choice' || !state.prefs.autoSpeak) return;
    var tag = quiz.id + ':' + quiz.i;
    if (quiz.spoken === tag) return;
    quiz.spoken = tag;
    speak(q.word);
  }

  function finishQuiz() {
    stopQuizTimer();
    quiz.finished = true;
    var deck = deckById(quiz.deckId);
    if (deck && !quiz.retry) {
      deck.lastQuiz[quiz.mode] = { score: quizScore(), total: quiz.questions.length, at: now() };
      scheduleSave();
    }
    render();
  }

  function quitQuiz() {
    var answered = quiz && !quiz.finished && quiz.questions.some(function (q) { return q.result; });
    if (!answered) { goBack(); return; }
    stopQuizTimer();
    confirmDialog({ title: '要結束測驗嗎？', message: '這次的成績不會保存。', okText: '結束', cancelText: '繼續作答' })
      .then(function (ok) {
        if (ok) goBack();
        else if (quiz && quiz.mode === 'spell') focusSpellInput();
      });
  }

  /** 「重測答錯的 N 題」: the same questions again (choice: answers in a new order). */
  function retryWrong() {
    var mode = quiz.mode;
    var questions = quiz.questions.filter(function (q) { return !q.result || !q.result.correct; }).map(function (q) {
      var c = Object.assign({}, q);
      delete c.result;
      if (mode === 'choice') {
        c.options = VC.shuffle(q.options, rand);
        c.answerIndex = c.options.indexOf(q.options[q.answerIndex]);
      }
      return c;
    });
    if (!questions.length) return;
    quiz = newQuizSession(quiz.deckId, mode, questions, true);
    render();
  }

  /** Progress ring around the score (fixed shapes; only numbers go into the attributes). */
  function scoreRing(pct) {
    var NS = 'http://www.w3.org/2000/svg';
    var r = 52;
    var len = 2 * Math.PI * r;
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('aria-hidden', 'true');
    var circle = function (cls) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('class', cls);
      c.setAttribute('cx', '60');
      c.setAttribute('cy', '60');
      c.setAttribute('r', String(r));
      svg.appendChild(c);
      return c;
    };
    circle('ring-track');
    if (pct > 0) {
      var bar = circle('ring-bar');
      bar.setAttribute('stroke-dasharray', len.toFixed(2));
      bar.setAttribute('stroke-dashoffset', (len * (1 - pct / 100)).toFixed(2));
      bar.style.setProperty('--len', len.toFixed(2));
    }
    return svg;
  }

  function resultsView(deck) {
    var mode = quiz.mode;
    var total = quiz.questions.length;
    var score = quizScore();
    var pct = Math.round(score / total * 100);
    var wrong = quiz.questions.filter(function (q) { return !q.result || !q.result.correct; });

    var actions = h('div', { class: 'results-actions' },
      wrong.length ? h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'retry-wrong',
        onclick: retryWrong }, icon('reset'), '重測答錯的 ' + wrong.length + ' 題') : null,
      h('button', { type: 'button', class: 'btn btn-lg ' + (wrong.length ? 'btn-secondary' : 'btn-primary'),
        'data-action': 'quiz-again', text: '再測一次', onclick: function () { startQuiz(deck.id, mode); render(); } }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-lg', 'data-action': 'quiz-home', text: '回到牌組',
        onclick: function () { goBackTo(deckHash(deck.id)); } }));

    var list = null;
    if (wrong.length) {
      list = [h('h2', { class: 'section-title', text: '答錯的單字' }),
        h('div', { class: 'word-list wrong-list' }, wrong.map(function (q) {
          var r = q.result || {};
          // Spelling: the form the sentence needed, when it is not the word itself (abandon → abandoned).
          var form = mode === 'spell' && q.cloze.answer.toLowerCase() !== str(r.word).toLowerCase() ? q.cloze.answer : '';
          return h('div', { class: 'wl-row', 'data-card-id': q.cardId },
            h('div', { class: 'wr-main' },
              h('div', { class: 'wr-word', lang: 'en', text: r.word }),
              h('div', { class: 'wr-meaning', text: oneLine(r.meaning) })),
            form ? h('span', { class: 'pill p-form', lang: 'en', text: form }) : null);
        }))];
    }

    return h('div', { class: 'content no-bottombar results', id: 'quiz-results' },
      h('div', { class: 'score' }, scoreRing(pct),
        h('div', { class: 'score-center' },
          h('p', { class: 'score-num', id: 'quiz-score' }, h('b', { text: String(score) }), ' / ' + total),
          h('p', { class: 'score-pct', text: pct + '%' }))),
      h('h2', { class: 'score-line', text: pct >= 90 ? '太厲害了！' : pct >= 70 ? '不錯喔，繼續加油！' : '多練幾次就會記住了！' }),
      h('p', { class: 'score-sub', text: quiz.retry ? '重測答錯的題目' : QUIZ_TITLES[mode] + ' · ' + total + ' 題' }),
      actions,
      list);
  }

  /* =====================================================================================
   * Card editor sheet (flashcards, deck, browse)
   * opts: { deckId, cardId?, onChange? }
   * ===================================================================================== */

  function findDuplicate(deckId, word, exceptId) {
    var k = VC.normalizeWord(word);
    for (var i = 0; i < state.cards.length; i++) {
      var c = state.cards[i];
      if (c.deckId === deckId && c.id !== exceptId && VC.normalizeWord(c.word) === k) return c;
    }
    return null;
  }

  function openCardSheet(opts) {
    var card = opts.cardId ? cardById(opts.cardId) : null;
    var isNew = !card;
    var src = card || {};
    var ov;
    var changed = function () { if (opts.onChange) opts.onChange(); };
    var noAuto = { autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', autocomplete: 'off' };

    var inputs = {
      word: h('input', Object.assign({ id: 'f-word', class: 'input word-input', type: 'text', lang: 'en', placeholder: '例如 abandon', enterkeyhint: 'next' }, noAuto)),
      phonetic: h('input', Object.assign({ id: 'f-phonetic', class: 'input', type: 'text', placeholder: '/əˈbændən/（可留空）', enterkeyhint: 'next' }, noAuto)),
      meaning: autoGrow(h('textarea', { id: 'f-meaning', class: 'input', rows: 1, placeholder: '例如 v. 放棄；拋棄' })),
      example: autoGrow(h('textarea', Object.assign({ id: 'f-example', class: 'input', rows: 1, lang: 'en', placeholder: 'He abandoned his car in the snow.' }, noAuto))),
      exampleZh: autoGrow(h('textarea', { id: 'f-exampleZh', class: 'input', rows: 1, placeholder: '他把車丟在雪地裡。' })),
      note: autoGrow(h('textarea', { id: 'f-note', class: 'input', rows: 1, placeholder: '同義字、片語、記憶法…' }))
    };
    CARD_TEXT_FIELDS.forEach(function (k) { inputs[k].value = str(src[k]); });
    // Phone keyboards: 「下一項」 on 單字 / 音標 moves on without closing the keyboard.
    [[inputs.word, inputs.phonetic], [inputs.phonetic, inputs.meaning]].forEach(function (pair) {
      pair[0].addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); pair[1].focus(); }
      });
    });

    function read() {
      var f = {};
      CARD_TEXT_FIELDS.forEach(function (k) { f[k] = inputs[k].value.trim(); });
      return f;
    }

    function save(addAnother) {
      var f = read();
      if (!f.word) { toast('請輸入單字', 'error'); inputs.word.focus(); return; }
      if (!f.meaning) { toast('請輸入中文意思', 'error'); inputs.meaning.focus(); return; }
      var dup = findDuplicate(opts.deckId, f.word, card && card.id);
      var go2 = dup ? confirmDialog({
        title: '「' + dup.word + '」已經在這個牌組裡',
        message: isNew ? '仍要再新增一張嗎？' : '仍要儲存嗎？',
        okText: isNew ? '仍要新增' : '仍要儲存'
      }) : Promise.resolve(true);
      go2.then(function (ok) {
        if (!ok) return;
        if (isNew) {
          addCard(opts.deckId, f);
          toast('已新增「' + f.word + '」');
        } else {
          var cur = cardById(card.id);
          if (!cur) { closeOverlay(ov); return; }
          replaceCard(Object.assign({}, cur, f));
          toast('已儲存');
        }
        scheduleSave();
        changed();
        if (addAnother) {
          CARD_TEXT_FIELDS.forEach(function (k) {
            inputs[k].value = '';
            inputs[k].dispatchEvent(new Event('input'));
          });
          inputs.word.focus();
        } else {
          closeOverlay(ov);
        }
      });
    }

    var tested = card && (card.right || card.wrong);
    var body = h('div', { class: 'sheet-body' },
      tested ? h('p', { class: 'sheet-meta', text: '測驗：答對 ' + (card.right || 0) + '・答錯 ' + (card.wrong || 0) }) : null,
      field('單字', inputs.word, null, true),
      field('音標', inputs.phonetic),
      field('中文意思', inputs.meaning, null, true),
      field('例句', inputs.example, '例句裡要有這個單字，拼字題才能從例句出題。'),
      field('例句翻譯', inputs.exampleZh),
      field('備註', inputs.note));

    if (card) {
      body.appendChild(h('button', { type: 'button', class: 'btn btn-danger-text btn-block', 'data-action': 'card-delete',
        onclick: function () {
          confirmDialog({ title: '刪除「' + card.word + '」？', message: '刪除後無法復原。', okText: '刪除', danger: true })
            .then(function (ok) {
              if (!ok) return;
              state.cards = state.cards.filter(function (c) { return c.id !== card.id; });
              scheduleSave();
              closeOverlay(ov);
              changed();
              toast('已刪除「' + card.word + '」');
            });
        } }, icon('trash'), '刪除這個單字'));
    }

    var foot = h('div', { class: 'sheet-foot' },
      isNew ? h('button', { type: 'button', class: 'btn btn-secondary btn-lg', 'data-action': 'card-save-next',
        text: '儲存並繼續新增', onclick: function () { save(true); } }) : null,
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'card-save',
        text: '儲存', onclick: function () { save(false); } }));

    ov = openSheet({ title: isNew ? '新增單字' : '編輯單字', body: body, foot: foot, focus: isNew ? inputs.word : null });
  }

  /* =====================================================================================
   * Browse / edit words
   * ===================================================================================== */

  var browse = { deckId: null, q: '', limit: 200 };

  /** 「錯 N」 for a word answered wrong in a quiz, nothing otherwise. */
  function wrongPill(card) {
    return card.wrong > 0 ? h('span', { class: 'pill p-wrong', title: '測驗答錯 ' + card.wrong + ' 次', text: '錯 ' + card.wrong }) : null;
  }

  function oneLine(s) { return str(s).replace(/\s*\n\s*/g, '；'); }

  function renderBrowse(deckId) {
    var deck = deckById(deckId);
    if (!deck) { toast('找不到這個牌組'); navigate('#/', true); return; }
    if (browse.deckId !== deckId) browse = { deckId: deckId, q: '', limit: 200 };
    var rerender = function () { renderBrowse(deckId); };

    var search = h('input', {
      id: 'browse-search', class: 'input', type: 'search', placeholder: '搜尋單字或中文意思', value: browse.q,
      autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'search',
      'aria-label': '搜尋單字'
    });
    var clearBtn = iconBtn('close', '清除搜尋', 'clear-search', function () {
      search.value = '';
      browse.q = '';
      browse.limit = 200;
      updateList();
      search.focus();
    }, 'clear');
    var meta = h('p', { class: 'list-meta' });
    var listWrap = h('div');

    function updateList() {
      clearBtn.hidden = !browse.q;
      clear(listWrap);
      var all = cardsOfDeck(deckId);
      var q = browse.q.trim().toLowerCase();
      var shown = q ? all.filter(function (c) {
        return c.word.toLowerCase().indexOf(q) >= 0 || c.meaning.toLowerCase().indexOf(q) >= 0;
      }) : all;
      meta.textContent = q ? '找到 ' + shown.length + ' 個' : '共 ' + fmtNum(all.length) + ' 字';
      if (!all.length) {
        listWrap.appendChild(h('div', { class: 'word-list list-empty' },
          h('p', null, '這個牌組還沒有單字。', h('br'), '可以匯入文字檔，或點下方「＋ 新增單字」一個一個加。'),
          h('button', { type: 'button', class: 'btn btn-tonal', 'data-action': 'import-to-deck',
            onclick: function () { openImport(deckId); } }, icon('upload'), '匯入單字到這個牌組')));
        return;
      }
      if (!shown.length) {
        listWrap.appendChild(h('div', { class: 'word-list' }, h('p', { class: 'list-empty', text: '找不到「' + browse.q.trim() + '」' })));
        return;
      }
      var list = h('div', { class: 'word-list' });
      var addRows = function (from, to) {
        var frag = document.createDocumentFragment();
        shown.slice(from, to).forEach(function (c) {
          frag.appendChild(h('button', {
            type: 'button', class: 'word-row', 'data-action': 'card-row', 'data-card-id': c.id,
            onclick: function () { openCardSheet({ deckId: deckId, cardId: c.id, onChange: rerender }); }
          },
            h('div', { class: 'wr-main' },
              h('div', { class: 'wr-word', lang: 'en', text: c.word }),
              h('div', { class: 'wr-meaning', text: oneLine(c.meaning) })),
            wrongPill(c)));
        });
        list.appendChild(frag);
      };
      addRows(0, browse.limit);
      listWrap.appendChild(list);
      if (shown.length > browse.limit) {
        var moreBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-action': 'show-more' });
        var moreWrap = h('div', { class: 'more-wrap' }, moreBtn);
        var setMoreText = function () { moreBtn.textContent = '顯示更多（還有 ' + (shown.length - browse.limit) + ' 個）'; };
        setMoreText();
        // Append the next rows only; rebuilding the whole list gets slow with thousands of words.
        moreBtn.addEventListener('click', function () {
          var from = browse.limit;
          browse.limit += 300;
          addRows(from, browse.limit);
          if (shown.length > browse.limit) setMoreText();
          else moreWrap.parentNode.removeChild(moreWrap);
        });
        listWrap.appendChild(moreWrap);
      }
    }

    search.addEventListener('input', debounce(function () {
      browse.q = search.value;
      browse.limit = 200;
      updateList();
    }, 120));
    search.addEventListener('keydown', function (e) { if (e.key === 'Enter') search.blur(); });
    updateList();

    var gear = iconBtn('sliders', '牌組設定', 'deck-settings', function () { openDeckSettings(deckId); });
    var bottom = h('div', { class: 'bottombar' },
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'add-card',
        onclick: function () { openCardSheet({ deckId: deckId, onChange: rerender }); } }, icon('plus'), '新增單字'));

    mount(screen('browse', [
      topbar(deck.name, backBtn(), gear),
      h('div', { class: 'content' }, h('div', { class: 'search' }, icon('search'), search, clearBtn), meta, listWrap),
      bottom
    ]), 'browse:' + deckId);
  }

  /* =====================================================================================
   * Import
   * ===================================================================================== */

  var IMPORT_ACCEPT = '.txt,.tsv,.csv,.md,.json,text/plain,text/markdown';
  var DEFAULT_SECTION = 'VC_DEFAULT_SECTION_9f2c41';
  var MAX_FILE_BYTES = 10 * 1024 * 1024;
  var NOT_A_BACKUP = '這不是單字卡的備份檔。要新增單字，請用 .txt 文字檔（見匯入畫面的「文字檔格式說明」）。';
  var EXAMPLE_TEXT = [
    '#deck: 高中英文 Level 1',
    '# 以 # 開頭（但不是 #deck:）的行是註解，會被忽略',
    'abandon | /əˈbændən/ | v. 放棄；拋棄 | He abandoned his car in the snow. | 他把車丟在雪地裡。',
    'ability | n. 能力 | She has the ability to learn fast. | 她有快速學習的能力。',
    'absent | adj. 缺席的'
  ].join('\n');
  // 「複製給 Claude 的說明」: the generation rules + a fill-in request.
  // Keep identical to the block in 格式說明.md §11 (tests/e2e.html checks this).
  var CLAUDE_PROMPT = [
    '請幫我做一份英文單字檔，要能直接匯入「單字卡」App。',
    '主題和字數：（例如：學測 Level 4 單字 30 個）',
    '牌組名稱：（例如：Level 4 第 1 回）',
    '',
    '請嚴格遵守下面的格式：',
    '1. 如果你能直接產生檔案，就給我 UTF-8 的 .txt 檔；否則把整份內容放在一個 ```text 程式碼區塊裡。只輸出檔案內容本身，不要用 Markdown 表格、編號、項目符號或粗體。',
    '2. 開頭可以有幾行 # 開頭的註解（主題、字數），但註解不要以 #deck 開頭。',
    '3. 每個牌組用一行「#deck: 牌組名稱」開始；一個牌組只寫一次 #deck:，不同牌組的名稱不要重複。',
    '4. 一行一張卡，固定格式：',
    '   word | /IPA/ | pos. 中文意思 | Natural English example sentence. | 自然的中文翻譯',
    '   需要時可以加第 6 欄備註（片語、常見搭配、同反義字），例如：| be reluctant to + V 不情願做……',
    '5. 分隔符號一律用半形 |，前後各空一格；不要用 Tab 或逗號。欄位內容裡不要出現 |（真的需要就寫 \\|），也不要換行（需要時寫 \\n）。',
    '6. 音標用美式（General American）IPA，寫在 /…/ 裡，例如 /əˈbændən/；名詞、動詞唸法不同時都寫在這一欄，例如 /ˈprezənt/ (n.) /prɪˈzent/ (v.)。不確定音標時整欄省略（直接寫 word | pos. 中文意思 | …），不要留空欄。',
    '7. 中文意思用台灣慣用的繁體中文，詞性縮寫放最前面（n. v. adj. adv. prep. conj. pron. phr. 等）；同一詞性的多個意思用全形分號「；」隔開，不同詞性接著寫，例如 v. 接近；靠近；n. 方法。',
    '8. 例句要自然、符合高中程度，而且一定要包含這個單字本身或它的規則變化（-s、-es、-ed、-ing、-er、-est、-ly）；不要用不規則變化（例如 take 不要寫成 took、buy 不要寫成 bought），片語要完整出現（give up 可以寫 gives up、giving up，但不要拆成 give it up），因為 App 的拼字測驗會從例句裡把這個字挖空。翻譯用自然的台灣口語。',
    '9. 不要加標題列（例如 word | meaning），同一個單字只寫一行，不要重複。',
    '',
    '範例：',
    '#deck: 學測 Level 4・第 1 回',
    'abandon | /əˈbændən/ | v. 拋棄；放棄 | Someone abandoned the puppy on the side of the road. | 有人把那隻小狗丟在路邊。',
    'reluctant | /rɪˈlʌktənt/ | adj. 不情願的；勉強的 | He was reluctant to admit his mistake. | 他不太願意承認自己的錯誤。 | be reluctant to + V 不情願做……',
    'give up | phr. 放棄 | Don\'t give up on your dreams. | 不要放棄你的夢想。'
  ].join('\n');

  var imp = { files: [], text: '', target: 'new', names: {}, dupMode: 'skip', focusPaste: false };
  var impUI = null;

  function resetImport() {
    imp = { files: [], text: '', target: 'new', names: {}, dupMode: 'skip', focusPaste: false };
  }

  /**
   * Open the import screen. deckId: words without #deck go into that deck (opened from an empty
   * deck); otherwise into a new deck. Text or files still waiting there are kept.
   */
  function openImport(deckId, focusPaste) {
    if (!imp.text.trim() && !imp.files.length) resetImport();
    if (deckId) imp.target = deckId;
    if (focusPaste) imp.focusPaste = true;
    return go('#/import');
  }

  function importSources() {
    var list = imp.files.map(function (f) {
      return { id: f.id, name: f.name, defaultDeckName: stripExt(f.name) || '我的單字', text: f.text };
    });
    if (imp.text.trim()) list.push({ id: 'paste', name: '貼上的文字', defaultDeckName: '我的單字', text: imp.text });
    return list;
  }

  /** Same word twice in one file ("present | n. 禮物" / "present | v. 呈現"): one card, both meanings. */
  function mergeFields(target, f) {
    if (f.meaning && str(target.meaning).indexOf(f.meaning) === -1) {
      target.meaning = target.meaning ? target.meaning + '\n' + f.meaning : f.meaning;
    }
    // A second pronunciation is kept as well ("record /ˈrekərd/ n." + "/rɪˈkɔːrd/ v.").
    if (f.phonetic && str(target.phonetic).indexOf(f.phonetic) === -1) {
      target.phonetic = target.phonetic ? target.phonetic + ' ' + f.phonetic : f.phonetic;
    }
    // An example and its translation only come together (never one line's sentence with another's).
    if (!target.example && !target.exampleZh) {
      if (f.example) target.example = f.example;
      if (f.exampleZh) target.exampleZh = f.exampleZh;
    }
    if (!target.note && f.note) target.note = f.note;
  }

  // Parse results of the last planImport call: typing a deck name or switching the duplicate
  // mode re-plans the import without parsing the whole text again.
  var parseCache = [];

  function parseSource(src, used) {
    var csv = /\.csv$/i.test(str(src.name));
    var hit = null;
    for (var i = 0; i < parseCache.length && !hit; i++) {
      if (parseCache[i].csv === csv && parseCache[i].text === src.text) hit = parseCache[i];
    }
    if (!hit) hit = { text: src.text, csv: csv, parsed: VC.parseDeckText(src.text, { defaultDeckName: DEFAULT_SECTION, csv: csv }) || {} };
    used.push(hit);
    return hit.parsed;
  }

  /**
   * Work out where every parsed card would go, without changing anything.
   * sources: [{ id, name, defaultDeckName, text }]
   * opts: { target: 'new' | deckId, names: { [sourceId]: deckName }, dupMode: 'skip' | 'update' }
   */
  function planImport(sources, opts) {
    var dupMode = opts.dupMode === 'update' ? 'update' : 'skip';
    var targetDeck = opts.target && opts.target !== 'new' ? deckById(opts.target) : null;
    var groups = {};
    var order = [];
    var errors = [];
    var needsName = [];
    var perSource = {};
    var badChar = String.fromCharCode(0xFFFD);
    var suspectEncoding = false;
    var skipped = 0;
    var used = [];

    function groupFor(dest, fromSection) {
      var key = dest.deck ? 'id:' + dest.deck.id : 'new:' + deckKey(dest.name);
      var g = groups[key];
      if (g) return g;
      // Word-keyed maps without a prototype: "constructor" / "__proto__" are ordinary words.
      g = groups[key] = {
        key: key, deckId: dest.deck ? dest.deck.id : null, name: dest.deck ? dest.deck.name : dest.name,
        isNew: !dest.deck, fromSection: fromSection, adds: [], updates: [], dups: 0, merged: 0,
        seen: Object.create(null), existing: Object.create(null)
      };
      if (dest.deck) {
        state.cards.forEach(function (c) {
          if (c.deckId !== dest.deck.id) return;
          var k = VC.normalizeWord(c.word);
          if (!g.existing[k]) g.existing[k] = c;
        });
      }
      order.push(key);
      return g;
    }

    function destByName(name) {
      var nm = str(name).trim() || '我的單字';
      var d = deckByLooseName(nm);
      return d ? { deck: d } : { name: nm };
    }

    sources.forEach(function (src) {
      var parsed = parseSource(src, used);
      var stat = perSource[src.id] = { cards: 0, errors: (parsed.errors || []).length };
      skipped += (parsed.skipped || []).length; // chat text around a ``` block
      if (str(src.text).indexOf(badChar) !== -1) suspectEncoding = true;
      (parsed.errors || []).forEach(function (e) {
        errors.push({ source: src.name, line: e.line, text: e.text, reason: e.reason });
      });
      (parsed.decks || []).forEach(function (sec) {
        var isDefault = sec.name === DEFAULT_SECTION;
        var dest;
        if (isDefault) {
          if (needsName.indexOf(src.id) < 0) needsName.push(src.id);
          if (targetDeck) dest = { deck: targetDeck };
          else dest = destByName(opts.names && opts.names[src.id] != null ? opts.names[src.id] : src.defaultDeckName);
        } else {
          dest = destByName(sec.name);
        }
        var g = groupFor(dest, !isDefault);
        (sec.cards || []).forEach(function (c) {
          stat.cards++;
          if (c.phonetic && c.phonetic.indexOf('?') !== -1) suspectEncoding = true; // IPA lost in an ANSI file
          var k = VC.normalizeWord(c.word);
          var f = cardFields(c);
          var seen = g.seen[k];
          // Two lines with their own, different example sentences stay two cards ("May" the
          // month and "may"; or a deck exported with the same word twice).
          if (seen && !(seen.add && f.example && seen.fields.example && f.example !== seen.fields.example)) {
            if (seen.fields) { mergeFields(seen.fields, f); g.merged++; } else g.dups++;
            return;
          }
          var ex = g.existing[k];
          if (!ex || seen) {
            g.adds.push(f);
            if (!seen) g.seen[k] = { fields: f, add: true };
          } else if (dupMode === 'update') {
            // Only what the file actually has: empty fields keep the card's current text, and the
            // word keeps its spelling (it matched anyway).
            var upd = {};
            CARD_TEXT_FIELDS.forEach(function (key) { if (key !== 'word' && f[key]) upd[key] = f[key]; });
            g.updates.push({ id: ex.id, current: ex, fields: upd });
            g.seen[k] = { fields: upd };
          } else {
            g.dups++;
            g.seen[k] = { fields: null };
          }
        });
      });
    });

    parseCache = used;
    var list = order.map(function (k) { return groups[k]; });
    // dup: already in the deck (skipped / updated); merged: repeated in the file, merged into one card.
    var totals = { add: 0, update: 0, dup: 0, merged: 0, err: errors.length, skipped: skipped };
    list.forEach(function (g) {
      totals.add += g.adds.length;
      totals.update += g.updates.length;
      totals.dup += g.dups;
      totals.merged += g.merged;
    });
    return { groups: list, errors: errors, totals: totals, needsName: needsName, dupMode: dupMode,
      perSource: perSource, suspectEncoding: suspectEncoding };
  }

  /** Apply a plan. If the result cannot be saved (storage full), nothing changes: res.failed. */
  function applyPlan(plan) {
    var res = { added: 0, updated: 0, skipped: plan.totals.dup + plan.totals.merged, errors: plan.errors.length, deckIds: [] };
    var saved = transaction(function () {
      plan.groups.forEach(function (g) {
        if (!g.adds.length && !g.updates.length) return;
        var deckId = g.deckId;
        if (!deckId || !deckById(deckId)) {
          var existing = deckByLooseName(g.name);
          deckId = existing ? existing.id : createDeck(g.name).id;
        }
        g.adds.forEach(function (f) { addCard(deckId, f); res.added++; });
        g.updates.forEach(function (u) {
          var cur = cardById(u.id);
          if (cur) { replaceCard(Object.assign({}, cur, u.fields)); res.updated++; }
        });
        if (res.deckIds.indexOf(deckId) < 0) res.deckIds.push(deckId);
      });
      return res.added || res.updated;
    });
    if (!saved) return { added: 0, updated: 0, skipped: res.skipped, errors: res.errors, deckIds: [], failed: true };
    return res;
  }

  function runImport(sources, opts) { return applyPlan(planImport(sources, opts)); }

  function currentImportOpts() {
    if (imp.target !== 'new' && !deckById(imp.target)) imp.target = 'new';
    return { target: imp.target, names: imp.names, dupMode: imp.dupMode };
  }

  function handleImportFiles(files) {
    var json = files.filter(isJsonFile);
    var texts = files.filter(function (f) { return !isJsonFile(f); });
    if (json.length) {
      restoreBackupFile(json[0]).then(function (isBackup) {
        if (!texts.length) return;
        if (isBackup) toast('已先處理備份檔，其他檔案請再匯入一次');
        else readTextFiles(texts); // not a backup: the word files still count
      });
      return;
    }
    readTextFiles(texts);
  }

  function readTextFiles(texts) {
    var tooBig = texts.filter(function (f) { return f.size > MAX_FILE_BYTES; });
    if (tooBig.length) toast('「' + tooBig[0].name + '」太大了（上限 10 MB）', 'error');
    texts = texts.filter(function (f) { return f.size <= MAX_FILE_BYTES; });
    if (!texts.length) return;
    Promise.all(texts.map(function (f) {
      return readFileBytes(f).then(function (bytes) {
        return { id: uid(), name: f.name, size: f.size, text: VC.decodeBytes(bytes) };
      });
    })).then(function (list) {
      imp.files = imp.files.concat(list);
      refreshImport();
    }).catch(function () {
      toast('讀取檔案失敗，請再試一次', 'error');
    });
  }

  function renderImport() {
    var fileInput = h('input', { type: 'file', id: 'file-input', accept: IMPORT_ACCEPT, multiple: true });
    fileInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(fileInput.files || []);
      fileInput.value = '';
      if (files.length) handleImportFiles(files);
    });
    var fine = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
    var dz = h('label', { class: 'dropzone', for: 'file-input', 'data-action': 'pick-file' },
      fileInput,
      h('span', { class: 'dz-icon' }, icon('upload')),
      h('span', { class: 'dz-title', text: '選擇文字檔' }),
      h('span', { class: 'dz-sub', text: fine ? '支援 .txt / .tsv / .csv，也可以把檔案拖曳到這裡' : '支援 .txt / .tsv / .csv，可一次選多個' }));
    ['dragenter', 'dragover'].forEach(function (t) {
      dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      dz.addEventListener(t, function () { dz.classList.remove('drag'); });
    });

    var ta = h('textarea', {
      id: 'import-text', class: 'input paste-area', rows: 5, spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off',
      placeholder: 'abandon | /əˈbændən/ | v. 放棄 | He abandoned his car. | 他棄車而去。\nability | n. 能力\nabsent | adj. 缺席的',
      'aria-label': '貼上單字文字'
    });
    ta.value = imp.text;
    var slowRefresh = debounce(refreshImport, 250);
    ta.addEventListener('input', function () {
      imp.text = ta.value;
      if (ta.value.length < 60000) refreshImport(); else slowRefresh(); // big pastes: don't re-parse per keystroke
    });

    var confirmBtn = h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'import-confirm',
      text: '匯入', disabled: true, onclick: doImport });

    impUI = {
      fileList: h('div', { class: 'file-list', id: 'import-files' }),
      options: h('div', { class: 'import-options', id: 'import-options' }),
      preview: h('div', { id: 'import-preview' }),
      confirmBtn: confirmBtn,
      optionsSig: null,
      textarea: ta
    };

    mount(screen('import', [
      topbar('匯入單字', backBtn()),
      h('div', { class: 'content' },
        dz,
        impUI.fileList,
        h('div', { class: 'or-line', text: '或直接貼上文字' }),
        ta,
        impUI.options,
        impUI.preview,
        claudeCta(),
        helpSection()),
      h('div', { class: 'bottombar' }, confirmBtn)
    ]), 'import');

    refreshImport();
    if (imp.focusPaste) {
      imp.focusPaste = false;
      setTimeout(function () { try { ta.focus(); } catch (e) { /* ignore */ } }, 60);
    }
  }

  function refreshImport() {
    if (!impUI || !document.documentElement.contains(impUI.preview)) return;
    var sources = importSources();
    var opts = currentImportOpts();
    var plan = planImport(sources, opts);

    // Selected files
    clear(impUI.fileList);
    imp.files.forEach(function (f) {
      var rm = iconBtn('close', '移除 ' + f.name, 'remove-file', function () {
        imp.files = imp.files.filter(function (x) { return x.id !== f.id; });
        delete imp.names[f.id];
        refreshImport();
      }, 'muted');
      rm.setAttribute('data-file-id', f.id);
      impUI.fileList.appendChild(h('div', { class: 'file-chip' }, icon('file'),
        h('span', { class: 'fname', text: f.name }),
        h('span', { class: 'fmeta', text: Math.max(1, Math.round(f.size / 1024)) + ' KB' }), rm));
    });

    // Options (rebuilt only when their structure changes, so typing keeps focus)
    var sig = JSON.stringify([sources.length > 0, opts.target, plan.needsName,
      plan.groups.some(function (g) { return g.fromSection; }), plan.totals.dup > 0 || imp.dupMode === 'update',
      state.decks.map(function (d) { return d.id + d.name; })]);
    if (sig !== impUI.optionsSig) {
      // A deck name typed so far may now match a deck with duplicates: keep the cursor in its box.
      var active = document.activeElement;
      var typing = active && active.classList && active.classList.contains('import-deck-name') ? active : null;
      impUI.optionsSig = sig;
      buildImportOptions(sources, plan);
      var again = typing && impUI.options.querySelector('.import-deck-name[data-source-id="' + cssEscape(typing.getAttribute('data-source-id')) + '"]');
      if (again) {
        try { again.focus(); again.setSelectionRange(typing.selectionStart, typing.selectionEnd); } catch (e) { /* ignore */ }
      }
    }

    buildImportPreview(sources, plan);
    var n = plan.totals.add + plan.totals.update;
    impUI.confirmBtn.disabled = n === 0;
    impUI.confirmBtn.textContent = n ? '匯入 ' + fmtNum(n) + ' 張' : '匯入';
  }

  function buildImportOptions(sources, plan) {
    var box = impUI.options;
    clear(box);
    if (!sources.length) return;

    var sel = h('select', { id: 'import-target', class: 'input', 'aria-label': '匯入到' },
      h('option', { value: 'new', text: '新牌組' }));
    state.decks.forEach(function (d) { sel.appendChild(h('option', { value: d.id, text: '加入：' + d.name })); });
    sel.value = imp.target;
    sel.addEventListener('change', function () { imp.target = sel.value; refreshImport(); });

    var hasSections = plan.groups.some(function (g) { return g.fromSection; });
    var needsTarget = plan.needsName.length > 0 || !hasSections;
    var panel = h('div', { class: 'panel' }, needsTarget ? field('匯入到', sel) : null);
    if (needsTarget && imp.target === 'new') {
      var bySource = {};
      sources.forEach(function (s) { bySource[s.id] = s; });
      plan.needsName.forEach(function (id) {
        var src = bySource[id];
        if (!src) return;
        var input = h('input', {
          class: 'input import-deck-name', type: 'text', maxlength: 60, autocomplete: 'off', 'data-source-id': id,
          value: imp.names[id] != null ? imp.names[id] : src.defaultDeckName
        });
        input.addEventListener('input', function () { imp.names[id] = input.value; refreshImport(); });
        var label = plan.needsName.length > 1 ? '「' + src.name + '」的牌組名稱' : '新牌組名稱';
        panel.appendChild(field(label, input));
      });
    }
    // Only when some words are already in the deck (where the words go is shown in the preview).
    if (plan.totals.dup > 0 || imp.dupMode === 'update') {
      panel.appendChild(field('牌組裡已經有的單字', segmented([
        { value: 'skip', label: '略過重複', action: 'dup-skip' },
        { value: 'update', label: '更新內容（保留測驗紀錄）', action: 'dup-update' }
      ], imp.dupMode, function (v) { imp.dupMode = v; refreshImport(); }, '牌組裡已經有的單字', 'compact'),
        '更新內容：用檔案裡寫的意思、例句等取代舊的，測驗紀錄不變。'));
    }
    if (panel.firstChild) box.appendChild(panel);
  }

  function buildImportPreview(sources, plan) {
    var box = impUI.preview;
    clear(box);
    if (!sources.length) return;
    var t = plan.totals;
    // Zero counts are left out; each "·" sits inside the part after it, so a wrapped line never ends in "·".
    var part = function (cls, text) { return h('span', { class: cls }, h('span', { class: 'dot', text: ' · ' }), text); };
    var summary = h('p', { class: 'summary', id: 'import-summary' },
      h('span', { class: 's-ok', text: '可匯入 ' + fmtNum(t.add + t.update) + ' 張' }),
      t.dup ? part('s-dup', '重複 ' + fmtNum(t.dup) + ' 張') : null,
      t.err ? part('s-err', '無法辨識 ' + fmtNum(t.err) + ' 行') : null);
    var panel = h('div', { class: 'panel' }, summary);
    var note = function (text, warn) {
      panel.appendChild(h('p', { class: 'field-hint import-note' + (warn ? ' warn' : ''), text: text }));
    };
    if (t.skipped) note('只匯入程式碼框（```）裡的內容；框外的 ' + t.skipped + ' 行說明文字已略過。');
    if (t.merged) note('有 ' + t.merged + ' 行是重複出現的單字，已合併到同一張卡（意思接在一起）。');

    sources.forEach(function (s) {
      var st = plan.perSource && plan.perSource[s.id];
      if (st && !st.cards && !st.errors) note('「' + s.name + '」沒有可匯入的內容（檔案是空的，或只有 # 註解）。', true);
    });
    if (plan.suspectEncoding) {
      note('有些字看起來是亂碼（例如音標變成「?」）。Excel 請用「另存新檔 → Unicode 文字」或「CSV UTF-8」，記事本請存成 UTF-8。', true);
    }
    if (plan.dupMode === 'update' && t.update) {
      note('其中新增 ' + t.add + ' 張、更新 ' + t.update + ' 張（測驗紀錄會保留；檔案裡沒寫的欄位維持原本的內容）');
    }

    var groups = plan.groups.filter(function (g) { return g.adds.length || g.updates.length || g.dups; });
    if (groups.length) {
      var ul = h('ul', { class: 'sections' });
      groups.forEach(function (g) {
        var num = (g.adds.length + g.updates.length) + ' 張' + (g.dups ? '（重複 ' + g.dups + '）' : '');
        ul.appendChild(h('li', null,
          h('span', { class: 'sec-name', text: g.name }),
          h('span', { class: 'sec-tag', text: g.isNew ? '新牌組' : '加入現有' }),
          h('span', { class: 'sec-num', text: num })));
      });
      panel.appendChild(ul);
    }

    var sample = [];
    plan.groups.forEach(function (g) {
      g.adds.concat(g.updates.map(function (u) { return Object.assign(cardFields(u.current), u.fields); })).forEach(function (f) {
        if (sample.length < 5) sample.push(f);
      });
    });
    if (sample.length) {
      panel.appendChild(h('p', { class: 'preview-title', text: '預覽' }));
      panel.appendChild(h('ul', { class: 'preview-cards' }, sample.map(function (f) {
        return h('li', null,
          h('span', { class: 'pw', lang: 'en', text: f.word }),
          f.phonetic ? h('span', { class: 'pp', text: f.phonetic }) : null,
          h('span', { class: 'pm', text: oneLine(f.meaning) }));
      })));
    }

    if (plan.errors.length) {
      var multi = sources.length > 1;
      var details = h('details', { class: 'disclosure errors' },
        h('summary', null, icon('chevron'), '查看無法辨識的 ' + plan.errors.length + ' 行'),
        h('ul', { class: 'error-list' }, plan.errors.slice(0, 200).map(function (e) {
          return h('li', null,
            h('span', { class: 'eline', text: (multi ? e.source + ' ' : '') + '第 ' + e.line + ' 行' }),
            h('span', { class: 'ereason', text: e.reason }),
            h('code', { text: e.text }));
        })));
      // Nothing can be imported: show why right away (and where the format is explained).
      if (!t.add && !t.update) details.open = true;
      if (!t.add && !t.update && !t.dup) {
        panel.appendChild(h('p', { class: 'field-hint import-note' },
          '每一行要寫成「單字 | 中文意思」（音標、例句可以接在後面）。',
          h('button', { type: 'button', class: 'text-link inline', 'data-action': 'show-format-help', text: '查看格式說明',
            onclick: function () {
              var help = document.querySelector('details.help');
              if (!help) return;
              help.open = true;
              if (help.scrollIntoView) help.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
            } })));
      }
      panel.appendChild(details);
    }
    box.appendChild(panel);
  }

  /** Pick up keystrokes that the debounced input handlers have not processed yet. */
  function syncImportInputs() {
    if (!impUI) return;
    if (impUI.textarea && document.documentElement.contains(impUI.textarea)) imp.text = impUI.textarea.value;
    Array.prototype.forEach.call(document.querySelectorAll('.import-deck-name'), function (input) {
      imp.names[input.getAttribute('data-source-id')] = input.value;
    });
  }

  function doImport() {
    syncImportInputs();
    var sources = importSources();
    var plan = planImport(sources, currentImportOpts());
    if (!plan.totals.add && !plan.totals.update) return;
    var res = applyPlan(plan);
    if (res.failed) { toast(notSavedText('匯入'), 'error', 7000); return; } // stay here, nothing changed
    var n = res.added + res.updated;
    var msg;
    if (res.deckIds.length === 1) {
      var d = deckById(res.deckIds[0]);
      msg = '已匯入 ' + n + ' 張到「' + (d ? d.name : '') + '」';
    } else {
      msg = '已匯入 ' + n + ' 張（' + res.deckIds.length + ' 個牌組）';
    }
    if (res.updated) msg += '，其中更新 ' + res.updated + ' 張';
    toast(msg);
    resetImport();
    // One deck: straight to it (ready to study). Several: home, with the decks highlighted.
    if (res.deckIds.length === 1) { goBackTo(deckHash(res.deckIds[0])); return; }
    flashDeckIds = res.deckIds.slice();
    goHome();
  }

  /** 「還沒有單字檔？」: copy the rules for Claude — the usual way to get a word file. */
  function claudeCta() {
    return h('div', { class: 'claude-cta' },
      h('p', null, h('b', { text: '還沒有單字檔？請 Claude 幫你做' }),
        '複製說明貼給 Claude，填上主題（例如「學測 Level 4 單字 30 個」），再把它的回覆貼回上面的框框。'),
      h('button', { type: 'button', class: 'btn btn-tonal btn-sm', 'data-action': 'copy-claude-rules',
        onclick: function () {
          copyText(CLAUDE_PROMPT).then(function (ok) {
            toast(ok ? '已複製！貼給 Claude，填上主題和牌組名稱就可以了' : '無法複製，請手動選取', ok ? null : 'error');
          });
        }
      }, icon('sparkle'), '複製給 Claude 的說明'));
  }

  function helpSection() {
    var copyBtn = h('button', { type: 'button', class: 'btn btn-tonal btn-sm', 'data-action': 'copy-example',
      onclick: function () { copyText(EXAMPLE_TEXT).then(function (ok) { toast(ok ? '已複製範例' : '無法複製，請手動選取', ok ? null : 'error'); }); }
    }, icon('clipboard'), '複製範例');
    return h('details', { class: 'disclosure help' },
      h('summary', null, icon('chevron'), '文字檔格式說明'),
      h('div', { class: 'help-body' },
        h('p', { text: '一行一個單字，欄位用「|」分隔（也可以用 Tab）。順序：單字 | 音標 | 中文意思 | 例句 | 例句翻譯 | 備註' }),
        h('pre', { class: 'code', text: EXAMPLE_TEXT }),
        h('ul', null,
          h('li', { text: '只有「單字」和「中文意思」是必填，其他都可以省略。' }),
          h('li', { text: '#deck: 名稱 可以指定牌組，一個檔案可以放好幾個牌組。' }),
          h('li', { text: '# 開頭的其他行是註解，不會匯入。' }),
          h('li', { text: 'Excel、Quizlet、Anki 匯出的檔案，或從 AI 聊天複製的表格、清單，大多也能直接匯入。' })),
        copyBtn));
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    var ta = h('textarea', { style: 'position:fixed;top:-1000px;opacity:0', readonly: true });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* =====================================================================================
   * Settings + backup
   * ===================================================================================== */

  function ymd(ms) {
    var d = new Date(ms);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /**
   * Download the whole state as JSON. Only a backup that was really handed over (download
   * started, or the iPhone share sheet completed) counts: it sets prefs.lastBackupAt.
   */
  function exportBackup() {
    flushSave();
    var prevAt = state.prefs.lastBackupAt;
    state.prefs.lastBackupAt = now(); // part of the backup itself, so a restore keeps the date
    var payload = { app: 'vocabcards', version: SCHEMA_VERSION, exportedAt: new Date(now()).toISOString(), data: state };
    var nDecks = state.decks.length;
    var nCards = state.cards.length;
    return downloadFile('單字卡備份_' + ymd(now()) + '.json', JSON.stringify(payload, null, 1), 'application/json')
      .then(function (ok) {
        if (!ok) {
          state.prefs.lastBackupAt = prevAt;
          toast('沒有儲存備份檔');
          return false;
        }
        scheduleSave();
        toast('已匯出備份（' + nDecks + ' 個牌組、' + nCards + ' 張卡片）');
        var r = currentRoute().name;
        if ((r === 'home' || r === 'settings') && !topOverlay()) render();
        return true;
      });
  }

  function pickBackupFile() {
    var input = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', tabindex: '-1' });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (f) restoreBackupFile(f);
    });
    document.body.appendChild(input);
    input.click();
  }

  /** Resolves true when the file is a usable backup (the restore dialog was shown), else false. */
  function restoreBackupFile(file) {
    return readFileBytes(file).then(function (bytes) {
      var obj;
      try { obj = JSON.parse(VC.decodeBytes(bytes)); } catch (e) { obj = null; }
      var data = obj && obj.app === 'vocabcards' && obj.data ? obj.data : obj;
      if (!data || typeof data !== 'object' || !Array.isArray(data.decks) || !Array.isArray(data.cards)) {
        toast(NOT_A_BACKUP, 'error', 5000);
        return false;
      }
      if (isNewerSchema(data)) {
        toast('這個備份是用較新版本的單字卡存的，請先重新整理頁面更新 App，再還原。', 'error', 6000);
        return false;
      }
      // Check what would really be restored (e.g. a word list JSON has no deck/card ids at all).
      var norm = normalizeState(data);
      if ((data.cards.length && !norm.cards.length) || (data.decks.length && !norm.decks.length)) {
        toast(NOT_A_BACKUP, 'error', 5000);
        return false;
      }
      var lost = data.cards.length - norm.cards.length;
      var when = obj.exportedAt ? '\n備份時間：' + ymd(Date.parse(obj.exportedAt) || now()) : '';
      confirmDialog({
        title: '還原備份？',
        message: '備份內有 ' + norm.decks.length + ' 個牌組、' + norm.cards.length + ' 張卡片。' +
          (lost > 0 ? '（另有 ' + lost + ' 張資料不完整，會略過）' : '') + when +
          '\n\n目前所有的牌組與測驗紀錄都會被取代，無法復原。',
        okText: '還原', danger: true
      }).then(function (ok) {
        if (!ok) return;
        var prev = state;
        var prevBlock = saveBlocked;
        if (saveBlocked === 'corrupt') saveBlocked = null; // restoring is the user's way out of unreadable data
        state = norm;
        if (!flushSave({ quiet: true, replace: true })) {
          state = prev;
          saveBlocked = prevBlock;
          // flushSave cancelled the pending save of earlier changes: they still have to be written.
          if (!saveBlocked && JSON.stringify(state) !== lastSavedJSON) scheduleSave();
          toast(notSavedText('還原'), 'error', 7000);
          render();
          return;
        }
        blockedRaw = null;
        resetSessions();
        resetImport();
        applyTheme();
        toast('已還原備份');
        goHome();
      });
      return true;
    }, function () {
      toast('讀取備份檔失敗', 'error');
      return false;
    });
  }

  function clearAllData() {
    // Unreadable data: same as 「重新開始」 on home (its dialog asks to download the data first).
    if (saveBlocked === 'corrupt') { resetCorrupt(); return; }
    var n = state.cards.length;
    confirmDialog({
      title: '清除所有資料？',
      message: state.decks.length + ' 個牌組、' + n + ' 張卡片和所有測驗紀錄都會被刪除。',
      okText: '繼續', danger: true
    }).then(function (ok) {
      if (!ok) return false;
      return confirmDialog({ title: '真的要全部清除嗎？', message: '這個動作無法復原。建議先「匯出備份」。', okText: '永久清除', danger: true });
    }).then(function (ok) {
      if (!ok) return;
      var prev = state;
      state = freshState();
      state.prefs = prev.prefs;
      if (!flushSave({ quiet: true, replace: true })) {
        state = prev;
        toast(notSavedText('清除'), 'error', 7000);
        render();
        return;
      }
      corruptCopies().forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
      resetSessions();
      toast('已清除所有資料');
      render();
    });
  }

  function fillVoiceSelect(sel) {
    clear(sel);
    sel.appendChild(h('option', { value: '', text: '自動選擇（推薦）' }));
    englishVoices().slice().sort(function (a, b) {
      return (a.lang || '').localeCompare(b.lang || '') || a.name.localeCompare(b.name);
    }).forEach(function (v) {
      sel.appendChild(h('option', { value: v.voiceURI, text: v.name + '（' + v.lang + '）' }));
    });
    sel.value = state.prefs.voiceURI || '';
    if (sel.value !== (state.prefs.voiceURI || '')) sel.value = '';
  }

  function renderSettings() {
    var p = state.prefs;
    var setPref = function (k, v) { p[k] = v; scheduleSave(); };

    var appearance = h('div', { class: 'group' },
      h('div', { class: 'set-row stack' },
        h('div', { class: 'set-label', text: '主題' }),
        segmented([
          { value: 'auto', label: '自動', action: 'theme-auto' },
          { value: 'light', label: '淺色', action: 'theme-light' },
          { value: 'dark', label: '深色', action: 'theme-dark' }
        ], p.theme, function (v) { setPref('theme', v); applyTheme(); }, '主題')));

    var speech;
    if (tts.supported) {
      var auto = h('input', { type: 'checkbox', class: 'switch', id: 'pref-autospeak', checked: p.autoSpeak, 'aria-label': '自動朗讀' });
      auto.addEventListener('change', function () { setPref('autoSpeak', auto.checked); });
      var rateVal = h('span', { class: 'set-value', text: p.speechRate.toFixed(2) + '×' });
      var rate = h('input', { type: 'range', id: 'pref-rate', min: 0.5, max: 1.5, step: 0.05, value: p.speechRate, 'aria-label': '語速' });
      rate.addEventListener('input', function () {
        var v = Math.round(parseFloat(rate.value) * 100) / 100;
        rateVal.textContent = v.toFixed(2) + '×';
        setPref('speechRate', v);
      });
      var voiceSel = h('select', { id: 'pref-voice', class: 'input', 'aria-label': '語音' });
      fillVoiceSelect(voiceSel);
      voiceSel.addEventListener('change', function () { setPref('voiceURI', voiceSel.value || null); });
      speech = h('div', { class: 'group' },
        h('label', { class: 'set-row', for: 'pref-autospeak' },
          h('div', { class: 'set-label' }, '自動朗讀', h('small', { text: '字卡和選擇題出現英文時自動唸出來' })), auto),
        h('div', { class: 'set-row stack' },
          h('div', { class: 'set-head' }, h('span', { text: '語速' }), rateVal), rate),
        h('div', { class: 'set-row stack' },
          h('div', { class: 'set-label', text: '語音' }),
          h('div', { class: 'voice-row' }, voiceSel,
            h('button', { type: 'button', class: 'btn btn-tonal', 'data-action': 'voice-test',
              onclick: function () { speak('Hello! Practice makes perfect.'); } }, icon('speaker'), '試聽'))));
    } else {
      speech = h('div', { class: 'group' }, h('p', { class: 'tips', text: '這個瀏覽器不支援語音朗讀。建議用 Safari（iPhone）或 Chrome（Android）開啟。' }));
    }

    var rowBtn = function (iconName, label, sub, action, fn, danger) {
      return h('button', { type: 'button', class: 'set-row' + (danger ? ' danger' : ''), 'data-action': action, onclick: fn },
        icon(iconName), h('div', { class: 'set-label' }, label, sub ? h('small', { text: sub }) : null));
    };
    var exportRow = rowBtn('download', '匯出備份', '把所有牌組和測驗紀錄存成 .json 檔', 'export-backup', function () { exportBackup(); });
    exportRow.querySelector('.set-label').appendChild(h('small', { id: 'last-backup', class: p.lastBackupAt ? null : 'never',
      text: p.lastBackupAt ? '上次備份：' + ymd(p.lastBackupAt) : '還沒備份過' }));
    var data = h('div', { class: 'group' },
      exportRow,
      rowBtn('restore', '還原備份', '從 .json 備份檔還原（會取代目前資料）', 'restore-backup', pickBackupFile),
      rowBtn('trash', '清除所有資料', null, 'clear-all', clearAllData, true));

    var used = (lastSavedJSON || JSON.stringify(state)).length;
    corruptCopies().forEach(function (k) { used += (readStored(k) || '').length; });
    var usedText = used < 1024 * 1024 ? Math.max(1, Math.round(used / 1024)) + ' KB' : (used / 1048576).toFixed(1) + ' MB';
    var about = h('div', { class: 'group' },
      h('div', { class: 'set-row' }, h('div', { class: 'set-label', text: '版本' }), h('span', { class: 'set-value', text: APP_VERSION })),
      h('div', { class: 'set-row' },
        h('div', { class: 'set-label' }, '儲存空間',
          h('small', { text: state.decks.length + ' 個牌組 · ' + fmtNum(state.cards.length) + ' 張卡片' })),
        h('span', { class: 'set-value', text: '約 ' + usedText })),
      h('p', { class: 'tips' },
        h('b', { text: '加到手機主畫面，用起來就像 App：' }), h('br'),
        'iPhone：用 Safari 開啟 → 點下方的「分享」（iOS 26 在右下「⋯」裡）→「加入主畫面」', h('br'),
        'Android：用 Chrome 開啟 → 點「⋮」選單 →「安裝應用程式」（或「加到主畫面」）'),
      h('p', { class: 'tips tips-warn' },
        h('b', { text: 'iPhone 注意：' }),
        '加入主畫面後的 App 是另一份資料，不會自動帶過去。已經在 Safari 用過的話，先在 Safari「匯出備份」，再到主畫面的 App 裡「還原備份」。'));

    mount(screen('settings', [
      topbar('設定', backBtn()),
      h('div', { class: 'content no-bottombar' },
        h('h2', { class: 'group-title', text: '外觀' }), appearance,
        h('h2', { class: 'group-title', text: '發音' }), speech,
        h('h2', { class: 'group-title', text: '資料' }), data,
        h('h2', { class: 'group-title', text: '關於' }), about,
        h('p', { class: 'about-foot', text: '資料只存在這個瀏覽器裡（iPhone 的 Safari 和主畫面 App 也各存一份），記得定期「匯出備份」。' }))
    ]), 'settings');
  }

  /* =====================================================================================
   * Render + global events
   * ===================================================================================== */

  function render() {
    if (!VC) return;
    var r = currentRoute();
    if (r.name !== 'quiz') stopQuizTimer();
    if (r.name !== 'cards' && r.name !== 'quiz' && tts.supported) {
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }
    if (r.name === 'deck') renderHub(r.id);
    else if (r.name === 'cards') renderCards(r.id);
    else if (r.name === 'quiz') renderQuiz(r.id, r.mode);
    else if (r.name === 'browse') renderBrowse(r.id);
    else if (r.name === 'import') renderImport();
    else if (r.name === 'settings') renderSettings();
    else renderHome();
  }

  /**
   * Show data another tab saved — unless a sheet or dialog is open, or a quiz question is on
   * screen (re-drawing it would take the focus, and the phone keyboard, from the answer box).
   */
  function refreshForOtherTab() {
    if (topOverlay() || (currentRoute().name === 'quiz' && currentQuestion())) return;
    render();
  }

  function resetSessions() {
    stopQuizTimer();
    quiz = null;
    fc = null;
  }

  function onKeyDown(e) {
    var top = topOverlay();
    if (top) {
      if (e.key === 'Escape') { e.preventDefault(); closeOverlay(top); return; }
      if (e.key === 'Tab') {
        var f = focusables(top.root);
        if (!f.length) { e.preventDefault(); return; }
        var first = f[0], last = f[f.length - 1], active = document.activeElement;
        var inside = top.root.contains(active);
        if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
      }
      return;
    }
    var target = e.target || {};
    var tag = target.tagName || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || target.isContentEditable || e.altKey || e.ctrlKey || e.metaKey) return;
    var r = currentRoute();
    if (r.name === 'cards' && fc && fc.deckId === r.id) flashKey(e, tag);
    else if (r.name === 'quiz' && quiz && quiz.deckId === r.id && quiz.mode === r.mode) quizKey(e, tag);
  }

  /** Flashcards: ← → previous / next, Space / Enter flip, S speak. */
  function flashKey(e, tag) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      flashStep(k === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (k === ' ' || k === 'Spacebar' || k === 'Enter') {
      if (tag === 'BUTTON' || tag === 'A') return; // let the focused control handle it
      e.preventDefault();
      if (!e.repeat) flipCard();
      return;
    }
    if ((k === 's' || k === 'S') && !fc.end) {
      var deck = deckById(fc.deckId);
      var order = deck ? flashOrder(deck) : [];
      var card = order[Math.min(deck ? deck.flash.index : 0, order.length - 1)];
      if (card && (deck.settings.direction !== 'zh2en' || fc.flipped)) speak(card.word);
    }
  }

  /** Quiz: 1–4 choose an answer, Enter next question, S speak (choice); typing goes to the answer box (spell). */
  function quizKey(e, tag) {
    var q = currentQuestion();
    if (!q) return;
    var k = e.key;
    if (k === 'Enter' || ((k === ' ' || k === 'Spacebar') && quiz.mode === 'choice')) {
      if (tag === 'BUTTON' || tag === 'A') return; // let the focused control handle it
      e.preventDefault();
      if (!e.repeat && q.result) nextQuestion();
      return;
    }
    if (quiz.mode === 'choice') {
      if (k >= '1' && k <= '4' && k.length === 1) {
        e.preventDefault();
        if (!e.repeat) answerChoice(+k - 1);
      } else if (k === 's' || k === 'S') {
        speak(q.word);
      }
    } else if (!q.result && k.length === 1) {
      focusSpellInput(); // the key itself then goes into the box
    }
  }

  /** Another tab / the installed app saved: take its data, keeping what this tab has not saved yet. */
  function onStorage(e) {
    if (e.key !== STORAGE_KEY) return;
    if (e.storageArea && e.storageArea !== window.localStorage) return;
    // What is stored now (an event can be older than a save we already merged in).
    var raw = readStored(STORAGE_KEY);
    if (raw === lastSavedJSON || (raw && !parseStored(raw))) return;
    if (adoptStored(raw)) scheduleSave(); // this tab's changes, merged in, still have to be written
    applyTheme();
    refreshForOtherTab();
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden') { flushSave(); return; }
    // Home: the backup reminder counts days, which may have passed while the app was in the background.
    if (!topOverlay() && currentRoute().name === 'home') render();
  }

  /**
   * The service worker refreshes each file on its own, so after an update one launch can mix an
   * old core.js with a new app.js. Detect that, drop the cached copies and reload once — but
   * only when the server really answers: Wi-Fi without internet, a captive portal or a weak
   * signal still report navigator.onLine, and without its cache the app could not open offline.
   */
  function checkVersions() {
    if (!VC || VC.version === APP_VERSION) return;
    var flag = 'vocabcards.reloadedFor';
    var later = function () { toast('有新版本：連上網路後，把 App 關掉再打開就會更新。'); };
    var tried = null;
    try { tried = sessionStorage.getItem(flag); } catch (e) { tried = null; }
    if (tried === APP_VERSION || navigator.onLine === false || !window.caches || !caches.keys || !window.fetch) {
      setTimeout(later, 600);
      return;
    }
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 4000);
    // The service worker leaves non-GET requests alone, so a HEAD goes to the network.
    fetch('core.js', { method: 'HEAD', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (res) {
        clearTimeout(timer);
        if (!res.ok || res.redirected) throw new Error('no server');
        try { sessionStorage.setItem(flag, APP_VERSION); } catch (e) { /* ignore */ }
        return caches.keys();
      })
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf('vocabcards-') === 0; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { flushSave(); location.reload(); }, later); // offline: keep running
  }

  function onDocDrop(e) {
    if (currentRoute().name !== 'import') { e.preventDefault(); return; }
    e.preventDefault();
    var files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
    if (files.length) handleImportFiles(files);
  }

  function fatal(message) {
    var app = document.getElementById('app');
    clear(app);
    app.appendChild(h('div', { class: 'fatal' }, h('h1', { text: '單字卡' }), h('p', { text: message })));
  }

  function init() {
    if (!VC) {
      fatal('無法載入程式檔（core.js）。請確認所有檔案都放在同一個資料夾，再重新整理。');
      return;
    }
    loadState();
    applyTheme();
    initHistory();

    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('storage', onStorage);
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', onDocDrop);

    if (tts.supported) {
      loadVoices();
      var onVoices = function () {
        loadVoices();
        var sel = document.getElementById('pref-voice');
        if (sel && document.activeElement !== sel) fillVoiceSelect(sel);
      };
      if (window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener('voiceschanged', onVoices);
      else window.speechSynthesis.onvoiceschanged = onVoices;
    }

    render();
    checkVersions();

    if (!window.VC_SINGLE_FILE && location.protocol.indexOf('http') === 0 && 'serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline support is optional */ });
      });
    }
  }

  /* =====================================================================================
   * Test / automation API
   * ===================================================================================== */

  window.VCApp = {
    getState: function () { return clone(state); },
    setState: function (obj) {
      state = normalizeState(obj);
      resetSessions();
      lastRenderKey = null;
      flushSave({ replace: true });
      applyTheme();
      render();
    },
    save: function () { return flushSave(); },
    reload: function () {
      clearTimeout(saveTimer);
      saveTimer = null;
      loadState();
      resetSessions();
      lastRenderKey = null;
      applyTheme();
      render();
    },
    render: function () { render(); },
    setClock: function (fn) { clockFn = typeof fn === 'function' ? fn : null; },
    importText: function (text, opts) {
      var o = opts || {};
      var target = o.deckId && deckById(o.deckId) ? o.deckId : 'new';
      var res = runImport([{ id: 'api', name: o.fileName || 'text', defaultDeckName: o.deckName || '我的單字', text: str(text) }],
        { target: target, names: {}, dupMode: o.dupMode });
      flushSave();
      render();
      return res;
    },
    setPlatform: function (obj) {
      platformOverride = obj && typeof obj === 'object' ? Object.assign({}, obj) : null;
      lastRenderKey = null;
      render();
    },
    setRandom: function (fn) { randomFn = typeof fn === 'function' ? fn : null; }
  };

  init();
})();
