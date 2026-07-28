// MyWork 프론트 — 상태 변경 시 전체 재렌더. 이벤트는 위임으로 처리.
import { checklist, weightedPct, checklistTotals } from './progress.js';

const DAY = 86400000;
const VIEWS = { summary: '요약', list: '목록', board: '보드', calendar: '캘린더', timeline: '타임라인' };
const KIND_LABEL = { type: '업무유형', status: '진행상황', priority: '우선순위', category: '업무분류' };
const META_KEY = { type: 'types', status: 'statuses', priority: 'priorities', category: 'categories' };

// 색상은 전부 설정(options)에서 온다. 배경은 같은 색의 10% 투명도 — 색을 두 번 고르지 않도록.
const TYPE_COLOR = (t) => S.opt.type.get(t)?.color ?? '#6B7280';
const TYPE_BG = (t) => `${TYPE_COLOR(t)}1A`;
const STATUS_COLOR = (s) => S.opt.status.get(s)?.color ?? '#6B7280';
const STATUS_BG = (s) => `${STATUS_COLOR(s)}1A`;
const CAT_COLOR = (c) => S.opt.category.get(c)?.color ?? '#6B7280';
const PR_COLOR = (p) => S.opt.priority.get(p)?.color ?? '#6B7280';
const PR_RANK = (p) => S.opt.priority.get(p)?.sort ?? 99;
const isDone = (s) => S.doneSet.has(s);

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseD = (s) => { const p = String(s || '').split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
const shift = (base, n) => iso(new Date(base.getTime() + n * DAY));
const md = (s) => s.slice(5).replace('-', '/');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const today = new Date(); today.setHours(0, 0, 0, 0);
const TODAY = iso(today);

const S = {
  tasks: [], categories: [], types: [], statuses: [], priorities: [],
  opt: { type: new Map(), status: new Map(), priority: new Map(), category: new Map() }, doneSet: new Set(),
  settings: null,
  view: 'summary', query: '', fCategory: 'all', fType: 'all', fPriority: 'all',
  sortKey: 'due', sortDir: 1,
  calMonth: TODAY.slice(0, 7),
  hideDone: false,
  modal: null, archive: null, newSub: '', dragId: null, dragSub: null, dragOpt: null, dragOptKind: null, error: '',
};

// ── API ──────────────────────────────────────────────
async function api(url, opts) {
  const res = await fetch(url, opts && { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 204) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || '요청 실패');
  return body;
}
const send = (url, method, data) => api(url, { method, body: JSON.stringify(data) });

async function reload() {
  const [meta, tasks] = await Promise.all([api('/api/meta'), api('/api/tasks')]);
  Object.assign(S, {
    tasks,
    categories: meta.categories.map((o) => o.name),
    types: meta.types.map((o) => o.name),
    statuses: meta.statuses.map((o) => o.name),
    priorities: meta.priorities.map((o) => o.name),
    opt: {
      type: new Map(meta.types.map((o) => [o.name, o])),
      status: new Map(meta.statuses.map((o) => [o.name, o])),
      priority: new Map(meta.priorities.map((o) => [o.name, o])),
      category: new Map(meta.categories.map((o) => [o.name, o])),
    },
    doneSet: new Set(meta.statuses.filter((o) => o.done).map((o) => o.name)),
    meta,
  });
  // 설정에서 이름을 바꾸거나 지운 값이 필터에 남아 있으면 아무것도 안 보이므로 푼다
  if (!S.categories.includes(S.fCategory)) S.fCategory = 'all';
  if (!S.types.includes(S.fType)) S.fType = 'all';
  if (!S.priorities.includes(S.fPriority)) S.fPriority = 'all';
  // 모달이 열린 채 체크리스트를 고치는 경우가 있어 서버 값으로 다시 맞춘다
  if (S.modal?.id) S.modal.subtasks = S.tasks.find((t) => t.id === S.modal.id)?.subtasks ?? [];
  render();
}

/** 서버 호출 → 실패 시 모달에 에러 노출. */
async function mutate(fn) {
  try {
    S.error = '';
    await fn();
    await reload();
  } catch (e) {
    S.error = e.message;
    render();
  }
}

// ── 파생 ─────────────────────────────────────────────
function filtered() {
  const q = S.query.trim().toLowerCase();
  return S.tasks.filter((t) =>
    (S.fCategory === 'all' || t.category === S.fCategory) &&
    (S.fType === 'all' || t.type === S.fType) &&
    (S.fPriority === 'all' || t.priority === S.fPriority) &&
    (!q || t.title.toLowerCase().includes(q) || (t.memo || '').toLowerCase().includes(q)));
}

function dueMeta(t) {
  const diff = Math.round((parseD(t.due) - parseD(TODAY)) / DAY);
  const short = md(t.due);
  if (isDone(t.status)) return { color: '#9AA2AD', text: `${short} 완료`, short, diff };
  if (diff < 0) return { color: '#D64545', text: `${short} (${-diff}일 지연)`, short: `${short} ⚠`, diff };
  if (diff === 0) return { color: '#D64545', text: `${short} (오늘 마감)`, short: `${short} 오늘`, diff };
  if (diff <= 3) return { color: '#D98200', text: `${short} (D-${diff})`, short: `${short} D-${diff}`, diff };
  return { color: '#6B7280', text: `${short} (D-${diff})`, short, diff };
}

// ── 뷰 ───────────────────────────────────────────────
function viewSummary(list) {
  const cnt = (st) => list.filter((t) => t.status === st).length;
  const open = list.filter((t) => !isDone(t.status));
  const overdue = open.filter((t) => dueMeta(t).diff < 0).length;
  const soon = open.filter((t) => { const d = dueMeta(t).diff; return d >= 0 && d <= 7; }).length;
  const items = checklistTotals(list);

  const doneCnt = list.filter((t) => isDone(t.status)).length;
  const openStatuses = S.statuses.filter((s) => !isDone(s));

  const stats = [
    // 진척률 = 끝난 태스크 + 미완료 태스크의 체크된 항목. 완료 건수도 같이 보여 둘을 구분한다.
    { label: '전체 태스크', value: list.length, color: '#14161A', hint: `진척률 ${weightedPct(list, isDone)}% · 완료 ${doneCnt}건` },
    { label: '미완료', value: open.length, color: '#2F6FED',
      hint: openStatuses.map((s) => `${s} ${cnt(s)}`).join(' · ') || '없음' },
    { label: '7일 내 마감', value: soon, color: '#D98200', hint: '미완료 기준' },
    { label: '지연', value: overdue, color: '#D64545', hint: overdue ? '즉시 확인 필요' : '지연 없음' },
  ];

  // 스택바는 진행상황 설정을 그대로 따라간다 — 상태를 추가하면 막대에도 바로 반영된다
  const catStats = S.categories.map((c) => {
    const inCat = list.filter((t) => t.category === c);
    const n = inCat.length || 1;
    return {
      label: c, count: inCat.length, d: inCat.filter((t) => isDone(t.status)).length,
      pct: weightedPct(inCat, isDone),
      segs: S.statuses.map((s) => ({ color: STATUS_COLOR(s), w: (inCat.filter((t) => t.status === s).length / n) * 100 })),
    };
  }).filter((c) => c.count > 0);

  const maxType = Math.max(1, ...S.types.map((ty) => list.filter((t) => t.type === ty).length));
  const typeStats = S.types.map((ty) => {
    const c = list.filter((t) => t.type === ty).length;
    return { label: ty, count: c, color: TYPE_COLOR(ty), w: (c / maxType) * 100 };
  }).filter((t) => t.count > 0);

  const upcoming = open.slice().sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6);

  return `<div class="stack">
    <div class="stats">${stats.map((s) => `<div class="card stat">
      <div class="l">${s.label}</div><div class="v" style="color:${s.color}">${s.value}</div><div class="h">${s.hint}</div>
    </div>`).join('')}</div>
    <div class="two">
      <div class="card" style="padding:18px">
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:14px">
          <div class="card-t">업무분류별 현황</div>
          <div style="font-size:11.5px;color:#8A919C">막대는 상태 · 진척은 체크리스트까지 반영</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">${catStats.map((c) => `<div class="bar-row">
          <div class="top"><b>${esc(c.label)}</b><span>${c.count}건 · 완료 ${c.d} · 진척 ${c.pct}%</span></div>
          <div class="bar">${c.segs.map((s) => `<div style="width:${s.w}%;background:${s.color}"></div>`).join('')}</div>
        </div>`).join('') || '<div class="empty">표시할 분류가 없습니다.</div>'}</div>
        <div class="legend">
          ${S.statuses.map((s) => `<span><i style="background:${STATUS_COLOR(s)}"></i>${esc(s)}</span>`).join('')}
          ${items.total ? `<span style="margin-left:auto">체크리스트 ${items.done}/${items.total}</span>` : ''}
        </div>
      </div>
      <div class="card" style="padding:18px">
        <div class="card-t" style="margin-bottom:14px">업무유형 분포</div>
        <div style="display:flex;flex-direction:column;gap:9px">${typeStats.map((t) => `<div class="type-row">
          <span class="l">${esc(t.label)}</span>
          <div class="track"><div class="fill" style="width:${t.w}%;background:${t.color}"></div></div>
          <span class="n">${t.count}</span></div>`).join('') || '<div class="empty">표시할 유형이 없습니다.</div>'}</div>
      </div>
    </div>
    <div class="card" style="padding:18px">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:12px">
        <div class="card-t">마감 임박 · 지연</div>
        <div style="font-size:11.5px;color:#8A919C">미완료 태스크를 마감일 순으로</div>
      </div>
      <div style="display:flex;flex-direction:column">${upcoming.map((t) => {
        const dm = dueMeta(t);
        return `<div class="up-row" data-act="open" data-id="${t.id}">
          <span class="dot" style="background:${PR_COLOR(t.priority)}"></span>
          <span class="t">${esc(t.title)}</span>
          <span class="c">${esc(t.category)}</span>
          <span class="d" style="color:${dm.color}">${dm.text}</span></div>`;
      }).join('') || '<div class="empty">미완료 태스크가 없습니다.</div>'}</div>
    </div>
  </div>`;
}

