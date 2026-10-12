# 빠른 입력 바 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `n`/`＋ 새 태스크`로 뜨는 한 줄 입력 바에서 «금요일까지 #인사시스템 발령 에러 확인»을 치고 Enter를 누르면 마감·분류가 채워진 태스크가 즉시 생긴다.

**Architecture:** 해석은 순수 함수 모듈 `public/quickparse.js`(브라우저·테스트 공유, `public/listgroup.js`와 같은 패턴). 입력 바는 `render()`가 갈아끼우는 `#modal-root` 밖의 전용 노드에 한 번만 그려 타이핑 중 재렌더로 입력값·IME 조합이 깨지지 않게 한다. 저장은 기존 `POST /api/tasks`.

**Tech Stack:** 바닐라 JS ES 모듈(빌드 없음), `node --test`, CSS 토큰(`--elev-lg`, `--radius`, `.chip.tint`).

**설계서:** `docs/superpowers/specs/2026-10-12-quick-capture-design.md`

## Global Constraints

- 새 의존성 없음. 서버·스키마·REST 무변경.
- 기존 `id`·`data-act` 유지(`new-task` 버튼 id 유지, 동작만 바뀜). 단축키 `/`, `i`, `Ctrl+Enter` 유지.
- 보드 열 `+`, 프로젝트 하위 추가, 메모 → 태스크 전환, AI 지시창 무변경.
- `light-dark()` 단일 토큰 체계 유지.
- 코드 주석·커밋 메시지는 한국어. 각 태스크 끝에 `npm test` 통과.

## 파일 구조

| 파일 | 역할 | 변경 |
|---|---|---|
| `public/quickparse.js` | 한 줄 → `{ title, due, category }` 순수 함수 | 신규(Task 1) |
| `test-quickparse.js` | 해석 규칙 단위 테스트 | 신규(Task 1) |
| `public/app.js` | 입력 바·저장·추가 알림 토스트·단축키 | 수정(Task 2) |
| `public/style.css` | `.qbar` 스타일 | 수정(Task 2) |
| `README.md` | 등록·단축키 설명 | 수정(Task 2) |

---

### Task 1: 한 줄 해석기 `parseQuick`

**Files:**
- Create: `public/quickparse.js`
- Create: `test-quickparse.js`

**Interfaces:**
- Produces: `export function parseQuick(text: string, { today: 'YYYY-MM-DD', categories: string[] }): { title: string, due: string|null, category: string|null }`

- [ ] **Step 1: 실패하는 테스트 작성** — `test-quickparse.js`

