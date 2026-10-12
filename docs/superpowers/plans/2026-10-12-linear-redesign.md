# Linear풍 비주얼 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계서 `docs/superpowers/specs/2026-10-12-linear-redesign-design.md`대로 토큰·사이드바·헤더를 Linear풍으로 바꾸고 보드를 재설계한다.

**Architecture:** 색·간격은 `public/style.css`의 `:root` 토큰과 섹션별 규칙만 고친다. 마크업 변경은 `public/app.js`의 `render()`(nav·뷰 제목·헤더 아이콘 주입)와 `viewBoard()`에 한정한다. 헤더 아이콘은 6개 HTML을 고치지 않고 app.js가 기존 버튼에 주입한다 — 헤더 구조가 한 곳에서 관리된다.

**Tech Stack:** Express 5 정적 서빙, 바닐라 JS, CSS `light-dark()` 토큰, `node --test`.

## Global Constraints

- 모든 `data-act`, `data-id`, `data-drop`, `data-opt`, 요소 `id` 유지.
- `--surface`는 `light-dark(#FFFFFF, #16191E)` 그대로 — 팔레트 3:1 기준값.
- 액센트 `light-dark(#5E6AD2, #8B93F5)` (텍스트 대비 4.70 / 6.37).
- `light-dark()` 단일 토큰 체계 유지, 새 의존성 없음, 아이콘은 인라인 SVG.
- 브레이크포인트 1100 / 960 / 560px 동작 유지.
- 이 변경은 시각 변경이라 자동 테스트 대상이 아니다. 각 태스크 끝에 `npm test`(동작 무변경)와 브라우저 스크린샷으로 확인한다.

---

### Task 1: 토큰 · 사이드바 · 헤더

**Files:**
- Modify: `public/style.css` (`:root` 토큰, `/* ── 사이드바 ── */`, `/* ── 헤더 ── */`, `@media (max-width:960px)`)
- Modify: `public/app.js` (`render()`의 nav·뷰 제목, 파일 하단 헤더 초기화)
- Modify: `public/*.html` 6개 (`.brand` 부제 제거)

**Interfaces:**
- Produces: CSS 클래스 `.ico`(nav 아이콘 래퍼), `.hicon`(헤더 아이콘 버튼), `.lbl`(아이콘 버튼의 숨김 라벨). JS 상수 `ICON`(이름 → SVG 문자열).

- [ ] **Step 1: 토큰 교체** — `:root`에서 아래 값으로 바꾼다.

```css
    --bg:         light-dark(#FFFFFF, #16191E);  /* 본문 면 — 회색 앱 배경을 없앴다 */
    --accent:     light-dark(#5E6AD2, #8B93F5);  /* 인디고. 텍스트 대비 4.70 / 6.37 */
    --accent-h:   light-dark(#4F5AC0, #A5ACF8);
    --accent-bg:  light-dark(#EEF0FB, #1E2140);
    /* 사이드바는 본문과 한 톤 차이의 밝은 면이다(검은 사이드바 폐지) */
    --side-bg:    light-dark(#F7F8FA, #0F1115);
    --side-fg:    var(--text-3);
    --side-dim:   var(--text-4);
    --side-hover: light-dark(#ECEEF2, #1C2026);
    --side-line:  var(--line);
```

- [ ] **Step 2: 사이드바 CSS** — 흰 글자 고정값을 토큰으로, 폭 220, 왼쪽 막대 대신 아이콘.

```css
  aside { width:220px; flex:none; background:var(--side-bg); color:var(--text); border-right:1px solid var(--line); display:flex; flex-direction:column; padding:14px 10px 12px; }
  .brand { padding:4px 10px 14px; }
  .brand b { font-size:13px; font-weight:600; }
  nav { display:flex; flex-direction:column; gap:1px; }
  .nav-btn { all:unset; cursor:pointer; display:flex; align-items:center; gap:9px; padding:7px 10px; border-radius:6px; font-size:13px; font-weight:500; color:var(--side-fg); }
  .nav-btn:hover { background:var(--side-hover); color:var(--text); }
  .nav-btn.on { background:var(--side-hover); color:var(--text); }
  .nav-btn .ico { display:flex; color:var(--icon); }
  .nav-btn.on .ico { color:var(--accent); }
  .nav-btn .label { flex:1; }
  .nav-btn .badge { font-size:12px; color:var(--side-dim); font-variant-numeric:tabular-nums; }
  .cats { border-top:1px solid var(--side-line); padding:12px 10px 4px; display:flex; flex-direction:column; gap:6px; }
  .cats h6 { margin:0 0 2px; font-size:12px; color:var(--text-4); font-weight:500; }
  .cat-btn { all:unset; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:12.5px; color:var(--side-fg); padding:3px 0; }
  .cat-btn:hover, .cat-btn.on { color:var(--text); }
  .cat-btn.on .name { font-weight:600; }
  .cat-btn .cdot { width:7px; height:7px; border-radius:50%; flex:none; }
  .cat-btn .name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .cat-btn .n { font-variant-numeric:tabular-nums; color:var(--text-4); }
```

