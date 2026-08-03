// MyWork 프론트 — 상태 변경 시 전체 재렌더. 이벤트는 위임으로 처리.
import { checklist, weightedPct, checklistTotals } from './progress.js';

const DAY = 86400000;
const VIEWS = { summary: '요약', list: '목록', board: '보드', calendar: '캘린더', timeline: '타임라인', notes: '메모' };
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
// 우선순위는 «가장 높은 것»만 화면에 드러낸다. 이름('High')이 아니라 설정 순서의 첫 항목이 기준 —
// done 플래그와 같은 이유로, 이름을 바꾸거나 등급을 늘려도 동작이 유지된다.
const isTop = (p) => p === S.priorities[0];
const topBadge = (p) => isTop(p) ? `<b class="hi-badge" style="background:${PR_COLOR(p)}1A;color:${PR_COLOR(p)}">${esc(p)}</b>` : '';
/** 반복 계열 식별자. 회차는 별도 태스크로 복사될 뿐 계열 id가 없어서 주기+제목으로 묶는다. */
const seriesKey = (t) => `${t.repeat_days} ${t.title}`;
// Keep 스타일 파스텔 팔레트. 첫 항목('')은 기본 카드색. 진한 글자가 그대로 읽히는 밝기로 고정한다.
const NOTE_COLORS = ['', '#F8D7D4', '#FBE7CE', '#FBF3C2', '#DEF0D2', '#CDE9E2', '#D4E4F2', '#E3DEF2', '#EFE0DA'];
/**
 * 그 태스크가 「걸려 있는 날」 — 끝난 건은 실제로 끝낸 날, 나머지는 마감일.
 * 표시(dueMeta)와 정렬이 같은 값을 봐야 완료 행이 화면에 보이는 날짜와 다른 자리에 앉지 않는다.
 * done_at이 없는 구버전 완료 행은 예전처럼 마감일이 근사치다.
 */
const endDate = (t) => (isDone(t.status) && t.done_at ? t.done_at.slice(0, 10) : t.due);
/** 우선순위 우선, 같으면 날짜 순. 목록의 우선순위 정렬을 뺀 자리를 이 기본 정렬이 대신한다. */
const byPriority = (a, b) => PR_RANK(a.priority) - PR_RANK(b.priority) || endDate(a).localeCompare(endDate(b));

// 상하위 관계는 1단계뿐이라 인덱스 없이 훑는다 (개인용 규모 — 수십~수백 건)
const taskById = (id) => S.tasks.find((t) => t.id === id);
const childrenOf = (id) => S.tasks.filter((t) => t.parent_id === id);
/** 하위 태스크 진행 — 완료 건수 기준. 없으면 total 0 → UI에서 숨김. */
const childProgress = (id) => {
  const kids = childrenOf(id);
  return { done: kids.filter((t) => isDone(t.status)).length, total: kids.length };
};

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
  view: document.body.dataset.view || 'summary',
  query: '', fCategory: 'all', fType: 'all', fPriority: 'all',
  sortKey: 'due', sortDir: 1,
  calMonth: TODAY.slice(0, 7),
  hideDone: false,
  modal: null, archive: null, newSub: '', dragId: null, dragSub: null, dragOpt: null, dragOptKind: null, error: '',
  reSel: null, // 지연 일괄 재조정 선택. null = 전부 선택(기본값)
  pending: null, // 되돌리기 대기 중인 삭제 { id, title, timer }
  openSeries: new Set(), // 이전 회차를 펼쳐 둔 반복 계열
  notes: [], archNotes: [], showArchivedNotes: false,
  noteModal: null,      // 메모 편집 모달
  quick: false,         // 빠른 작성 폼 펼침 여부
  colorPick: null,      // 색상 스와치가 열린 메모 id
  convertNoteId: null,  // 태스크로 전환 중인 메모 id — 태스크 저장 성공 시 연결한다
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
  const [meta, tasks, notes, archNotes] = await Promise.all([
    api('/api/meta'), api('/api/tasks'), api('/api/notes'), api('/api/notes?archived=1'),
  ]);
  Object.assign(S, {
    tasks, notes, archNotes,
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
    !(S.pending?.kind === 'task' && t.id === S.pending.id) && // 삭제 대기 중 — 되돌리기 시간이 끝날 때까지만 감춘다
    (S.fCategory === 'all' || t.category === S.fCategory) &&
    (S.fType === 'all' || t.type === S.fType) &&
    (S.fPriority === 'all' || t.priority === S.fPriority) &&
    (!q || t.title.toLowerCase().includes(q) || (t.memo || '').toLowerCase().includes(q)));
}

const noteById = (id) => [...S.notes, ...S.archNotes].find((n) => n.id === Number(id));

function filteredNotes() {
  const q = S.query.trim().toLowerCase();
  const src = S.showArchivedNotes ? S.archNotes : S.notes;
  return src.filter((n) =>
    !(S.pending?.kind === 'note' && n.id === S.pending.id) &&
    // 분류 없는 메모는 필터·사이드바 토글에 걸리지 않고 항상 보인다
    (S.fCategory === 'all' || !n.category || n.category === S.fCategory) &&
    (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)));
}