```js
// 빠른 입력 해석 검증. 순수 함수라 브라우저 없이 돌린다. 기준일 2026-10-12는 월요일.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick } from './public/quickparse.js';

const ctx = { today: '2026-10-12', categories: ['인사시스템', '유진GPT', 'GPT', 'TOPICS', '기타'] };
const p = (text) => parseQuick(text, ctx);

test('상대 날짜 — 오늘·내일·모레, 뒤의 «까지»도 지운다', () => {
  assert.deepEqual(p('내일 보고서'), { title: '보고서', due: '2026-10-13', category: null });
  assert.equal(p('오늘까지 정산').due, '2026-10-12');
  assert.deepEqual(p('모레'), { title: '', due: '2026-10-14', category: null });
});

test('요일 — 다가오는 그 요일(오늘이면 오늘), 이번 주·다음 주', () => {
  assert.deepEqual(p('금요일까지 발령 에러 확인'), { title: '발령 에러 확인', due: '2026-10-16', category: null });
  assert.equal(p('금 회의 준비').due, '2026-10-16');
  assert.equal(p('월 회의').due, '2026-10-12');
  assert.equal(p('다음주 월요일 배포').due, '2026-10-19');
  assert.equal(p('이번 주 금요일 정리').due, '2026-10-16');
  assert.equal(p('이번주 일요일').due, '2026-10-18');
  assert.equal(p('다음 주 일요일 전까지 점검').due, '2026-10-25');
});

test('월/일 — 지났으면 다음 해, «N일»은 지났으면 다음 달', () => {
  assert.deepEqual(p('10/20 마감 건'), { title: '마감 건', due: '2026-10-20', category: null });
  assert.equal(p('10.20 리뷰').due, '2026-10-20');
  assert.equal(p('10월 20일 리뷰').due, '2026-10-20');
  assert.equal(p('1/5 신년 계획').due, '2027-01-05');
  assert.equal(p('20일 정산').due, '2026-10-20');
  assert.equal(p('5일 정산').due, '2026-11-05');
});

test('오탐 방지 — 단어 속 글자·없는 날짜·«일» 단독은 날짜가 아니다', () => {
  assert.deepEqual(p('금액 확인'), { title: '금액 확인', due: null, category: null });
  assert.deepEqual(p('일 정리'), { title: '일 정리', due: null, category: null });
  assert.deepEqual(p('오늘의 할 일'), { title: '오늘의 할 일', due: null, category: null });
  assert.deepEqual(p('2/30 이상'), { title: '2/30 이상', due: null, category: null });
});

test('날짜가 여럿이면 첫 번째만 쓰고 나머지는 제목에 남긴다', () => {
  assert.deepEqual(p('내일 그리고 금요일'), { title: '그리고 금요일', due: '2026-10-13', category: null });
});

test('분류 — #태그는 지우고 우선, 포함 매칭은 제목에 남기고 최장 이름', () => {
  assert.deepEqual(p('#인사시스템 발령 확인'), { title: '발령 확인', due: null, category: '인사시스템' });
  assert.deepEqual(p('인사시스템 발령 확인'), { title: '인사시스템 발령 확인', due: null, category: '인사시스템' });
  assert.equal(p('유진GPT 교육').category, '유진GPT');
  assert.equal(p('#topics 정리').category, 'TOPICS');
  assert.deepEqual(p('#없는분류 메모'), { title: '#없는분류 메모', due: null, category: null });
  assert.deepEqual(p('금요일까지 #인사시스템 발령 에러 확인'),
    { title: '발령 에러 확인', due: '2026-10-16', category: '인사시스템' });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test test-quickparse.js`
Expected: FAIL — `Cannot find module '.../public/quickparse.js'`

- [ ] **Step 3: 구현** — `public/quickparse.js`