const COLS = [
  { key: 'title', label: '제목' }, { key: 'type', label: '유형' }, { key: 'status', label: '상태' },
  { key: 'category', label: '분류' }, { key: 'priority', label: '우선순위' },
  { key: 'start', label: '시작일' }, { key: 'due', label: '마감일' }, { key: '', label: '' },
];

function viewList(list) {
  const sorted = list.slice().sort((a, b) => {
    const k = S.sortKey;
    let av, bv;
    if (k === 'priority') { av = PR_RANK(a.priority); bv = PR_RANK(b.priority); }
    else if (k === 'status') { av = S.statuses.indexOf(a.status); bv = S.statuses.indexOf(b.status); }
    else { av = String(a[k] ?? ''); bv = String(b[k] ?? ''); }
    return (av < bv ? -1 : av > bv ? 1 : 0) * S.sortDir;
  });

  const head = COLS.map((c) => `<button data-act="sort" data-key="${c.key}">
    <span>${c.label}</span><span class="arrow">${S.sortKey === c.key && c.key ? (S.sortDir === 1 ? '▲' : '▼') : ''}</span></button>`).join('');

  const rows = sorted.map((t) => {
    const dm = dueMeta(t), done = isDone(t.status), p = checklist(t);
    return `<div class="grid-row trow">
      <div class="main" data-act="open" data-id="${t.id}">
        <span class="tt" style="text-decoration:${done ? 'line-through' : 'none'};color:${done ? '#9AA2AD' : '#14161A'}">${esc(t.title)}</span>
        <span class="td">${t.repeat_days ? `<b class="rp-badge">🔁 ${repeatLabel(t.repeat_days)}</b>` : ''}${p.total ? `<b class="ck-badge">☑ ${p.done}/${p.total}</b>` : ''}${esc(t.memo || '—')}</span>
      </div>
      <div class="cell"><span class="chip" style="background:${TYPE_BG(t.type)};color:${TYPE_COLOR(t.type)}">${esc(t.type)}</span></div>
      <div class="cell"><span class="chip" style="background:${STATUS_BG(t.status)};color:${STATUS_COLOR(t.status)}">${esc(t.status)}</span></div>
      <div class="cell" style="color:#5A6270">${esc(t.category)}</div>
      <div class="cell" style="color:${PR_COLOR(t.priority)};font-weight:600;font-size:11.5px">${t.priority}</div>
      <div class="cell" style="color:#6B7280;font-variant-numeric:tabular-nums">${md(t.start)}</div>
      <div class="cell" style="color:${dm.color};font-variant-numeric:tabular-nums;font-weight:550">${dm.text}</div>
      <div class="cell" style="padding:0 8px;display:flex;justify-content:center">
        <button class="x-btn" data-act="del" data-id="${t.id}">×</button></div>
    </div>`;
  }).join('');

  return `<div class="card" style="overflow-x:auto">
    <div class="grid-row thead">${head}</div>
    ${rows || '<div class="empty">조건에 맞는 태스크가 없습니다.</div>'}
  </div>`;
}