// 지연 = 마감이 오늘 이전 + 미완료. 요약 뷰 표시와 일괄 재조정이 같은 정의를 쓴다.
const lateOpen = () => filtered().filter((t) => !isDone(t.status) && t.due < TODAY);
const lateSelected = () => lateOpen().filter((t) => !S.reSel || S.reSel.has(t.id));

function dueMeta(t) {
  const diff = Math.round((parseD(t.due) - parseD(TODAY)) / DAY);
  const short = md(t.due);
  // 완료 건은 마감일 대신 실제로 끝낸 날을 보여준다 — 지금까지는 마감일에 «완료»만 붙여 놓아 사실과 달랐다
  if (isDone(t.status)) {
    const at = md(endDate(t));
    return { color: '#9AA2AD', text: `${at} 완료`, short: at, diff };
  }
  if (diff < 0) return { color: '#D64545', text: `${short} (${-diff}일 지연)`, short: `${short} ⚠`, diff };
  if (diff === 0) return { color: '#D64545', text: `${short} (오늘 마감)`, short: `${short} 오늘`, diff };
  if (diff <= 3) return { color: '#D98200', text: `${short} (D-${diff})`, short: `${short} D-${diff}`, diff };
  return { color: '#6B7280', text: `${short} (D-${diff})`, short, diff };
}

// ── 뷰 ───────────────────────────────────────────────
function viewSummary(list) {
  const cnt = (st) => list.filter((t) => t.status === st).length;
  const open = list.filter((t) => !isDone(t.status));
  // today_brief(MCP)와 같은 3분류 — 지연 / 오늘 마감 / 7일 내 예정. 각 구간 안에서는 우선순위가 앞선다.
  const late = open.filter((t) => t.due < TODAY).sort(byPriority);
  const dueToday = open.filter((t) => t.due === TODAY).sort(byPriority);
  const week = open.filter((t) => t.due > TODAY && t.due <= shift(today, 7)).sort(byPriority);
  const overdue = late.length;
  const soon = dueToday.length + week.length;
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

  // ── 오늘의 액션 — 지연 섹션은 체크박스 + 일괄 마감 재조정 버튼을 가진다
  const sel = new Set(lateSelected().map((t) => t.id));
  const fri = shift(today, (5 - today.getDay() + 7) % 7); // 다가오는 금요일 (오늘이 금요일이면 오늘)
  const laterCnt = open.length - overdue - soon;

  const briefRow = (t, box = '') => {
    const dm = dueMeta(t);
    return `<div class="up-row" data-act="open" data-id="${t.id}">${box}
      <span class="dot" style="background:${CAT_COLOR(t.category)}"></span>
      <span class="t">${topBadge(t.priority)}${esc(t.title)}</span>
      <span class="c">${esc(t.category)}</span>
      <span class="d" style="color:${dm.color}">${dm.text}</span></div>`;
  };
  const briefHead = (label, color, n, extra = '') =>
    `<div class="brief-h"><i style="background:${color}"></i><b>${label}</b><span class="n">${n}</span>${extra}</div>`;

  const reschedBtns = `<span style="margin-left:auto;display:flex;gap:6px">
    <button class="btn-sm" data-act="resched" data-to="${TODAY}" ${sel.size ? '' : 'disabled'}>선택 ${sel.size}건 → 오늘</button>
    ${fri === TODAY ? '' : `<button class="btn-sm" data-act="resched" data-to="${fri}" ${sel.size ? '' : 'disabled'}>→ ${md(fri)} 금요일</button>`}
  </span>`;

  const brief = `<div class="card" style="padding:18px">
    <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
      <div class="card-t">오늘의 액션</div>
      <div style="font-size:11.5px;color:#8A919C">지연 → 오늘 마감 → 7일 내 예정 · 지연은 선택해서 마감일을 한 번에 미룰 수 있습니다</div>
    </div>
    ${overdue ? briefHead('지연', '#D64545', overdue, reschedBtns)
      + late.map((t) => briefRow(t, `<input type="checkbox" data-act="resel" data-id="${t.id}" ${sel.has(t.id) ? 'checked' : ''}>`)).join('') : ''}
    ${dueToday.length ? briefHead('오늘 마감', '#D98200', dueToday.length) + dueToday.map((t) => briefRow(t)).join('') : ''}
    ${week.length ? briefHead('예정 · 7일 내', '#2F6FED', week.length) + week.map((t) => briefRow(t)).join('') : ''}
    ${open.length ? '' : '<div class="empty">미완료 태스크가 없습니다.</div>'}
    ${laterCnt > 0 ? `<div class="ck-hint" style="padding-top:10px">7일 이후 마감 미완료 ${laterCnt}건</div>` : ''}
  </div>`;

  return `<div class="stack">
    <div class="stats">${stats.map((s) => `<div class="card stat">
      <div class="l">${s.label}</div><div class="v" style="color:${s.color}">${s.value}</div><div class="h">${s.hint}</div>
    </div>`).join('')}</div>
    ${brief}
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
  </div>`;
}

// 우선순위 전용 컬럼은 없앴다 — 값이 거의 한 등급에 몰려 정렬·스캔에 쓸모가 없었다.
// 대신 가장 높은 등급만 제목 앞 배지로 드러낸다.
const COLS = [
  { key: 'title', label: '제목' }, { key: 'type', label: '유형' }, { key: 'status', label: '상태' },
  { key: 'category', label: '분류' },
  { key: 'start', label: '시작일' }, { key: 'due', label: '마감일' }, { key: '', label: '' },
];