```js
// 빠른 입력 한 줄 해석. 브라우저(app.js)와 테스트가 같은 함수를 쓴다.
// AI 대신 규칙인 이유: 한 줄에 오는 날짜 표현은 «금요일까지·내일·10/20» 정도라 규칙이면 충분하고,
// Enter마다 수 초를 기다리게 하면 «빨리 적기»라는 목적이 무너진다. 긴 문장은 AI 지시창이 받는다.

const DOW = '일월화수목금토';
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// 실재하는 날짜만 — new Date(2026, 1, 30)은 3/2로 넘어가므로 되짚어 확인한다
const valid = (y, m, d) => {
  const x = new Date(y, m - 1, d);
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? x : null;
};

// 앞뒤가 글자·숫자면 날짜 표현이 아니다 — «금액»의 금, «오늘의»의 오늘을 잡지 않게
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const SUFFIX = '(?:\\s*(?:전까지|까지는|까지))?'; // 날짜 뒤에 붙는 «까지»류는 표현의 일부로 함께 지운다

/** 규칙 목록. at()이 null이면 그 매치는 날짜가 아니다(예: 2/30). */
const RULES = [
  { re: '(오늘|내일|모레)', at: (m, t) => add(t, ['오늘', '내일', '모레'].indexOf(m[1])) },
  {
    // «일» 한 글자는 «일 정리» 같은 오탐이 잦아 «일요일»만 인정한다
    re: '(?:(이번|다음)\\s*주\\s*)?(?:([월화수목금토])(?:요일)?|(일)요일)',
    at: (m, t) => {
      const dow = DOW.indexOf(m[2] ?? m[3]);
      const monday = add(t, -((t.getDay() + 6) % 7)); // 주는 월~일
      const inWeek = (w) => add(monday, w * 7 + ((dow + 6) % 7));
      if (m[1] === '다음') return inWeek(1);
      if (m[1] === '이번' && inWeek(0) >= t) return inWeek(0);
      return add(t, (dow - t.getDay() + 7) % 7); // 다가오는 그 요일, 오늘이면 오늘
    },
  },
  {
    re: '(\\d{1,2})\\s*(?:[/.]|월\\s*)(\\d{1,2})일?',
    at: (m, t) => {
      const [mo, d] = [Number(m[1]), Number(m[2])];
      const x = valid(t.getFullYear(), mo, d);
      return x && x < t ? valid(t.getFullYear() + 1, mo, d) : x;
    },
  },
  {
    re: '(\\d{1,2})일',
    at: (m, t) => {
      const d = Number(m[1]);
      const x = valid(t.getFullYear(), t.getMonth() + 1, d);
      if (!x || x >= t) return x;
      const next = new Date(t.getFullYear(), t.getMonth() + 1, 1);
      return valid(next.getFullYear(), next.getMonth() + 1, d);
    },
  },
].map((r) => ({ ...r, re: new RegExp(B + r.re + SUFFIX + E, 'gu') }));

/**
 * @param {string} text 사용자가 친 한 줄
 * @param {{ today: string, categories: string[] }} ctx today는 YYYY-MM-DD, categories는 설정 순서
 * @returns {{ title: string, due: string|null, category: string|null }}
 */
export function parseQuick(text, { today, categories }) {
  const [y, mo, d] = today.split('-').map(Number);
  const t = new Date(y, mo - 1, d);

  // 날짜 — 모든 규칙에서 «가장 앞에 나온» 유효한 표현 하나만 쓴다
  let hit = null;
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      const at = r.at(m, t);
      if (!at) continue;
      if (!hit || m.index < hit.index) hit = { index: m.index, len: m[0].length, due: iso(at) };
      break;
    }
  }
  let rest = hit ? `${text.slice(0, hit.index)} ${text.slice(hit.index + hit.len)}` : text;

  // 분류 — #태그(지움)가 우선, 없으면 이름 포함(제목에 남김, 가장 긴 이름)
  const low = (s) => s.toLowerCase();
  let category = null;
  const tag = rest.match(/(?<!\S)#(\S+)/u);
  const tagged = tag && categories.find((c) => low(c) === low(tag[1]));
  if (tagged) {
    category = tagged;
    rest = rest.replace(tag[0], ' ');
  } else {
    category = [...categories].sort((a, b) => b.length - a.length).find((c) => low(rest).includes(low(c))) ?? null;
  }

  return { title: rest.replace(/\s+/g, ' ').trim(), due: hit?.due ?? null, category };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test test-quickparse.js` → Expected: 6 tests PASS.
Run: `npm test` → Expected: 전부 PASS.
실패하는 케이스가 있으면 테스트 기대값이 아니라 구현을 고친다. 단, 설계서 표와 테스트가 서로 모순되면 멈추고 보고한다.

- [ ] **Step 5: Commit**

```bash
git add public/quickparse.js test-quickparse.js
git commit -m "feat: 빠른 입력 한 줄 해석기 — 날짜 표현·#분류를 규칙으로 뽑는 순수 함수"
```

---

### Task 2: 빠른 입력 바 + 추가 알림 토스트

**Files:**
- Modify: `public/app.js` (import, `S`, 토스트 `viewToast`, 클릭·키·input 리스너, `new-task` 버튼 리스너, `n` 단축키)
- Modify: `public/style.css` (토스트 절 다음에 `.qbar` 절)
- Modify: `README.md`

**Interfaces:**
- Consumes: `parseQuick`(Task 1), 기존 `firstOpen()`, `openNew()`, `openTask(id)`, `send()`, `api()`, `reload()`, `mutate()`, `esc()`, `md()`, `parseD()`, `CAT_COLOR()`, `TODAY`, `S.pending`.
- Produces: `openQuickBar(text = '')`, `closeQuickBar()`, `saveQuickBar(keepOpen)`, `quickToModal()`, `S.qbar`, `S.notice`.

- [ ] **Step 1: import·상태**

```js
import { parseQuick } from './quickparse.js';
```
(기존 `listgroup.js` import 다음 줄)

`S`에 추가(`quickTask` 줄 근처):
```js
  qbar: false,          // 빠른 입력 바 열림 여부 — 바 DOM은 render() 밖의 qbarRoot에 따로 그린다
  notice: null,         // 빠른 입력으로 방금 추가한 태스크 알림 { id, title, timer }
```

- [ ] **Step 2: 입력 바 함수** — `viewToast` 정의 바로 위에 추가