// 열 순서 = 진행상황 설정 순서. 열 머리를 끌어 바꾸면 설정에도 그대로 반영된다.
function viewBoard(list) {
  const cols = S.meta.statuses;
  return `<div class="board" style="grid-template-columns:repeat(${cols.length},minmax(220px,1fr))">${cols.map((o) => {
    const st = o.name;
    const tasks = list.filter((t) => t.status === st)
      .sort((a, b) => PR_RANK(a.priority) - PR_RANK(b.priority) || a.due.localeCompare(b.due));
    return `<div class="bcol ${S.dragId ? 'drag' : ''}" data-drop="${esc(st)}" data-opt="${o.id}">
      <div class="head" draggable="true" title="드래그해서 열 순서 변경">
        <span class="ck-grip">⠿</span>
        <span class="dot" style="background:${STATUS_COLOR(st)}"></span>
        <span class="l">${esc(st)}</span><span class="n">${tasks.length}</span>
      </div>
      ${tasks.map((t) => {
        const dm = dueMeta(t), done = isDone(t.status), p = checklist(t);
        return `<div class="bcard ${S.dragId === t.id ? 'dragging' : ''}" draggable="true" data-act="open" data-id="${t.id}">
          <div class="tt" style="text-decoration:${done ? 'line-through' : 'none'};color:${done ? '#8D95A0' : '#14161A'}">${esc(t.title)}</div>
          <div class="tags">
            <span style="background:${TYPE_BG(t.type)};color:${TYPE_COLOR(t.type)}">${esc(t.type)}</span>
            <span style="background:${CAT_COLOR(t.category)}1A;color:${CAT_COLOR(t.category)};font-weight:400">${esc(t.category)}</span>
            ${t.repeat_days ? `<span style="background:#FCF1E0;color:#D98200">🔁 ${repeatLabel(t.repeat_days)}</span>` : ''}
          </div>
          ${p.total ? `<div class="prog-row">
            <div class="prog"><div class="fill" style="width:${p.pct}%"></div></div>
            <span class="ck-n">${p.done}/${p.total}</span></div>` : ''}
          <div class="foot">
            <span class="pr" style="color:${PR_COLOR(t.priority)}">${t.priority}</span>
            <span class="du" style="color:${dm.color}">${dm.short}</span>
          </div></div>`;
      }).join('')}
      <button class="add-btn" data-act="new" data-status="${esc(st)}">＋ 태스크 추가</button>
    </div>`;
  }).join('')}</div>`;
}

function viewCalendar(list) {
  const [y, m] = S.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const gridStart = new Date(first.getTime() - first.getDay() * DAY);
  const week = ['일', '월', '화', '수', '목', '금', '토']
    .map((w, i) => `<div style="color:${i === 0 ? '#D64545' : i === 6 ? '#2F6FED' : '#5A6270'}">${w}</div>`).join('');

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * DAY);
    const key = iso(d), inMonth = d.getMonth() === m - 1, isToday = key === TODAY;
    const evts = list.filter((t) => t.due === key);
    cells.push({
      html: `<div class="day" style="background:${inMonth ? '#fff' : '#FAFBFC'}">
        <div style="display:flex;align-items:center;gap:5px">
          <span class="n" style="font-weight:${isToday ? 700 : 500};background:${isToday ? '#2F6FED' : 'transparent'};color:${isToday ? '#fff' : !inMonth ? '#C0C6CF' : d.getDay() === 0 ? '#D64545' : d.getDay() === 6 ? '#2F6FED' : '#3C424C'}">${d.getDate()}</span>
        </div>
        ${evts.map((t) => `<div class="ev" data-act="open" data-id="${t.id}" style="background:${TYPE_BG(t.type)};color:${TYPE_COLOR(t.type)};border-left:3px solid ${TYPE_COLOR(t.type)};text-decoration:${isDone(t.status) ? 'line-through' : 'none'}">${esc(t.title)}</div>`).join('')}
      </div>`,
      empty: evts.length === 0,
    });
  }
  if (cells.slice(35).every((c) => c.empty)) cells.length = 35;

  return `<div class="card" style="overflow:hidden">
    <div class="cal-head">
      <button class="icon-btn" data-act="month" data-n="-1">‹</button>
      <div class="m">${y}년 ${m}월</div>
      <button class="icon-btn" data-act="month" data-n="1">›</button>
      <button class="icon-btn" data-act="month" data-n="0">오늘</button>
      <div style="flex:1"></div>
      <div class="hint">마감일 기준 · 태스크를 클릭하면 수정</div>
    </div>
    <div class="week">${week}</div>
    <div class="days">${cells.map((c) => c.html).join('')}</div>
  </div>`;
}