function viewList(list) {
  const sorted = list.slice().sort((a, b) => {
    const k = S.sortKey;
    let av, bv;
    if (k === 'due') { av = endDate(a); bv = endDate(b); } // 완료 행은 보이는 값(완료일)으로 줄 세운다
    else if (k === 'status') { av = S.statuses.indexOf(a.status); bv = S.statuses.indexOf(b.status); }
    else { av = String(a[k] ?? ''); bv = String(b[k] ?? ''); }
    return (av < bv ? -1 : av > bv ? 1 : 0) * S.sortDir;
  });

  const head = COLS.map((c) => `<button data-act="sort" data-key="${c.key}">
    <span>${c.label}</span><span class="arrow">${S.sortKey === c.key && c.key ? (S.sortDir === 1 ? '▲' : '▼') : ''}</span></button>`).join('');

  // 반복 태스크는 완료 회차가 같은 제목으로 쌓인다 — 최신 완료 회차만 남기고 이전 것을 접는다.
  // 계열 식별자는 제목+주기다. 회차마다 별도 태스크로 복사될 뿐 계열 id가 없기 때문이며,
  // 어느 회차의 제목을 고치면 그 건은 계열에서 떨어져 나온다.
  const rounds = new Map();
  for (const t of sorted) {
    if (!(t.repeat_days > 0) || !isDone(t.status)) continue;
    const key = seriesKey(t);
    rounds.set(key, [...(rounds.get(key) ?? []), t]);
  }
  const folds = new Map(); // 최신 회차 id → 접힌 건수
  const folded = new Set(); // 접혀서 안 보이는 행
  for (const [key, list] of rounds) {
    if (list.length < 2) continue;
    const [latest, ...older] = list.slice().sort((a, b) => b.due.localeCompare(a.due));
    folds.set(latest.id, older.length);
    if (!S.openSeries.has(key)) older.forEach((t) => folded.add(t.id));
  }

  // 하위 태스크는 상위 바로 아래에 붙인다. 상위가 필터에 걸려 안 보이면 제자리에 그대로 둔다.
  const kids = new Map();
  for (const t of sorted) if (t.parent_id) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]);
  const shown = new Set(sorted.map((t) => t.id));
  const ordered = sorted.flatMap((t) =>
    (t.parent_id && shown.has(t.parent_id)) ? [] : [t, ...(kids.get(t.id) ?? [])]);

  const rows = ordered.filter((t) => !folded.has(t.id)).map((t) => {
    const dm = dueMeta(t), done = isDone(t.status), p = checklist(t), c = childProgress(t.id);
    // 하위 표시 색은 상위의 분류 색을 따른다 — 상위가 지워졌거나 보관됐으면 CAT_COLOR의 기본 회색
    const sub = t.parent_id ? `--sub:${CAT_COLOR(taskById(t.parent_id)?.category)}` : '';
    return `<div class="grid-row trow">
      <div class="main ${t.parent_id ? 'is-sub' : ''}" style="${sub}" data-act="open" data-id="${t.id}">
        <span class="tt" style="text-decoration:${done ? 'line-through' : 'none'};color:${done ? '#9AA2AD' : '#14161A'}">${t.parent_id ? '<span class="sub-mark">↳</span>' : ''}${done ? '' : topBadge(t.priority)}${esc(t.title)}</span>
        <span class="td">${t.repeat_days ? `<b class="rp-badge">🔁 ${repeatLabel(t.repeat_days)}</b>` : ''}${folds.has(t.id) ? `<b class="fold-badge" data-act="fold" data-id="${t.id}">${S.openSeries.has(seriesKey(t)) ? '− 이전 회차 접기' : `＋ 이전 회차 ${folds.get(t.id)}건`}</b>` : ''}${c.total ? `<b class="sb-badge">⑂ ${c.done}/${c.total}</b>` : ''}${p.total ? `<b class="ck-badge">☑ ${p.done}/${p.total}</b>` : ''}${esc(t.memo || '—')}</span>
      </div>
      <div class="cell"><span class="chip" style="background:${TYPE_BG(t.type)};color:${TYPE_COLOR(t.type)}">${esc(t.type)}</span></div>
      <div class="cell"><span class="chip" style="background:${STATUS_BG(t.status)};color:${STATUS_COLOR(t.status)}">${esc(t.status)}</span></div>
      <div class="cell" style="color:#5A6270">${esc(t.category)}</div>
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
    const tasks = list.filter((t) => t.status === st).sort(byPriority);
    return `<div class="bcol ${S.dragId ? 'drag' : ''}" data-drop="${esc(st)}" data-opt="${o.id}">
      <div class="head" draggable="true" title="드래그해서 열 순서 변경">
        <span class="ck-grip">⠿</span>
        <span class="dot" style="background:${STATUS_COLOR(st)}"></span>
        <span class="l">${esc(st)}</span><span class="n">${tasks.length}</span>
      </div>
      ${tasks.map((t) => {
        const dm = dueMeta(t), done = isDone(t.status), p = checklist(t), c = childProgress(t.id);
        const parent = t.parent_id && taskById(t.parent_id);
        return `<div class="bcard ${parent ? 'is-sub' : ''} ${S.dragId === t.id ? 'dragging' : ''}" draggable="true"
             style="${parent ? `--sub:${CAT_COLOR(parent.category)}` : ''}" data-act="open" data-id="${t.id}">
          ${parent ? `<div class="parent-line" data-act="open" data-id="${parent.id}" title="상위 태스크: ${esc(parent.title)}">↳ ${esc(parent.title)}</div>` : ''}
          <div class="tt" style="text-decoration:${done ? 'line-through' : 'none'};color:${done ? '#8D95A0' : '#14161A'}">${done ? '' : topBadge(t.priority)}${esc(t.title)}</div>
          <div class="tags">
            <span style="background:${TYPE_BG(t.type)};color:${TYPE_COLOR(t.type)}">${esc(t.type)}</span>
            <span style="background:${CAT_COLOR(t.category)}1A;color:${CAT_COLOR(t.category)};font-weight:400">${esc(t.category)}</span>
            ${c.total ? `<span style="background:#E9ECF1;color:#3C424C">⑂ ${c.done}/${c.total}</span>` : ''}
            ${t.repeat_days ? `<span style="background:#FCF1E0;color:#D98200">🔁 ${repeatLabel(t.repeat_days)}</span>` : ''}
          </div>
          ${p.total ? `<div class="prog-row">
            <div class="prog"><div class="fill" style="width:${p.pct}%"></div></div>
            <span class="ck-n">${p.done}/${p.total}</span></div>` : ''}
          <div class="foot">
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
        <span class="dot" style="background:${CAT_COLOR(t.category)}"></span><span>${esc(t.title)}</span>
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

// ── 메모 뷰 (Keep 스타일) ────────────────────────────
function noteCard(n) {
  const task = n.task_id ? taskById(n.task_id) : null;
  return `<div class="note-card" data-act="note-open" data-id="${n.id}" style="background:${esc(n.color) || '#fff'}">
    ${n.title ? `<div class="nt">${esc(n.title)}</div>` : ''}
    ${n.body ? `<div class="nb">${esc(n.body)}</div>` : ''}
    ${n.category || task ? `<div class="nfoot">
      ${n.category ? `<span class="chip" style="background:${CAT_COLOR(n.category)}1A;color:${CAT_COLOR(n.category)}">${esc(n.category)}</span>` : ''}
      ${task ? `<span class="chip note-task" data-act="open" data-id="${task.id}" title="연결된 태스크 열기">✓ ${esc(task.title)}</span>` : ''}
    </div>` : ''}
    ${S.colorPick === n.id ? `<div class="note-swatches">${NOTE_COLORS.map((c) =>
      `<button data-act="note-swatch" data-id="${n.id}" data-color="${c}" class="${(n.color || '') === c ? 'on' : ''}"
        style="background:${c || '#fff'}" title="${c || '기본'}"></button>`).join('')}</div>` : ''}
    <div class="note-actions">
      <button data-act="note-pin" data-id="${n.id}" title="${n.pinned ? '고정 해제' : '고정'}">📌</button>
      <button data-act="note-color" data-id="${n.id}" title="색상">🎨</button>
      ${n.archived
        ? `<button data-act="note-arch" data-id="${n.id}" data-to="0" title="복원">↩</button>`
        : `<button data-act="note-totask" data-id="${n.id}" title="태스크로 전환" ${n.task_id ? 'disabled' : ''}>➜</button>
           <button data-act="note-arch" data-id="${n.id}" data-to="1" title="보관">🗄</button>`}
      <button class="x-btn" data-act="note-del" data-id="${n.id}">×</button>
    </div>
  </div>`;
}

function viewQuick() {
  if (!S.quick) return '<div class="note-quick collapsed" data-act="quick-open">메모 작성…</div>';
  return `<div class="note-quick">
    <input id="nq-title" placeholder="제목">
    <textarea id="nq-body" rows="3" placeholder="메모 내용…"></textarea>
    <div class="nq-foot">
      <select id="nq-category">
        <option value="">분류 없음</option>
        ${S.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
      </select>
      <div style="flex:1"></div>
      <button class="btn-sm" data-act="quick-save">저장</button>
    </div>
  </div>`;
}

function viewNotes(list) {
  const cards = (notes) => `<div class="notes-grid">${notes.map(noteCard).join('')}</div>`;
  if (S.showArchivedNotes) {
    return `<div class="notes-wrap">
      ${list.length ? cards(list) : '<div class="card empty">보관된 메모가 없습니다.</div>'}
    </div>`;
  }
  const pinned = list.filter((n) => n.pinned);
  const rest = list.filter((n) => !n.pinned);
  return `<div class="notes-wrap">
    ${viewQuick()}
    ${pinned.length
      ? `<div class="notes-sec"><h6>📌 고정됨</h6>${cards(pinned)}</div>`
        + (rest.length ? `<div class="notes-sec"><h6>기타</h6>${cards(rest)}</div>` : '')
      : (rest.length ? cards(rest) : '')}
    ${list.length ? '' : '<div class="card empty">메모가 없습니다. 위에서 바로 작성해 보세요.</div>'}
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

/**
 * 상위 태스크 지정. Jira처럼 1단계까지만 —
 * 이미 하위를 가진 태스크는 다른 태스크의 하위가 될 수 없다(선택 대신 안내만).
 */
function viewParent(m) {
  const kids = m.id ? childrenOf(m.id) : [];
  if (kids.length) {
    return `<div class="field"><label>상위 태스크</label>
      <div class="ck-hint">하위 태스크 ${kids.length}건을 가지고 있어 다른 태스크의 하위로 넣을 수 없습니다.</div></div>`;
  }
  const cand = S.tasks.filter((t) => t.id !== m.id && t.parent_id == null);
  // 보관된 태스크가 상위인 경우 목록에 없다 — 선택지를 만들어 두지 않으면 저장할 때 연결이 조용히 끊긴다
  const keep = m.parent_id && !cand.some((t) => t.id === m.parent_id)
    ? `<option value="${m.parent_id}" selected>#${m.parent_id} (보관됨)</option>` : '';
  return `<div class="field"><label>상위 태스크</label>
    <select id="d-parent">
      <option value="">없음</option>${keep}
      ${cand.map((t) => `<option value="${t.id}" ${t.id === m.parent_id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}
    </select></div>`;
}

/** 하위 태스크 목록. 하위는 다시 하위를 못 가지므로 자신이 하위면 아예 표시하지 않는다. */
function viewChildren(m) {
  if (!m.id || m.parent_id) return '';
  const kids = childrenOf(m.id);
  const p = childProgress(m.id);
  return `<div class="field">
    <label>하위 태스크 ${p.total ? `<span class="ck-n">${p.done}/${p.total}</span>` : ''}</label>
    <div class="ck-list">${kids.map((t) => {
      const dm = dueMeta(t);
      return `<div class="ck-item" data-act="open" data-id="${t.id}" style="cursor:pointer">
        <span class="ck-t ${isDone(t.status) ? 'done' : ''}">${esc(t.title)}</span>
        <span class="chip" style="background:${STATUS_BG(t.status)};color:${STATUS_COLOR(t.status)}">${esc(t.status)}</span>
        <span class="ck-n" style="color:${dm.color}">${dm.short}</span>
      </div>`;
    }).join('') || '<div class="ck-hint">하위 태스크가 없습니다.</div>'}</div>
    <div class="ck-add"><button class="btn-sm" data-act="child-add">＋ 하위 태스크 추가</button></div>
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

/** 메모 편집 모달. 생성은 빠른 작성이 맡고, 여기는 항상 기존 메모(id 있음)를 연다. */
function viewNoteModal() {
  const n = S.noteModal;
  if (!n) return '';
  return `<div class="backdrop" data-act="note-close-bd"><div class="modal">
    <div class="mh"><div class="t">메모</div><div style="flex:1"></div>
      <button class="x-btn" data-act="note-close">×</button></div>
    <div class="mb">
      ${S.error ? `<div class="err">${esc(S.error)}</div>` : ''}
      <div class="field"><label>제목</label>
        <input id="n-title" value="${esc(n.title)}" placeholder="제목 (선택)"></div>
      <div class="field"><label>내용</label>
        <textarea id="n-body" rows="8" placeholder="메모 내용">${esc(n.body)}</textarea></div>
      <div class="row2">
        <div class="field"><label>업무분류</label>
          <select id="n-category"><option value="">없음</option>
            ${S.categories.map((c) => `<option value="${esc(c)}" ${c === n.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select></div>
        <div class="field"><label>색상</label>
          <div class="note-swatches" style="padding-top:10px">${NOTE_COLORS.map((c) =>
            `<button data-act="nm-color" data-color="${c}" class="${(n.color || '') === c ? 'on' : ''}" style="background:${c || '#fff'}" title="${c || '기본'}"></button>`).join('')}</div></div>
      </div>
      <div class="field"><label>연결 태스크</label>
        <select id="n-task"><option value="">없음</option>
          ${n.task_id && !taskById(n.task_id) ? `<option value="${n.task_id}" selected>#${n.task_id} (보관됨)</option>` : ''}
          ${S.tasks.map((t) => `<option value="${t.id}" ${t.id === n.task_id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}
        </select>
        <div class="ck-hint">연결하면 태스크 모달에서도 이 메모가 보입니다.</div></div>
    </div>
    <div class="mf">
      <button class="btn-del" data-act="note-del-modal">삭제</button>
      <div style="flex:1"></div>
      <button class="btn-ghost" data-act="note-close">취소</button>
      <button class="btn-save" data-act="note-save">저장</button>
    </div>
  </div></div>`;
}

/** 태스크에 연결된 메모 — 클릭하면 메모 편집으로 넘어간다. */
function viewTaskNotes(m) {
  if (!m.id) return '';
  const notes = S.notes.filter((n) => n.task_id === m.id);
  if (!notes.length) return '';
  return `<div class="field"><label>연결된 메모 <span class="ck-n">${notes.length}건</span></label>
    <div class="ck-list">${notes.map((n) => `<div class="ck-item" data-act="note-open" data-id="${n.id}" style="cursor:pointer">
      <span class="ck-t">${esc(n.title || n.body.slice(0, 60))}</span>
    </div>`).join('')}</div></div>`;
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
      ${viewParent(m)}
      <div class="field">
        <label>반복</label>
        <select id="d-repeat">${repeatOptions(m.repeat_days ?? 0)}</select>
        ${m.repeat_days ? `<div class="ck-hint">완료로 바꾸면 마감일 +${m.repeat_days}일로 다음 회차가 자동 생성됩니다.</div>` : ''}
      </div>
      <div class="field"><label>설명 · 메모</label>
        <textarea id="d-memo" rows="4" placeholder="세부 내용, 링크 등">${esc(m.memo)}</textarea></div>
      ${viewChecklist(m)}
      ${viewChildren(m)}
      ${viewTaskNotes(m)}
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
    `<a class="nav-btn ${S.view === k ? 'on' : ''}" href="/${k}">
      <span class="mark"></span><span class="label">${label}</span>
      <span class="badge">${k === 'summary' ? '' : k === 'notes' ? S.notes.length : visible.length}</span></a>`).join('');

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
  if (ft) {
    ft.innerHTML = `<option value="all">유형: 전체</option>${S.types.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}`;
    ft.value = S.fType;
  }
  // 우선순위 필터는 3지 선택 대신 «최상위 등급만» 토글이다 — 등급 이름은 설정에서 온다
  const fp = document.getElementById('f-priority');
  if (fp) {
    fp.textContent = `${S.priorities[0] ?? '우선순위'}만`;
    fp.classList.toggle('on', S.fPriority !== 'all');
  }
  document.getElementById('hide-done')?.classList.toggle('on', S.hideDone);
  document.getElementById('show-arch-notes')?.classList.toggle('on', S.showArchivedNotes);

  const renderers = { summary: viewSummary, list: viewList, board: viewBoard, calendar: viewCalendar, timeline: viewTimeline, notes: viewNotes };
  document.getElementById('viewport').innerHTML = renderers[S.view](S.view === 'notes' ? filteredNotes() : list);
  document.getElementById('modal-root').innerHTML = viewModal() + viewNoteModal() + viewToast();
  // 지정된 경우에만 포커스 — 체크리스트 조작 중 제목으로 커서가 튀지 않게
  if (S.modal && S.focusId) { document.getElementById(S.focusId)?.focus(); S.focusId = null; }
}

// ── 모달 조작 ────────────────────────────────────────
function openTask(id) {
  const t = S.tasks.find((x) => x.id === Number(id));
  if (t) { S.modal = { ...t }; S.newSub = ''; S.error = ''; S.focusId = 'd-title'; render(); }
}
function openNew(status, parentId = null) {
  // 하위 태스크는 상위의 분류·유형·마감일을 물려받는다 — 매번 다시 고르지 않도록
  const p = parentId ? taskById(parentId) : null;
  // 기본값은 설정에서 가져온다 — 이름을 바꾸거나 지워도 기본값이 깨지지 않게
  S.modal = {
    id: null, title: '', type: p?.type ?? S.types[0], status: status || S.statuses.find((s) => !isDone(s)) || S.statuses[0],
    category: p?.category ?? (S.fCategory !== 'all' ? S.fCategory : S.categories[0]),
    priority: S.priorities.includes('Medium') ? 'Medium' : S.priorities[0],
    // 상위가 이미 지난 마감이면 물려받지 않는다 — 시작일(오늘)보다 앞서면 저장이 막힌다
    start: TODAY, due: p && p.due > TODAY ? p.due : shift(today, 7), memo: '', repeat_days: 0, subtasks: [],
    parent_id: parentId,
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
  // 하위를 가진 태스크는 select 자체가 없다 — 그럴 땐 기존 값을 그대로 둔다
  const parent = v('d-parent');
  if (parent !== undefined) S.modal.parent_id = parent ? Number(parent) : null;
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
    start: m.start, due: m.due, memo: m.memo, repeat_days: m.repeat_days ?? 0, parent_id: m.parent_id ?? null };
  await mutate(async () => {
    if (m.id) await send(`/api/tasks/${m.id}`, 'PATCH', body);
    else {
      const created = await send('/api/tasks', 'POST', body);
      // 메모 → 태스크 전환: 태스크가 실제로 만들어진 뒤에만 원본 메모를 연결한다
      if (S.convertNoteId) await send(`/api/notes/${S.convertNoteId}`, 'PATCH', { task_id: created.id });
    }
    S.modal = null;
    S.convertNoteId = null;
  });
}

/** 하위 태스크 추가 — 열려 있던 수정 내용을 먼저 저장하고 새 태스크 모달로 넘어간다. */
async function openChild() {
  const parentId = S.modal?.id;
  if (!parentId) return;
  await saveDraft();
  if (S.modal) return; // 저장 실패 — 에러가 뜬 모달을 그대로 둔다
  openNew(null, parentId);
}

// ── 메모 조작 ────────────────────────────────────────
async function openNote(id) {
  const n = noteById(id);
  if (!n) return;
  // 태스크 모달의 «연결된 메모»에서 넘어오는 경우 — 편집 중이던 내용을 조용히 버리지 않고
  // 하위 태스크 추가와 같은 규칙으로 먼저 저장한다
  if (S.modal?.id) {
    await saveDraft();
    if (S.modal) return; // 저장 실패 — 에러가 뜬 태스크 모달을 그대로 둔다
  }
  S.modal = null;
  S.noteModal = { ...n };
  S.error = '';
  render();
}

/** 메모 모달 입력값을 상태에 흡수 — syncDraft와 같은 이유. */
function syncNote() {
  if (!S.noteModal) return;
  const v = (id) => document.getElementById(id)?.value;
  if (v('n-title') === undefined) return; // 모달이 화면에 없으면 그대로 둔다
  Object.assign(S.noteModal, {
    title: v('n-title'),
    body: v('n-body'),
    category: v('n-category') || null,
    task_id: v('n-task') ? Number(v('n-task')) : null,
  });
}

async function saveNote() {
  syncNote();
  const n = S.noteModal;
  if (!n.title.trim() && !n.body.trim()) { S.error = '제목이나 내용을 입력하세요'; return render(); }
  await mutate(async () => {
    await send(`/api/notes/${n.id}`, 'PATCH',
      { title: n.title, body: n.body, color: n.color ?? '', category: n.category, task_id: n.task_id ?? null });
    S.noteModal = null;
  });
}

/** 빠른 작성 저장. 비어 있으면 만들지 않고 닫기만 한다 — Keep과 같은 동작. */
async function saveQuick() {
  const title = document.getElementById('nq-title')?.value.trim() ?? '';
  const body = document.getElementById('nq-body')?.value ?? '';
  const category = document.getElementById('nq-category')?.value || null;
  S.quick = false;
  if (!title && !body.trim()) return render();
  await mutate(() => send('/api/notes', 'POST', { title, body, category }));
}

/** 메모 → 태스크 전환. 새 태스크 모달을 프리필로 열고, 저장이 성공하면 메모를 연결한다. */
function convertNote(id) {
  const n = S.notes.find((x) => x.id === Number(id));
  if (!n) return;
  openNew();
  S.modal.title = n.title || n.body.split('\n')[0].slice(0, 80);
  S.modal.memo = n.body;
  if (n.category && S.categories.includes(n.category)) S.modal.category = n.category;
  S.convertNoteId = n.id;
  render();
}

// ── 삭제 되돌리기 ────────────────────────────────────
// 삭제 요청을 바로 보내지 않는다. 화면에서만 감춰 두고 UNDO_MS 뒤에 확정한다 —
// 서버도 스키마도 건드리지 않고 «되돌리기»가 성립하고, 그때까지는 체크리스트 CASCADE도 일어나지 않는다.
const UNDO_MS = 5000;

/** 대기 중인 삭제를 서버로 확정. 페이지를 떠나는 중에도 불리므로 keepalive로 보낸다. */
function commitDelete(reloadAfter = true) {
  const p = S.pending;
  if (!p) return;
  clearTimeout(p.timer);
  S.pending = null;
  const sent = api(p.url, { method: 'DELETE', keepalive: true });
  if (reloadAfter) sent.then(reload).catch((e) => { S.error = e.message; render(); });
}

function requestDelete(id) {
  commitDelete(); // 앞선 대기건은 먼저 확정한다 — 토스트는 항상 하나만 띄운다
  const t = taskById(Number(id));
  if (!t) return;
  S.pending = { id: t.id, kind: 'task', title: t.title, url: `/api/tasks/${t.id}`, timer: setTimeout(commitDelete, UNDO_MS) };
  render();
}

function requestDeleteNote(id) {
  commitDelete(); // 앞선 대기건 확정 — 토스트는 항상 하나
  const n = noteById(id);
  if (!n) return;
  S.pending = {
    id: n.id, kind: 'note', title: n.title || n.body.slice(0, 30) || '메모',
    url: `/api/notes/${n.id}`, timer: setTimeout(commitDelete, UNDO_MS),
  };
  render();
}

function undoDelete() {
  clearTimeout(S.pending?.timer);
  S.pending = null;
  render();
}

function viewToast() {
  const p = S.pending;
  if (!p) return '';
  return `<div class="toast">
    <span class="t">«${esc(p.title)}» 삭제됨</span>
    <button data-act="undo">되돌리기</button>
  </div>`;
}

// 뷰 전환이 전부 페이지 이동이라, 떠나기 전에 대기 중인 삭제를 흘려보낸다
addEventListener('pagehide', () => commitDelete(false));

// ── 이벤트 ───────────────────────────────────────────
document.addEventListener('click', (e) => {
  // 빠른 작성이 열려 있을 때 바깥을 클릭하면 Keep처럼 저장하고 닫는다 (비어 있으면 그냥 닫힘)
  if (S.quick && !e.target.closest('.note-quick')) saveQuick();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;

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
  if (act === 'resel') {
    e.stopPropagation();
    S.reSel = new Set(lateSelected().map((t) => t.id)); // 현재 선택을 확정한 뒤 토글
    S.reSel.has(Number(id)) ? S.reSel.delete(Number(id)) : S.reSel.add(Number(id));
    return render();
  }
  if (act === 'resched') {
    const to = el.dataset.to;
    const targets = lateSelected();
    if (!targets.length || !confirm(`지연 태스크 ${targets.length}건의 마감일을 ${md(to)}(으)로 옮길까요?`)) return;
    return mutate(async () => {
      await Promise.all(targets.map((t) => send(`/api/tasks/${t.id}`, 'PATCH', { due: to })));
      S.reSel = null;
    });
  }
  if (act === 'fold') {
    const key = seriesKey(taskById(Number(id)));
    S.openSeries.has(key) ? S.openSeries.delete(key) : S.openSeries.add(key);
    return render();
  }
  if (act === 'quick-open') {
    S.quick = true; render();
    return document.getElementById('nq-title')?.focus();
  }
  if (act === 'quick-save') return saveQuick();
  if (act === 'note-open') return openNote(id);
  if (act === 'note-pin') { const n = noteById(id); return mutate(() => send(`/api/notes/${id}`, 'PATCH', { pinned: !n.pinned })); }
  if (act === 'note-color') { S.colorPick = S.colorPick === Number(id) ? null : Number(id); return render(); }
  if (act === 'note-swatch') { S.colorPick = null; return mutate(() => send(`/api/notes/${id}`, 'PATCH', { color: el.dataset.color })); }
  if (act === 'nm-color') { syncNote(); S.noteModal.color = el.dataset.color; return render(); }
  if (act === 'note-arch') return mutate(() => send(`/api/notes/${id}`, 'PATCH', { archived: el.dataset.to === '1' }));
  if (act === 'note-totask') return convertNote(id);
  if (act === 'note-del') return requestDeleteNote(id);
  if (act === 'note-del-modal') { const nid = S.noteModal.id; S.noteModal = null; return requestDeleteNote(nid); }
  if (act === 'note-save') return saveNote();
  if (act === 'note-close' || (act === 'note-close-bd' && e.target === el)) { S.noteModal = null; S.error = ''; return render(); }
  if (act === 'open') return openTask(id);
  if (act === 'new') return openNew(el.dataset.status);
  if (act === 'del') { e.stopPropagation(); return requestDelete(id); }
  if (act === 'del-modal') { const t = S.modal.id; S.modal = null; return requestDelete(t); }
  if (act === 'undo') return undoDelete();
  if (act === 'save') return saveDraft();
  if (act === 'sub-add') return addSubtask();
  if (act === 'child-add') return openChild();
  if (act === 'sub-toggle') { syncDraft(); return mutate(() => send(`/api/subtasks/${el.dataset.sub}`, 'PATCH', { done: el.dataset.done !== '1' })); }
  if (act === 'sub-del') { syncDraft(); return mutate(() => api(`/api/subtasks/${el.dataset.sub}`, { method: 'DELETE' })); }
  if (act === 'close' || (act === 'close-bd' && e.target === el)) { S.modal = null; S.convertNoteId = null; S.error = ''; return render(); }
  if (act === 'close-arch' || (act === 'close-arch-bd' && e.target === el)) { S.archive = null; S.error = ''; return render(); }
  if (act === 'close-set' || (act === 'close-set-bd' && e.target === el)) { S.settings = null; S.error = ''; return render(); }
  if (act === 'set-kind') { S.settings = el.dataset.kind; S.error = ''; return render(); }
  if (act === 'opt-add') return addOption();
  if (act === 'opt-del') {
    const n = Number(el.dataset.used);
    // 업무분류 삭제 시엔 그 분류를 쓰는 메모도 분류 없음이 되므로 함께 안내한다.
    const noteN = S.settings === 'category'
      ? [...S.notes, ...S.archNotes].filter((x) => x.category === el.dataset.name).length : 0;
    const parts = [];
    if (n) parts.push(`이 값을 쓰는 태스크 ${n}건이 다른 항목으로 옮겨집니다`);
    if (noteN) parts.push(`메모 ${noteN}건은 분류 없음이 됩니다`);
    const msg = parts.length
      ? `'${el.dataset.name}'을(를) 삭제하면 ${parts.join(', ')}. 계속할까요?`
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
document.getElementById('f-type')?.addEventListener('change', (e) => { S.fType = e.target.value; render(); });
document.getElementById('f-priority')?.addEventListener('click', () => {
  S.fPriority = S.fPriority === 'all' ? S.priorities[0] : 'all';
  render();
});
document.getElementById('hide-done')?.addEventListener('click', () => { S.hideDone = !S.hideDone; render(); });
document.getElementById('open-archive')?.addEventListener('click', openArchive);
document.getElementById('open-settings')?.addEventListener('click', () => {
  S.modal = S.archive = null; S.error = ''; S.settings = 'type'; render();
});
document.getElementById('new-task')?.addEventListener('click', () => openNew());
document.getElementById('show-arch-notes')?.addEventListener('click', () => { S.showArchivedNotes = !S.showArchivedNotes; render(); });
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
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (S.modal || S.archive || S.settings || S.noteModal || S.quick || S.colorPick)) {
    if (S.quick) return saveQuick(); // 빠른 작성은 닫는 모든 경로가 저장이다 — Keep과 동일 (비어 있으면 그냥 닫힘)
    S.modal = S.archive = S.settings = S.noteModal = null;
    S.colorPick = null; S.convertNoteId = null;
    render();
  }
  if (e.key === 'Enter' && e.target.id === 'd-newsub') { e.preventDefault(); addSubtask(); }
  if (e.key === 'Enter' && e.target.id === 's-new') { e.preventDefault(); addOption(); }
  if (e.key === 'Enter' && e.target.dataset?.act === 'opt-name') e.target.blur();
});

reload().catch((e) => { document.getElementById('viewport').innerHTML = `<div class="card empty">서버 연결 실패: ${esc(e.message)}</div>`; });