- [ ] **Step 3: 헤더 CSS** — 48px, 아이콘 버튼.

```css
  header { height:48px; flex:none; background:var(--surface); border-bottom:1px solid var(--line); display:flex; align-items:center; gap:6px; padding:0 16px; overflow:hidden; }
  header .vtitle { font-size:14px; font-weight:600; flex:none; white-space:nowrap; }
  /* 아이콘 전용 헤더 버튼 — 라벨은 title·aria-label로만 남긴다 */
  .toggle.hicon { width:32px; padding:0; justify-content:center; border-color:transparent; background:transparent; color:var(--icon); }
  .toggle.hicon:hover { background:var(--hover); color:var(--text); }
  .toggle.hicon.on { background:var(--accent-bg); color:var(--accent); border-color:transparent; }
  .hicon .lbl { display:none; }
```

`header input`·`header select`의 `height:32px`는 30px로, `.btn-primary`의 `height:32px`도 30px로 낮춘다.

- [ ] **Step 4: 960px 구간** — `.nav-btn .mark { display:none; }` 줄을 `.nav-btn .ico { display:none; }`로 바꾸고, `.brand span { display:none; }` 줄은 삭제한다(부제가 없어진다).

- [ ] **Step 5: 아이콘 상수와 nav 렌더** — `app.js` 상단 `VIEWS` 아래에 추가.

```js
// 인라인 SVG 아이콘 — 외부 아이콘 라이브러리 없이 16px 선 아이콘만 쓴다
const svg = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  summary: svg('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  board: svg('<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>'),
  calendar: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>'),
  notes: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  eyeOff: svg('<path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.6 3.3M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a8.6 8.6 0 0 0 4.4-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  archive: svg('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  sparkles: svg('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
};
```

`render()`의 nav 템플릿에서 `<span class="mark"></span>`을 `<span class="ico">${ICON[k]}</span>`로 바꾸고, 뷰 제목을 `` `${VIEWS[S.view]} 뷰` `` → `VIEWS[S.view]`로 바꾼다.

- [ ] **Step 6: 헤더 아이콘 주입** — 파일 하단 `document.getElementById('q').value = S.query;` 앞에 추가.

```js
// 헤더 보조 버튼을 아이콘 버튼으로 — 6개 HTML을 고치지 않고 여기서 한 번에 바꾼다. 원래 글자는 숨긴 라벨로 남긴다.
for (const [id, icon] of [['hide-done', 'eyeOff'], ['show-arch-notes', 'archive'], ['open-archive', 'archive'], ['open-settings', 'settings'], ['open-ai', 'sparkles']]) {
  const b = document.getElementById(id);
  if (!b) continue;
  const label = b.textContent.trim();
  b.classList.add('hicon');
  b.setAttribute('aria-label', label);
  b.title = b.title ? `${label} — ${b.title}` : label;
  b.innerHTML = `${ICON[icon]}<span class="lbl">${label}</span>`;
}
```

- [ ] **Step 7: 브랜드 부제 제거** — 6개 HTML에서 `<div class="brand"><b>MYWORK</b><span>개인 업무 관리 · 박진혁</span></div>` → `<div class="brand"><b>MyWork</b></div>`.

```bash
sed -i 's|<div class="brand"><b>MYWORK</b><span>개인 업무 관리 · 박진혁</span></div>|<div class="brand"><b>MyWork</b></div>|' public/*.html
```

- [ ] **Step 8: 확인** — `npm test` 19 pass. 브라우저에서 요약·보드를 라이트/다크로 스크린샷, 아이콘 버튼 클릭(완료 숨김 토글 `on` 표시, 설정 모달, AI 지시창) 동작 확인.

- [ ] **Step 9: Commit** — `git commit -m "feat: Linear풍 토큰·사이드바·헤더"`

---

### Task 2: 보드 재설계

**Files:**
- Modify: `public/style.css` (`/* ── 보드 ── */` 블록, `.bcard.is-sub`·`.bcard .parent-line` 규칙)
- Modify: `public/app.js` (`viewBoard()`, 새 함수 `boardDue()`)

**Interfaces:**
- Consumes: `ICON.plus` (Task 1), 기존 `dueMeta(t) → { color, text, short, diff }`, `checklist(t) → { done, total, pct }`, `childProgress(id)`, `childBadge(c, id)`, `CAT_COLOR`, `STATUS_COLOR`, `repeatLabel`.
- Produces: `boardDue(t, dm) → { text, color } | null`.