function viewTimeline(list) {
  if (!list.length) return '<div class="card empty">표시할 태스크가 없습니다.</div>';
  const starts = list.map((t) => parseD(t.start).getTime());
  const ends = list.map((t) => parseD(t.due).getTime());
  const min = new Date(Math.min(...starts)), max = new Date(Math.max(...ends));
  const gs = new Date(min.getFullYear(), min.getMonth(), 1);
  const ge = new Date(max.getFullYear(), max.getMonth() + 1, 0);
  const total = Math.round((ge - gs) / DAY) + 1;

  const months = [];
  for (let cur = new Date(gs); cur <= ge; cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)) {
    const dim = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
    months.push(`<div class="mo" style="width:${(dim / total) * 100}%">${cur.getMonth() + 1}월 ${cur.getFullYear()}</div>`);
  }
  const todayLeft = ((parseD(TODAY) - gs) / DAY / total) * 100;

  const rows = list.slice().sort((a, b) => a.start.localeCompare(b.start)).map((t) => {
    const st = parseD(t.start), en = parseD(t.due);
    const left = ((st - gs) / DAY / total) * 100;
    const width = Math.max(0.8, (((en - st) / DAY + 1) / total) * 100);
    const outside = left + width > 62;
    const range = `${md(t.start)} – ${md(t.due)}`;
    return `<div class="g-row">
      <div class="fix" data-act="open" data-id="${t.id}">
        <span class="dot" style="background:${PR_COLOR(t.priority)}"></span><span>${esc(t.title)}</span>
      </div>
      <div class="g-track">
        <div class="today" style="left:${todayLeft >= 0 && todayLeft <= 100 ? todayLeft : -10}%"></div>
        <div class="bar2" data-act="open" data-id="${t.id}" title="${range}"
             style="left:${left}%;width:${width}%;background:${isDone(t.status) ? '#9CB6A4' : TYPE_COLOR(t.type)}"></div>
        <div class="lab" style="left:${outside ? 'auto' : `${left + width}%`};right:${outside ? `${100 - left}%` : '0'};justify-content:${outside ? 'flex-end' : 'flex-start'}">
          <span>${range}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  return `<div class="card" style="overflow:hidden">
    <div class="gantt-head"><div class="card-t">타임라인</div><div style="font-size:11.5px;color:#8A919C">${iso(gs)} → ${iso(ge)}</div></div>
    <div class="gantt-cols"><div class="fix">태스크</div><div style="flex:1;display:flex">${months.join('')}</div></div>
    ${rows}
  </div>`;
}

const REPEATS = [[0, '반복 없음'], [1, '매일'], [7, '매주'], [14, '2주마다'], [28, '4주마다']];
const repeatLabel = (n) => REPEATS.find(([d]) => d === n)?.[1] ?? `${n}일마다`;
/** 프리셋에 없는 주기(MCP로 넣은 값 등)도 선택지로 살려 둔다. */
function repeatOptions(cur) {
  const list = REPEATS.some(([d]) => d === cur) ? REPEATS : [...REPEATS, [cur, `${cur}일마다`]];
  return list.map(([d, label]) => `<option value="${d}" ${d === cur ? 'selected' : ''}>${label}</option>`).join('');
}

// 체크리스트는 즉시 저장 방식이라 task id가 있어야 한다 → 신규는 저장 후 활성화
function viewChecklist(m) {
  if (!m.id) return `<div class="field"><label>체크리스트</label>
    <div class="ck-hint">태스크를 저장하면 항목을 추가할 수 있습니다.</div></div>`;
  const p = checklist(m);
  return `<div class="field">
    <label>체크리스트 ${p.total ? `<span class="ck-n">${p.done}/${p.total}</span>` : ''}</label>
    ${p.total ? `<div class="prog" style="margin-bottom:2px"><div class="fill" style="width:${p.pct}%"></div></div>` : ''}
    <div class="ck-list">${(m.subtasks ?? []).map((s) => `<div class="ck-item" draggable="true" data-sub="${s.id}">
      <span class="ck-grip" title="드래그해서 순서 변경">⠿</span>
      <button class="ck-box ${s.done ? 'on' : ''}" data-act="sub-toggle" data-sub="${s.id}" data-done="${s.done ? 1 : 0}">${s.done ? '✓' : ''}</button>
      <span class="ck-t ${s.done ? 'done' : ''}">${esc(s.title)}</span>
      <button class="x-btn" data-act="sub-del" data-sub="${s.id}">×</button>
    </div>`).join('') || '<div class="ck-hint">항목이 없습니다.</div>'}</div>
    <div class="ck-add">
      <input id="d-newsub" value="${esc(S.newSub)}" placeholder="항목 입력 후 Enter">
      <button class="btn-sm" data-act="sub-add">추가</button>
    </div>
  </div>`;
}

/** 설정 모달 — 업무유형·진행상황·우선순위·업무분류를 추가/이름변경/색상변경/순서변경/삭제. */
function viewSettings() {
  const kind = S.settings;
  const rows = S.meta[META_KEY[kind]];
  const used = (name) => S.tasks.filter((t) => t[kind] === name).length;

  return `<div class="backdrop" data-act="close-set-bd"><div class="modal">
    <div class="mh"><div class="t">설정</div><div style="flex:1"></div>
      <button class="x-btn" data-act="close-set">×</button></div>
    <div class="mb">
      <div class="tabs">${Object.entries(KIND_LABEL).map(([k, label]) =>
        `<button class="tab ${k === kind ? 'on' : ''}" data-act="set-kind" data-kind="${k}">${label}</button>`).join('')}</div>
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}
      <div class="ck-list">${rows.map((o) => `<div class="ck-item" draggable="true" data-opt="${o.id}">
        <span class="ck-grip" title="드래그해서 순서 변경">⠿</span>
        <input type="color" class="opt-color" value="${o.color}" data-act="opt-color" data-id="${o.id}" title="색상">
        <input class="opt-name" value="${esc(o.name)}" data-act="opt-name" data-id="${o.id}">
        ${kind === 'status' ? `<label class="opt-done" title="이 상태면 '끝난 것'으로 셉니다">
          <input type="checkbox" ${o.done ? 'checked' : ''} data-act="opt-done" data-id="${o.id}"> 완료
        </label>` : `<span class="ck-n">${used(o.name)}건</span>`}
        <button class="x-btn" data-act="opt-del" data-id="${o.id}" data-name="${esc(o.name)}" data-used="${used(o.name)}">×</button>
      </div>`).join('')}</div>
      <div class="ck-add">
        <input id="s-new" placeholder="${KIND_LABEL[kind]} 추가 후 Enter">
        <button class="btn-sm" data-act="opt-add">추가</button>
      </div>
      <div class="ck-hint">${kind === 'status'
        ? '<b>완료</b>로 표시한 상태는 진척률·보관·반복 생성·완료 숨김에서 «끝남»으로 취급됩니다. 최소 하나는 있어야 합니다. 순서는 보드 열 순서이며, 보드에서 열을 끌어도 바뀝니다.'
        : `이름을 바꾸면 그 ${KIND_LABEL[kind]}을(를) 쓰던 태스크도 함께 바뀝니다. 삭제하면 남은 첫 항목으로 옮겨집니다.`}</div>
    </div>
    <div class="mf"><div style="flex:1"></div>
      <button class="btn-ghost" data-act="close-set">닫기</button></div>
  </div></div>`;
}

/** 보관 모달 — 오래된 완료분을 한 번에 보관하고, 보관된 것을 되돌린다. */
function viewArchive() {
  const a = S.archive;
  return `<div class="backdrop" data-act="close-arch-bd"><div class="modal">
    <div class="mh"><div class="t">완료 태스크 정리</div><div style="flex:1"></div>
      <button class="x-btn" data-act="close-arch">×</button></div>
    <div class="mb">
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}
      <div class="field">
        <label>보관 기준</label>
        <div class="ck-add">
          <input type="date" id="a-before" value="${a.before}" style="flex:1">
          <button class="btn-sm" data-act="arch-run" ${a.count ? '' : 'disabled'}>${a.count}건 보관</button>
        </div>
        <div class="ck-hint">이 날짜 <b>이전에 마감</b>된 <b>완료</b> 태스크를 보관합니다. 삭제가 아니라 목록·통계·브리핑에서만 빠지며, 아래에서 되돌릴 수 있습니다.</div>
      </div>
      <div class="field">
        <label>보관됨 <span class="ck-n">${a.list.length}건</span></label>
        <div class="ck-list" style="max-height:260px;overflow:auto">${a.list.map((t) => `<div class="ck-item">
          <span class="ck-t">${esc(t.title)}</span>
          <span class="ck-n">${t.due}</span>
          <button class="btn-sm" data-act="arch-restore" data-id="${t.id}">복원</button>
          <button class="x-btn" data-act="arch-delete" data-id="${t.id}" title="영구 삭제">×</button>
        </div>`).join('') || '<div class="ck-hint">보관된 태스크가 없습니다.</div>'}</div>
      </div>
    </div>
    <div class="mf"><div style="flex:1"></div>
      <button class="btn-ghost" data-act="close-arch">닫기</button></div>
  </div></div>`;
}

function viewModal() {
  if (S.settings) return viewSettings();
  if (S.archive) return viewArchive();
  const m = S.modal;
  if (!m) return '';
  const opts = (arr, sel) => arr.map((v) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
  return `<div class="backdrop" data-act="close-bd"><div class="modal">
    <div class="mh"><div class="t">${m.id ? '태스크 수정' : '새 태스크'}</div><div style="flex:1"></div>
      <button class="x-btn" data-act="close">×</button></div>
    <div class="mb">
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}
      <div class="field"><label>제목</label>
        <input id="d-title" value="${esc(m.title)}" placeholder="예: 투자심의AI 파일럿 리뷰 준비"></div>
      <div class="row2">
        <div class="field"><label>업무유형</label><select id="d-type">${opts(S.types, m.type)}</select></div>
        <div class="field"><label>진행상황</label><select id="d-status">${opts(S.statuses, m.status)}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label>업무분류</label><select id="d-category">${opts(S.categories, m.category)}</select></div>
        <div class="field"><label>우선순위</label><select id="d-priority">${opts(S.priorities, m.priority)}</select></div>
      </div>
      <div class="row2">
        <div class="field"><label>시작일</label><input type="date" id="d-start" value="${m.start}"></div>
        <div class="field"><label>마감일</label><input type="date" id="d-due" value="${m.due}"></div>
      </div>
      <div class="field">
        <label>반복</label>
        <select id="d-repeat">${repeatOptions(m.repeat_days ?? 0)}</select>
        ${m.repeat_days ? `<div class="ck-hint">완료로 바꾸면 마감일 +${m.repeat_days}일로 다음 회차가 자동 생성됩니다.</div>` : ''}
      </div>
      <div class="field"><label>설명 · 메모</label>
        <textarea id="d-memo" rows="4" placeholder="세부 내용, 링크 등">${esc(m.memo)}</textarea></div>
      ${viewChecklist(m)}
    </div>
    <div class="mf">
      ${m.id ? '<button class="btn-del" data-act="del-modal">삭제</button>' : ''}
      <div style="flex:1"></div>
      <button class="btn-ghost" data-act="close">취소</button>
      <button class="btn-save" data-act="save">저장</button>
    </div>
  </div></div>`;
}

// ── 렌더 ─────────────────────────────────────────────
function render() {
  const all = filtered();
  // '완료 숨김'은 작업용 뷰에만 적용한다. 요약은 완료 건수·진척률을 보여야 하므로 제외.
  const visible = S.hideDone ? all.filter((t) => !isDone(t.status)) : all;
  const list = S.view === 'summary' ? all : visible;

  document.getElementById('nav').innerHTML = Object.entries(VIEWS).map(([k, label]) =>
    `<button class="nav-btn ${S.view === k ? 'on' : ''}" data-act="nav" data-view="${k}">
      <span class="mark"></span><span class="label">${label}</span>
      <span class="badge">${k === 'summary' ? '' : visible.length}</span></button>`).join('');

  const catCount = {};
  for (const t of S.tasks) catCount[t.category] = (catCount[t.category] || 0) + 1;
  document.getElementById('sidebar-cats').innerHTML = S.categories.map((c) =>
    `<button class="cat-btn ${S.fCategory === c ? 'on' : ''}" data-act="cat" data-cat="${esc(c)}">
      <span class="cdot" style="background:${CAT_COLOR(c)}"></span>
      <span class="name">${esc(c)}</span><span class="n">${catCount[c] || 0}</span></button>`).join('');

  document.getElementById('view-title').textContent = `${VIEWS[S.view]} 뷰`;
  const fc = document.getElementById('f-category');
  fc.innerHTML = `<option value="all">분류: 전체</option>${S.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
  fc.value = S.fCategory;
  const ft = document.getElementById('f-type');
  ft.innerHTML = `<option value="all">유형: 전체</option>${S.types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}`;
  ft.value = S.fType;
  const fp = document.getElementById('f-priority');
  fp.innerHTML = `<option value="all">우선순위: 전체</option>${S.priorities.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}`;
  fp.value = S.fPriority;
  document.getElementById('hide-done').classList.toggle('on', S.hideDone);

  const renderers = { summary: viewSummary, list: viewList, board: viewBoard, calendar: viewCalendar, timeline: viewTimeline };
  document.getElementById('viewport').innerHTML = renderers[S.view](list);
  document.getElementById('modal-root').innerHTML = viewModal();
  // 지정된 경우에만 포커스 — 체크리스트 조작 중 제목으로 커서가 튀지 않게
  if (S.modal && S.focusId) { document.getElementById(S.focusId)?.focus(); S.focusId = null; }
}

