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
 *       opts: { deckName?: string, deckId?: string, dupMode?: 'skip' | 'update', fileName?: string,
 *               folderId?: string }
 *       Cards outside #deck sections go to deckId (existing deck) or the deck named deckName
 *       (existing deck with that name — case/space-insensitive — else a new one; default 「我的單字」).
 *       New decks go into the folder folderId, unless the text says "#folder: 名稱" (that folder,
 *       made when there is none). fileName ending in .csv parses the text as CSV.
 *       failed: true = storage full, nothing imported.
 *   setPlatform(obj)    override platform detection, e.g. { ios: true, standalone: false } (tests,
 *                       screenshots); pass null to go back to the real values. Re-renders.
 *   setRandom(fn)       fn() -> number in [0, 1); replaces Math.random for picking quiz questions and
 *                       answer order and for the flashcard shuffle seed (pass null to reset)
 * Storage key: localStorage 'vocabcards.v1'; ?sk=<name> in the URL (or window.VC_STORAGE_KEY, set
 * before app.js loads — tests that run the app without a URL) uses another key.
 * State (version 3): { version, folders: [{ id, name, created }], decks: [{ id, name, created,
 * folderId (null = no folder), settings, flash }], cards, seq, quizHistory: [{ mode, deckIds, score,
 * total, at }] (newest first, max 20; finished quizzes, not 重測 rounds), prefs: { …, quizSetup:
 * { mode: 'choice' | 'spell', deckIds: [ids] | null (= every deck), count: 10 | 20 | 50 | 0 (= all) } } }.
 * Version 1 / 2 data and backups are migrated when loaded / restored.
 *
 * Routes: #/ (牌組)  #/folder/<folderId>  #/deck/<deckId>  #/deck/<deckId>/words  #/cards/<deckId>
 *         #/quiz (測驗)  #/quiz/run  #/import  #/settings
 *         #/quiz?deck=<id> | ?folder=<id> (&mode=choice|spell) choose exactly that deck / the decks of
 *         that folder on the quiz page, then show as #/quiz; so do the v2 links #/quiz/<deckId>/<mode>.
 *         #/quiz/run without a quiz going on (e.g. after a reload) shows #/quiz. v1 #/study/<deckId> = the deck.
 * Root screen element: <main class="screen"
 *         data-screen="home|folder|deck|browse|cards|quiz-setup|quiz|import|settings"> (quiz = a quiz running)
 * Tab bar <nav class="tabbar"> (outside #app; body.has-tabbar while shown) on home, folder and
 * quiz-setup only: tab-decks, tab-quiz (the current one has aria-current="page"). Tabs replace
 * rather than add history: back from #/quiz goes to #/.
 *
 * data-action (all are <button>s unless noted):
 *   Home      open-settings, open-import (bottom primary), new-deck, new-folder (prompt for a name);
 *             folders first (section 「資料夾」): folder-open (data-folder-id; .folder-meta
 *             「3 個牌組 · 98 字」), folder-menu (⋯, data-folder-id); then the decks outside any folder:
 *             deck-open (data-deck-id; second line .deck-total 「共 N 字」), deck-menu (⋯, data-deck-id);
 *             no deck and no folder: empty-import-file, empty-paste, load-sample, empty-claude,
 *             empty-restore; iPhone Safari hint on the empty state: .empty-ios
 *             notice card #home-notice[data-notice="corrupt|newer|corrupt-copy|ios|backup"]:
 *               notice-backup (export now), notice-dismiss, download-raw, reset-corrupt, reload-app,
 *               delete-corrupt-copy
 *   Deck menu sheet-browse, sheet-settings, deck-move (移動到資料夾), sheet-export, sheet-delete
 *   Move sheet move-to-folder (data-folder-id = a folder id or "none" = 不放資料夾; the current one
 *             has aria-pressed="true"), move-new-folder (prompt, make the folder, move the deck there)
 *   Folder    back, folder-menu (data-folder-id), #folder-count 「3 個牌組 · 98 字」, deck-open /
 *             deck-menu rows, new-deck (made in this folder), bottom: folder-import (匯入單字 with
 *             this folder chosen), folder-quiz (測驗這個資料夾, when it has words);
 *             empty folder (#folder-empty): folder-import, new-deck
 *   Folder menu folder-rename (prompt), folder-quiz (when it has words), folder-delete (confirm; its
 *             decks move out of the folder, no word is deleted)
 *   Deck hub  back, deck-settings, word count #hub-count 「共 N 字」;
 *             tiles hub-cards (.tile-meta 「看到第 12 張」), hub-quiz (測驗: the quiz page with this deck
 *             chosen; disabled, saying why in .tile-desc, when no question can be made);
 *             add-examples (請 Claude 補例句, when half the words or more have no example); hub-words
 *             (瀏覽與編輯單字); empty deck (#hub-empty): import-to-deck, add-card
 *   Examples sheet (add-examples): copy-examples-prompt (rules + the deck as a text file, for Claude),
 *             paste-examples (the import screen for this deck, 更新內容 selected)
 *   Cards     back, shuffle (aria-pressed), edit-card, card (the tappable flashcard #flash-card
 *             [data-card-id], .flipped while its back shows), speak, prev, flip (aria-pressed), next;
 *             progress text #flash-progress 「12 / 40」; swipe left/right on the card = next/prev;
 *             end view #flash-end: flash-restart, flash-to-choice, flash-to-spell (start a quiz of this
 *             deck right away; it becomes the quiz page's setup), flash-home, and .done-note +
 *             add-examples when there are no spelling questions
 *   Quiz page (data-screen="quiz-setup") quiz-resume (「繼續第 N 題」 .tile-meta 「共 10 題」, .tile-desc
 *             「選擇題 · Unit 3」; while a quiz left half-way has answers); 題型 quiz-mode-choice /
 *             quiz-mode-spell (aria-pressed); 選擇牌組 (#quiz-decks):
 *             quiz-all / quiz-none (one link: 全選, or 全部取消 when every deck is chosen), per folder
 *             quiz-folder (data-folder-id; role=checkbox, aria-checked true | false | mixed) and
 *             quiz-folder-toggle (open / close, aria-expanded), deck rows quiz-deck (data-deck-id;
 *             role=checkbox, aria-checked; .pick-meta 「40 字」, for 拼字題 「40 字 · 可出 12 題」 or
 *             「40 字 · 沒有可出的題目」 (.dim)); decks outside a folder under .pick-label 「未分類」 (only when
 *             there are folders); 題數 quiz-count-10 / -20 / -50 (only those below the questions
 *             available) / quiz-count-all 「全部 (N)」 (aria-pressed; hidden when nothing can be asked);
 *             summary #quiz-summary 「已選 3 個牌組 · 可出 98 題」 or the reason nothing can be asked
 *             (.warn); quiz-start (開始測驗, disabled then); 最近測驗 #quiz-recent rows .recent-row
 *             (text 「選擇題 · 3 個牌組 · 8/10 · 10/16」; one deck: its name); no deck at all:
 *             #quiz-no-decks with open-import
 *   Quiz      (#/quiz/run, data-screen="quiz") quiz-quit (✕), counter #quiz-count 「3 / 10」, speak;
 *             feedback #quiz-feedback (.ok / .bad);
 *             quiz-next (下一題, 「看結果」 on the last question); the question (.quiz-prompt for choice,
 *             .quiz-card for spell) has data-card-id of the card it asks
 *             choice: options option-0 .. option-3 (.opt; once answered the right one has .correct, a
 *               wrong pick .wrong, the tapped one .chosen); the example then shows in .quiz-explain.
 *               Options are VC.quizMeaning of the meanings (notes with English left out).
 *             spell: sentence .cloze with the hidden word .cloze-mask (its text is the mask, e.g.
 *               a_______d; after answering a <mark> with the word), hint .quiz-hint and spell-giveup
 *               (不會，看答案) in .quiz-card-foot, input #spell-input, spell-submit; a wrong answer shows
 *               .fb-meaning in the card and .fb-form when only the form was wrong
 *             results #quiz-results: #quiz-score 「8 / 10」, wrong words .wrong-list (rows .wl-row
 *               [data-card-id]; .wr-deck = the deck's name when several decks were tested),
 *               retry-wrong (only when something was wrong), quiz-again (再測一次: same decks, kind
 *               and count, a new random set), quiz-home (回到測驗)
 *   Browse    back, deck-settings, add-card, card-row (data-card-id; pill .p-wrong 「錯 N」 when the word
 *             was answered wrong in a quiz, .p-nospell 「片語不考拼字」 for a phrase (VC.isPhrase) or
 *             「不考拼字」 when its example lacks the word), show-more, search input #browse-search,
 *             clear-search; empty deck: .list-empty with import-to-deck
 *   Card sheet inputs #f-word #f-phonetic #f-meaning #f-example #f-exampleZh #f-note; under the
 *             example #f-example-hint (what the spelling quiz asks, .warn when the word is not found,
 *             「片語不考拼字…」 for a phrase); quiz record .sheet-meta 「測驗：答對 x・答錯 y」 (when there
 *             is one); card-save, card-save-next (new cards only), card-delete
 *   Deck settings sheet input #ds-name; select #ds-folder ('' = 不放資料夾, or a folder id; only when
 *             there are folders); 字卡正面 dir-en2zh (英文) / dir-zh2en (中文), ds-save, ds-export, ds-delete
 *   Import    back, file input #file-input (inside the dropzone label), remove-file (data-file-id),
 *             textarea #import-text, select #import-target ('new' or a deck id),
 *             deck-name inputs .import-deck-name (data-source-id), select #import-folder ('' =
 *             不放資料夾, a folder id, 'new' = the folder being named, 'add' = 新增資料夾… (prompts);
 *             shown when the import makes a new deck the file does not put in a #folder:, or when
 *             opened from a folder page), dup-skip, dup-update (only when some words are already in
 *             the deck), summary #import-summary (zero counts left out), deck list ul.sections (each
 *             li: .sec-name, .sec-folder when the deck is / will be in a folder, .sec-tag, .sec-num),
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
  var APP_VERSION = '3.0'; // must equal VC.version in core.js (and VERSION in sw.js)

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
    shuffle: '<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
    folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.6.8l1.1 1.4a2 2 0 0 0 1.6.8h5.1A2.5 2.5 0 0 1 21 10.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
    folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.6.8l1.1 1.4a2 2 0 0 0 1.6.8h5.1A2.5 2.5 0 0 1 21 10.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 11v6M9 14h6"/>',
    folderOut: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6a2 2 0 0 1 1.6.8l1.1 1.4a2 2 0 0 0 1.6.8h5.1A2.5 2.5 0 0 1 21 10.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><path d="M12 17v-6M9.5 13.5L12 11l2.5 2.5"/>',
    quiz: '<path d="M8 4H6.5A2.5 2.5 0 0 0 4 6.5v13A2.5 2.5 0 0 0 6.5 22h11a2.5 2.5 0 0 0 2.5-2.5v-13A2.5 2.5 0 0 0 17.5 4H16"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M8.5 13.5l2.5 2.5 4.5-5"/>',
    minus: '<path d="M6 12h12"/>'
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
      var sk = new URLSearchParams(location.search).get('sk') || window.VC_STORAGE_KEY;
      if (sk) return String(sk);
    } catch (e) { /* old browsers: fall through */ }
    return 'vocabcards.v1';
  })();

  // state.version this app writes; version 1 (v1.x, spaced repetition) and 2 (v2.x, no folders) are migrated
  var SCHEMA_VERSION = 3;
  var DEFAULT_PREFS = {
    theme: 'auto', autoSpeak: false, speechRate: 0.9, voiceURI: null,
    // The quiz page (#/quiz): question kind, chosen decks (null = every deck, until a choice is
    // made) and questions per quiz (10 | 20 | 50 | 0 = all).
    quizSetup: { mode: 'choice', deckIds: null, count: 10 },
    lastBackupAt: null,      // ms of the last successful 「匯出備份」
    backupNagAt: null,       // ms of the last 「之後再說」 on the backup reminder
    iosTipDismissed: false   // the one-time iPhone Safari notice on home
  };
  var QUIZ_COUNTS = [10, 20, 50, 0];
  var QUIZ_MODES = ['choice', 'spell'];
  var QUIZ_TITLES = { choice: '選擇題', spell: '拼字題' };
  var QUIZ_HISTORY_MAX = 20;
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
    return { version: SCHEMA_VERSION, folders: [], decks: [], cards: [], seq: 0, quizHistory: [], prefs: clone(DEFAULT_PREFS) };
  }

  function defaultSettings() {
    var d = VC && VC.DEFAULT_DECK_SETTINGS;
    return { direction: d && d.direction === 'zh2en' ? 'zh2en' : 'en2zh' };
  }

  /**
   * Flashcard position of a deck: index into the (possibly shuffled) order, and cardId = the card
   * shown there (once one was shown), so the place is kept when cards are added or deleted.
   */
  function freshFlash() { return { index: 0, shuffle: false, seed: 0 }; }

  function normalizeFlash(fl) {
    var out = { index: clampInt(fl.index, 0, 1e7, 0), shuffle: !!fl.shuffle, seed: (+fl.seed || 0) >>> 0 };
    if (fl.cardId && typeof fl.cardId === 'string') out.cardId = fl.cardId;
    return out;
  }

  /** A finished quiz in state.quizHistory: { mode, deckIds, score, total, at }, or null when unusable. */
  function normalizeHistoryEntry(e) {
    if (!e || typeof e !== 'object' || QUIZ_MODES.indexOf(e.mode) < 0) return null;
    var total = clampInt(e.total, 0, 1e6, 0);
    if (!total) return null;
    var ids = [];
    (Array.isArray(e.deckIds) ? e.deckIds : []).forEach(function (id) {
      if (id && ids.indexOf(String(id)) < 0) ids.push(String(id));
    });
    return { mode: e.mode, deckIds: ids, score: clampInt(e.score, 0, total, 0), total: total, at: +e.at || 0 };
  }

  /** A valid number of questions per quiz (QUIZ_COUNTS), else null. */
  function quizCountOf(v) {
    return v !== null && v !== '' && typeof v !== 'boolean' && QUIZ_COUNTS.indexOf(+v) >= 0 ? +v : null;
  }

  /** Newest first, at most QUIZ_HISTORY_MAX, one entry per (at, mode). */
  function tidyHistory(list) {
    var seen = Object.create(null);
    return list.filter(function (e) {
      var k = e.at + ':' + e.mode;
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    }).sort(function (a, b) { return b.at - a.at; }).slice(0, QUIZ_HISTORY_MAX);
  }

  /**
   * prefs.quizSetup with only decks that exist. A choice whose decks are all gone falls back to
   * every deck (null); a choice of no deck at all ([]) stays.
   */
  function normalizeQuizSetup(qs, decks, fallbackCount) {
    var raw = qs && typeof qs === 'object' ? qs : {};
    var count = quizCountOf(raw.count);
    var out = {
      mode: QUIZ_MODES.indexOf(raw.mode) >= 0 ? raw.mode : 'choice',
      deckIds: null,
      count: count === null ? fallbackCount : count
    };
    if (Array.isArray(raw.deckIds)) {
      var exists = Object.create(null);
      decks.forEach(function (d) { exists[d.id] = true; });
      var ids = [];
      raw.deckIds.forEach(function (id) {
        id = str(id);
        if (exists[id] && ids.indexOf(id) < 0) ids.push(id);
      });
      out.deckIds = ids.length || !raw.deckIds.length ? ids : null;
    }
    return out;
  }

  /**
   * Make any loaded / restored object safe to use: fill defaults, drop garbage. Older data is
   * migrated here. Version 1 (spaced repetition): the schedule fields of every card, the day
   * statistics and the daily limits go; every word, deck and preference stays. Version 2: no
   * folders yet (every deck outside a folder), no quiz history; the last result per deck
   * (deck.lastQuiz) is dropped and 每次測驗題數 (prefs.quizCount) becomes prefs.quizSetup.count.
   */
  function normalizeState(raw) {
    var s = freshState();
    if (!raw || typeof raw !== 'object') return s;
    var folderIds = Object.create(null);
    (Array.isArray(raw.folders) ? raw.folders : []).forEach(function (f) {
      if (!f || typeof f !== 'object' || !f.id || folderIds[f.id]) return;
      folderIds[f.id] = true;
      s.folders.push({ id: String(f.id), name: str(f.name).trim() || '未命名資料夾', created: +f.created || now() });
    });
    var deckIds = {};
    (Array.isArray(raw.decks) ? raw.decks : []).forEach(function (d) {
      if (!d || typeof d !== 'object' || !d.id || deckIds[d.id]) return;
      deckIds[d.id] = true;
      var set = d.settings && typeof d.settings === 'object' ? d.settings : {};
      var fl = d.flash && typeof d.flash === 'object' ? d.flash : {};
      s.decks.push({
        id: String(d.id), name: str(d.name).trim() || '未命名牌組', created: +d.created || now(),
        folderId: d.folderId && folderIds[d.folderId] ? String(d.folderId) : null,
        settings: { direction: set.direction === 'zh2en' ? 'zh2en' : 'en2zh' },
        flash: normalizeFlash(fl)
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
    s.quizHistory = tidyHistory((Array.isArray(raw.quizHistory) ? raw.quizHistory : [])
      .map(normalizeHistoryEntry).filter(Boolean));
    var rawPrefs = raw.prefs && typeof raw.prefs === 'object' ? raw.prefs : {};
    s.prefs = Object.assign(clone(DEFAULT_PREFS), rawPrefs);
    delete s.prefs.rateHints; // v1: how often the rating buttons were explained
    if (['auto', 'light', 'dark'].indexOf(s.prefs.theme) < 0) s.prefs.theme = 'auto';
    s.prefs.speechRate = Math.max(0.5, Math.min(1.5, +s.prefs.speechRate || 0.9));
    s.prefs.autoSpeak = !!s.prefs.autoSpeak;
    // v2: 每次測驗題數 was prefs.quizCount (10 | 20 | 0)
    var oldCount = quizCountOf(rawPrefs.quizCount);
    delete s.prefs.quizCount;
    s.prefs.quizSetup = normalizeQuizSetup(rawPrefs.quizSetup, s.decks,
      oldCount === null ? DEFAULT_PREFS.quizSetup.count : oldCount);
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
      if (!(+obj.version >= SCHEMA_VERSION)) scheduleSave(); // store the migrated version-1 / 2 data
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
   * theirs = what the other tab saved since. Cards, decks, folders and settings changed (or added
   * or deleted) only here keep this tab's version. A card changed in both keeps the text edited
   * here (else theirs) and the quiz answers of both tabs add up; a deck changed in both keeps
   * the name, folder, settings and flashcard place changed here (else theirs); a folder renamed
   * in both keeps this tab's name. The finished quizzes of both tabs are kept (newest 20).
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
    merged.folders = mergeList(base.folders, mine.folders, theirs.folders, function (m, t, b) {
      return m.name !== b.name ? Object.assign({}, t, { name: m.name }) : t;
    });
    merged.decks = mergeList(base.decks, mine.decks, theirs.decks, function (m, t, b) {
      var d = clone(t);
      ['name', 'folderId', 'settings', 'flash'].forEach(function (f) { if (!same(m[f], b[f])) d[f] = clone(m[f]); });
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
    merged.quizHistory = tidyHistory(mine.quizHistory.concat(theirs.quizHistory));
    merged.seq = Math.max(+mine.seq || 0, +theirs.seq || 0);
    return normalizeState(merged); // also drops cards of decks that are gone, folder ids of folders that are gone
  }

  /** Message for an import / restore that was rolled back because it could not be saved. */
  function notSavedText(what) {
    if (lastSaveError === 'blocked') return BLOCKED_TEXT[saveBlocked] || '目前無法儲存。';
    if (lastSaveError === 'full') return '單字太多，超過這個瀏覽器能儲存的空間，沒有' + what + '。可以先刪除用不到的牌組再試一次。';
    return '無法儲存資料（瀏覽器可能禁止了本機儲存），沒有' + what + '。';
  }

  /** Run fn (which changes the state); if the result cannot be saved, put everything back. */
  function transaction(fn) {
    var snap = { folders: state.folders.slice(), decks: state.decks.slice(), cards: state.cards.slice(), seq: state.seq };
    var changed = fn();
    if (!changed || flushSave({ quiet: true })) return true;
    state.folders = snap.folders;
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

  /** Deck names that only differ in case, width or spaces ("我的 牌組" / "我的牌組") are the same deck. */
  function deckKey(name) {
    var s = str(name);
    if (s.normalize) s = s.normalize('NFKC');
    return s.toLowerCase().replace(/\s+/g, '');
  }

  /** Decks named name (case/width/space-insensitive), the exact spelling first. */
  function decksByLooseName(name) {
    var n = str(name).trim();
    var k = deckKey(n);
    return state.decks.filter(function (d) { return deckKey(d.name) === k; })
      .sort(function (a, b) { return (b.name === n) - (a.name === n); });
  }

  function folderById(id) {
    for (var i = 0; i < state.folders.length; i++) if (state.folders[i].id === id) return state.folders[i];
    return null;
  }

  /** Folder names compare like deck names (case, width and spaces do not count). */
  function folderByLooseName(name) {
    var k = deckKey(str(name).trim());
    for (var i = 0; i < state.folders.length; i++) if (deckKey(state.folders[i].name) === k) return state.folders[i];
    return null;
  }

  function sortedFolders() {
    return state.folders.slice().sort(function (a, b) { return a.created - b.created; });
  }

  function sortedDecks() {
    return state.decks.slice().sort(function (a, b) { return a.created - b.created; });
  }

  /** Decks of a folder (null: the decks outside any folder), oldest first. */
  function decksInFolder(folderId) {
    return sortedDecks().filter(function (d) { return d.folderId === folderId; });
  }

  function folderName(folderId) {
    var f = folderId ? folderById(folderId) : null;
    return f ? f.name : '';
  }

  function createFolder(name) {
    var folder = { id: uid(), name: str(name).trim() || '未命名資料夾', created: now() };
    state.folders.push(folder);
    return folder;
  }

  /** The folder named name, made when there is none yet (import). */
  function folderForName(name) {
    return folderByLooseName(name) || createFolder(name);
  }

  /** Delete a folder; its decks (and their words) stay, outside any folder. */
  function deleteFolder(folderId) {
    state.folders = state.folders.filter(function (f) { return f.id !== folderId; });
    state.decks.forEach(function (d) { if (d.folderId === folderId) d.folderId = null; });
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

  function createDeck(name, folderId) {
    var deck = {
      id: uid(), name: str(name).trim() || '我的單字', created: now(),
      folderId: folderId && folderById(folderId) ? folderId : null,
      settings: defaultSettings(), flash: freshFlash()
    };
    state.decks.push(deck);
    return deck;
  }

  function deleteDeck(deckId) {
    state.decks = state.decks.filter(function (d) { return d.id !== deckId; });
    state.cards = state.cards.filter(function (c) { return c.deckId !== deckId; });
    state.prefs.quizSetup = normalizeQuizSetup(state.prefs.quizSetup, state.decks, state.prefs.quizSetup.count);
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

  /**
   * { name, id? } of a route. The quiz page can be opened with decks chosen for it:
   * #/quiz?deck=<id> / #/quiz?folder=<id> (and &mode=choice|spell), and the v2 links
   * #/quiz/<deckId>/<mode>: route.preset = { deckId?, folderId?, mode? } (see applyQuizPreset).
   */
  function parseRoute(hash) {
    var path = normHash(hash).slice(2);
    var qi = path.indexOf('?');
    var query = qi >= 0 ? path.slice(qi + 1) : '';
    var parts = (qi >= 0 ? path.slice(0, qi) : path).split('/');
    var name = parts[0] || '';
    var id = '';
    try { id = parts[1] ? decodeURIComponent(parts[1]) : ''; } catch (e) { id = ''; }
    var sub = parts[2] || '';
    if (name === 'deck' && id) return sub === 'words' ? { name: 'browse', id: id } : { name: 'deck', id: id };
    if (name === 'folder' && id) return { name: 'folder', id: id };
    if (name === 'cards' && id) return { name: 'cards', id: id };
    if (name === 'quiz') {
      if (parts[1] === 'run' && !sub) return { name: 'quiz-run' };
      if (id) return { name: 'quiz', preset: { deckId: id, mode: sub } }; // v2: #/quiz/<deckId>/<mode>
      var q = null;
      try { q = query ? new URLSearchParams(query) : null; } catch (e) { q = null; }
      if (q && (q.get('deck') || q.get('folder') || q.get('mode'))) {
        return { name: 'quiz', preset: { deckId: q.get('deck'), folderId: q.get('folder'), mode: q.get('mode') } };
      }
      return { name: 'quiz' };
    }
    if (name === 'study' && id) return { name: 'deck', id: id }; // v1 links
    if (name === 'import') return { name: 'import' };
    if (name === 'settings') return { name: 'settings' };
    return { name: 'home' };
  }

  function deckHash(deckId) { return '#/deck/' + enc(deckId); }
  function wordsHash(deckId) { return '#/deck/' + enc(deckId) + '/words'; }
  function cardsHash(deckId) { return '#/cards/' + enc(deckId); }
  function folderHash(folderId) { return '#/folder/' + enc(folderId); }
  var QUIZ_HASH = '#/quiz';
  var QUIZ_RUN_HASH = '#/quiz/run';
  /** The quiz page with exactly these decks chosen: { deckId } or { folderId } (and mode). */
  function quizPresetHash(o) {
    var q = [];
    if (o.deckId) q.push('deck=' + enc(o.deckId));
    if (o.folderId) q.push('folder=' + enc(o.folderId));
    if (o.mode) q.push('mode=' + enc(o.mode));
    return QUIZ_HASH + (q.length ? '?' + q.join('&') : '');
  }

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

  /** A headword read aloud without its notation ("send sb off" → "send somebody off", no "+ V-ing"). */
  function speakWord(word) { speak(VC.speakableWord ? VC.speakableWord(word) : word); }

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
    // The same screen drawn again (a flip, the next card): the button just used keeps the focus,
    // so keyboard and screen-reader users stay where they were.
    var active = document.activeElement;
    var focusAction = same && active && active !== document.body && app.contains(active) ? active.getAttribute('data-action') : null;
    var focusSel = focusAction ? '[data-action="' + cssEscape(focusAction) + '"]' : '';
    // Rows that share an action (a deck checkbox on the quiz page) are told apart by their ids.
    ['data-deck-id', 'data-folder-id'].forEach(function (attr) {
      var v = focusSel && active.getAttribute(attr);
      if (v) focusSel += '[' + attr + '="' + cssEscape(v) + '"]';
    });
    if (same) el.classList.add('no-anim');
    clear(app);
    app.appendChild(el);
    lastRenderKey = key;
    window.scrollTo(0, same ? y : 0);
    var again = focusSel && el.querySelector(focusSel);
    if (again && !again.disabled && again.focus) {
      try { again.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    }
  }

  /** hint: a text, or an element (e.g. one that changes while typing). */
  function field(label, control, hint, required) {
    var isInput = /^(INPUT|TEXTAREA|SELECT)$/.test(control.tagName);
    return h(isInput ? 'label' : 'div', { class: 'field' },
      h('span', { class: 'field-label' }, label, required ? h('span', { class: 'req', text: '*' }) : null),
      control,
      hint ? (hint.nodeType ? hint : h('p', { class: 'field-hint', text: hint })) : null);
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
   * Tab bar: 牌組 (#/, #/folder/<id>) · 測驗 (#/quiz). One element outside the screens, so it
   * stays put (no fade) when the screen changes; hidden on every other screen.
   * ===================================================================================== */

  var tabBar = null;
  var TAB_OF_ROUTE = { home: 'decks', folder: 'decks', quiz: 'quiz' };

  function updateTabBar(routeName) {
    var cur = TAB_OF_ROUTE[routeName] || null;
    if (!tabBar && cur) {
      var tab = function (key, iconName, label) {
        return h('button', { type: 'button', class: 'tab', 'data-action': 'tab-' + key, 'data-tab': key,
          onclick: function () { switchTab(key); } }, icon(iconName), h('span', { text: label }));
      };
      tabBar = h('nav', { class: 'tabbar', 'aria-label': '主選單' }, tab('decks', 'cards', '牌組'), tab('quiz', 'quiz', '測驗'));
      document.body.insertBefore(tabBar, document.getElementById('toasts'));
    }
    document.body.classList.toggle('has-tabbar', !!cur);
    if (!tabBar) return;
    tabBar.hidden = !cur;
    Array.prototype.forEach.call(tabBar.children, function (b) {
      if (b.getAttribute('data-tab') === cur) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
  }

  /**
   * Tabs do not pile up history: 牌組 goes back to the 牌組 page; 測驗 from the 牌組 page adds one
   * entry (so back returns to 牌組), from a folder page it takes that page's place when 牌組 is
   * right below it. The current tab again: back to the top.
   */
  function switchTab(key) {
    var r = currentRoute().name;
    if (TAB_OF_ROUTE[r] === key && (key === 'quiz' || r === 'home')) {
      window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
      return;
    }
    if (key === 'decks') { goHome(); return; }
    closeAllOverlays().then(function () {
      var below = nav.idx > 0 && !nav.broken ? routes[nav.idx - 1] : null;
      navigate(QUIZ_HASH, r !== 'home' && below === '#/');
    });
  }

  /* =====================================================================================
   * Home (牌組) / folders / decks
   * ===================================================================================== */

  var flashDeckIds = [];

  function renderHome() {
    var decks = sortedDecks();
    var folders = sortedFolders();
    var head = h('header', { class: 'home-head' },
      h('div', { class: 'home-titles' }, h('h1', { class: 'app-title', text: '單字卡' })),
      iconBtn('gear', '設定', 'open-settings', function () { go('#/settings'); }));

    var note = homeNotice();
    if (!decks.length && !folders.length) {
      mount(screen('home', [head, h('div', { class: 'content no-bottombar' }, note, emptyState())]), 'home');
      return;
    }

    var counts = cardCounts();
    var loose = decks.filter(function (d) { return !d.folderId; });
    var content = h('div', { class: 'content' }, note);
    if (folders.length) {
      content.appendChild(h('h2', { class: 'section-title', text: '資料夾' }));
      content.appendChild(h('div', { class: 'deck-list' }, folders.map(function (f) { return folderRow(f, counts); })));
    }
    if (loose.length) {
      content.appendChild(h('h2', { class: 'section-title', text: folders.length ? '牌組' : '我的牌組' }));
      content.appendChild(h('div', { class: 'deck-list' }, loose.map(function (d) { return deckRow(d, counts[d.id] || 0); })));
    }
    content.appendChild(h('div', { class: 'list-foot' },
      h('button', { type: 'button', class: 'text-link', 'data-action': 'new-deck', onclick: function () { newDeckFlow(null); } },
        icon('plus'), '建立空白牌組'),
      h('button', { type: 'button', class: 'text-link', 'data-action': 'new-folder',
        onclick: function () { newFolderFlow().then(function (f) { if (f) { render(); toast('已新增資料夾「' + f.name + '」'); } }); } },
        icon('folderPlus'), '新增資料夾')));

    var bottom = h('div', { class: 'bottombar' },
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'open-import',
        onclick: function () { openImport(); } }, icon('plus'), '匯入單字'));

    mount(screen('home', [head, content, bottom]), 'home');
    flashRows(content);
  }

  /** Highlight the rows of the decks just imported (and the folders they went into). */
  function flashRows(root) {
    if (!flashDeckIds.length) return;
    var rows = [];
    flashDeckIds.forEach(function (id) {
      var d = deckById(id);
      var row = root.querySelector('[data-deck-row="' + cssEscape(id) + '"]') ||
        (d && d.folderId ? root.querySelector('[data-folder-row="' + cssEscape(d.folderId) + '"]') : null);
      if (row && rows.indexOf(row) < 0) rows.push(row);
    });
    rows.forEach(function (row) {
      row.classList.add('flash');
      if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    });
    flashDeckIds = [];
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

  function deckRow(deck, total) {
    var open = h('button', {
      type: 'button', class: 'deck-open', 'data-action': 'deck-open', 'data-deck-id': deck.id,
      'aria-label': deck.name + '，共 ' + total + ' 字',
      onclick: function () { go(deckHash(deck.id)); }
    }, h('div', { class: 'deck-name', text: deck.name }),
      h('div', { class: 'deck-meta' }, h('span', { class: 'deck-total', text: '共 ' + fmtNum(total) + ' 字' })));
    var more = iconBtn('more', '「' + deck.name + '」的選項', 'deck-menu', function () { openDeckMenu(deck.id); }, 'muted deck-more');
    more.setAttribute('data-deck-id', deck.id);
    return h('div', { class: 'deck-row', 'data-deck-row': deck.id }, open, more);
  }

  /** 「3 個牌組 · 98 字」 */
  function folderStats(folderId, counts) {
    var decks = decksInFolder(folderId);
    var words = 0;
    decks.forEach(function (d) { words += counts[d.id] || 0; });
    return { decks: decks, words: words, text: decks.length + ' 個牌組 · ' + fmtNum(words) + ' 字' };
  }

  function folderRow(folder, counts) {
    var st = folderStats(folder.id, counts);
    var open = h('button', {
      type: 'button', class: 'deck-open folder-open', 'data-action': 'folder-open', 'data-folder-id': folder.id,
      'aria-label': '資料夾「' + folder.name + '」，' + st.text,
      onclick: function () { go(folderHash(folder.id)); }
    }, h('span', { class: 'folder-icon', 'aria-hidden': 'true' }, icon('folder')),
      h('span', { class: 'folder-text' },
        h('span', { class: 'deck-name', text: folder.name }),
        h('span', { class: 'deck-meta folder-meta', text: st.text })));
    var more = iconBtn('more', '資料夾「' + folder.name + '」的選項', 'folder-menu', function () { openFolderMenu(folder.id); }, 'muted deck-more');
    more.setAttribute('data-folder-id', folder.id);
    return h('div', { class: 'deck-row folder-row', 'data-folder-row': folder.id }, open, more);
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

  /** 建立空白牌組 (in folderId, or outside any folder). */
  function newDeckFlow(folderId) {
    promptDialog({ title: '建立空白牌組', message: '建立後可以在牌組裡一個一個新增單字。', placeholder: '牌組名稱', okText: '建立', maxlength: 60 })
      .then(function (name) {
        if (name === null) return;
        name = name.trim();
        if (!name) { toast('請輸入牌組名稱', 'error'); return; }
        var deck = createDeck(name, folderId);
        scheduleSave();
        go(deckHash(deck.id));
      });
  }

  /** A folder name typed by the user: trimmed, not empty, not the name of another folder. Else null (with a toast). */
  function checkFolderName(name, exceptId) {
    var n = str(name).trim();
    if (!n) { toast('請輸入資料夾名稱', 'error'); return null; }
    var other = folderByLooseName(n);
    if (other && other.id !== exceptId) { toast('已經有「' + other.name + '」資料夾了', 'error'); return null; }
    return n;
  }

  /** Ask for a name and make a folder. Resolves the new folder, or null. */
  function newFolderFlow() {
    return promptDialog({ title: '新增資料夾', message: '例如一本課本一個資料夾，每一課一個牌組。',
      placeholder: '資料夾名稱，例如：龍騰 B3', okText: '新增', maxlength: 60 })
      .then(function (name) {
        if (name === null) return null;
        var n = checkFolderName(name);
        if (!n) return null;
        var folder = createFolder(n);
        scheduleSave();
        return folder;
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
      menuItem('folder', '移動到資料夾', 'deck-move', function () {
        closeOverlay(ov).then(function () { openMoveSheet(deck.id); });
      }),
      menuItem('download', '匯出文字檔', 'sheet-export', function () { exportDeck(deck.id); closeOverlay(ov); }),
      h('div', { class: 'menu-sep' }),
      menuItem('trash', '刪除牌組', 'sheet-delete', function () {
        closeOverlay(ov).then(function () { confirmDeleteDeck(deck.id); });
      }, 'danger'));
    ov = openSheet({ title: deck.name, body: body });
  }

  /** Put a deck into a folder (null: outside any folder). */
  function moveDeck(deckId, folderId) {
    var deck = deckById(deckId);
    if (!deck || deck.folderId === folderId) return;
    deck.folderId = folderId;
    scheduleSave();
    render();
    toast(folderId ? '已移到「' + folderName(folderId) + '」' : '已移出資料夾');
  }

  /** 移動到資料夾: 不放資料夾, every folder (the current one checked), 新增資料夾. */
  function openMoveSheet(deckId) {
    var deck = deckById(deckId);
    if (!deck) return;
    var ov;
    var choice = function (iconName, label, folderId) {
      var current = deck.folderId === folderId;
      var item = h('button', {
        type: 'button', class: 'menu-item' + (current ? ' current' : ''), 'data-action': 'move-to-folder',
        'data-folder-id': folderId || 'none', 'aria-pressed': String(current),
        onclick: function () {
          closeOverlay(ov);
          moveDeck(deckId, folderId);
        }
      }, icon(iconName), h('span', { class: 'menu-label', text: label }), current ? icon('check', 'menu-check') : null);
      return item;
    };
    var body = h('div', { class: 'menu' },
      choice('folderOut', '不放資料夾', null),
      sortedFolders().map(function (f) { return choice('folder', f.name, f.id); }),
      h('div', { class: 'menu-sep' }),
      menuItem('folderPlus', '新增資料夾', 'move-new-folder', function () {
        closeOverlay(ov).then(newFolderFlow).then(function (f) {
          if (f) moveDeck(deckId, f.id);
        });
      }, 'primary'));
    ov = openSheet({ title: '把「' + deck.name + '」移動到', body: body });
  }

  function openFolderMenu(folderId) {
    var folder = folderById(folderId);
    if (!folder) return;
    var ov;
    var hasCards = folderStats(folderId, cardCounts()).words > 0;
    var body = h('div', { class: 'menu' },
      menuItem('edit', '重新命名', 'folder-rename', function () {
        closeOverlay(ov).then(function () { renameFolderFlow(folderId); });
      }),
      hasCards ? menuItem('quiz', '測驗這個資料夾', 'folder-quiz', function () {
        go(quizPresetHash({ folderId: folderId }));
      }) : null,
      h('div', { class: 'menu-sep' }),
      menuItem('trash', '刪除資料夾', 'folder-delete', function () {
        closeOverlay(ov).then(function () { confirmDeleteFolder(folderId); });
      }, 'danger'));
    ov = openSheet({ title: folder.name, body: body });
  }

  function renameFolderFlow(folderId) {
    var folder = folderById(folderId);
    if (!folder) return;
    promptDialog({ title: '重新命名資料夾', value: folder.name, placeholder: '資料夾名稱', okText: '儲存', maxlength: 60 })
      .then(function (name) {
        if (name === null) return;
        var f = folderById(folderId); // another tab may have replaced the state meanwhile
        var n = f && checkFolderName(name, folderId);
        if (!n) return;
        f.name = n;
        scheduleSave();
        render();
        toast('已重新命名');
      });
  }

  function confirmDeleteFolder(folderId) {
    var folder = folderById(folderId);
    if (!folder) return;
    var n = decksInFolder(folderId).length;
    confirmDialog({
      title: '刪除資料夾「' + folder.name + '」？',
      message: n ? '裡面的 ' + n + ' 個牌組會移到外面，單字不會被刪除。' : '這個資料夾是空的。',
      okText: '刪除', danger: true
    }).then(function (ok) {
      if (!ok) return;
      deleteFolder(folderId);
      scheduleSave();
      toast('已刪除資料夾');
      if (currentRoute().name === 'folder' && currentRoute().id === folderId) goHome();
      else render();
    });
  }

  function exportDeck(deckId) {
    var deck = deckById(deckId);
    if (!deck) return;
    var cards = cardsOfDeck(deck.id);
    var name = deck.name;
    // A deck in a folder says so in the file (#folder:), so importing it puts it in the same folder.
    downloadFile(safeFileName(name) + '.txt', VC.serializeDeck(name, cards, folderName(deck.folderId)), 'text/plain').then(function (ok) {
      if (ok) toast('已匯出「' + name + '」（' + cards.length + ' 字）');
    });
  }

  function confirmDeleteDeck(deckId) {
    var deck = deckById(deckId);
    if (!deck) return Promise.resolve(false);
    var n = cardsOfDeck(deckId).length;
    var back = deck.folderId && folderById(deck.folderId) ? folderHash(deck.folderId) : '#/';
    return confirmDialog({
      title: '刪除「' + deck.name + '」？',
      message: '牌組裡的 ' + n + ' 個單字和測驗紀錄都會被刪除，無法復原。',
      okText: '刪除', danger: true
    }).then(function (ok) {
      if (!ok) return false;
      deleteDeck(deckId);
      scheduleSave();
      toast('已刪除牌組');
      var r = currentRoute();
      if (r.id === deckId && r.name !== 'folder') goBackTo(back); // its own screens: back to where it was listed
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
    // 資料夾 (once there are folders; 移動到資料夾 in the deck's ⋯ menu can also make one)
    var folderSel = null;
    if (state.folders.length) {
      folderSel = h('select', { id: 'ds-folder', class: 'input' }, h('option', { value: '', text: '不放資料夾' }),
        sortedFolders().map(function (f) { return h('option', { value: f.id, text: f.name }); }));
      folderSel.value = deck.folderId || '';
    }

    function save() {
      var name = nameIn.value.trim();
      if (!name) { toast('請輸入牌組名稱', 'error'); nameIn.focus(); return; }
      // Look the deck up again: another tab may have replaced the state while the sheet was open.
      var d = deckById(deckId);
      if (!d) { toast('找不到這個牌組', 'error'); closeOverlay(ov); return; }
      d.name = name;
      d.settings.direction = dir;
      if (folderSel) d.folderId = folderSel.value && folderById(folderSel.value) ? folderSel.value : null;
      scheduleSave();
      render();
      closeOverlay(ov);
      toast('已儲存設定');
    }

    var body = h('div', { class: 'sheet-body' },
      field('牌組名稱', nameIn),
      folderSel ? field('資料夾', folderSel) : null,
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
   * Folder (#/folder/<folderId>): its decks, 匯入單字 into it, 測驗這個資料夾
   * ===================================================================================== */

  function renderFolder(folderId) {
    var folder = folderById(folderId);
    if (!folder) { toast('找不到這個資料夾'); navigate('#/', true); return; }
    var counts = cardCounts();
    var st = folderStats(folderId, counts);
    var more = iconBtn('more', '資料夾選項', 'folder-menu', function () { openFolderMenu(folderId); });
    more.setAttribute('data-folder-id', folderId);
    var importBtn = function (cls, iconName, label) {
      return h('button', { type: 'button', class: 'btn btn-lg ' + cls, 'data-action': 'folder-import',
        onclick: function () { openImport(null, false, null, folderId); } }, icon(iconName), label);
    };
    var newDeck = function (cls) {
      return h('button', { type: 'button', class: cls, 'data-action': 'new-deck',
        onclick: function () { newDeckFlow(folderId); } }, icon('plus'), '建立空白牌組');
    };
    var children = [topbar(folder.name, backBtn(), more)];
    if (!st.decks.length) {
      var art = h('div');
      art.innerHTML = EMPTY_ART; // static markup
      children.push(h('div', { class: 'content no-bottombar' },
        h('div', { class: 'empty folder-empty', id: 'folder-empty' },
          art.firstChild,
          h('h2', { text: '這個資料夾還是空的' }),
          h('p', null, '匯入單字，新的牌組就會放進這個資料夾；', h('br'), '也可以在牌組的「⋯」選「移動到資料夾」。'),
          h('div', { class: 'empty-actions' },
            importBtn('btn-primary', 'upload', '匯入單字到這個資料夾'),
            newDeck('btn btn-secondary btn-lg')))));
    } else {
      children.push(h('div', { class: 'content' },
        h('p', { class: 'hub-count', id: 'folder-count', text: st.text }),
        h('div', { class: 'deck-list' }, st.decks.map(function (d) { return deckRow(d, counts[d.id] || 0); })),
        h('div', { class: 'list-foot' }, newDeck('text-link'))));
      children.push(h('div', { class: 'bottombar folder-bar' },
        importBtn(st.words ? 'btn-secondary' : 'btn-primary', 'plus', '匯入單字'),
        st.words ? h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'folder-quiz',
          onclick: function () { go(quizPresetHash({ folderId: folderId })); } }, icon('quiz'), '測驗這個資料夾') : null));
    }
    var el = screen('folder', children);
    mount(el, 'folder:' + folderId);
    flashRows(el);
  }

  /* =====================================================================================
   * Deck hub (#/deck/<deckId>): 字卡 · 測驗 (the quiz page with this deck chosen)
   * ===================================================================================== */

  var NO_QUESTION = {
    choice: '要有兩個以上不同中文意思的單字才能出題',
    spell: '例句裡找不到單字，無法出題'
  };

  /** True for a headword of two or more words: the spelling quiz leaves phrases out (VC.isPhrase). */
  function isPhrase(word) { return !!(VC.isPhrase && VC.isPhrase(word)); }

  /** Why a quiz can't be made from these cards (no example sentences, only phrases: says so). */
  function noQuestionText(mode, cards) {
    if (mode === 'spell') {
      if (!cards.some(function (c) { return str(c.example).trim(); })) return '單字都沒有例句，無法出題';
      if (cards.every(function (c) { return isPhrase(c.word); })) return '片語不考拼字，沒有可出的題目';
    }
    return NO_QUESTION[mode];
  }

  /** Half the words or more have no example sentence: the spelling quiz needs them (請 Claude 補例句). */
  function needsExamples(deckCards) {
    var missing = deckCards.filter(function (c) { return !str(c.example).trim(); }).length;
    return missing > 0 && missing * 2 >= deckCards.length;
  }

  /** 「請 Claude 補例句」: a text link that opens the sheet explaining how. */
  function examplesLink(deckId) {
    return h('button', { type: 'button', class: 'text-link examples-link', 'data-action': 'add-examples',
      onclick: function () { openExamplesSheet(deckId); } }, icon('sparkle'), '請 Claude 幫這個牌組補例句');
  }

  /** Meaning text the way the choice quiz compares it (VC.quizMeaning, then VC.meaningKey). */
  function meaningKey(meaning) {
    return VC.meaningKey(VC.quizMeaning(meaning));
  }

  /**
   * Cards the multiple-choice distractors come from: the quiz's own cards, or every card when
   * they have fewer than 4 different meanings (so a small deck still gets four options).
   */
  function choicePool(cards) {
    var seen = Object.create(null);
    var n = 0;
    for (var i = 0; i < cards.length && n < 4; i++) {
      var k = meaningKey(cards[i].meaning);
      if (k && !seen[k]) { seen[k] = true; n++; }
    }
    return n >= 4 ? cards : state.cards;
  }

  /** How many questions each quiz can make from these cards: { choice, spell }. */
  function quizEligible(cards) {
    return cards.length ? VC.quizEligible(cards, choicePool(cards)) : { choice: 0, spell: 0 };
  }

  function deckSize(deckId) {
    var n = 0;
    for (var i = 0; i < state.cards.length; i++) if (state.cards[i].deckId === deckId) n++;
    return n;
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
      var pos = deck.flash.index;
      content.appendChild(h('p', { class: 'hub-count', id: 'hub-count', text: '共 ' + fmtNum(n) + ' 字' }));
      content.appendChild(h('div', { class: 'tiles' },
        hubTile({ action: 'hub-cards', icon: 'cards', title: '字卡', desc: '翻面背單字',
          meta: [pos > 0 && pos < n ? h('span', { text: '看到第 ' + (pos + 1) + ' 張' }) : null],
          onclick: function () { go(cardsHash(deckId)); } }),
        hubTile({ action: 'hub-quiz', icon: 'quiz', title: '測驗',
          desc: can.choice || can.spell ? '選擇題或拼字題' : NO_QUESTION.choice, disabled: !can.choice && !can.spell,
          onclick: function () { go(quizPresetHash({ deckId: deckId })); } })));
      if (needsExamples(cards)) content.appendChild(h('div', { class: 'hub-examples' }, examplesLink(deckId)));
      content.appendChild(h('div', { class: 'group hub-more' },
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

  // { deckId, flipped, end, enter: 'in' | 'next' | 'prev' | '', shown (cards shown so far), spoken,
  //   undoShuffle?: { index, shown } (the place before 隨機 was turned on, while no other card was shown) }
  var fc = null;
  var lastSwipeAt = -1e9; // perfNow() of the last swipe (the tap that ends it must not flip the card)

  /**
   * The deck's cards in flashcard order: as added, or shuffled with the deck's saved seed (an order
   * that stays the same for the other cards when one is added or deleted).
   */
  function flashOrder(deck) {
    var cards = cardsOfDeck(deck.id);
    return deck.flash.shuffle ? VC.seededOrder(cards, deck.flash.seed) : cards;
  }

  /** Move to index in the flashcard order (the card there is remembered once it is shown). */
  function setFlashIndex(fl, index) {
    fl.index = index;
    delete fl.cardId;
  }

  function renderCards(deckId) {
    var deck = deckById(deckId);
    if (!deck) { toast('找不到這個牌組'); navigate('#/', true); return; }
    var key = 'cards:' + deckId;
    if (!fc || fc.deckId !== deckId || lastRenderKey !== key) {
      fc = { deckId: deckId, flipped: false, end: false, enter: 'in', shown: 0, spoken: '' };
    }
    var fl = deck.flash;
    var order = flashOrder(deck);
    var n = order.length;
    // Cards added or deleted since: the card that was on screen keeps its place (if it is still there).
    var index = fl.index;
    if (fl.cardId && !(order[index] && order[index].id === fl.cardId)) {
      for (var j = 0; j < n; j++) if (order[j].id === fl.cardId) { index = j; break; }
    }
    index = Math.max(0, Math.min(index, n - 1)); // the last cards may have been deleted
    var card = n && !fc.end ? order[index] : null;
    if (index !== fl.index || (card && fl.cardId !== card.id)) {
      fl.index = index;
      if (card) fl.cardId = card.id;
      scheduleSave();
    }

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
      if (fc.spoken !== tag) { fc.spoken = tag; speakWord(card.word); }
    }
  }

  function flashCardView(deck, card) {
    var zh2en = deck.settings.direction === 'zh2en';
    // 中文 front: the meaning without notes that show the English ("n. 燈籠 → Lantern Festival");
    // the whole meaning then comes on the back.
    var shown = zh2en ? VC.quizMeaning(card.meaning) : '';
    var front = zh2en
      ? h('div', { class: 'card-front' }, h('h2', { class: 'front-meaning', text: shown }))
      : h('div', { class: 'card-front' },
          h('h2', { class: 'word ' + lenClass(card.word), lang: 'en', text: card.word }),
          phoneticRow(card));
    var back = fc.flipped ? h('div', { class: 'card-back' },
      zh2en
        ? h('div', { class: 'back-word' },
            h('h3', { class: 'word ' + lenClass(card.word), lang: 'en', text: card.word }), phoneticRow(card))
        : null,
      !zh2en || shown !== card.meaning ? h('p', { class: 'meaning', text: card.meaning }) : null,
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
        h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'flip', text: '翻面',
          'aria-pressed': String(!!fc.flipped), onclick: flipCard }),
        h('button', { type: 'button', class: 'btn btn-secondary', 'data-action': 'next',
          onclick: function () { flashStep(1); } }, h('span', { text: '下一張' }), icon('chevron'))),
      h('p', { class: 'kbd-hint', text: '← → 換卡 · 空白鍵 翻面 · S 朗讀' }));
  }

  function flashEndView(deck, order) {
    var can = quizEligible(order);
    var view = messageView('flash-end', '🎉', '看完了！共 ' + order.length + ' 張', '接著做個小測驗，看看記住了多少吧！', [
      h('button', { type: 'button', class: 'btn btn-secondary btn-lg', 'data-action': 'flash-restart', onclick: restartFlash },
        icon('reset'), '從頭再看一次'),
      // Straight into a quiz of this deck (the quiz page remembers it as its setup).
      h('button', { type: 'button', class: 'btn btn-tonal btn-lg', 'data-action': 'flash-to-choice', disabled: !can.choice,
        onclick: function () { openQuizFor([deck.id], 'choice'); } }, icon('choice'), '選擇題測驗'),
      h('button', { type: 'button', class: 'btn btn-tonal btn-lg', 'data-action': 'flash-to-spell', disabled: !can.spell,
        onclick: function () { openQuizFor([deck.id], 'spell'); } }, icon('spell'), '拼字題測驗'),
      // No spelling questions: say why, and how to get example sentences.
      can.spell ? null : h('p', { class: 'done-note', text: '拼字題：' + noQuestionText('spell', order) }),
      !can.spell && needsExamples(order) ? examplesLink(deck.id) : null,
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
      setFlashIndex(fl, n - 1);
    } else {
      var i = Math.min(fl.index, n - 1) + delta;
      if (i < 0) return;
      if (i < n) setFlashIndex(fl, i);
      else { fc.end = true; setFlashIndex(fl, 0); } // seen them all: next time starts from the first card
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
    setFlashIndex(deck.flash, 0);
    fc.end = false;
    fc.flipped = false;
    fc.enter = 'in';
    fc.shown++;
    scheduleSave();
    renderCards(deck.id);
  }

  /**
   * Shuffle on: a new random order from the first card. Off: the original order, same card — or,
   * when no other card was shown since it was turned on (a tap by mistake), back where it was.
   */
  function toggleShuffle(deckId) {
    var deck = deckById(deckId);
    if (!deck || !fc) return;
    var fl = deck.flash;
    var undo = fc.undoShuffle;
    fc.undoShuffle = null;
    if (fl.shuffle) {
      var order = flashOrder(deck);
      var cur = fc.end ? null : order[Math.min(fl.index, order.length - 1)];
      fl.shuffle = false;
      setFlashIndex(fl, undo && undo.shown === fc.shown ? undo.index : cur ? Math.max(0, cardsOfDeck(deckId).indexOf(cur)) : 0);
      toast('已恢復原本順序');
    } else {
      var before = fc.end ? 0 : fl.index;
      fl.shuffle = true;
      fl.seed = Math.floor(rand() * 4294967296) >>> 0;
      setFlashIndex(fl, 0);
      fc.undoShuffle = { index: before, shown: fc.shown + 1 };
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
    return iconBtn('speaker', '朗讀', 'speak', function (e) { e.stopPropagation(); speakWord(word); }, 'speak-btn');
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

  /** DOM nodes for `sentence` with every occurrence of the headword (VC.findHeadwords) in a <mark>. */
  function highlightNodes(sentence, word) {
    var nodes = [];
    var last = 0;
    VC.findHeadwords(sentence, word).forEach(function (hit) {
      if (hit.index < last) return;
      if (hit.index > last) nodes.push(document.createTextNode(sentence.slice(last, hit.index)));
      nodes.push(h('mark', { text: hit.text }));
      last = hit.index + hit.text.length;
    });
    if (last < sentence.length) nodes.push(document.createTextNode(sentence.slice(last)));
    return nodes;
  }

  /* =====================================================================================
   * Quiz page (#/quiz, the 測驗 tab): 題型 · 選擇牌組 (grouped by folder) · 題數 · 開始測驗,
   * and 最近測驗. What is chosen stays in state.prefs.quizSetup = { mode, deckIds, count }
   * (deckIds null = every deck, until the user picks); every change is saved and re-renders the page.
   * ===================================================================================== */

  // Folders shown open on the quiz page: { [folderId]: bool }, set each time the page is entered.
  var quizOpen = {};

  // What the quiz page needs to know about a card, kept per card object (an edited card is a new
  // object, so nothing goes stale): whether it can make a spelling question (VC.makeCloze — the
  // first time for a word it builds a RegExp, slow for thousands of words), and its quiz meaning
  // key and word (for the multiple-choice count).
  var spellCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  var choiceCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function spellOk(card) {
    if (!spellCache) return !!VC.makeCloze(card);
    var v = spellCache.get(card);
    if (v === undefined) { v = !!VC.makeCloze(card); spellCache.set(card, v); }
    return v;
  }

  function choiceInfo(card) {
    var v = choiceCache && choiceCache.get(card);
    if (!v) {
      v = { k: meaningKey(card.meaning), w: VC.normalizeWord(card.word) };
      if (choiceCache) choiceCache.set(card, v);
    }
    return v;
  }

  /**
   * How many of cards can make a multiple-choice question with wrong answers from pool — the
   * count of VC.quizEligible(cards, pool).choice (a pool card with another, non-empty quiz meaning
   * and another word), without its spelling work and without working out the same keys again.
   */
  function choiceCount(cards, pool) {
    var from = pool.filter(function (p) { return choiceInfo(p).k; });
    var n = 0;
    cards.forEach(function (c) {
      var me = choiceInfo(c);
      for (var j = 0; j < from.length; j++) {
        var p = from[j];
        var pi = choiceInfo(p);
        if (p === c || (c.id != null && p.id === c.id) || pi.k === me.k || (me.w && pi.w === me.w)) continue;
        n++;
        return;
      }
    });
    return n;
  }

  // While the quiz page is open, the spelling checks of every card are worked out a little at a
  // time in the background, so switching to 拼字題 (or choosing many decks) does not stall.
  var spellWarming = false;
  function warmSpellCache() {
    if (spellWarming || !spellCache) return;
    spellWarming = true;
    var list = state.cards;
    var i = 0;
    var idle = window.requestIdleCallback;
    var later = function () {
      if (idle) idle.call(window, step, { timeout: 400 }); else setTimeout(step, 20);
    };
    var step = function (deadline) {
      // Left the quiz page, or other data now: stop (the next visit starts again where the cache is).
      if (currentRoute().name !== 'quiz' || list !== state.cards) { spellWarming = false; return; }
      var t0 = perfNow();
      var more = function () {
        return deadline && deadline.timeRemaining && !deadline.didTimeout ? deadline.timeRemaining() > 1 : perfNow() - t0 < 12;
      };
      while (i < list.length && more()) spellOk(list[i++]);
      if (i < list.length) later(); else spellWarming = false;
    };
    setTimeout(later, 200);
  }

  function quizSetup() { return state.prefs.quizSetup; }

  /** The chosen decks (only those that exist), oldest first. */
  function selectedDeckIds() {
    var ids = quizSetup().deckIds;
    return sortedDecks().filter(function (d) { return ids === null || ids.indexOf(d.id) >= 0; })
      .map(function (d) { return d.id; });
  }

  function setSelectedDecks(ids) {
    quizSetup().deckIds = sortedDecks().filter(function (d) { return ids.indexOf(d.id) >= 0; })
      .map(function (d) { return d.id; });
    scheduleSave();
    render();
  }

  /** The cards of these decks, in the order they were added. */
  function cardsOfDecks(deckIds) {
    var set = Object.create(null);
    deckIds.forEach(function (id) { set[id] = true; });
    return state.cards.filter(function (c) { return set[c.deckId]; }).sort(function (a, b) { return a.seq - b.seq; });
  }

  /** How many questions of this kind the cards can make. */
  function availableCount(mode, cards) {
    if (!cards.length) return 0;
    return mode === 'spell' ? cards.filter(spellOk).length : choiceCount(cards, choicePool(cards));
  }

  /** 「Unit 3」 for one deck, else 「3 個牌組」. */
  function decksText(deckIds) {
    var one = deckIds.length === 1 ? deckById(deckIds[0]) : null;
    return one ? one.name : deckIds.length + ' 個牌組';
  }

  /**
   * #/quiz?deck=<id> / ?folder=<id> (&mode=…) and the v2 links #/quiz/<deckId>/<mode>: choose
   * exactly that deck / the decks of that folder (and that kind of question). The page then
   * shows as plain #/quiz, so going back to it later keeps what the user chose after.
   */
  function applyQuizPreset(p) {
    var qs = quizSetup();
    var deck = p.deckId ? deckById(p.deckId) : null;
    var folder = !deck && p.folderId ? folderById(p.folderId) : null;
    if (deck) qs.deckIds = [deck.id];
    else if (folder) qs.deckIds = decksInFolder(folder.id).map(function (d) { return d.id; });
    if (QUIZ_MODES.indexOf(p.mode) >= 0) qs.mode = p.mode;
    scheduleSave();
  }

  /** Entering the quiz page: a small collection shows every folder open; else only the partly chosen ones. */
  function initQuizOpen(chosen) {
    quizOpen = {};
    var small = state.decks.length <= 8;
    state.folders.forEach(function (f) {
      var ds = decksInFolder(f.id);
      var k = ds.filter(function (d) { return chosen[d.id]; }).length;
      quizOpen[f.id] = small || (k > 0 && k < ds.length);
    });
  }

  /** The look of a checkbox: ✓ (true), – (mixed: some of a folder's decks), empty (false). */
  function checkMark(checked) {
    return h('span', { class: 'check', 'aria-hidden': 'true' },
      checked === 'true' ? icon('check') : checked === 'mixed' ? icon('minus') : null);
  }

  function renderQuizPage(route) {
    if (route.preset) {
      applyQuizPreset(route.preset);
      navigate(QUIZ_HASH, true);
      return;
    }
    var key = 'quiz-setup';
    var qs = quizSetup();
    var decks = sortedDecks();
    var head = h('header', { class: 'home-head' },
      h('div', { class: 'home-titles' }, h('h1', { class: 'app-title', text: '測驗' })));
    if (!decks.length) {
      mount(screen('quiz-setup', [head, h('div', { class: 'content no-bottombar' }, quizNoDecks())]), key);
      return;
    }

    var sel = selectedDeckIds();
    var chosen = Object.create(null);
    sel.forEach(function (id) { chosen[id] = true; });
    if (lastRenderKey !== key) initQuizOpen(chosen);
    var byDeck = Object.create(null);
    state.cards.forEach(function (c) { (byDeck[c.deckId] = byDeck[c.deckId] || []).push(c); });
    var selCards = cardsOfDecks(sel);
    var available = availableCount(qs.mode, selCards);

    var modeOpt = function (mode, iconName, desc) {
      return h('button', {
        type: 'button', class: 'mode-opt', 'data-action': 'quiz-mode-' + mode, 'aria-pressed': String(qs.mode === mode),
        onclick: function () { if (qs.mode !== mode) { qs.mode = mode; scheduleSave(); render(); } }
      }, h('span', { class: 'mo-head' }, icon(iconName), h('span', { text: QUIZ_TITLES[mode] })),
        h('span', { class: 'mo-desc', text: desc }));
    };

    var deckPick = function (d, inFolder) {
      var cards = byDeck[d.id] || [];
      var n = cards.length;
      var meta = '還沒有單字';
      var dim = !n;
      if (n) {
        meta = fmtNum(n) + ' 字';
        if (qs.mode === 'spell') {
          var k = cards.filter(spellOk).length;
          if (!k) { meta += ' · 沒有可出的題目'; dim = true; }
          else if (k < n) meta += ' · 可出 ' + fmtNum(k) + ' 題';
        }
      }
      var on = !!chosen[d.id];
      return h('button', {
        type: 'button', role: 'checkbox', 'aria-checked': String(on),
        class: 'pick-row' + (inFolder ? ' in-folder' : '') + (dim ? ' dim' : ''),
        'data-action': 'quiz-deck', 'data-deck-id': d.id,
        onclick: function () {
          setSelectedDecks(on ? sel.filter(function (id) { return id !== d.id; }) : sel.concat(d.id));
        }
      }, checkMark(String(on)),
        h('span', { class: 'pick-main' }, h('span', { class: 'pick-name', text: d.name }), h('span', { class: 'pick-meta', text: meta })));
    };

    var groups = [];
    var folders = sortedFolders();
    folders.forEach(function (f) {
      var ds = decksInFolder(f.id);
      if (!ds.length) return;
      var k = ds.filter(function (d) { return chosen[d.id]; }).length;
      var checked = !k ? 'false' : k === ds.length ? 'true' : 'mixed';
      var open = !!quizOpen[f.id];
      var ids = ds.map(function (d) { return d.id; });
      var toggle = iconBtn('chevron', (open ? '收合' : '展開') + '「' + f.name + '」', 'quiz-folder-toggle', function () {
        quizOpen[f.id] = !open;
        render();
      }, 'muted pick-toggle');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('data-folder-id', f.id);
      groups.push(h('div', { class: 'group pick-group' + (open ? ' open' : ''), 'data-folder-group': f.id },
        h('div', { class: 'pick-folder' },
          h('button', {
            type: 'button', role: 'checkbox', 'aria-checked': checked, class: 'pick-row folder-pick',
            'data-action': 'quiz-folder', 'data-folder-id': f.id,
            onclick: function () {
              setSelectedDecks(checked === 'true' ? sel.filter(function (id) { return ids.indexOf(id) < 0; }) : sel.concat(ids));
            }
          }, checkMark(checked), h('span', { class: 'pick-ficon', 'aria-hidden': 'true' }, icon('folder')),
            h('span', { class: 'pick-main' }, h('span', { class: 'pick-name', text: f.name }),
              h('span', { class: 'pick-meta', text: checked === 'mixed' ? '已選 ' + k + ' / ' + ds.length + ' 個牌組' : ds.length + ' 個牌組' }))),
          toggle),
        open ? ds.map(function (d) { return deckPick(d, true); }) : null));
    });
    var loose = decks.filter(function (d) { return !d.folderId; });
    if (loose.length) {
      if (groups.length) groups.push(h('h3', { class: 'pick-label', text: '未分類' }));
      groups.push(h('div', { class: 'group pick-group' }, loose.map(function (d) { return deckPick(d, false); })));
    }

    var allOn = sel.length === decks.length;
    var content = h('div', { class: 'content quiz-setup' },
      resumeTile(),
      h('h2', { class: 'section-title', text: '題型' }),
      h('div', { class: 'mode-seg', role: 'group', 'aria-label': '題型' },
        modeOpt('choice', 'choice', '看英文選中文'), modeOpt('spell', 'spell', '看例句拼單字')),
      h('div', { class: 'section-head' },
        h('h2', { class: 'section-title', text: '選擇牌組' }),
        h('button', { type: 'button', class: 'text-link section-link', 'data-action': allOn ? 'quiz-none' : 'quiz-all',
          text: allOn ? '全部取消' : '全選',
          onclick: function () { setSelectedDecks(allOn ? [] : decks.map(function (d) { return d.id; })); } })),
      h('div', { class: 'pick-list', id: 'quiz-decks' }, groups));

    if (available) {
      var opts = [];
      [10, 20, 50].forEach(function (c) {
        if (c < available) opts.push({ value: String(c), label: String(c), action: 'quiz-count-' + c });
      });
      opts.push({ value: '0', label: '全部 (' + fmtNum(available) + ')', action: 'quiz-count-all' });
      content.appendChild(h('h2', { class: 'section-title', text: '題數' }));
      content.appendChild(segmented(opts, qs.count && qs.count < available ? String(qs.count) : '0', function (v) {
        qs.count = +v;
        scheduleSave();
      }, '題數', 'count-seg'));
    }
    // One deck with too few example sentences for the spelling quiz: how to get them.
    if (qs.mode === 'spell' && sel.length === 1 && selCards.length && needsExamples(selCards)) {
      content.appendChild(h('div', { class: 'hub-examples' }, examplesLink(sel[0])));
    }
    append(content, recentQuizzes());

    var reason = !sel.length ? '請先選擇要測驗的牌組'
      : !selCards.length ? '選的牌組還沒有單字'
      : !available ? noQuestionText(qs.mode, selCards) : '';
    var summary = h('p', { class: 'start-summary' + (reason ? ' warn' : ''), id: 'quiz-summary' },
      sel.length ? '已選 ' + sel.length + ' 個牌組 · ' : '', reason || '可出 ' + fmtNum(available) + ' 題');
    var start = h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'quiz-start',
      disabled: !available, text: '開始測驗',
      onclick: function () {
        startQuiz({ mode: qs.mode, deckIds: selectedDeckIds(), count: qs.count });
        go(QUIZ_RUN_HASH);
      } });

    mount(screen('quiz-setup', [head, content, h('div', { class: 'bottombar start-bar' }, summary, start)]), key);
    warmSpellCache();
  }

  /** 「繼續第 N 題」: a quiz left half-way (back gesture / button) goes on where it was. */
  function resumeTile() {
    if (!quiz || quiz.finished || !quiz.questions.some(function (q) { return q.result; })) return null;
    return h('button', { type: 'button', class: 'tile resume-tile', 'data-action': 'quiz-resume',
      onclick: function () { go(QUIZ_RUN_HASH); } },
      h('span', { class: 'tile-icon' }, icon(quiz.mode)),
      h('span', { class: 'tile-text' },
        h('span', { class: 'tile-head' },
          h('span', { class: 'tile-title', text: '繼續第 ' + (quiz.i + 1) + ' 題' }),
          h('span', { class: 'tile-meta', text: '共 ' + quiz.questions.length + ' 題' })),
        h('span', { class: 'tile-desc', text: quiz.retry ? '重測答錯的題目' : QUIZ_TITLES[quiz.mode] + ' · ' + decksText(quiz.deckIds) })),
      icon('chevron', 'tile-chev'));
  }

  /** 最近測驗: the last 5 finished quizzes, 「選擇題 · 3 個牌組 · 8/10 · 10/16」. */
  function recentQuizzes() {
    var list = state.quizHistory.slice(0, 5);
    if (!list.length) return null;
    var sep = function () { return h('span', { class: 'sr-only', text: ' · ' }); };
    return [h('h2', { class: 'section-title', text: '最近測驗' }),
      h('div', { class: 'group recent-list', id: 'quiz-recent' }, list.map(function (e) {
        var d = new Date(e.at);
        return h('div', { class: 'recent-row' },
          h('span', { class: 'recent-main', text: QUIZ_TITLES[e.mode] + ' · ' + decksText(e.deckIds) }), sep(),
          h('span', { class: 'recent-score', text: e.score + '/' + e.total }), sep(),
          h('span', { class: 'recent-date', text: (d.getMonth() + 1) + '/' + d.getDate() }));
      }))];
  }

  function quizNoDecks() {
    var art = h('div');
    art.innerHTML = EMPTY_ART; // static markup
    return h('div', { class: 'empty', id: 'quiz-no-decks' },
      art.firstChild,
      h('h2', { text: '還沒有牌組' }),
      h('p', null, '先匯入單字，', h('br'), '就能在這裡選牌組來測驗。'),
      h('div', { class: 'empty-actions' },
        h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'open-import',
          onclick: function () { openImport(); } }, icon('upload'), '匯入單字')));
  }

  /* =====================================================================================
   * Running quiz (#/quiz/run): questions from every chosen deck.
   *
   * quiz = { id, mode, deckIds, count, questions, i, retry, finished, timer, answeredAt, shownAt, enter, spoken, ui }
   *   questions  from VC.buildQuiz; an answered question gets
   *              q.result = { correct, chosen? (choice), input?, gaveUp?, otherForm? (spell), word, meaning, deckId }
   *   retry      a 「重測答錯的題目」 round: its score does not go into 最近測驗 (state.quizHistory)
   *   answeredAt, shownAt  perfNow() of the last answer / of the question coming up (tap guards)
   *   ui         the parts of the question screen that change in place. The next question re-uses
   *              the same answer box, so the phone keyboard stays open from question to question.
   * The session is in memory only: back and then forward again continues it, and so does 「繼續第 N
   * 題」 on the quiz page while it has answers; 開始測驗, 「再測一次」 and the end of the flashcards
   * make a fresh set. 「結束」 in the ✕ dialog throws the session away. Without a session (e.g. the
   * page was reloaded) #/quiz/run shows the quiz page.
   * ===================================================================================== */

  var quiz = null;
  var quizSerial = 0;
  // A tap within this long after a new question came up was meant for the screen before (a tap to
  // skip the wait, a double tap on 再測一次): it does not answer.
  var NEW_QUESTION_GUARD_MS = 350;
  // … and within this long after a wrong spelling, a second tap on the same spot (確認 → 下一題) or a
  // second Enter does not hide the correction.
  var WRONG_ANSWER_GUARD_MS = 500;

  /** setup: { mode, deckIds, count } */
  function newQuizSession(setup, questions, retry) {
    return {
      id: ++quizSerial, mode: setup.mode, deckIds: setup.deckIds.slice(), count: setup.count,
      questions: questions, i: 0, retry: !!retry,
      finished: false, timer: null, answeredAt: 0, shownAt: perfNow(), enter: true, spoken: '', ui: null
    };
  }

  /** A pointer tap (click events from keys and el.click() have detail 0) right after time `since`. */
  function tooSoon(e, since, ms) {
    return !!(e && e.detail > 0 && perfNow() - since < ms);
  }

  /** The current question was just answered wrong (see WRONG_ANSWER_GUARD_MS). */
  function justMissed() {
    var q = currentQuestion();
    return !!(q && q.result && !q.result.correct && perfNow() - quiz.answeredAt < WRONG_ANSWER_GUARD_MS);
  }

  /**
   * A fresh random set of questions from the cards of setup.deckIds. The wrong choices come from
   * the same cards (all cards when they have fewer than 4 different meanings).
   */
  function startQuiz(setup) {
    stopQuizTimer();
    var ids = setup.deckIds.filter(function (id) { return deckById(id); });
    var cards = cardsOfDecks(ids);
    var pool = setup.mode === 'choice' ? choicePool(cards) : cards;
    var questions = cards.length ? VC.buildQuiz(cards, setup.mode, setup.count, rand, pool) || [] : [];
    quiz = newQuizSession({ mode: setup.mode, deckIds: ids, count: setup.count }, questions, false);
  }

  /** Straight into a quiz of these decks (end of the flashcards); the quiz page keeps it as its setup. */
  function openQuizFor(deckIds, mode) {
    var qs = quizSetup();
    qs.mode = mode;
    qs.deckIds = deckIds.slice();
    scheduleSave();
    startQuiz(qs);
    return go(QUIZ_RUN_HASH);
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

  function renderQuizRun() {
    if (quiz && !quiz.questions.length) {
      quiz = null;
      toast('沒有可以出的題目', 'error');
    }
    if (!quiz) { navigate(QUIZ_HASH, true); return; }
    var title = QUIZ_TITLES[quiz.mode];
    var quit = iconBtn('close', quiz.finished ? '關閉' : '結束測驗', 'quiz-quit', quitQuiz);
    if (quiz.finished) {
      mount(screen('quiz', [topbar(title, quit), resultsView()]), 'quiz-results:' + quiz.id);
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
      // 不會，看答案 sits in the sentence card (fillSpell), above the input: with the phone keyboard
      // up, the space below the input is covered.
      body = [ui.prompt,
        h('div', { class: 'spell-form' }, h('div', { class: 'spell-row' }, ui.input, ui.submit, ui.next)),
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
    // The options and 下一題 are drawn anew: a keyboard / screen-reader user keeps a place to be.
    var hadFocus = ui.options.contains(document.activeElement) || ui.bottom.contains(document.activeElement);
    clear(ui.prompt);
    ui.prompt.className = 'quiz-prompt' + (quiz.enter ? ' enter' : '');
    var word = h('h2', { class: 'word ' + lenClass(q.word), lang: 'en', text: q.word, tabindex: '-1' });
    ui.prompt.appendChild(word);
    append(ui.prompt, phoneticRow(q));

    clear(ui.options);
    ui.options.className = 'opts' + (res ? ' answered' : '') + (quiz.enter ? ' enter' : '');
    q.options.forEach(function (text, i) {
      var mark = !res ? '' : i === q.answerIndex ? ' correct' : i === res.chosen ? ' wrong' : ' dim';
      ui.options.appendChild(h('button', {
        type: 'button', class: 'opt' + mark + (res && i === res.chosen ? ' chosen' : ''),
        'data-action': 'option-' + i, 'aria-disabled': res ? 'true' : null,
        'aria-label': mark === ' correct' ? '正確答案：' + oneLine(text) : mark === ' wrong' ? '你選的（答錯）：' + oneLine(text) : null,
        onclick: function (e) {
          if (tooSoon(e, quiz.shownAt, NEW_QUESTION_GUARD_MS)) return; // meant for the screen before
          answerChoice(i);
        }
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
    var next = res ? h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'quiz-next',
      text: nextLabel(), onclick: nextQuestion }) : null;
    append(ui.bottom, next);
    if (hadFocus && (!document.activeElement || document.activeElement === document.body)) {
      try { (next || word).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
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
      if (!q || !q.result) submitSpell(false);
      else if (!justMissed()) nextQuestion(); // a quick second Enter must not hide the correction
    });
    // Answered: the box keeps what was typed. It is not made read-only, so it keeps the focus and
    // the phone keyboard stays up for the next question.
    ui.input.addEventListener('beforeinput', function (e) { if (ui.locked) e.preventDefault(); });
    ui.input.addEventListener('input', function () { if (ui.locked) ui.input.value = ui.lockedValue; });
    ui.submit = keepFocus(h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'spell-submit',
      text: '確認', onclick: function () { submitSpell(false); } }));
    // 下一題 takes the place of 確認: a double tap on 確認 must not skip the correction of a wrong answer.
    ui.next = keepFocus(h('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'quiz-next',
      onclick: function (e) { if (!(e && e.detail > 0 && justMissed())) nextQuestion(); } }));
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
    // Other occurrences of the word in the sentence are masked too until it is answered.
    ui.prompt.appendChild(h('p', { class: 'cloze', lang: 'en' },
      res ? cz.before : cz.beforeMasked != null ? cz.beforeMasked : cz.before,
      res ? h('mark', { class: res.correct ? 'ok' : 'bad', text: cz.answer }) : clozeMask(cz.masked),
      res ? cz.after : cz.afterMasked != null ? cz.afterMasked : cz.after));
    ui.giveup.hidden = !!res;
    ui.prompt.appendChild(h('div', { class: 'quiz-card-foot' },
      q.hint ? h('p', { class: 'quiz-hint', text: q.hint }) : null, ui.giveup));
    // A wrong answer: the word and its meaning in the card, which stays in view above the phone keyboard.
    if (res && !res.correct && res.meaning) {
      ui.prompt.appendChild(h('p', { class: 'fb-meaning' },
        h('b', { lang: 'en', text: res.word }), h('span', { text: oneLine(res.meaning) })));
    }

    ui.locked = !!res;
    ui.lockedValue = ui.input.value;
    ui.input.classList.toggle('ok', !!res && res.correct);
    ui.input.classList.toggle('bad', !!res && !res.correct);
    ui.input.setAttribute('aria-readonly', String(!!res));
    ui.submit.hidden = !!res;
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
    if (res.otherForm) {
      ui.feedback.appendChild(h('p', { class: 'fb-line fb-form' }, '單字拼對了，但句子裡要用 ',
        h('b', { lang: 'en', text: cz.answer })));
    }
  }

  function submitSpell(giveUp) {
    var q = currentQuestion();
    if (!q || q.result || quiz.mode !== 'spell') return;
    var typed = quiz.ui.input.value.trim();
    if (!giveUp && !typed) { focusSpellInput(); return; } // empty: nothing to check yet
    var card = cardById(q.cardId);
    var word = card ? card.word : '';
    var correct = !giveUp && VC.checkSpelling(typed, q.cloze.answer, word);
    q.result = { correct: correct, input: giveUp ? '' : typed, gaveUp: !!giveUp,
      otherForm: !giveUp && !correct && VC.isOtherForm(typed, word, q.cloze.answer) };
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
    res.deckId = card ? card.deckId : '';
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
    quiz.shownAt = perfNow();
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
    speakWord(q.word);
  }

  /** The end: a quiz that is not a 重測 round goes into 最近測驗 (state.quizHistory, newest first). */
  function finishQuiz() {
    stopQuizTimer();
    quiz.finished = true;
    if (!quiz.retry) {
      var mode = quiz.mode;
      var at = now();
      // (at, mode) tells entries apart when tabs merge their histories: keep it unique.
      while (state.quizHistory.some(function (e) { return e.at === at && e.mode === mode; })) at++;
      state.quizHistory = tidyHistory([{ mode: mode, deckIds: quiz.deckIds.slice(), score: quizScore(),
        total: quiz.questions.length, at: at }].concat(state.quizHistory));
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
        if (ok) {
          quiz = null; // ended: no 「繼續第 N 題」 on the quiz page
          goBack();
        } else if (quiz && quiz.mode === 'spell') focusSpellInput();
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
    quiz = newQuizSession(quiz, questions, true);
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

  function resultsView() {
    var session = quiz;
    var mode = session.mode;
    var total = session.questions.length;
    var score = quizScore();
    var pct = Math.round(score / total * 100);
    var wrong = session.questions.filter(function (q) { return !q.result || !q.result.correct; });
    var multi = session.deckIds.length > 1;

    var actions = h('div', { class: 'results-actions' },
      wrong.length ? h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'retry-wrong',
        onclick: retryWrong }, icon('reset'), '重測答錯的 ' + wrong.length + ' 題') : null,
      h('button', { type: 'button', class: 'btn btn-lg ' + (wrong.length ? 'btn-secondary' : 'btn-primary'),
        'data-action': 'quiz-again', text: '再測一次', onclick: function () { startQuiz(session); render(); } }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-lg', 'data-action': 'quiz-home', text: '回到測驗',
        onclick: function () { goBackTo(QUIZ_HASH); } }));

    var list = null;
    if (wrong.length) {
      list = [h('h2', { class: 'section-title', text: '答錯的單字' }),
        h('div', { class: 'word-list wrong-list' }, wrong.map(function (q) {
          var r = q.result || {};
          // Spelling: the form the sentence needed, when it is not the word itself (abandon → abandoned).
          var form = mode === 'spell' && q.cloze.answer.toLowerCase() !== str(r.word).toLowerCase() ? q.cloze.answer : '';
          var deck = multi && r.deckId ? deckById(r.deckId) : null; // which deck, when several were tested
          return h('div', { class: 'wl-row', 'data-card-id': q.cardId },
            h('div', { class: 'wr-main' },
              h('div', { class: 'wr-word', lang: 'en', text: r.word }),
              h('div', { class: 'wr-meaning', text: oneLine(r.meaning) }),
              deck ? h('div', { class: 'wr-deck', text: deck.name }) : null),
            form ? h('span', { class: 'pill p-form', lang: 'en', text: form }) : null);
        }))];
    }

    return h('div', { class: 'content no-bottombar results', id: 'quiz-results' },
      h('div', { class: 'score' }, scoreRing(pct),
        h('div', { class: 'score-center' },
          h('p', { class: 'score-num', id: 'quiz-score' }, h('b', { text: String(score) }), ' / ' + total),
          h('p', { class: 'score-pct', text: pct + '%' }))),
      h('h2', { class: 'score-line', text: pct >= 90 ? '太厲害了！' : pct >= 70 ? '不錯喔，繼續加油！' : '多練幾次就會記住了！' }),
      h('p', { class: 'score-sub', text: (session.retry ? '重測答錯的題目' : QUIZ_TITLES[mode] + ' · ' + total + ' 題') +
        ' · ' + decksText(session.deckIds) }),
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

    // Under the example: what the spelling quiz will ask, or that it cannot find the word (phrases: not asked).
    var exampleHint = h('p', { class: 'field-hint', id: 'f-example-hint' });
    function updateExampleHint() {
      var w = inputs.word.value.trim();
      var ex = inputs.example.value.trim();
      var phrase = isPhrase(w);
      var cz = w && ex && !phrase ? VC.makeCloze({ word: w, example: ex }) : null;
      exampleHint.classList.toggle('warn', !!(w && ex && !cz && !phrase));
      exampleHint.textContent = phrase ? '片語不考拼字（拼字題只考一個字的單字），例句照常寫就好。'
        : !w || !ex ? '例句裡要有這個單字，拼字題才能從例句出題。'
        : cz ? '拼字題：' + oneLine(cz.beforeMasked + cz.masked + cz.afterMasked)
        : '例句裡找不到「' + w + '」，拼字題會跳過這張卡（不規則變化、拆開的片語都找不到）。';
    }
    inputs.word.addEventListener('input', updateExampleHint);
    inputs.example.addEventListener('input', updateExampleHint);
    updateExampleHint();

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
      field('例句', inputs.example, exampleHint),
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

  /**
   * 「片語不考拼字」 for a phrase, 「不考拼字」 for a word whose example sentence does not contain it
   * (the spelling quiz skips both).
   */
  function noSpellPill(card) {
    if (isPhrase(card.word)) return h('span', { class: 'pill p-nospell', title: '拼字題只考一個字的單字', text: '片語不考拼字' });
    return str(card.example).trim() && !spellOk(card)
      ? h('span', { class: 'pill p-nospell', title: '例句裡找不到這個單字，拼字題會跳過', text: '不考拼字' }) : null;
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
            noSpellPill(c), wrongPill(c)));
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
  // How example sentences must be written (rule 8 of CLAUDE_PROMPT; also in EXAMPLES_PROMPT).
  var EXAMPLE_RULE = '例句要自然、符合高中程度，而且一定要包含這個單字本身或它的規則變化（-s、-es、-ed、-ing、-er、-est、-ly）；' +
    '不要用不規則變化（例如 take 不要寫成 took、buy 不要寫成 bought），片語要完整出現（give up 可以寫 gives up、giving up，' +
    '但不要拆成 give it up），因為 App 的拼字測驗會從例句裡把這個字挖空。翻譯用自然的台灣口語。';
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
    '3. 每個牌組用一行「#deck: 牌組名稱」開始；一個牌組只寫一次 #deck:，不同牌組的名稱不要重複。如果我有說要放進哪個資料夾（例如課本名稱），就在第一個 #deck: 前面加一行「#folder: 資料夾名稱」。',
    '4. 一行一張卡，固定格式：',
    '   word | /IPA/ | pos. 中文意思 | Natural English example sentence. | 自然的中文翻譯',
    '   需要時可以加第 6 欄備註（片語、常見搭配、同反義字），例如：| be reluctant to + V 不情願做……',
    '5. 分隔符號一律用半形 |，前後各空一格；不要用 Tab 或逗號。欄位內容裡不要出現 |（真的需要就寫 \\|），也不要換行（需要時寫 \\n）。',
    '6. 音標用美式（General American）IPA，寫在 /…/ 裡，例如 /əˈbændən/；名詞、動詞唸法不同時都寫在這一欄，例如 /ˈprezənt/ (n.) /prɪˈzent/ (v.)。不確定音標時整欄省略（直接寫 word | pos. 中文意思 | …），不要留空欄。',
    '7. 中文意思用台灣慣用的繁體中文，詞性縮寫放最前面（n. v. adj. adv. prep. conj. pron. phr. 等）；同一詞性的多個意思用全形分號「；」隔開，不同詞性接著寫，例如 v. 接近；靠近；n. 方法。衍生字、搭配詞這類英文補充寫在第 6 欄備註，不要寫在中文意思裡；片語的句型（+ N、+ V-ing）也寫在備註，例如 look forward to | phr. 期待 | 例句 | 翻譯 | look forward to + N / V-ing。',
    '8. ' + EXAMPLE_RULE + '片語（兩個字以上）不會出拼字題，例句照常寫就好。',
    '9. 不要加標題列（例如 word | meaning），同一個單字只寫一行，不要重複。',
    '',
    '範例：',
    '#deck: 學測 Level 4・第 1 回',
    'abandon | /əˈbændən/ | v. 拋棄；放棄 | Someone abandoned the puppy on the side of the road. | 有人把那隻小狗丟在路邊。',
    'reluctant | /rɪˈlʌktənt/ | adj. 不情願的；勉強的 | He was reluctant to admit his mistake. | 他不太願意承認自己的錯誤。 | be reluctant to + V 不情願做……',
    'give up | phr. 放棄 | Don\'t give up on your dreams. | 不要放棄你的夢想。'
  ].join('\n');

  // 「請 Claude 補例句」: the deck as a text file, with rules for adding example sentences.
  function examplesPrompt(deck, cards) {
    return [
      '下面是我的「單字卡」App 單字檔，請幫每個單字補上例句和例句翻譯，改好的檔案要能直接匯入 App。',
      '',
      '請嚴格遵守下面的規則：',
      '1. #deck:（和 #folder:）那一行和每一行的單字都不要改，也不要增加、刪除或合併單字；有音標的照原本的寫。',
      '2. 每一行寫成：word | /IPA/ | pos. 中文意思 | Natural English example sentence. | 自然的中文翻譯 | 備註（沒有音標就省略音標那一欄，沒有備註就省略最後一欄）。',
      '3. 中文意思保持原樣；但意思裡 →、← 或括號（…）中的英文補充（衍生字、搭配詞、句型），請搬到第 6 欄備註，中文意思欄只留中文。',
      '4. ' + EXAMPLE_RULE,
      '5. 分隔符號一律用半形 |，前後各空一格。只輸出檔案內容，整份放在一個 ```text 程式碼區塊裡。',
      '',
      '單字檔：',
      '```text',
      VC.serializeDeck(deck.name, cards, folderName(deck.folderId)).trim(),
      '```'
    ].join('\n');
  }

  /** How to get example sentences for a deck (the spelling quiz needs them): Claude adds them. */
  function openExamplesSheet(deckId) {
    var deck = deckById(deckId);
    if (!deck) return;
    var cards = cardsOfDeck(deckId);
    var missing = cards.filter(function (c) { return !str(c.example).trim(); }).length;
    var body = h('div', { class: 'sheet-body examples-help' },
      h('p', { text: '拼字題要從例句出題，這個牌組有 ' + missing + ' 個單字還沒有例句。可以請 Claude 一次補好：' }),
      h('ol', null,
        h('li', { text: '按「複製給 Claude」，貼到 Claude 的對話框送出。' }),
        h('li', { text: '複製 Claude 的整則回覆，按「貼上 Claude 的回覆」貼進框框。' }),
        h('li', { text: '確認選的是「更新內容（保留測驗紀錄）」，再按「匯入」。單字的測驗紀錄都會保留。' })));
    var foot = h('div', { class: 'sheet-foot stack' },
      h('button', { type: 'button', class: 'btn btn-tonal btn-lg', 'data-action': 'copy-examples-prompt',
        onclick: function () {
          copyText(examplesPrompt(deck, cardsOfDeck(deckId))).then(function (ok) {
            toast(ok ? '已複製！貼給 Claude 就可以了' : '無法複製，請再試一次', ok ? null : 'error');
          });
        } }, icon('sparkle'), '複製給 Claude'),
      h('button', { type: 'button', class: 'btn btn-primary btn-lg', 'data-action': 'paste-examples',
        onclick: function () { openImport(deckId, true, 'update'); } }, icon('clipboard'), '貼上 Claude 的回覆'));
    openSheet({ title: '請 Claude 補例句', body: body, foot: foot });
  }

  // folder: the 資料夾 of new decks: '' (none), a folder id, or 'new' = a folder named newFolder,
  // made when the import happens. askFolder: opened from a folder page (資料夾 shows from the start).
  var imp = null;
  var impUI = null;

  function resetImport() {
    imp = { files: [], text: '', target: 'new', names: {}, dupMode: 'skip', focusPaste: false, folder: '', newFolder: '', askFolder: false };
  }
  resetImport();

  /**
   * Open the import screen. deckId: words without #deck go into that deck (opened from an empty
   * deck); otherwise into a new deck. dupMode: preselect 'update' (Claude's reply with examples
   * for words already in the deck). folderId: new decks go into that folder (opened from a folder
   * page). Text or files still waiting there are kept.
   */
  function openImport(deckId, focusPaste, dupMode, folderId) {
    if (!imp.text.trim() && !imp.files.length) resetImport();
    if (deckId) imp.target = deckId;
    if (focusPaste) imp.focusPaste = true;
    if (dupMode) imp.dupMode = dupMode;
    if (folderId) { imp.folder = folderId; imp.askFolder = true; }
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
   * The deck a section of a file goes into, if it exists. With "#folder: F" in the file: the deck
   * of that name in folder F (none: a new deck in F). Without: the one in the folder chosen for
   * the import, else one outside any folder, else one in any folder (it stays where it is).
   */
  function importDeck(name, fileFolder, chosenFolderId) {
    var same = decksByLooseName(name);
    if (!same.length) return null;
    var find = function (test) { for (var i = 0; i < same.length; i++) if (test(same[i])) return same[i]; return null; };
    if (fileFolder) {
      var k = deckKey(fileFolder);
      return find(function (d) { var f = folderById(d.folderId); return !!f && deckKey(f.name) === k; });
    }
    return (chosenFolderId && find(function (d) { return d.folderId === chosenFolderId; })) ||
      find(function (d) { return !d.folderId; }) || same[0];
  }

  /**
   * Work out where every parsed card would go, without changing anything.
   * sources: [{ id, name, defaultDeckName, text }]
   * opts: { target: 'new' | deckId, names: { [sourceId]: deckName }, dupMode: 'skip' | 'update',
   *         folder: null | { id } | { name } — the folder of new decks (a "#folder:" in the file wins) }
   * Each group (one deck) has folder = the name of the folder its deck is / will be in ('' = none)
   * and fileFolder = the "#folder:" of the file for a new deck.
   */
  function planImport(sources, opts) {
    var dupMode = opts.dupMode === 'update' ? 'update' : 'skip';
    var targetDeck = opts.target && opts.target !== 'new' ? deckById(opts.target) : null;
    var chosen = opts.folder || null;
    var chosenId = chosen && chosen.id && folderById(chosen.id) ? chosen.id : null;
    var chosenName = chosenId ? folderName(chosenId) : chosen && chosen.name ? str(chosen.name).trim() : '';
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
      var key = dest.deck ? 'id:' + dest.deck.id
        : 'new:' + (dest.folder ? 'f:' + deckKey(dest.folder) : '') + ':' + deckKey(dest.name);
      var g = groups[key];
      if (g) return g;
      // Word-keyed maps without a prototype: "constructor" / "__proto__" are ordinary words.
      g = groups[key] = {
        key: key, deckId: dest.deck ? dest.deck.id : null, name: dest.deck ? dest.deck.name : dest.name,
        isNew: !dest.deck, fromSection: fromSection, adds: [], updates: [], dups: 0, merged: 0,
        fileFolder: dest.deck ? '' : dest.folder || '',
        folder: dest.deck ? folderName(dest.deck.folderId) : dest.folder || chosenName,
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

    function destByName(name, fileFolder) {
      var nm = str(name).trim() || '我的單字';
      // Opened for one deck (its empty hub, 請 Claude 補例句): a section with that deck's name is
      // that deck — also when another folder has a deck of the same name.
      if (targetDeck && deckKey(nm) === deckKey(targetDeck.name) &&
          (!fileFolder || deckKey(fileFolder) === deckKey(folderName(targetDeck.folderId)))) {
        return { deck: targetDeck };
      }
      var d = importDeck(nm, fileFolder, chosenId);
      return d ? { deck: d } : { name: nm, folder: fileFolder };
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
        var fileFolder = str(sec.folder).trim();
        var dest;
        if (isDefault) {
          if (needsName.indexOf(src.id) < 0) needsName.push(src.id);
          if (targetDeck) dest = { deck: targetDeck };
          else dest = destByName(opts.names && opts.names[src.id] != null ? opts.names[src.id] : src.defaultDeckName, fileFolder);
        } else {
          dest = destByName(sec.name, fileFolder);
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
      perSource: perSource, suspectEncoding: suspectEncoding, folder: chosenId ? { id: chosenId } : chosenName ? { name: chosenName } : null };
  }

  /** Apply a plan. If the result cannot be saved (storage full), nothing changes: res.failed. */
  function applyPlan(plan) {
    var res = { added: 0, updated: 0, skipped: plan.totals.dup + plan.totals.merged, errors: plan.errors.length, deckIds: [] };
    var saved = transaction(function () {
      plan.groups.forEach(function (g) {
        if (!g.adds.length && !g.updates.length) return;
        var deckId = g.deckId;
        if (!deckId || !deckById(deckId)) {
          // A new deck: in the file's folder, else the chosen one (made now when it is new).
          var folder = g.fileFolder ? folderForName(g.fileFolder)
            : plan.folder && plan.folder.id ? folderById(plan.folder.id)
            : plan.folder ? folderForName(plan.folder.name) : null;
          deckId = createDeck(g.name, folder ? folder.id : null).id;
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
    if (imp.folder && imp.folder !== 'new' && !folderById(imp.folder)) imp.folder = '';
    if (imp.folder === 'new' && !imp.newFolder) imp.folder = '';
    var folder = imp.folder === 'new' ? { name: imp.newFolder } : imp.folder ? { id: imp.folder } : null;
    return { target: imp.target, names: imp.names, dupMode: imp.dupMode, folder: folder };
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
      state.decks.map(function (d) { return d.id + d.name; }),
      showImportFolder(sources, plan), imp.folder, imp.newFolder, state.folders.map(function (f) { return f.id + f.name; })]);
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

  /**
   * 資料夾 is asked when the import makes a new deck that the file does not put in a folder
   * itself — and before anything is chosen when the import was opened from a folder page.
   */
  function showImportFolder(sources, plan) {
    if (!sources.length) return imp.askFolder;
    return plan.groups.some(function (g) { return g.isNew && !g.fileFolder && g.adds.length; });
  }

  /** The 資料夾 select (#import-folder): 不放資料夾 / the folders / a new one being named / 新增資料夾…. */
  function importFolderSelect() {
    var sel = h('select', { id: 'import-folder', class: 'input' },
      h('option', { value: '', text: '不放資料夾' }),
      sortedFolders().map(function (f) { return h('option', { value: f.id, text: f.name }); }),
      imp.newFolder ? h('option', { value: 'new', text: imp.newFolder + '（新資料夾）' }) : null,
      h('option', { value: 'add', text: '新增資料夾…' }));
    sel.value = imp.folder;
    sel.addEventListener('change', function () {
      if (sel.value !== 'add') { imp.folder = sel.value; refreshImport(); return; }
      sel.value = imp.folder; // until a name is given
      promptDialog({ title: '新增資料夾', message: '這次匯入的新牌組會放進這個資料夾。', placeholder: '資料夾名稱，例如：龍騰 B3',
        okText: '確定', maxlength: 60 }).then(function (name) {
        if (name === null) return;
        var n = str(name).trim();
        if (!n) { toast('請輸入資料夾名稱', 'error'); return; }
        var existing = folderByLooseName(n);
        if (existing) {
          toast('已經有「' + existing.name + '」資料夾，新牌組會放進這裡');
          imp.folder = existing.id;
        } else {
          imp.newFolder = n;
          imp.folder = 'new';
        }
        impUI.optionsSig = null; // rebuild with the new option
        refreshImport();
      });
    });
    return sel;
  }

  function buildImportOptions(sources, plan) {
    var box = impUI.options;
    clear(box);
    var folderField = showImportFolder(sources, plan)
      ? field('資料夾', importFolderSelect(), '新的牌組會放進這個資料夾；已經有的牌組不會移動。') : null;
    if (!sources.length) {
      if (folderField) box.appendChild(h('div', { class: 'panel' }, folderField));
      return;
    }

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
    append(panel, folderField);
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
          h('span', { class: 'sec-main' },
            h('span', { class: 'sec-name', text: g.name }),
            g.folder ? h('span', { class: 'sec-folder' }, icon('folder'),
              h('span', { text: g.folder + (folderByLooseName(g.folder) ? '' : '（新資料夾）') })) : null),
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
    // One deck: straight to it (ready to study). Several: their folder when they are all in the
    // same one, else home — with the decks highlighted.
    if (res.deckIds.length === 1) { goBackTo(deckHash(res.deckIds[0])); return; }
    flashDeckIds = res.deckIds.slice();
    var folderIds = [];
    res.deckIds.forEach(function (id) {
      var d = deckById(id);
      var f = d ? d.folderId || '' : '';
      if (folderIds.indexOf(f) < 0) folderIds.push(f);
    });
    if (folderIds.length === 1 && folderIds[0]) goBackTo(folderHash(folderIds[0]));
    else goHome();
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
          h('li', { text: '#folder: 名稱 寫在 #deck: 前面，後面的牌組就會放進這個資料夾。' }),
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
        message: '備份內有 ' + (norm.folders.length ? norm.folders.length + ' 個資料夾、' : '') +
          norm.decks.length + ' 個牌組、' + norm.cards.length + ' 張卡片。' +
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
      state.prefs = Object.assign({}, prev.prefs, { quizSetup: Object.assign({}, prev.prefs.quizSetup, { deckIds: null }) });
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
    if (r.name !== 'quiz-run') stopQuizTimer();
    if (r.name !== 'cards' && r.name !== 'quiz-run' && tts.supported) {
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }
    updateTabBar(r.name);
    if (r.name === 'deck') renderHub(r.id);
    else if (r.name === 'folder') renderFolder(r.id);
    else if (r.name === 'cards') renderCards(r.id);
    else if (r.name === 'quiz') renderQuizPage(r);
    else if (r.name === 'quiz-run') renderQuizRun();
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
    if (topOverlay() || (currentRoute().name === 'quiz-run' && currentQuestion())) return;
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
    else if (r.name === 'quiz-run' && quiz) quizKey(e, tag);
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
      if (card && (deck.settings.direction !== 'zh2en' || fc.flipped)) speakWord(card.word);
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
        speakWord(q.word);
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
    checkForUpdate();
    // Home: the backup reminder counts days, which may have passed while the app was in the background.
    if (!topOverlay() && currentRoute().name === 'home') render();
  }

  /**
   * A home-screen app kept in the background never navigates (hash routes), so the browser would
   * not look for a new version: ask when it comes back (at most once an hour). A new service worker
   * downloads every file; the next launch is the new version.
   */
  var lastUpdateCheck = Date.now();
  function checkForUpdate() {
    if (Date.now() - lastUpdateCheck < 3600000 || !navigator.serviceWorker || !navigator.serviceWorker.getRegistration) return;
    lastUpdateCheck = Date.now();
    try {
      navigator.serviceWorker.getRegistration().then(function (r) { if (r) return r.update(); }).catch(function () {});
    } catch (e) { /* offline support is optional */ }
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
        { target: target, names: {}, dupMode: o.dupMode, folder: o.folderId && folderById(o.folderId) ? { id: o.folderId } : null });
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