```js
// ── 빠른 입력 바 ─────────────────────────────────────
// render()는 #modal-root를 통째로 갈아끼운다. 그 안에 두면 저장 뒤 reload·토스트 타이머의 재렌더가
// 타이핑 중인 입력값과 한글 조합을 지운다 — 그래서 바는 전용 노드에 열 때 한 번만 그린다.
const qbarRoot = document.body.appendChild(document.createElement('div'));

/** 해석 결과 + 기본 분류. guessed = 문장에서 분류를 못 찾아 기본값을 쓴 경우(칩을 흐리게). */
function quickParsed(text) {
  const p = parseQuick(text, { today: TODAY, categories: S.categories });
  const fallback = S.fCategory !== 'all' ? S.fCategory : S.categories[0];
  return { ...p, category: p.category ?? fallback, guessed: !p.category };
}

/** 바 아래 칩 — 확인 단계가 아니라 «이렇게 들어간다»를 보여 주는 표시. 재렌더 없이 이 영역만 고친다. */
function drawQuickChips() {
  const input = document.getElementById('qb-input');
  const box = document.getElementById('qb-chips');
  if (!input || !box) return;
  const p = quickParsed(input.value);
  box.innerHTML = p.title ? `
    ${p.due ? `<span class="due">📅 ${md(p.due)} (${'일월화수목금토'[parseD(p.due).getDay()]})</span>` : ''}
    <span class="chip tint ${p.guessed ? 'guess' : ''}" style="--c:${CAT_COLOR(p.category)}">${esc(p.category)}</span>` : '';
}

function setQuickErr(msg) {
  const el = document.getElementById('qb-err');
  if (el) el.textContent = msg;
}

function openQuickBar(text = '') {
  S.qbar = true;
  qbarRoot.innerHTML = `<div class="qbar" role="dialog" aria-label="빠른 입력">
    <input id="qb-input" autocomplete="off" aria-describedby="qb-hint"
           placeholder="할 일 한 줄 — 예: 금요일까지 #인사시스템 발령 에러 확인">
    <div class="qb-chips" id="qb-chips" aria-live="polite"></div>
    <div class="err" id="qb-err"></div>
    <div class="qb-hint" id="qb-hint">Enter 저장 · Shift+Enter 자세히 · Esc 닫기(저장)</div>
  </div>`;
  const input = document.getElementById('qb-input');
  input.value = text;
  drawQuickChips();
  input.focus();
}

function closeQuickBar() {
  S.qbar = false;
  qbarRoot.innerHTML = '';
}

/**
 * Enter(keepOpen) = 저장하고 바를 비운 채 유지(연속 입력). Esc·바깥 클릭 = 저장하고 닫기.
 * 닫는 모든 경로가 저장이다 — 보드 빠른 추가·메모 빠른 작성과 같은 규칙. 비어 있으면 그냥 닫힌다.
 */
async function saveQuickBar(keepOpen) {
  const input = document.getElementById('qb-input');
  const text = input?.value ?? '';
  const p = quickParsed(text);
  if (!keepOpen) closeQuickBar();
  if (!p.title) return;
  try {
    const t = await send('/api/tasks', 'POST', {
      title: p.title, status: firstOpen(), category: p.category,
      start: TODAY, due: p.due, memo: '', repeat_days: 0, parent_id: null,
    });
    if (keepOpen && S.qbar) { input.value = ''; drawQuickChips(); setQuickErr(''); }
    showNotice(t);
    await reload();
  } catch (e) {
    // 실패하면 친 내용을 잃지 않게 바를 다시 열어 에러와 함께 돌려준다
    if (!S.qbar) openQuickBar(text);
    setQuickErr(e.message);
  }
}

/** Shift+Enter — 해석 결과를 채운 전체 모달. 채운 값은 «변경»으로 남겨 그냥 닫으면 확인 창이 뜬다. */
function quickToModal() {
  const p = quickParsed(document.getElementById('qb-input')?.value ?? '');
  closeQuickBar();
  openNew();
  Object.assign(S.modal, { title: p.title, category: p.category, due: p.due });
  render();
}

/** 추가 알림. 지연 확정(삭제·완료) 토스트가 있으면 그쪽이 우선이라 화면에는 그 뒤에 보인다. */
function showNotice(t) {
  clearTimeout(S.notice?.timer);
  S.notice = { id: t.id, title: t.title, timer: setTimeout(() => { S.notice = null; render(); }, UNDO_MS) };
}
```
`UNDO_MS`는 «지연 확정» 블록에 정의돼 있다. `showNotice`는 그 블록보다 위에 정의되지만 호출 시점에만 읽으므로 문제없다.