// ── 모달 조작 ────────────────────────────────────────
function openTask(id) {
  const t = S.tasks.find((x) => x.id === Number(id));
  if (t) { S.modal = { ...t }; S.newSub = ''; S.error = ''; S.focusId = 'd-title'; render(); }
}
function openNew(status) {
  // 기본값은 설정에서 가져온다 — 이름을 바꾸거나 지워도 기본값이 깨지지 않게
  S.modal = {
    id: null, title: '', type: S.types[0], status: status || S.statuses.find((s) => !isDone(s)) || S.statuses[0],
    category: S.fCategory !== 'all' ? S.fCategory : S.categories[0],
    priority: S.priorities.includes('Medium') ? 'Medium' : S.priorities[0],
    start: TODAY, due: shift(today, 7), memo: '', repeat_days: 0, subtasks: [],
  };
  S.newSub = ''; S.error = ''; S.focusId = 'd-title';
  render();
}
/** DOM 입력값을 모달 상태에 흡수 — 재렌더 시 입력 내용이 날아가지 않게. */
function syncDraft() {
  if (!S.modal) return;
  const v = (id) => document.getElementById(id)?.value;
  Object.assign(S.modal, {
    title: v('d-title'), type: v('d-type'), status: v('d-status'), category: v('d-category'),
    priority: v('d-priority'), start: v('d-start'), due: v('d-due'), memo: v('d-memo'),
    repeat_days: Number(v('d-repeat') ?? 0),
  });
  S.newSub = v('d-newsub') ?? '';
}