- [ ] **Step 1: `boardDue` 추가** — `viewBoard` 바로 위.

```js
/** 보드 카드 메타 줄의 마감 표기 — 좁은 줄이라 날짜보다 «얼마나 늦었나»를 먼저 말한다. 마감 없음은 생략. */
function boardDue(t, dm) {
  if (dm.diff === null) return null;
  if (isDone(t.status)) return { text: dm.short, color: 'var(--text-4)' };
  if (isWaiting(t.status)) return { text: dm.text, color: 'var(--text-4)' }; // «MM/DD 대기»
  if (dm.diff < 0) return { text: `${-dm.diff}일 지연`, color: 'var(--danger)' };
  if (dm.diff === 0) return { text: '오늘', color: 'var(--danger)' };
  return { text: dm.short, color: dm.color };
}
```

- [ ] **Step 2: `viewBoard` 교체**

```js
function viewBoard(list) {
  return `<div class="board">${S.meta.statuses.map((o) => {
    const st = o.name;
    const tasks = list.filter((t) => t.status === st).sort(byDue);
    const adding = S.quickTask === st;
    return `<div class="bcol ${S.dragId ? 'drag' : ''}" data-drop="${esc(st)}" data-opt="${o.id}">
      <div class="head" draggable="true" title="드래그해서 열 순서 변경">
        <span class="ck-grip">⠿</span>
        <span class="dot" style="background:${STATUS_COLOR(st)}"></span>
        <span class="l">${esc(st)}</span><span class="n">${tasks.length}</span>
        <button class="col-add" data-act="bq-open" data-status="${esc(st)}" title="${esc(st)}에 태스크 추가" aria-label="${esc(st)}에 태스크 추가">${ICON.plus}</button>
      </div>
      ${adding ? `<div class="bq-form"><input id="bq-title" placeholder="제목 입력 후 Enter · 연속 추가 가능"></div>` : ''}
      ${tasks.map((t) => {
        const done = isDone(t.status), p = checklist(t), c = childProgress(t.id);
        const due = boardDue(t, dueMeta(t));
        const parent = t.parent_id && taskById(t.parent_id);
        return `<div class="bcard ${parent ? 'is-sub' : ''} ${done ? 'done' : ''} ${S.dragId === t.id ? 'dragging' : ''}" draggable="true" data-act="open" data-id="${t.id}">
          ${parent ? `<div class="parent-line" data-act="open" data-id="${parent.id}" title="상위 태스크: ${esc(parent.title)}">↳ ${esc(parent.title)}</div>` : ''}
          <div class="tt">${esc(t.title)}</div>
          <div class="meta">
            <span class="cat"><i class="cdot" style="background:${CAT_COLOR(t.category)}"></i>${esc(t.category)}</span>
            ${p.total ? `<span title="체크리스트 ${p.done}/${p.total}">☑ ${p.done}/${p.total}</span>` : ''}
            ${childBadge(c, t.id)}
            ${t.repeat_days ? `<span title="${repeatLabel(t.repeat_days)} 반복">↻</span>` : ''}
            ${due ? `<span class="du" style="color:${due.color}">${due.text}</span>` : ''}
          </div></div>`;
      }).join('')}
      ${!tasks.length && !adding ? '<div class="empty-col">비어 있음</div>' : ''}
    </div>`;
  }).join('')}</div>`;
}
```

- [ ] **Step 3: 보드 CSS 교체** — `/* ── 보드 ── */`부터 `.bq-form input` 줄까지를 아래로 바꾼다(`.add-btn` 규칙은 다른 곳에서 쓰지 않으면 삭제 — `grep -n "add-btn" public/app.js`로 확인).

