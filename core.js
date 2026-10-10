/*
 * 單字卡 core — pure logic shared by the app and the tests. No DOM access.
 *   - text-file format:  parseDeckText / serializeDeck / decodeBytes / normalizeWord
 *   - cards:             newCard
 *   - headwords:         wordForms / headwordRegex / findHeadword  (the word inside its example sentence)
 *   - spelling quiz:     maskWord / makeCloze / checkSpelling
 *   - choice quiz:       posOf / meaningKey / pickChoices
 *   - quizzes:           buildQuiz / quizEligible, with shuffle / seededRng for random order
 * Loads as a classic <script> (window.VC) and as a CommonJS module (module.exports).
 */
(function () {
  'use strict';

  const DEFAULT_DECK_SETTINGS = { direction: 'en2zh' }; // 字卡正面: 'en2zh' 英文 / 'zh2en' 中文

  /* ------------------------------------------------------------------ helpers */

  function str(v) {
    return v == null ? '' : String(v);
  }

  function num(v, fallback) {
    if (v == null || v === '') return fallback;
    const n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  function oneLine(v) {
    return str(v).replace(/\s+/g, ' ').trim();
  }

  /* ------------------------------------------------------- text-file parsing */

  const CJK_RE = /[㐀-鿿豈-﫿]/;
  // "#deck: 名稱" — also full-width ＃ and ：, any case.
  const DECK_RE = /^[#＃]\s*deck\s*[:：]\s*([\s\S]*)$/i;
  // Anki "Notes in Plain Text" headers that describe extra columns / the separator.
  const ANKI_COLUMN_RE = /^#\s*(tags|guid|notetype|deck)\s+column\s*:\s*(\d+)\s*$/i;
  const ANKI_SEPARATOR_RE = /^#\s*separator\s*:\s*(\S+)\s*$/i;
  const PHONETIC_RE = /^(?:\/[\s\S]+\/|\[[\s\S]+\])$/;
  // A /…/ or […] group between spaces or punctuation (not "he/she/they"): heteronyms with
  // labels in field 2, e.g. "/ˈprezənt/ (n.); /prɪˈzent/ (v.)".
  const PHONETIC_GROUP_RE = /(^|[\s(（,，;；、])(\/[^\/\s][^\/]*\/|\[[^\[\]]+\])(?=$|[\s)）,，;；、])/;
  // Characters that only occur in IPA / KK transcriptions (a bare "əˈbændən" in field 2).
  const IPA_CHAR_RE = /[əɪʊæɑɔʌɛɚɝθðʃʒŋˈˌːˋˊ]/;
  // Fallback lines only: "abandon /əˈbændən/ 放棄" — a trailing /…/ or […] in the English part.
  const PHONETIC_TAIL_RE = /(^|\s)(\/[^/]+\/|\[[^[\]]+\])$/;
  // … but a bracketed usage label is part of the meaning: "information [U] 資訊".
  const LABEL_RE = /^\[(?:U|C|U\/C|C\/U|pl\.?|sing\.?|slang|informal|formal|AmE|BrE)\]$/i;
  const POS_NAMES = 'interj|abbr|conj|prep|pron|adj|adv|aux|art|phr|num|int|vt|vi|n|v';
  const POS = '(?:' + POS_NAMES + ')\\.';
  const POS_UNIT = '[(（]?' + POS + '(?:\\s*[/,、&]\\s*' + POS + ')*[)）]?';
  const POS_START_RE = new RegExp('^' + POS_UNIT, 'i'); // "n. 學期", "(v.) …"
  // A bracketed POS may be glued to the word: "abandon(v.)放棄".
  const POS_TAIL_RE = new RegExp('(^|[\\s,，:：=]|(?=[(（]))(' + POS_UNIT + '(?:\\s*' + POS_UNIT + ')*)$', 'i');
  // A whole field that is only a part of speech (a separate 詞性 column): "v.", "adj", "(n.)", "名詞".
  const POS_FIELD_RE = new RegExp('^(?:' + POS_UNIT + '(?:\\s*' + POS_UNIT + ')*' +
    '|[(（]?(?:' + POS_NAMES + ')[)）]?' +
    '|[(（]?(?:名詞|動詞|形容詞|副詞|介系詞|介詞|連接詞|連詞|代名詞|代詞|感嘆詞|感歎詞|片語|助動詞|冠詞|數詞|及物動詞|不及物動詞)[)）]?)$', 'i');
  const TRAILING_SEPARATORS_RE = /[\s,，:：=＝\-–—－~～;；>＞→⇒／｜︱│]+$/;
  // "abandon v. 1. 放棄 2. 拋棄": a sense number right before the first Chinese character.
  const SENSE_TAIL_RE = /(^|\s)((?:\d{1,2}[.)、．]|[(（]\d{1,2}[)）]|[①-⑳]))\s*$/;
  // List markers in front of a word: "1. ", "2) ", "(3) ", "4、", "① ", "• ", "- ", "* "
  // (also before a word that starts with a digit, after a space: "1. 3D printing").
  const LIST_MARKER_RE = /^\s*(?:[(（]?\d{1,4}[.)、．）]|[(（]\d{1,4}[)）]|[①-⑳]|[•●○◦▪▫・·‧]|[-*+](?=\s))(?:\s*(?=[*_"'“‘「]*[A-Za-z])|\s+(?=\d))/;
  // A whole TAB / table field that is only a row number or a bullet.
  const MARKER_FIELD_RE = /^(?:[(（]?\d{1,4}[.)、．）]?|[(（]\d{1,4}[)）]|[①-⑳]|[•●○◦▪▫・·‧*+-])$/;
  // Markdown that AI chats wrap around word lists: code fences, rules, a bold-only heading line.
  const FENCE_RE = /^(?:```|~~~)/;
  const HRULE_RE = /^([-*_])(?:\s*\1){2,}$/;
  const BOLD_LINE_RE = /^(\*\*|__)(?=\S)[^*_]*\S\1[:：]?$/;
  const MAX_JOINED_LINES = 20;
  // Opening brackets/quotes right before the first CJK character belong to the meaning.
  const OPENERS = '([（「『【〔〈《“"';
  // A section's first line is a column header when field 1 is one of these words …
  const HEADER_WORDS = new Set(['word', 'words', 'term', 'terms', 'front', 'english', 'vocabulary', 'vocab',
    '單字', '英文', '生字', '英文單字', '單詞', '字彙']);
  // … and field 2 is missing, one of these, or (without a part of speech in front) contains one
  // of the keywords below: "Chinese meaning", "中文解釋", "/IPA/" (a prompt template echoed back).
  const HEADER_WORDS_2 = new Set(['meaning', 'meanings', 'definition', 'definitions', 'back', 'chinese',
    'translation', 'ipa', 'kk', 'phonetic', 'phonetics', 'pronunciation', 'pos', 'part of speech',
    '中文', '中文意思', '意思', '意義', '字義', '詞義', '解釋', '釋義', '定義', '翻譯', '中譯', '音標', 'kk音標', '詞性', '例句']);
  const HEADER_KEYWORDS = ['meaning', 'definition', 'phonetic', 'pronunciation', 'chinese', 'translation', 'ipa',
    '中文', '意思', '意義', '解釋', '翻譯', '音標', '詞性', '例句'];
  // A row-number column in front of the header: "No. | Word | Meaning".
  const NUMBER_HEADERS = new Set(['no', 'no.', 'num', 'number', '序號', '編號', '題號']);
  const HEADER_LINE = '單字 | 音標 | 中文意思 | 例句 | 例句翻譯 | 備註';
  const DEFAULT_DECK_NAME = '我的單字';

  const ERR_NO_SEPARATOR = '找不到「|」分隔符號，也沒有中文意思';
  const ERR_NO_WORD = '缺少單字';
  const ERR_NO_MEANING = '缺少中文意思';

  // Only real HTML tags (as in Anki / Quizlet exports) with name="value" attributes, so
  // placeholders like "remind <sb> of <sth>" and "if a<b and b>c" stay as they are.
  const TAG_ATTRS = '(?:\\s+[\\w:-]+\\s*=\\s*(?:"[^"]*"|\'[^\']*\'|[^\\s"\'<>]+))*\\s*\\/?>';
  const BREAK_TAG_RE = new RegExp('<(?:br|div|p)' + TAG_ATTRS, 'gi');
  const TAG_RE = new RegExp('<\\/?(?:a|b|i|u|s|em|strong|span|font|div|p|br|hr|img|sup|sub|small|big|' +
    'ul|ol|li|table|tbody|thead|tr|td|th|code|pre|blockquote|h[1-6])' + TAG_ATTRS, 'gi');
  const ENTITY_RE = /&(?:(nbsp|amp|lt|gt|quot|apos)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g;
  const HTMLISH_RE = /<\/?[a-zA-Z][^<>]*>|&(?:[a-zA-Z]+|#\d+|#[xX][0-9a-fA-F]+);/;
  const NAMED_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  const SOUND_TAG_RE = /\[sound:[^\]]*\]/gi;

  function decodeEntity(match, name, dec, hex) {
    if (name) return NAMED_ENTITIES[name];
    const cp = dec ? parseInt(dec, 10) : parseInt(hex, 16);
    if (cp === 160) return ' ';
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
  }

  // Anki / Quizlet exports: <br>, <div>, <p> become newlines, other tags vanish, entities decode.
  function htmlToText(s) {
    if (s.indexOf('<') === -1 && s.indexOf('&') === -1) return s;
    return s.replace(BREAK_TAG_RE, '\n').replace(TAG_RE, '').replace(ENTITY_RE, decodeEntity);
  }

  // Markdown emphasis from AI chats: **bold** and *italic* between words ("2*3*4" and
  // "2**3" stay), and _x_ / __x__ only around a whole field (so fill-in blanks like
  // "He ___ it." stay). Escaped \* and \_ (written by serializeDeck) are never emphasis.
  function stripEmphasis(s) {
    if (s.indexOf('*') === -1 && s.indexOf('_') === -1) return s;
    let t = s.replace(/(^|[^\w*\\])\*\*(?=\S)([^*]*?[^\s\\])\*\*(?![\w*])/g, '$1$2');
    t = t.replace(/(^|[^*\w\\])\*(?=[^\s*])([^*]*?[^\s*\\])\*(?![*\w])/g, '$1$2');
    const m = /^(_{1,2})(?=[^\s_])([^_]*?[^\s_\\])\1$/.exec(t);
    return m ? m[2] : t;
  }

  // \|  \n  \t  \\  \*  \_  (and \# / \＃ so a word may start with "#"); unknown escapes stay literal.
  function unescapeField(s) {
    if (s.indexOf('\\') === -1) return s;
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s.charAt(i);
      if (ch === '\\' && i + 1 < s.length) {
        const next = s.charAt(i + 1);
        const rep = next === 'n' ? '\n' : next === 't' ? '\t'
          : '|\\#＃*_'.indexOf(next) !== -1 ? next : null;
        if (rep !== null) {
          out += rep;
          i++;
          continue;
        }
      }
      out += ch;
    }
    return out;
  }

  function cleanField(raw) {
    let s = htmlToText(raw.trim()).trim();
    if (s.indexOf('[') !== -1) s = s.replace(SOUND_TAG_RE, '').trim(); // Anki audio tags
    return unescapeField(stripEmphasis(s));
  }

  // Strip CSV-style wrapping quotes ("…" with "" for a literal quote), as written by Excel —
  // only when the opening quote really closes at the end (not '"Pizza?" "Whatever."').
  function unquote(s) {
    if (s.length >= 2 && s.charAt(0) === '"' && quoteEnd(s, 0) === s.length - 1) {
      return s.slice(1, -1).replace(/""/g, '"').trim();
    }
    return s;
  }

  function headerKey(s) {
    return unquote(str(s).trim()).toLowerCase();
  }

  function isHeaderWord(s) {
    return HEADER_WORDS.has(headerKey(s));
  }

  // "word | 中文意思", "Front\tBack", "單字 | 中文解釋", "No. | Word | Meaning" — but not a real
  // first card like "term | n. 學期" or "word | 字".
  function isHeaderRow(tokens) {
    let t = tokens;
    if (t.length > 2 && NUMBER_HEADERS.has(headerKey(t[0]))) t = t.slice(1);
    if (!isHeaderWord(t[0])) return false;
    const second = headerKey(t[1]);
    if (!second || HEADER_WORDS_2.has(second)) return true;
    return !POS_START_RE.test(second) && HEADER_KEYWORDS.some(function (k) { return second.indexOf(k) !== -1; });
  }

  // Field 2 is a phonetic: wrapped in /…/ or […]; or, when field 3 is the Chinese meaning, IPA
  // with labels ("/ˈprezənt/ (n.); /prɪˈzent/ (v.)") or without slashes ("əˈbændən").
  function isPhoneticField(f, next) {
    if (!f || CJK_RE.test(f)) return false;
    if (PHONETIC_RE.test(f)) return true;
    if (!CJK_RE.test(next || '')) return false;
    return PHONETIC_GROUP_RE.test(f) || (!/[\/\[\]]/.test(f) && IPA_CHAR_RE.test(f));
  }

  function isPipe(ch) { return ch === '|'; }
  function isWidePipe(ch) { return ch === '｜' || ch === '︱' || ch === '│'; }

  // Split on unescaped separators (isSep). Returns null when the line has none.
  function splitPipes(line, isSep) {
    const raw = [];
    let cur = '';
    let found = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line.charAt(i);
      if (ch === '\\' && i + 1 < line.length) {
        cur += ch + line.charAt(i + 1);
        i++;
      } else if (isSep(ch)) {
        raw.push(cur);
        cur = '';
        found = true;
      } else {
        cur += ch;
      }
    }
    if (!found) return null;
    raw.push(cur);
    return raw;
  }

  // End index of the quoted field that opens at rec[q] (the closing quote), or -1 if unclosed.
  function quoteEnd(rec, q) {
    for (let k = q + 1; k < rec.length; k++) {
      if (rec.charAt(k) === '"') {
        if (rec.charAt(k + 1) === '"') { k++; continue; }
        return k;
      }
    }
    return -1;
  }

  // Raw fields of one TAB / CSV record. A field that starts with " is quoted ("" = a literal
  // quote) and may contain the delimiter and line breaks; unquote() removes the quotes later.
  function splitDelimited(rec, d) {
    const out = [];
    let i = 0;
    for (;;) {
      let j = i;
      while (rec.charAt(j) === ' ') j++;
      let end = -1;
      if (rec.charAt(j) === '"') {
        const close = quoteEnd(rec, j);
        if (close !== -1) {
          const next = rec.indexOf(d, close + 1);
          end = next === -1 ? rec.length : next;
        }
      }
      if (end === -1) {
        const next = rec.indexOf(d, i);
        end = next === -1 ? rec.length : next;
      }
      out.push(rec.slice(i, end));
      if (end >= rec.length) return out;
      i = end + d.length;
    }
  }

  // True when the record ends inside a quoted field (an Excel cell with a line break).
  function quoteOpen(rec, d) {
    let i = 0;
    for (;;) {
      let j = i;
      while (rec.charAt(j) === ' ') j++;
      let from = i;
      if (rec.charAt(j) === '"') {
        const close = quoteEnd(rec, j);
        if (close === -1) return true;
        from = close + 1;
      }
      const next = rec.indexOf(d, from);
      if (next === -1) return false;
      i = next + d.length;
    }
  }

  // TAB wins; otherwise split on unescaped "|", or on full-width ｜ ︱ │ when the line has no "|".
  // Returns null when the line has no separator at all.
  function splitFields(line) {
    if (line.indexOf('\t') !== -1) {
      return splitDelimited(line, '\t').map(function (f) { return cleanField(unquote(f.trim())); });
    }
    let raw = splitPipes(line, isPipe);
    if (!raw && /[｜︱│]/.test(line)) raw = splitPipes(line, isWidePipe);
    return raw ? raw.map(cleanField) : null;
  }

  // "| a | b |" (a Markdown table row) → "a | b"; null for anything else.
  function tableRow(t) {
    if (t.length < 3 || t.charAt(0) !== '|' || t.charAt(t.length - 1) !== '|' || t.charAt(t.length - 2) === '\\') return null;
    const inner = t.slice(1, -1);
    return splitPipes(inner, isPipe) ? inner : null;
  }

  // "|---|:---:|", "--- | ---": the row under a Markdown table header.
  function isTableSeparator(t) {
    return !!t && t.indexOf('|') !== -1 && t.indexOf('-') !== -1 && /^[\s|:\-]+$/.test(t);
  }

  function nextNonBlank(lines, from) {
    for (let k = from; k < lines.length; k++) {
      const t = lines[k].trim();
      if (t) return t;
    }
    return '';
  }

  function stripListMarker(line) {
    const m = LIST_MARKER_RE.exec(line);
    return m ? line.slice(m[0].length) : line;
  }

  function buildCard(word, phonetic, rest) {
    if (!word) return { error: ERR_NO_WORD };
    const meaning = rest[0] || '';
    if (!meaning) return { error: ERR_NO_MEANING };
    return {
      card: {
        word: word,
        phonetic: phonetic,
        meaning: meaning,
        example: rest[1] || '',
        exampleZh: rest[2] || '',
        note: rest.slice(3).filter(Boolean).join(' / '),
      },
    };
  }

  function posLabel(s) {
    return /^[a-z]+$/i.test(s) ? s + '.' : s;
  }

  function cardFromFields(fields) {
    const rest = fields.slice(1);
    let phonetic = '';
    const f2 = rest.length ? rest[0] : '';
    if (isPhoneticField(f2, rest[1])) {
      phonetic = rest.shift();
      if (!/[\/\[\]]/.test(phonetic)) phonetic = '/' + phonetic + '/'; // IPA without slashes, e.g. from a website
    } else if (rest.length > 1 && !f2 && rest[1]) {
      // A blank meaning cell ("abandon |  | He abandoned it. | 他放棄了。") is not a blank 音標 column.
      if (!CJK_RE.test(rest[1]) && !POS_START_RE.test(rest[1]) && CJK_RE.test(rest[2] || '') &&
          !isPhoneticField(rest[1], rest[2])) return { error: ERR_NO_MEANING };
      rest.shift(); // an empty 音標 column ("word |  | 中文"), e.g. a spreadsheet with blank IPA cells
    }
    // A separate 詞性 column ("abandon | v. | 放棄") joins the meaning.
    if (rest.length > 1 && rest[0] && POS_FIELD_RE.test(rest[0]) && CJK_RE.test(rest[1])) {
      rest[1] = posLabel(rest[0]) + ' ' + rest[1];
      rest.shift();
    }
    return buildCard(fields[0], phonetic, rest);
  }

  function trimSeparators(s) {
    return s.replace(TRAILING_SEPARATORS_RE, '').trim();
  }

  // "abandon /əˈbændən/ v." → { word: 'abandon', phonetic: '/əˈbændən/', pos: 'v.', label: '' }
  function splitEnglishPart(s) {
    let word = unquote(trimSeparators(s));
    let pos = '';
    let phonetic = '';
    let label = '';
    let m;
    for (let pass = 0; pass < 2; pass++) {
      if (!pos && (m = POS_TAIL_RE.exec(word))) {
        pos = m[2];
        word = trimSeparators(word.slice(0, m.index));
      }
      if (!phonetic && !label && (m = PHONETIC_TAIL_RE.exec(word))) {
        if (LABEL_RE.test(m[2])) label = m[2]; else phonetic = m[2];
        word = trimSeparators(word.slice(0, m.index));
      }
    }
    return { word: word, pos: pos, phonetic: phonetic, label: label };
  }

  // No TAB and no "|": split at the first CJK ideograph ("abandon v. 放棄").
  function cardFromFallback(raw) {
    const m = CJK_RE.exec(raw);
    if (!m) return { error: ERR_NO_SEPARATOR };
    let at = m.index;
    // Opening brackets and a leading ellipsis belong to the meaning ("o'clock ……點鐘").
    while (at > 0 && (OPENERS + '…⋯').indexOf(raw.charAt(at - 1)) !== -1) at--;
    let dots = at;
    while (dots > 0 && raw.charAt(dots - 1) === '.') dots--;
    if (at - dots >= 2) at = dots; // "ago ...以前" (a single "." is the end of "v.")
    // A letter or number glued to the meaning that the word starts with too: "T-shirt T恤", "1990s 1990年代".
    const glued = /(^|\s)([A-Z]|\d+)$/.exec(raw.slice(0, at));
    if (glued && glued.index > 0 && new RegExp('(^|\\s)' + glued[2]).test(raw.slice(0, glued.index))) {
      at = glued.index + glued[1].length;
    }
    // A sense number in front of the first meaning stays with the meaning ("v. 1. 放棄 2. 拋棄").
    const sense = SENSE_TAIL_RE.exec(raw.slice(0, at));
    if (sense) at = sense.index + sense[1].length;
    const english = raw.slice(0, at);
    const head = splitEnglishPart(cleanField(english));
    if (/[A-Za-z]-\s+$/.test(english) && head.word) head.word += '-'; // a prefix: "re- 再；重新"
    let meaning = unquote(cleanField(raw.slice(at)));
    if (head.label && meaning) meaning = head.label + ' ' + meaning;
    if (head.pos && meaning) meaning = head.pos + ' ' + meaning;
    return buildCard(head.word, head.phonetic, [meaning]);
  }

  /**
   * opts: { defaultDeckName?: string, csv?: boolean }
   *   csv: the text is a comma-separated file (RFC 4180 quotes); lines without a comma are
   *        read like any other line.
   * Returns { decks, errors }. When the text has a ``` / ~~~ code block with cards in it (a whole
   * AI chat reply was copied), only the block is read: the result also has skipped = the line
   * numbers of the chat text around it, which is neither imported nor reported as an error.
   */
  function parseDeckText(text, opts) {
    const lines = str(text).replace(/^﻿/, '').split(/\r\n|\r|\n/);
    const inside = fenceMap(lines);
    if (inside) {
      const fenced = parseLines(lines, opts, inside);
      if (fenced.decks.length) return fenced;
    }
    return parseLines(lines, opts, null);
  }

  // inside[i]: line i is in a ``` / ~~~ block (an unclosed block runs to the end). null without blocks.
  function fenceMap(lines) {
    let open = false;
    let any = false;
    const inside = lines.map(function (line) {
      if (!FENCE_RE.test(line.trim())) return open;
      open = !open;
      any = true;
      return false;
    });
    return any ? inside : null;
  }

  // only: null = every line, else only the lines with only[i] (the rest are listed in skipped).
  function parseLines(lines, opts, only) {
    const defaultName = oneLine(opts && opts.defaultDeckName) || DEFAULT_DECK_NAME;
    const decks = [];
    const byName = new Map();
    const errors = [];
    const skipped = [];
    let sectionName = defaultName;
    let atSectionStart = true;
    let delim = opts && opts.csv ? ',' : ''; // '' = TAB when the line has one, else "|"
    const anki = { drop: [], deckCol: 0 };   // columns described by Anki "#… column:N" headers

    for (let i = 0; i < lines.length; i++) {
      const first = i;
      const raw = lines[i];
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (only && !only[i]) {
        if (!FENCE_RE.test(trimmed)) skipped.push(i + 1);
        continue;
      }

      const c0 = trimmed.charAt(0);
      if (c0 === '#' || c0 === '＃') {
        const deckLine = DECK_RE.exec(trimmed);
        let m;
        if (deckLine) {
          sectionName = oneLine(deckLine[1]) || defaultName;
          atSectionStart = true;
        } else if ((m = ANKI_COLUMN_RE.exec(trimmed))) {
          const col = Number(m[2]);
          if (m[1].toLowerCase() === 'deck') anki.deckCol = col;
          if (col > 0 && anki.drop.indexOf(col) === -1) anki.drop.push(col);
        } else if ((m = ANKI_SEPARATOR_RE.exec(trimmed))) {
          const sep = m[1].toLowerCase();
          delim = sep === 'comma' || sep === ',' ? ',' : sep === 'semicolon' || sep === ';' ? ';' : '';
        }
        continue; // any other "#…" line is a comment
      }
      // Markdown around a list copied from an AI chat: ``` fences, --- rules, |---| rows, **headings**.
      if (FENCE_RE.test(trimmed) || HRULE_RE.test(trimmed) || BOLD_LINE_RE.test(trimmed) || isTableSeparator(trimmed)) continue;

      let fields;
      let body = raw;
      let byColumns = false;
      const cells = tableRow(trimmed);
      if (cells !== null) {
        fields = splitFields(cells); // a Markdown table row
      } else {
        // "\1. intro", "\- ish", "\```": a leading backslash (written by serializeDeck) keeps a
        // word from being read as a list marker, a code fence or a rule.
        body = /^\\[^|\\#＃*_nt]/.test(trimmed) ? raw.replace('\\', '') : stripListMarker(raw);
        const d = delim && body.indexOf(delim) !== -1 ? delim : body.indexOf('\t') !== -1 ? '\t' : '';
        if (d) {
          // A quoted cell may span lines (a spreadsheet cell with a line break in it).
          if (quoteOpen(body, d)) {
            let joined = body;
            let k = i;
            while (quoteOpen(joined, d) && k + 1 < lines.length && k - i < MAX_JOINED_LINES) {
              k++;
              joined += '\n' + lines[k];
            }
            if (!quoteOpen(joined, d)) {
              body = joined;
              i = k;
            }
          }
          fields = splitDelimited(body, d).map(function (f) { return cleanField(unquote(f.trim())); });
          byColumns = true;
        } else {
          fields = splitFields(body);
        }
      }

      // The row right above |---| is a table header (with or without outer pipes).
      if (fields && isTableSeparator(nextNonBlank(lines, i + 1))) {
        atSectionStart = false;
        continue;
      }

      let name = sectionName;
      if (byColumns && anki.drop.length) {
        if (anki.deckCol && fields.length >= anki.deckCol) {
          const fromColumn = oneLine(fields[anki.deckCol - 1].split('::').pop());
          if (fromColumn) name = fromColumn;
        }
        fields = fields.filter(function (f, idx) { return anki.drop.indexOf(idx + 1) === -1; });
      }
      // A row-number / bullet column in front of the word ("1\tabandon\t放棄", "| 1 | abandon | 放棄 |")
      // — but not a word that is a number ("911 | n. 報案電話 | …"): then field 2 is the meaning.
      if (fields && fields.length >= 3 && MARKER_FIELD_RE.test(fields[0]) && /^[*_"'“‘]*[A-Za-z]/.test(fields[1]) &&
          !CJK_RE.test(fields[1]) && !POS_START_RE.test(fields[1])) {
        fields = fields.slice(1);
      }

      if (atSectionStart) {
        atSectionStart = false;
        if (isHeaderRow(fields ? fields : body.trim().split(/[\s,，:：=]+/))) continue;
      }

      const result = fields ? cardFromFields(fields) : cardFromFallback(body);
      if (result.error) {
        errors.push({ line: first + 1, text: lines.slice(first, i + 1).join('\n'), reason: result.error });
        continue;
      }
      result.card.line = first + 1;
      let deck = byName.get(name);
      if (!deck) {
        deck = { name: name, cards: [] };
        byName.set(name, deck);
        decks.push(deck);
      }
      deck.cards.push(result.card);
    }
    return only ? { decks: decks, errors: errors, skipped: skipped } : { decks: decks, errors: errors };
  }

  /* ---------------------------------------------------- text-file writing */

  function normField(v) {
    return str(v).replace(/\r\n?/g, '\n').trim();
  }

  function escapeField(v) {
    let s = normField(v)
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    // Text that would be read back as Markdown emphasis ("I *love* it.") keeps its * and _.
    if (stripEmphasis(s) !== s) s = s.replace(/[*_]/g, '\\$&');
    // Text that would be read back as HTML (tags/entities) is entity-encoded so it round-trips.
    if (HTMLISH_RE.test(s)) s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return s;
  }

  function serializeCard(card) {
    const c = card || {};
    const phonetic = normField(c.phonetic);
    const meaning = normField(c.meaning);
    let word = escapeField(c.word);
    // A word that starts like a comment, list marker, code fence or rule: "#tag", "1. intro", "```".
    if (/^[#＃]/.test(word) || stripListMarker(word) !== word || FENCE_RE.test(word) || HRULE_RE.test(word)) {
      word = '\\' + word;
    }
    const out = [word];
    if (phonetic) {
      out.push(escapeField(PHONETIC_RE.test(phonetic) ? phonetic : '/' + phonetic + '/'));
    } else if (PHONETIC_RE.test(meaning) || isPhoneticField(meaning, normField(c.example))) {
      out.push(''); // keep an empty 音標 slot so a meaning like "[俚語]" is not read as a phonetic
    }
    out.push(escapeField(meaning), escapeField(c.example), escapeField(c.exampleZh), escapeField(c.note));
    while (out.length > 2 && out[out.length - 1] === '') out.pop();
    return out.join(' | ');
  }

  function serializeDeck(name, cards) {
    const list = Array.isArray(cards) ? cards : [];
    const lines = ['#deck: ' + oneLine(name)];
    // A first word like "term" could be taken for a column header on import — add a real header.
    if (list.length && isHeaderWord(normField(list[0] && list[0].word))) lines.push(HEADER_LINE);
    for (let i = 0; i < list.length; i++) lines.push(serializeCard(list[i]));
    return lines.join('\n') + '\n';
  }

  /* --------------------------------------------------------------- encoding */

  function countReplacement(s) {
    let n = 0;
    for (let i = s.indexOf('\uFFFD'); i !== -1; i = s.indexOf('\uFFFD', i + 1)) n++;
    return n;
  }

  // UTF-16 without a BOM: every other byte of ASCII text is 0.
  function utf16WithoutBom(b) {
    const pairs = Math.min(200, Math.floor(b.length / 2));
    if (pairs < 2) return '';
    let even = 0;
    let odd = 0;
    for (let i = 0; i < pairs; i++) {
      if (b[2 * i] === 0) even++;
      if (b[2 * i + 1] === 0) odd++;
    }
    if (odd >= pairs * 0.3 && even <= pairs * 0.05) return 'utf-16le';
    if (even >= pairs * 0.3 && odd <= pairs * 0.05) return 'utf-16be';
    return '';
  }

  function decodeBytes(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    const decode = function (label, bytes, fatal) {
      return new TextDecoder(label, fatal ? { fatal: true } : undefined).decode(bytes);
    };
    let s;
    let utf16;
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
      s = decode('utf-8', b.subarray(3));
    } else if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
      s = decode('utf-16le', b.subarray(2));
    } else if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
      s = decode('utf-16be', b.subarray(2));
    } else if ((utf16 = utf16WithoutBom(b))) {
      s = decode(utf16, b);
    } else {
      try {
        s = decode('utf-8', b, true);
      } catch (notUtf8) {
        // Big5 = Windows 記事本 "ANSI" on a 繁中 system. A UTF-8 file with one stray byte
        // stays UTF-8: whichever decoding produces fewer broken characters wins.
        const loose = decode('utf-8', b);
        let big5 = null;
        try { big5 = decode('big5', b); } catch (noBig5) { big5 = null; }
        s = big5 !== null && countReplacement(big5) < countReplacement(loose) ? big5 : loose;
      }
    }
    return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  }

  function normalizeWord(s) {
    let t = str(s);
    if (t.normalize) t = t.normalize('NFKC');
    // Curly apostrophes (iOS smart punctuation, Word) and zero-width characters from web pages.
    t = t.replace(/[\u2018\u2019\u02BC\u2032]/g, "'").replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
    return t.toLowerCase().trim().replace(/\s+/g, ' ');
  }

  /* ------------------------------------------------------------------ cards */

  // right / wrong: how often the card was answered correctly / wrongly in a quiz (both modes).
  function newCard(fields, deckId, now, id, seq) {
    const f = fields || {};
    return {
      id: id,
      deckId: deckId,
      word: str(f.word),
      phonetic: str(f.phonetic),
      meaning: str(f.meaning),
      example: str(f.example),
      exampleZh: str(f.exampleZh),
      note: str(f.note),
      created: now,
      seq: seq,
      right: 0,
      wrong: 0,
    };
  }

  /* -------------------------------------------------------------- headwords */

  // Letters for word boundaries and masking: ASCII plus Latin-1 / Latin Extended (café, naïve).
  const LETTERS = 'A-Za-z\\u00C0-\\u024F';
  const LETTER_RUN_RE = new RegExp('[' + LETTERS + ']+', 'g');
  const ONE_RUN_RE = new RegExp('^[' + LETTERS + ']+$');
  const NOT_LETTER_RE = new RegExp('[^' + LETTERS + ']', 'g');
  const NOT_WORD_CHAR_RE = new RegExp('[^' + LETTERS + '\'’\\- ]', 'g');
  const IRREGULAR = {
    be: ['be', 'am', 'is', 'are', 'was', 'were', 'been', 'being'],
    have: ['have', 'has', 'had', 'having'],
    do: ['do', 'does', 'did', 'done', 'doing'],
    go: ['go', 'goes', 'went', 'gone', 'going'],
  };
  // Placeholders in a phrase ("take care of sth", "take sb's place", "make up one's mind") are not
  // in the sentence.
  const PLACEHOLDER_RE =
    /(^|\s)(?:(?:sth|sb|something|somebody|someone|one)['’]s|sth|sb|something|somebody|someone|oneself)\.?(?=\s|$)/g;

  /**
   * The word (lower-cased) and its regular forms: -s -es -ed -d -ing -ly -er -est, silent e
   * (making), -le → -ly (simply), consonant + y → -ies -ied -ier -iest -ily (studied), a doubled
   * final consonant (stopped, bigger, admitted), -ic → -ically (basically); or the forms of
   * be / have / do / go. Forms that are not real words are harmless: they never occur in a sentence.
   */
  function wordForms(word) {
    const w = str(word).trim().toLowerCase();
    if (!w) return [];
    if (Object.prototype.hasOwnProperty.call(IRREGULAR, w)) return IRREGULAR[w].slice();
    const f = [w, w + 's', w + 'es', w + 'ed', w + 'd', w + 'ing', w + 'ly', w + 'er', w + 'est'];
    if (/e$/.test(w) && w.length > 2) {
      const s = w.slice(0, -1); // silent e: make → making
      f.push(s + 'ing', s + 'ed', s + 'er', s + 'est');
      if (/le$/.test(w)) f.push(s + 'y'); // simple → simply
    }
    if (/[^aeiou]y$/.test(w)) {
      const y = w.slice(0, -1); // study → studied, happy → happily
      f.push(y + 'ies', y + 'ied', y + 'ier', y + 'iest', y + 'ily');
    }
    const last = w.slice(-1);
    if (/^[^aeiou]*[aeiou][bdgklmnprt]$/.test(w)) { // one syllable: stop → stopped, big → bigger
      f.push(w + last + 'ed', w + last + 'ing', w + last + 'er', w + last + 'est');
    } else if (/[^aeiou][aeiou][bdgklmnprt]$/.test(w)) { // admit → admitted, begin → beginning
      f.push(w + last + 'ed', w + last + 'ing');
    }
    if (/ic$/.test(w)) f.push(w + 'ally'); // basic → basically
    return f.filter(function (x, i) { return f.indexOf(x) === i; });
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // A literal part of the pattern; a straight and a curly apostrophe match each other.
  function literal(s) {
    return escapeRe(s).replace(/['’]/g, '[\'’]');
  }

  /**
   * A global, case-insensitive RegExp that finds the headword in an example sentence, or null when
   * the word has fewer than 2 letters. The word may be inflected (wordForms); in a phrase only the
   * first word is ("giving up", not "gave up"), the rest must follow literally. Bracketed parts,
   * alternatives after / ; , and placeholders like sth / sb / one's are left out.
   * Group 1 is the character in front of the match ('' at the start: no lookbehind before
   * iOS 16.4), group 2 the headword, which starts at m.index + m[1].length. A match never starts
   * or ends inside another word ("cat" is not found in "category").
   */
  function headwordRegex(word) {
    let w = str(word);
    if (w.normalize) w = w.normalize('NFC'); // é as one character
    w = w.toLowerCase()
      .replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, ' ')
      .split(/[\/;,，；、]/)[0];
    const bare = w.replace(PLACEHOLDER_RE, ' ');
    if (bare.replace(NOT_LETTER_RE, '')) w = bare; // the word "someone" itself stays
    w = w
      .replace(NOT_WORD_CHAR_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (w.replace(NOT_LETTER_RE, '').length < 2) return null;
    const parts = w.split(' ');
    const first = wordForms(parts[0]).sort(function (a, b) { return b.length - a.length; }).map(literal);
    const rest = parts.slice(1).map(literal).join('\\s+');
    const core = '(?:' + first.join('|') + ')' + (rest ? '\\s+' + rest : '');
    try {
      return new RegExp('(^|[^' + LETTERS + '])(' + core + ')(?![' + LETTERS + '])', 'gi');
    } catch (e) {
      return null;
    }
  }

  // The first occurrence of the headword in sentence: { index, text } (the exact substring) or null.
  function findHeadword(sentence, word) {
    const s = str(sentence);
    const re = s ? headwordRegex(word) : null;
    const m = re ? re.exec(s) : null;
    return m ? { index: m.index + m[1].length, text: m[2] } : null;
  }

  /* ---------------------------------------------------------- spelling quiz */

  /**
   * Keeps the first and the last letter of every run of letters and hides the rest:
   * abandoned → a_______d, Abandon → A_____n, give up → g__e u_ (a 2-letter run keeps only its
   * first letter, a 1-letter run stays), well-being → w__l-b___g, o'clock → o'c___k.
   * Returns { masked, hidden } where hidden = the number of '_'.
   */
  function maskWord(text) {
    let hidden = 0;
    const masked = str(text).replace(LETTER_RUN_RE, function (run) {
      const keepLast = run.length > 2;
      const n = run.length - (keepLast ? 2 : 1);
      hidden += n;
      return run.charAt(0) + '_'.repeat(n) + (keepLast ? run.charAt(run.length - 1) : '');
    });
    return { masked: masked, hidden: hidden };
  }

  /**
   * The spelling question of a card: its example sentence split around the first occurrence of the
   * headword — { before, answer, after, masked, hidden } with before + answer + after = example —
   * or null when there is no example, the word is not in it, or nothing would be hidden.
   */
  function makeCloze(card) {
    const example = str(card && card.example);
    const hit = findHeadword(example, card && card.word);
    if (!hit) return null;
    const mask = maskWord(hit.text);
    if (!mask.hidden) return null;
    return {
      before: example.slice(0, hit.index),
      answer: hit.text,
      after: example.slice(hit.index + hit.text.length),
      masked: mask.masked,
      hidden: mask.hidden,
    };
  }

  // Case, full-width letters (NFKC), accents (résumé = resume), curly apostrophes, Unicode hyphens,
  // extra spaces and trailing punctuation do not count as spelling mistakes.
  function spellingKey(s) {
    let t = normalizeWord(s);
    if (t.normalize) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t.replace(/[‐-–−]/g, '-').replace(/[\s.,!?;:；。！？]+$/, '');
  }

  // True when input spells answer — or, for a one-word answer of 3+ letters, when input is only
  // the hidden letters (answer "abandoned", input "bandone").
  function checkSpelling(input, answer) {
    const a = spellingKey(answer);
    const t = spellingKey(input);
    if (!t || !a) return false;
    if (t === a) return true;
    return a.length >= 3 && ONE_RUN_RE.test(a) && t === a.slice(1, -1);
  }

  /* ------------------------------------------------------------ choice quiz */

  const POS_LEAD_RE = new RegExp('^[(（]?\\s*(' + POS_NAMES + ')\\.', 'i');

  // The part of speech a meaning starts with, lower-cased ("v. 放棄" → 'v.', "(Adj.) 快樂的" → 'adj.'), or ''.
  function posOf(meaning) {
    const m = POS_LEAD_RE.exec(str(meaning).trim());
    return m ? m[1].toLowerCase() + '.' : '';
  }

  // Meanings with the same key are the same option: line breaks read as '；', case and spaces ignored.
  function meaningKey(meaning) {
    return str(meaning).trim().replace(/\s*\n\s*/g, '；').replace(/\s+/g, ' ').toLowerCase();
  }

  // Tests a pool card as a wrong option for card: returns its meaningKey, or '' when it is the card
  // itself, the same word (e.g. in another deck), or a blank / the same meaning.
  function distractorTest(card) {
    const id = card && card.id;
    const word = normalizeWord(card && card.word);
    const key = meaningKey(card && card.meaning);
    return function (c) {
      if (!c || c === card || (id != null && c.id === id)) return '';
      const k = meaningKey(c.meaning);
      if (!k || k === key || (word && normalizeWord(c.word) === word)) return '';
      return k;
    };
  }

  /**
   * Options for a multiple-choice question: card.meaning plus up to n - 1 (default 3) wrong meanings
   * from pool (cards), all distinct by meaningKey. Meanings with the card's part of speech come
   * first, the rest are random. Returns { options (shuffled), answerIndex } — fewer than n options
   * when the pool lacks distinct meanings; the option strings are always distinct.
   */
  function pickChoices(card, pool, rng, n) {
    const r = rngOf(rng);
    const size = n == null ? 4 : Math.max(1, Math.floor(num(n, 4)));
    const correct = str(card && card.meaning);
    const pos = posOf(correct);
    const test = distractorTest(card);
    const list = Array.isArray(pool) ? pool.slice() : [];
    const used = new Set();
    const same = [];
    const other = [];
    // Draw the pool in random order (Fisher–Yates, one step at a time) until enough are found.
    for (let i = 0; i < list.length && same.length < size - 1; i++) {
      const j = i + randomIndex(r, list.length - i);
      const c = list[j];
      list[j] = list[i];
      list[i] = c;
      const k = test(c);
      if (!k || used.has(k)) continue;
      used.add(k);
      (posOf(c.meaning) === pos ? same : other).push(str(c.meaning));
    }
    const wrong = same.concat(other).slice(0, size - 1);
    const order = shuffle(wrong.map(function (m, i) { return i + 1; }).concat(0), r);
    return {
      options: order.map(function (i) { return i ? wrong[i - 1] : correct; }),
      answerIndex: order.indexOf(0),
    };
  }

  /* ------------------------------------------------------------------ quiz */

  function rngOf(rng) {
    return typeof rng === 'function' ? rng : Math.random;
  }

  // An index in [0, n) from rng — also when a broken rng returns 1, a negative number or NaN.
  function randomIndex(r, n) {
    const k = Math.floor(r() * n);
    return k > 0 ? Math.min(n - 1, k) : 0;
  }

  // Fisher–Yates on a copy (the input is never changed); rng() returns [0, 1), default Math.random.
  function shuffle(array, rng) {
    const r = rngOf(rng);
    const a = Array.isArray(array) ? array.slice() : [];
    for (let i = a.length - 1; i > 0; i--) {
      const j = randomIndex(r, i + 1);
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // mulberry32: the same seed (a number, taken as uint32) always gives the same sequence in [0, 1).
  function seededRng(seed) {
    let a = Number(seed) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * The questions of a quiz: count cards (0 = all) in random order, skipping cards that cannot
   * make a question (so there are fewer only when too few cards can).
   *   'choice' → { cardId, mode, word, phonetic, options, answerIndex }: pickChoices(card, pool || cards);
   *              a card needs at least one other distinct meaning (2+ options).
   *   'spell'  → { cardId, mode, cloze, hint }: cloze = makeCloze(card), hint = exampleZh or else meaning.
   */
  function buildQuiz(cards, mode, count, rng, pool) {
    if (mode !== 'choice' && mode !== 'spell') throw new RangeError("mode must be 'choice' or 'spell'");
    const r = rngOf(rng);
    const limit = Math.max(0, Math.floor(num(count, 0)));
    const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
    const from = Array.isArray(pool) ? pool : list;
    const order = shuffle(list, r);
    const out = [];
    for (let i = 0; i < order.length && (!limit || out.length < limit); i++) {
      const c = order[i];
      if (mode === 'choice') {
        const pick = pickChoices(c, from, r);
        if (pick.options.length < 2) continue;
        out.push({ cardId: c.id, mode: mode, word: str(c.word), phonetic: str(c.phonetic),
          options: pick.options, answerIndex: pick.answerIndex });
      } else {
        const cloze = makeCloze(c);
        if (cloze) out.push({ cardId: c.id, mode: mode, cloze: cloze, hint: str(c.exampleZh).trim() || str(c.meaning) });
      }
    }
    return out;
  }

  // How many questions buildQuiz(cards, mode, 0, rng, pool) makes in each mode: { choice, spell }.
  function quizEligible(cards, pool) {
    const list = Array.isArray(cards) ? cards.filter(Boolean) : [];
    const from = Array.isArray(pool) ? pool : list;
    let choice = 0;
    let spell = 0;
    for (let i = 0; i < list.length; i++) {
      if (from.some(distractorTest(list[i]))) choice++;
      if (makeCloze(list[i])) spell++;
    }
    return { choice: choice, spell: spell };
  }

  /* ----------------------------------------------------------------- export */

  const VC = {
    version: '2.0', // must equal APP_VERSION in app.js (detects a stale cached core.js)
    DEFAULT_DECK_SETTINGS: DEFAULT_DECK_SETTINGS,
    parseDeckText: parseDeckText,
    serializeDeck: serializeDeck,
    decodeBytes: decodeBytes,
    normalizeWord: normalizeWord,
    newCard: newCard,
    wordForms: wordForms,
    headwordRegex: headwordRegex,
    findHeadword: findHeadword,
    maskWord: maskWord,
    makeCloze: makeCloze,
    checkSpelling: checkSpelling,
    posOf: posOf,
    meaningKey: meaningKey,
    shuffle: shuffle,
    seededRng: seededRng,
    pickChoices: pickChoices,
    buildQuiz: buildQuiz,
    quizEligible: quizEligible,
  };

  if (typeof module === 'object' && module && module.exports) module.exports = VC;
  if (typeof window !== 'undefined') window.VC = VC;
  else if (typeof self !== 'undefined') self.VC = VC;
})();