/** 보관 모달의 대상 건수와 보관 목록을 서버에서 다시 읽는다. */
async function loadArchive(before) {
  const [{ count }, list] = await Promise.all([
    api(`/api/archivable?before=${before}`),
    api('/api/tasks?archived=1'),
  ]);
  S.archive = { before, count, list: list.slice().sort((a, b) => b.due.localeCompare(a.due)) };
}

async function addOption() {
  const input = document.getElementById('s-new');
  const name = input?.value.trim();
  if (!name) return;
  await mutate(async () => { await send(`/api/options/${S.settings}`, 'POST', { name }); });
  document.getElementById('s-new')?.focus();
}

async function openArchive() {
  S.error = '';
  S.modal = null;
  try {
    await loadArchive(shift(today, -30));
    render();
  } catch (e) {
    S.error = e.message;
    render();
  }
}

/** 보관 모달 안의 동작 — 끝나면 모달 내용과 본문을 함께 새로 그린다. */
async function archiveAction(fn) {
  try {
    S.error = '';
    await fn();
    await loadArchive(document.getElementById('a-before')?.value || S.archive.before);
    await reload();
  } catch (e) {
    S.error = e.message;
    render();
  }
}

async function addSubtask() {
  syncDraft();
  const title = S.newSub.trim();
  if (!title || !S.modal?.id) return;
  S.focusId = 'd-newsub';
  await mutate(async () => { await send(`/api/tasks/${S.modal.id}/subtasks`, 'POST', { title }); S.newSub = ''; });
}