```css
  /* ── 보드 ──
     열은 배경 없이 머리만 두고 카드가 면을 이룬다. 폭 272px 고정 — 상태가 늘면 열이 좁아지는 대신 가로로 스크롤한다. */
  .board { display:flex; gap:12px; align-items:flex-start; overflow-x:auto; padding-bottom:8px; }
  .bcol { flex:0 0 272px; min-height:160px; padding:4px; border-radius:8px; display:flex; flex-direction:column; gap:6px; }
  .bcol.drag { background:color-mix(in oklab, var(--accent-bg) 55%, transparent); }
  .bcol.dragging { opacity:.45; }
  /* 열 삽입선은 좌우로 — 체크리스트(위아래)와 방향만 다르다 */
  .bcol.over { box-shadow:inset 3px 0 0 var(--accent); }
  .bcol.over-b { box-shadow:inset -3px 0 0 var(--accent); }
  .bcol .head { display:flex; align-items:center; gap:7px; padding:2px 2px 6px; cursor:grab; }
  .bcol .head:active { cursor:grabbing; }
  .bcol .head .ck-grip { opacity:0; width:8px; }
  .bcol .head:hover .ck-grip { opacity:1; }
  .bcol .head .dot { width:8px; height:8px; border-radius:50%; flex:none; }
  .bcol .head .l { font-size:13px; font-weight:600; }
  .bcol .head .n { font-size:12px; color:var(--text-3); font-variant-numeric:tabular-nums; }
  .col-add { all:unset; cursor:pointer; margin-left:auto; width:24px; height:24px; border-radius:5px; display:flex; align-items:center; justify-content:center; color:var(--icon); }
  .col-add:hover { background:var(--hover); color:var(--text); }
  .bcard { background:var(--surface); border:1px solid var(--line); border-radius:6px; padding:10px 12px; cursor:grab; display:flex; flex-direction:column; gap:6px; }
  .bcard:hover { border-color:var(--icon); }
  .bcard.dragging { opacity:.4; }
  .bcard.done { opacity:.6; }
  .bcard.done .tt { text-decoration:line-through; }
  .bcard .tt { font-size:13px; font-weight:500; line-height:1.45; text-wrap:pretty; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
  .bcard .meta { display:flex; align-items:center; gap:10px; font-size:12px; color:var(--text-3); min-width:0; }
  .bcard .meta .cat { display:flex; align-items:center; gap:5px; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bcard .meta .cdot { width:7px; height:7px; border-radius:50%; flex:none; }
  .bcard .meta .sb-badge { background:none; padding:0; font-size:12px; font-weight:400; color:inherit; }
  .bcard .meta .sb-badge.late { color:var(--danger); }
  .bcard .meta .du { margin-left:auto; flex:none; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .empty-col { font-size:12px; color:var(--text-4); padding:8px 2px; }
  .bq-form input { width:100%; box-sizing:border-box; height:34px; border:1px solid var(--accent); border-radius:6px; padding:0 10px; font-size:13px; outline:none; background:var(--surface); color:var(--text); }
```

`.bcard.is-sub { border-left:…}` 규칙은 삭제하고, `.bcard .parent-line` 두 규칙을 아래로 바꾼다.

```css
  .bcard .parent-line { align-self:flex-start; max-width:100%; font-size:11.5px; color:var(--text-4); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
  .bcard .parent-line:hover { color:var(--accent); }
```

- [ ] **Step 4: 확인** — `npm test` 19 pass. 보드에서: 카드 드래그로 상태 변경, 열 머리 드래그로 순서 변경, `+`로 빠른 추가(Enter 연속·Esc 저장), 상위 줄 클릭 시 상위 모달, 하위 배지 클릭 시 프로젝트 뷰 이동. 라이트/다크, 960px·560px 스크린샷.

- [ ] **Step 5: Commit** — `git commit -m "feat: 보드 재설계 — 고정폭 투명 열·한 줄 메타 카드"`

---

### Task 3: 다른 뷰 보정 · 대비 검증 · 문서

**Files:**
- Modify: `public/style.css` (필요한 곳만)
- Modify: `README.md` (보드·헤더 설명)

- [ ] **Step 1: 대비 재계산** — 아래 스크립트로 액센트 텍스트 ≥4.5, 팔레트 vs `--surface` ≥3을 확인한다(커밋하지 않는 일회성 확인).

```bash
node -e "
const L=h=>{const c=[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const cr=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
const pal=['#797D84','#EA6C36','#8F5D04','#759D63','#0C708E','#608AF8','#7750C2','#B75ABB','#B13E58'];
console.log('accent', cr('#5E6AD2','#FFFFFF').toFixed(2), cr('#8B93F5','#16191E').toFixed(2));
console.log('palette', Math.min(...pal.map(p=>cr(p,'#FFFFFF'))).toFixed(2), Math.min(...pal.map(p=>cr(p,'#16191E'))).toFixed(2));"
```
Expected: `accent 4.70 6.37`, `palette 3.11 3.10`.

- [ ] **Step 2: 뷰 점검** — 요약·목록·캘린더·메모·프로젝트를 라이트/다크로 스크린샷. 흰 바탕 위 `.card`가 테두리로 구분되는지, 사이드바 960px 가로 바가 밝은 톤으로 자연스러운지 확인하고 깨진 곳만 고친다.

- [ ] **Step 3: README** — «뷰» 절의 보드 설명에 «열 머리 `+`로 빠른 추가(열 맨 위)», 하단 `＋ 태스크 추가` 언급을 교체하고, 헤더 보조 버튼이 아이콘이 됐다는 한 줄을 추가.

- [ ] **Step 4: 최종 확인 · Commit** — `npm test` 19 pass, `git commit -m "docs: 보드·헤더 변경 반영 + 뷰 보정"`. 푸시는 요청받았을 때만.