- [ ] **Step 3: 토스트** — `viewToast`를 교체

```js
function viewToast() {
  const p = S.pending;
  if (p) {
    return `<div class="toast" role="status">
      <span class="t">«${esc(p.title)}» ${p.kind === 'complete' ? '완료' : '삭제됨'}</span>
      <button data-act="undo">되돌리기</button>
    </div>`;
  }
  const n = S.notice;
  if (!n) return '';
  return `<div class="toast" role="status">
    <span class="t">«${esc(n.title)}» 추가됨</span>
    <button data-act="notice-edit">수정</button>
    <button data-act="notice-undo">되돌리기</button>
  </div>`;
}
```

- [ ] **Step 4: 클릭 리스너**

`document.addEventListener('click', ...)` 맨 앞(빠른 작성 저장 줄들 위)에 추가:
```js
  // 빠른 입력 바 바깥 클릭 = 저장하고 닫기. 바를 여는 버튼·토스트(수정/되돌리기)는 바깥으로 치지 않는다.
  if (S.qbar && !e.target.closest('.qbar, .toast, #new-task')) saveQuickBar(false);
```
`if (act === 'undo') return undoPending();` 다음에 추가:
```js
  if (act === 'notice-edit' || act === 'notice-undo') {
    const nid = S.notice?.id;
    clearTimeout(S.notice?.timer);
    S.notice = null;
    if (!nid) return render();
    if (act === 'notice-undo') return mutate(() => api(`/api/tasks/${nid}`, { method: 'DELETE' })); // 막 만든 건이라 CASCADE 걱정이 없다
    if (S.qbar) saveQuickBar(false); // 수정으로 넘어가면 바는 닫는다 — 닫는 경로는 저장
    return openTask(nid);
  }
```

- [ ] **Step 5: 키·입력 리스너**

`document.addEventListener('keydown', ...)`의 **맨 앞**에 추가:
```js
  if (S.qbar) {
    // 한글 조합 중 Enter는 조합 확정용이다 — 저장으로 가로채지 않는다
    if (e.key === 'Enter' && e.target.id === 'qb-input' && !e.isComposing) {
      e.preventDefault();
      return e.shiftKey ? quickToModal() : saveQuickBar(true);
    }
    if (e.key === 'Escape') { e.preventDefault(); return saveQuickBar(false); }
  }
```
같은 리스너의 `const busy = ...` 줄 끝에 `|| S.qbar`를 더한다:
```js
  const busy = S.modal || S.noteModal || S.settings || S.archive || S.quick || S.quickTask || S.ai || S.qbar;
```
`n` 단축키 줄을 교체:
```js
  if (e.key === 'n') { e.preventDefault(); openQuickBar(); }
```
`input` 리스너 추가(`q` 입력 리스너 근처):
```js
document.addEventListener('input', (e) => { if (e.target.id === 'qb-input') { drawQuickChips(); setQuickErr(''); } });
```
`new-task` 버튼 리스너를 교체:
```js
document.getElementById('new-task')?.addEventListener('click', () => (S.qbar ? document.getElementById('qb-input')?.focus() : openQuickBar()));
```
하단의 `newBtn.title = '단축키: n';`은 그대로 둔다.

- [ ] **Step 6: CSS** — `/* ── 삭제 되돌리기 토스트 ── */` 절의 `.toast button:hover` 줄 다음에 추가