async function saveDraft() {
  syncDraft();
  const m = S.modal;
  if (!m.title.trim()) { S.error = '제목을 입력하세요'; return render(); }
  const body = { title: m.title, type: m.type, status: m.status, category: m.category, priority: m.priority,
    start: m.start, due: m.due, memo: m.memo, repeat_days: m.repeat_days ?? 0 };
  await mutate(async () => {
    if (m.id) await send(`/api/tasks/${m.id}`, 'PATCH', body);
    else await send('/api/tasks', 'POST', body);
    S.modal = null;
  });
}

// ── 이벤트 ───────────────────────────────────────────
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;

  if (act === 'nav') { S.view = el.dataset.view; return render(); }
  if (act === 'cat') { S.fCategory = S.fCategory === el.dataset.cat ? 'all' : el.dataset.cat; return render(); }
  if (act === 'sort') {
    const k = el.dataset.key;
    if (!k) return;
    S.sortDir = S.sortKey === k ? -S.sortDir : 1;
    S.sortKey = k;
    return render();
  }
  if (act === 'month') {
    const n = Number(el.dataset.n);
    if (n === 0) S.calMonth = TODAY.slice(0, 7);
    else { const [y, m] = S.calMonth.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); S.calMonth = iso(d).slice(0, 7); }
    return render();
  }
  if (act === 'open') return openTask(id);
  if (act === 'new') return openNew(el.dataset.status);
  if (act === 'del') { e.stopPropagation(); return mutate(() => api(`/api/tasks/${id}`, { method: 'DELETE' })); }
  if (act === 'del-modal') return mutate(async () => { await api(`/api/tasks/${S.modal.id}`, { method: 'DELETE' }); S.modal = null; });
  if (act === 'save') return saveDraft();
  if (act === 'sub-add') return addSubtask();
  if (act === 'sub-toggle') { syncDraft(); return mutate(() => send(`/api/subtasks/${el.dataset.sub}`, 'PATCH', { done: el.dataset.done !== '1' })); }
  if (act === 'sub-del') { syncDraft(); return mutate(() => api(`/api/subtasks/${el.dataset.sub}`, { method: 'DELETE' })); }
  if (act === 'close' || (act === 'close-bd' && e.target === el)) { S.modal = null; S.error = ''; return render(); }
  if (act === 'close-arch' || (act === 'close-arch-bd' && e.target === el)) { S.archive = null; S.error = ''; return render(); }
  if (act === 'close-set' || (act === 'close-set-bd' && e.target === el)) { S.settings = null; S.error = ''; return render(); }
  if (act === 'set-kind') { S.settings = el.dataset.kind; S.error = ''; return render(); }
  if (act === 'opt-add') return addOption();
  if (act === 'opt-del') {
    const n = Number(el.dataset.used);
    const msg = n ? `'${el.dataset.name}'을(를) 삭제하면 이 값을 쓰는 태스크 ${n}건이 다른 항목으로 옮겨집니다. 계속할까요?`
                  : `'${el.dataset.name}'을(를) 삭제할까요?`;
    if (!confirm(msg)) return;
    return mutate(() => api(`/api/options/${id}`, { method: 'DELETE' }));
  }
  if (act === 'arch-run') {
    const before = document.getElementById('a-before').value;
    if (!before || !confirm(`${before} 이전에 마감된 완료 태스크 ${S.archive.count}건을 보관할까요? 나중에 되돌릴 수 있습니다.`)) return;
    return archiveAction(() => send('/api/tasks/archive', 'POST', { before }));
  }
  if (act === 'arch-restore') return archiveAction(() => send(`/api/tasks/${id}`, 'PATCH', { archived: 0 }));
  if (act === 'arch-delete') {
    if (!confirm('영구 삭제합니다. 되돌릴 수 없습니다.')) return;
    return archiveAction(() => api(`/api/tasks/${id}`, { method: 'DELETE' }));
  }
});

// 드래그앤드롭 — 보드는 카드↔컬럼(상태 변경) + 열 머리끼리(열 순서), 체크리스트·설정은 항목끼리 순서 교체.
// dragover는 초당 수십 번 오므로 재렌더 대신 클래스만 직접 건드린다.
const clearOver = () => document.querySelectorAll('.over, .over-b')
  .forEach((el) => el.classList.remove('over', 'over-b'));
const subOrder = () => (S.modal?.subtasks ?? []).map((s) => s.id);
const optOrder = (kind) => (S.meta?.[META_KEY[kind]] ?? []).map((o) => o.id);

document.addEventListener('dragstart', (e) => {
  // data-sub / data-opt가 있는 것만 정렬 대상 — 보관 모달도 .ck-item 스타일을 재사용한다
  const item = e.target.closest('.ck-item[data-sub], .ck-item[data-opt]');
  if (item) {
    e.dataTransfer.effectAllowed = 'move';
    if (item.dataset.sub) S.dragSub = Number(item.dataset.sub);
    else { S.dragOpt = Number(item.dataset.opt); S.dragOptKind = S.settings; }
    item.classList.add('dragging');
    return;
  }
  // 보드 열 머리 = 진행상황 항목 자체를 끄는 것. 설정의 순서 변경과 같은 경로로 흐른다.
  const head = e.target.closest('.bcol > .head');
  if (head) {
    e.dataTransfer.effectAllowed = 'move';
    S.dragOpt = Number(head.parentElement.dataset.opt);
    S.dragOptKind = 'status';
    head.parentElement.classList.add('dragging');
    return;
  }
  const card = e.target.closest('.bcard');
  if (!card) return;
  e.dataTransfer.effectAllowed = 'move';
  S.dragId = Number(card.dataset.id);
  card.classList.add('dragging');
});

document.addEventListener('dragend', () => {
  if (S.dragSub || S.dragOpt) {
    S.dragSub = S.dragOpt = S.dragOptKind = null;
    clearOver();
    document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
    return;
  }
  S.dragId = null;
  render();
});

// 체크리스트·설정 항목·보드 열이 같은 정렬 UX를 쓴다 — 어느 쪽인지만 구분한다
const sortCtx = () => S.dragSub
  ? { id: S.dragSub, attr: 'sub', order: subOrder() }
  : { id: S.dragOpt, attr: 'opt', order: optOrder(S.dragOptKind), kind: S.dragOptKind };

document.addEventListener('dragover', (e) => {
  if (S.dragSub || S.dragOpt) {
    const { id, attr, order } = sortCtx();
    const over = e.target.closest(`[data-${attr}]`);
    if (!over) return;
    e.preventDefault();
    clearOver();
    const target = Number(over.dataset[attr]);
    if (target === id) return;
    // 삽입선을 실제 삽입 위치에 맞춘다 — 아래로 끌면 목표 아래, 위로 끌면 목표 위
    over.classList.add(order.indexOf(id) < order.indexOf(target) ? 'over-b' : 'over');
    return;
  }
  if (e.target.closest('.bcol')) e.preventDefault();
});

document.addEventListener('drop', (e) => {
  if (S.dragSub || S.dragOpt) {
    const { id: dragged, attr, order, kind } = sortCtx();
    const isOpt = !!S.dragOpt;
    const over = e.target.closest(`[data-${attr}]`);
    S.dragSub = S.dragOpt = S.dragOptKind = null;
    clearOver();
    if (!over) return;
    e.preventDefault();
    const target = Number(over.dataset[attr]);
    if (target === dragged) return;
    // 끌어온 항목을 빼서 목표 자리에 끼워 넣는다. 아래로 끌면 목표 뒤, 위로 끌면 목표 앞.
    const from = order.indexOf(dragged), to = order.indexOf(target);
    if (from < 0 || to < 0) return;
    const ids = order.filter((x) => x !== dragged);
    ids.splice(ids.indexOf(target) + (from < to ? 1 : 0), 0, dragged);
    if (isOpt) return mutate(() => send(`/api/options/${kind}/order`, 'PATCH', { ids }));
    syncDraft();
    return mutate(() => send(`/api/tasks/${S.modal.id}/subtasks/order`, 'PATCH', { ids }));
  }
  const col = e.target.closest('.bcol');
  if (!col || !S.dragId) return;
  e.preventDefault();
  const id = S.dragId, status = col.dataset.drop;
  S.dragId = null;
  if (S.tasks.find((t) => t.id === id)?.status !== status) mutate(() => send(`/api/tasks/${id}`, 'PATCH', { status }));
});

document.getElementById('q').addEventListener('input', (e) => { S.query = e.target.value; render(); });
document.getElementById('f-category').addEventListener('change', (e) => { S.fCategory = e.target.value; render(); });
document.getElementById('f-type').addEventListener('change', (e) => { S.fType = e.target.value; render(); });
document.getElementById('f-priority').addEventListener('change', (e) => { S.fPriority = e.target.value; render(); });
document.getElementById('hide-done').addEventListener('click', () => { S.hideDone = !S.hideDone; render(); });
document.getElementById('open-archive').addEventListener('click', openArchive);
document.getElementById('open-settings').addEventListener('click', () => {
  S.modal = S.archive = null; S.error = ''; S.settings = 'type'; render();
});
// 기준일을 바꾸면 대상 건수를 다시 센다
document.addEventListener('change', (e) => {
  if (e.target.id === 'a-before') return archiveAction(async () => {});
  const act = e.target.dataset?.act, id = e.target.dataset?.id;
  if (act === 'opt-color') return mutate(() => send(`/api/options/${id}`, 'PATCH', { color: e.target.value }));
  if (act === 'opt-done') return mutate(() => send(`/api/options/${id}`, 'PATCH', { done: e.target.checked }));
  // 이름은 포커스를 벗어날 때만 저장 — 한 글자마다 태스크를 갱신하지 않도록
  if (act === 'opt-name') {
    const name = e.target.value.trim();
    const cur = S.meta[META_KEY[S.settings]].find((o) => o.id === Number(id));
    if (!name || name === cur?.name) return render();
    return mutate(() => send(`/api/options/${id}`, 'PATCH', { name }));
  }
});
document.getElementById('new-task').addEventListener('click', () => openNew());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (S.modal || S.archive || S.settings)) { S.modal = S.archive = S.settings = null; render(); }
  if (e.key === 'Enter' && e.target.id === 'd-newsub') { e.preventDefault(); addSubtask(); }
  if (e.key === 'Enter' && e.target.id === 's-new') { e.preventDefault(); addOption(); }
  if (e.key === 'Enter' && e.target.dataset?.act === 'opt-name') e.target.blur();
});

reload().catch((e) => { document.getElementById('viewport').innerHTML = `<div class="card empty">서버 연결 실패: ${esc(e.message)}</div>`; });