```css
  .toast button + button { margin-left:-4px; }

  /* ── 빠른 입력 바 ── 모달이 아니다: 딤 없이 상단에 떠 있고 뒤 화면은 그대로 쓸 수 있다.
     .app 밖(body 직속)에 그려지므로 글꼴·색을 직접 준다. */
  .qbar { position:fixed; top:12vh; left:50%; transform:translateX(-50%); z-index:55; width:min(560px, calc(100vw - 24px));
          background:var(--surface); color:var(--text); border-radius:var(--radius); box-shadow:var(--elev-lg);
          padding:6px 6px 10px; display:flex; flex-direction:column; gap:6px;
          font-family:Pretendard,-apple-system,'Segoe UI',sans-serif; }
  .qbar input { all:unset; font:inherit; height:42px; padding:0 12px; font-size:15px; font-weight:500; }
  /* 바 전체가 입력창 — 바 안쪽에 링을 하나 더 그리면 겹쳐 보인다 */
  .qbar input:focus-visible { outline:none !important; }
  .qbar input::placeholder { color:var(--text-4); }
  .qb-chips { display:flex; gap:6px; flex-wrap:wrap; align-items:center; padding:0 10px; min-height:22px; }
  .qb-chips .due { font-size:12px; font-weight:500; color:var(--text-2); background:var(--surface-2); padding:2px 8px; border-radius:99px; }
  .qb-chips .guess { opacity:.6; }
  .qbar .err { padding:0 10px; }
  .qbar .err:empty { display:none; }
  .qb-hint { padding:0 10px; font-size:11.5px; color:var(--text-4); }
```
`.qb-hint`의 `--text-4`는 흰 `--surface` 위라 4.65:1로 AA를 넘는다.

- [ ] **Step 7: README**

«뷰» 절 바로 아래, 공통 문단 앞에 추가:
```markdown
### 빠른 입력

`n` 또는 헤더의 `＋ 새 태스크`를 누르면 화면 위쪽에 한 줄 입력 바가 뜬다. `금요일까지 #인사시스템 발령 에러 확인`처럼 치고 `Enter`를 누르면 마감·분류가 채워진 태스크가 즉시 생기고, 바는 비워진 채 남아 연속으로 넣을 수 있다. 입력하는 동안 바 아래 칩이 «이렇게 들어간다»를 보여 준다.

| 표현 | 해석 |
|---|---|
| `오늘` `내일` `모레` | 그날 |
| `금` `금요일` · `이번주 금` · `다음주 월요일` | 다가오는 그 요일(오늘이면 오늘) · 이번 주 · 다음 주 |
| `10/20` `10.20` `10월 20일` · `20일` | 그 날짜(지났으면 다음 해) · 이번 달(지났으면 다음 달) |
| `…까지` | 날짜 뒤에 붙으면 함께 지운다 |
| `#분류` | 분류 지정(제목에서 지움). 분류 이름이 문장에 그대로 있으면 그 분류로 잡되 제목에 남긴다 |

- 해석은 로컬 규칙(`public/quickparse.js`)이다 — Enter마다 AI를 기다리지 않는다. 긴 문장·여러 건은 AI 지시창(`i`)으로.
- 분류를 못 찾으면 사이드바 분류 필터, 그것도 없으면 첫 분류(칩이 흐리게 보인다). 상태는 첫 미완료 상태.
- `Shift+Enter`는 해석 결과를 채운 전체 모달을 연다. `Esc`·바깥 클릭은 저장하고 닫는다(비어 있으면 그냥 닫힘).
- 저장 직후 토스트 «… 추가됨»의 `수정`은 편집 모달을, `되돌리기`는 방금 만든 태스크를 지운다.
```
단축키 문단의 `` `n` 새 태스크 ``를 `` `n` 빠른 입력 ``으로 바꾸고, 구조 트리의 `public/` 아래에 추가:
```
│   ├── quickparse.js # 빠른 입력 한 줄 해석 (순수 함수 — 테스트 공유)
```
루트 테스트 목록에 추가:
```
├── test-quickparse.js # 빠른 입력 해석 단위 테스트
```

- [ ] **Step 8: 테스트 + 브라우저 확인**

Run: `npm test` → PASS.
브라우저(컨트롤러): `n` → `금요일까지 #인사시스템 테스트건` 입력 중 칩 `📅 10/16 (금)` `인사시스템` 표시 → Enter → 토스트 «테스트건 추가됨» → `되돌리기`로 삭제 확인. Esc 저장 경로·Shift+Enter 모달 주입·한글 입력 중 Enter(조합 확정) 확인. 만든 테스트 태스크는 모두 지운다.

- [ ] **Step 9: Commit**

```bash
git add public/app.js public/style.css README.md
git commit -m "feat: 빠른 입력 바 — n으로 한 줄 입력, 마감·분류 해석해 즉시 저장, 추가 알림 토스트"
```
