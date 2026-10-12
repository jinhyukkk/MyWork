// MyWork 프론트 — 상태 변경 시 전체 재렌더. 이벤트는 위임으로 처리.
import { checklist, checklistTotals } from './progress.js';
import { groupTasks, nest } from './listgroup.js';
import { parseQuick } from './quickparse.js';

const DAY = 86400000;
// 프로젝트 뷰(/project)는 여기 없다 — 메뉴가 아니라 목록·보드의 ⑂ 배지와 모달에서 들어간다.
const VIEWS = { summary: '요약', list: '목록', board: '보드', calendar: '캘린더', notes: '메모' };
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
const KIND_LABEL = { status: '진행상황', category: '업무분류' };
const META_KEY = { status: 'statuses', category: 'categories' };

// 색상은 전부 설정(options)에서 온다. 글자·배경은 CSS의 .tint가 --c 하나로 만든다 — 색을 두 번 고르지 않도록.
const STATUS_COLOR = (s) => S.opt.status.get(s)?.color ?? '#6B7280';
const CAT_COLOR = (c) => S.opt.category.get(c)?.color ?? '#6B7280';
const isDone = (s) => S.doneSet.has(s);
// «공이 남에게 있는» 상태. 마감이 지나도 지연으로 세지 않는다 — 내 차례가 아니기 때문.
const isWaiting = (s) => S.waitingSet.has(s);
/** 반복 계열 식별자. 회차는 별도 태스크로 복사될 뿐 계열 id가 없어서 주기+제목으로 묶는다. */
const seriesKey = (t) => `${t.repeat_days} ${t.title}`;
// Keep 스타일 파스텔 팔레트. 첫 항목('')은 기본 카드색. 진한 글자가 그대로 읽히는 밝기로 고정한다.
const NOTE_COLORS = ['', '#F8D7D4', '#FBE7CE', '#FBF3C2', '#DEF0D2', '#CDE9E2', '#D4E4F2', '#E3DEF2', '#EFE0DA'];
/**
 * 진행상황·업무분류 팔레트.
 * 칩 글자색은 .tint가 테마에 맞춰 보정하지만 점·막대·범례는 이 값이 그대로 나간다.
 * 그래서 라이트(#FFF)·다크(#16191E) «양쪽»에서 비텍스트 3:1을 넘겨야 한다 — 최저 3.10:1.
 *
 * 색상환을 균등 분할하는 대신 최적화로 풀었다. 색맹은 색상 축 하나가 사라져 명도가 사실상
 * 유일한 단서라, 명도를 맞추면 오히려 구분이 막힌다. 그래서 휘도를 일부러 흩뜨리고
 * (Y 0.135~0.288) 정상·적록청색맹 4가지 시야에서 최소 색차(ΔE_OK)를 최대화했다.
 * 결과: 정상 0.117(이전 0.076) · 색맹 0.069~0.073(이전 0.016~0.020).
 * 제약은 hue 간격 30° 이상, 채도 0.09~0.17(형광색은 오래 보면 피로하다).
 */
const OPT_COLORS = ['#797D84', '#EA6C36', '#8F5D04', '#759D63', '#0C708E', '#608AF8', '#7750C2', '#B75ABB', '#B13E58'];
// 팔레트 밖의 색이 이미 저장돼 있으면(자유 선택 시절의 값) 맨 앞에 끼워 그 색을 잃지 않게 한다
const optPalette = (cur) => (OPT_COLORS.includes(cur) ? OPT_COLORS : [cur, ...OPT_COLORS]);
/**
 * 그 태스크가 「걸려 있는 날」 — 끝난 건은 실제로 끝낸 날, 나머지는 마감일.
 * 표시(dueMeta)와 정렬이 같은 값을 봐야 완료 행이 화면에 보이는 날짜와 다른 자리에 앉지 않는다.
 * done_at이 없는 구버전 완료 행은 예전처럼 마감일이 근사치다.
 */
const endDate = (t) => (isDone(t.status) && t.done_at ? t.done_at.slice(0, 10) : t.due);
/** 기본 정렬 — 걸려 있는 날짜 순. 마감 없음(«언젠가»)은 항상 뒤로 민다. */
const byDue = (a, b) => {
  const x = endDate(a), y = endDate(b);
  if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
  return x.localeCompare(y);
};

// 상하위 관계는 1단계뿐이라 인덱스 없이 훑는다 (개인용 규모 — 수십~수백 건)
const taskById = (id) => S.tasks.find((t) => t.id === id);
const childrenOf = (id) => S.tasks.filter((t) => t.parent_id === id);
// 완료 처리용 상태 — 진행상황 설정 순서를 따른다. 보드 드래그·프로젝트 완료 토글과 같은 값.
const firstDone = () => S.statuses.find(isDone);
const firstOpen = () => S.statuses.find((s) => !isDone(s)) ?? S.statuses[0];
const isCompleting = (t) => S.pending?.kind === 'complete' && S.pending.id === t.id;
/** 행 앞 동그라미. 완료(또는 완료 대기 중)면 채워진다. done 상태가 없으면 그리지 않는다. */
const doneBtn = (t) => {
  if (!firstDone()) return '';
  const on = isDone(t.status) || isCompleting(t);
  const label = on ? '미완료로 되돌리기' : '완료 처리';
  return `<button class="done-btn ${on ? 'on' : ''}" data-act="complete" data-id="${t.id}" title="${label}" aria-label="${label}">✓</button>`;
};
/**
 * 하위 태스크 진행 — 완료 건수 기준. 없으면 total 0 → UI에서 숨김.
 * late는 지연된 하위 건수. 상위는 마감이 멀어 평온해 보여도 하위가 밀려 있으면 배지가 경고색이 된다.
 */
const childProgress = (id) => {
  const kids = childrenOf(id);
  return {
    done: kids.filter((t) => isDone(t.status)).length,
    total: kids.length,
    late: kids.filter((t) => !isDone(t.status) && !isWaiting(t.status) && t.due && t.due < TODAY).length,
  };
};

/**
 * 하위 진행 배지. 목록·보드가 같은 마크업을 쓴다 — 지연 경고 규칙이 한 벌이어야 해서.
 * id를 주면 프로젝트 뷰로 가는 링크가 된다(메뉴에 없는 뷰의 주 입구).
 */
const childBadge = (c, id) => {
  if (!c.total) return '';
  const label = `⑂ ${c.done}/${c.total}${c.late ? ' ⚠' : ''}`;
  const cls = `sb-badge ${c.late ? 'late' : ''}`;
  const tip = `하위 ${c.done}/${c.total} 완료${c.late ? ` · ${c.late}건 지연` : ''}`;
  return id
    ? `<a class="${cls}" href="/project?task=${id}" title="${tip} · 프로젝트 뷰로" onclick="event.stopPropagation()">${label}</a>`
    : `<b class="${cls}" title="${tip}">${label}</b>`;
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseD = (s) => { const p = String(s || '').split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
const shift = (base, n) => iso(new Date(base.getTime() + n * DAY));
const md = (s) => (s ? s.slice(5).replace('-', '/') : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/**
 * 메모 안의 URL을 클릭 가능하게. 업무가 ITSM·메일·문서에서 오는데 붙여넣어도 링크가 아니었다.
 * **반드시 esc() 다음에** 쓴다 — 순서가 바뀌면 URL 안의 따옴표가 href 속성을 탈출한다.
 * esc를 이미 거쳤으므로 매칭 결과에는 따옴표가 남아 있지 않다(&quot;로 바뀐 뒤다).
 */
const linkify = (escaped) => escaped.replace(/https?:\/\/[^\s<]+/g,
  (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

const today = new Date(); today.setHours(0, 0, 0, 0);
const TODAY = iso(today);

// 뷰가 물리 페이지 분리라 메모리 상태는 뷰를 옮길 때마다 초기화된다 — 필터·검색만 localStorage로 살린다.
// 설정에서 지워진 값이 남아 있으면 reload()의 기존 검사가 'all'로 되돌린다.
const FILTER_KEYS = ['query', 'fCategory', 'hideDone'];
const savedFilters = (() => { try { return JSON.parse(localStorage.getItem('mywork.filters')) || {}; } catch { return {}; } })();

const S = {
  tasks: [], categories: [], statuses: [],
  opt: { status: new Map(), category: new Map() }, doneSet: new Set(), waitingSet: new Set(),
  settings: null,
  view: document.body.dataset.view || 'summary',
  // /project?task=27 — 없으면 프로젝트 목록을 보여준다
  projectId: Number(new URLSearchParams(location.search).get('task')) || null,
  quickChild: false,    // 프로젝트 뷰의 하위 태스크 인라인 추가 열림 여부
  query: savedFilters.query ?? '', fCategory: savedFilters.fCategory ?? 'all',
  listGroup: (() => { try { return localStorage.getItem('mywork.list.group') || 'status'; } catch { return 'status'; } })(),
  calMonth: TODAY.slice(0, 7),
  hideDone: savedFilters.hideDone ?? false,
  modal: null, archive: null, newSub: '', dragId: null, dragSub: null, dragOpt: null, dragOptKind: null, error: '',
  sumOpen: loadSumOpen(), // 요약의 접힌 구역 펼침 상태 { someday, cats }
  pending: null, // 되돌리기 대기 중인 삭제·완료 { id, kind, title, url, method, body?, timer }
  openSeries: new Set(), // 이전 회차를 펼쳐 둔 반복 계열
  notes: [], archNotes: [], showArchivedNotes: false,
  noteModal: null,      // 메모 편집 모달
  quick: false,         // 빠른 작성 폼 펼침 여부
  quickTask: null,      // 보드 인라인 빠른 추가가 열린 열(진행상황 이름)
  qbar: false,          // 빠른 입력 바 열림 여부 — 바 DOM은 render() 밖의 qbarRoot에 따로 그린다
  notice: null,         // 빠른 입력으로 방금 추가한 태스크 알림 { id, title, timer }
  colorPick: null,      // 색상 스와치가 열린 메모 id
  optColor: null,       // 색상 스와치가 열린 설정 항목 id
  convertNoteId: null,  // 태스크로 전환 중인 메모 id — 태스크 저장 성공 시 연결한다
  ai: false,            // AI 지시창 열림 여부
  aiBusy: false,
  aiMsgs: loadAiMsgs(), // [{ role, content, actions? }] — 뷰 전환(페이지 이동)에도 대화가 이어지게 세션에 둔다
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
    statuses: meta.statuses.map((o) => o.name),
    opt: {
      status: new Map(meta.statuses.map((o) => [o.name, o])),
      category: new Map(meta.categories.map((o) => [o.name, o])),
    },
    doneSet: new Set(meta.statuses.filter((o) => o.done).map((o) => o.name)),
    waitingSet: new Set(meta.statuses.filter((o) => o.waiting).map((o) => o.name)),
    meta,
  });
  // 설정에서 이름을 바꾸거나 지운 값이 필터에 남아 있으면 아무것도 안 보이므로 푼다
  if (!S.categories.includes(S.fCategory)) S.fCategory = 'all';
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
    (!q || t.title.toLowerCase().includes(q) || (t.memo || '').toLowerCase().includes(q) ||
      (t.subtasks ?? []).some((s) => s.title.toLowerCase().includes(q)))); // 세부 항목을 체크리스트에 적어도 검색에 걸린다
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
// 대기 중은 마감이 지나도 «내가 늦은 것»이 아니라 빠진다 — 일괄 재조정 대상도 아니다.
const lateOpen = () => filtered().filter((t) => !isDone(t.status) && !isWaiting(t.status) && t.due && t.due < TODAY);

function dueMeta(t) {
  // 마감 없음은 «언젠가» — 지연도 D-day도 계산할 수 없다. diff는 정렬에 쓰이지 않으므로 null.
  if (!t.due && !(isDone(t.status) && t.done_at)) {
    return { color: 'var(--text-4)', text: '마감 없음', short: '—', diff: null };
  }
  const diff = Math.round((parseD(t.due ?? TODAY) - parseD(TODAY)) / DAY);
  const short = md(t.due ?? '');
  // 완료 건은 마감일 대신 실제로 끝낸 날을 보여준다 — 지금까지는 마감일에 «완료»만 붙여 놓아 사실과 달랐다
  if (isDone(t.status)) {
    const at = md(endDate(t));
    return { color: 'var(--text-4)', text: `${at} 완료`, short: at, diff };
  }
  // 대기 중은 마감이 지나도 «지연»이라 하지 않는다 — 내 차례가 아닌 걸 붉게 칠하면 경고가 무뎌진다
  if (isWaiting(t.status)) {
    return { color: 'var(--text-4)', text: `${short} 대기`, short: `${short} ⏸`, diff };
  }
  if (diff < 0) return { color: 'var(--danger)', text: `${short} (${-diff}일 지연)`, short: `${short} ⚠`, diff };
  if (diff === 0) return { color: 'var(--danger)', text: `${short} (오늘 마감)`, short: `${short} 오늘`, diff };
  if (diff <= 3) return { color: 'var(--warn)', text: `${short} (D-${diff})`, short: `${short} D-${diff}`, diff };
  return { color: 'var(--text-4)', text: `${short} (D-${diff})`, short, diff };
}

// ── 뷰 ───────────────────────────────────────────────
function viewSummary(list) {
  const open = list.filter((t) => !isDone(t.status));
  // today_brief(MCP)와 같은 버킷 — 지연 / 오늘 마감 / 7일 내 예정. 각 구간 안에서는 마감일 순.
  // 대기 중(공이 남에게)은 날짜 버킷에서 통째로 빠진다 — 마감이 지나도 내 차례가 아니다.
  const waiting = open.filter((t) => isWaiting(t.status)).sort(byDue);
  const mine = open.filter((t) => !isWaiting(t.status));
  const late = mine.filter((t) => t.due && t.due < TODAY).sort(byDue);
  const dueToday = mine.filter((t) => t.due === TODAY).sort(byDue);
  const week = mine.filter((t) => t.due && t.due > TODAY && t.due <= shift(today, 7)).sort(byDue);
  // 마감 없음 — 어느 날짜 버킷에도 속하지 않는다. 지연으로 세지 않는 게 이 축의 존재 이유다.
  const someday = mine.filter((t) => !t.due);
  const laterCnt = mine.length - late.length - dueToday.length - week.length - someday.length;
  const items = checklistTotals(list);

  // 통계 카드 4개를 한 문장으로 — 0인 항목은 말하지 않는다(미완료는 항상)
  const facts = [late.length && `지연 ${late.length}`, dueToday.length && `오늘 ${dueToday.length}`, `미완료 ${open.length}`]
    .filter(Boolean).join(' · ');
  const dateLine = `${today.getMonth() + 1}월 ${today.getDate()}일 ${'일월화수목금토'[today.getDay()]}요일`;

  const row = (t) => {
    const dm = dueMeta(t);
    return `<div class="up-row ${isCompleting(t) ? 'completing' : ''}" data-act="open" data-id="${t.id}">
      ${doneBtn(t)}
      <span class="t">${esc(t.title)}</span>
      <span class="chip tint" style="--c:${CAT_COLOR(t.category)}">${esc(t.category)}</span>
      <span class="d" style="color:${dm.color}">${dm.text}</span></div>`;
  };
  const group = (label, cls, tasks, extra = '') => (tasks.length ? `<section class="card grp">
      <div class="grp-h ${cls}"><b>${label}</b><span class="n">${tasks.length}</span>${extra}</div>
      ${tasks.map(row).join('')}</section>` : '');

  // 오늘·금요일은 자주 쓰는 두 값의 지름길이고, 그 밖의 날짜는 date 입력으로 직접 고른다(고르는 순간 실행).
  const fri = shift(today, (5 - today.getDay() + 7) % 7); // 다가오는 금요일 (오늘이 금요일이면 오늘)
  const resched = `<details class="resched"><summary class="btn-sm">모두 미루기 ▾</summary>
    <div class="resched-menu card">
      <button class="btn-sm" data-act="resched" data-to="${TODAY}">오늘로</button>
      ${fri === TODAY ? '' : `<button class="btn-sm" data-act="resched" data-to="${fri}">${md(fri)} 금요일로</button>`}
      <input type="date" id="resched-date" class="resched-date" min="${TODAY}" title="다른 날짜로 옮깁니다">
    </div></details>`;

  // 스택바는 진행상황 설정을 그대로 따라간다 — 상태를 추가하면 막대에도 바로 반영된다
  const catStats = S.categories.map((c) => {
    const inCat = list.filter((t) => t.category === c);
    const n = inCat.length || 1;
    return {
      label: c, count: inCat.length, d: inCat.filter((t) => isDone(t.status)).length,
      segs: S.statuses.map((s) => ({ color: STATUS_COLOR(s), w: (inCat.filter((t) => t.status === s).length / n) * 100 })),
    };
  }).filter((c) => c.count > 0);

  // 언젠가·분류 현황은 «오늘 할 일»이 아니라 접어 둔다. 펼침 상태는 새로고침해도 유지.
  const fold = (key, label, n, body) => `<details class="card grp fold" data-fold="${key}" ${S.sumOpen[key] ? 'open' : ''}>
    <summary class="grp-h"><b>${label}</b>${n === null ? '' : `<span class="n">${n}</span>`}</summary>${body}</details>`;

  return `<div class="sum">
    <div class="today-h"><h1>오늘</h1><p>${dateLine} · ${facts}</p></div>
    ${open.length ? '' : '<div class="card empty">오늘 할 일이 없습니다.</div>'}
    ${group('지연', 'late', late, resched)}
    ${group('오늘 마감', 'today', dueToday)}
    ${group('이번 주', '', week)}
    ${laterCnt > 0 ? `<div class="ck-hint" style="padding:0 6px">7일 이후 마감 미완료 ${laterCnt}건</div>` : ''}
    ${group('대기 · 남의 차례', '', waiting)}
    ${someday.length ? fold('someday', '언젠가 · 마감 없음', someday.length, someday.map(row).join('')) : ''}
    ${catStats.length ? fold('cats', '분류별 현황', null, `<div class="cat-bars">${catStats.map((c) => `<div class="bar-row">
        <div class="top"><b>${esc(c.label)}</b><span>${c.count}건 · 완료 ${c.d}</span></div>
        <div class="bar">${c.segs.map((s) => `<div style="width:${s.w}%;background:${s.color}"></div>`).join('')}</div>
      </div>`).join('')}
      <div class="legend">
        ${S.statuses.map((s) => `<span><i style="background:${STATUS_COLOR(s)}"></i>${esc(s)}</span>`).join('')}
        ${items.total ? `<span style="margin-left:auto">체크리스트 ${items.done}/${items.total}</span>` : ''}
      </div></div>`) : ''}
  </div>`;
}

// 목록은 표가 아니라 묶음 리스트다. 열 클릭 정렬 대신 묶는 기준을 고른다 — 정렬은 언제나 마감일 순.
// 우선순위·업무유형·시작일 축은 없앴다(README «없앤 축» 참고).
const LIST_GROUPS = [['status', '상태별'], ['category', '분류별'], ['due', '마감순']];

function viewList(list) {
  const sorted = list.slice().sort(byDue);

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

  const mode = S.listGroup;
  const groups = groupTasks(sorted.filter((t) => !folded.has(t.id)), mode,
    { statuses: S.statuses, categories: S.categories, isDone });

  const row = ({ t, sub }) => {
    const dm = dueMeta(t), p = checklist(t), c = childProgress(t.id);
    // 상위가 다른 그룹에 있으면 들여쓸 수 없으니 메모 줄에 상위 제목을 단다
    const parent = t.parent_id && !sub ? taskById(t.parent_id) : null;
    const meta = [parent && `↳ ${esc(parent.title)}`, t.memo && linkify(esc(t.memo))].filter(Boolean).join(' · ');
    // 그룹 기준과 같은 축의 알약은 중복이라 뺀다
    const pills = [
      mode !== 'category' && `<span class="chip tint" style="--c:${CAT_COLOR(t.category)}">${esc(t.category)}</span>`,
      mode !== 'status' && `<span class="chip tint" style="--c:${STATUS_COLOR(t.status)}">${esc(t.status)}</span>`,
    ].filter(Boolean).join('');
    return `<div class="up-row lrow ${sub ? 'sub' : ''} ${isDone(t.status) || isCompleting(t) ? 'completing' : ''}" data-act="open" data-id="${t.id}">
      ${doneBtn(t)}
      <div class="main">
        <span class="t">${esc(t.title)}${t.repeat_days ? ` <span class="rp" title="${repeatLabel(t.repeat_days)} 반복">↻</span>` : ''}</span>
        ${p.total || c.total || folds.has(t.id) || meta ? `<span class="td">${childBadge(c, t.id)}${p.total ? `<b class="ck-badge">☑ ${p.done}/${p.total}</b>` : ''}${folds.has(t.id) ? `<b class="fold-badge" data-act="fold" data-id="${t.id}">${S.openSeries.has(seriesKey(t)) ? '− 이전 회차 접기' : `＋ 이전 회차 ${folds.get(t.id)}건`}</b>` : ''}${meta}</span>` : ''}
      </div>
      ${pills}
      <span class="d" style="color:${dm.color}">${dm.text}</span>
      <button class="x-btn" data-act="del" data-id="${t.id}" title="삭제" aria-label="삭제">×</button>
    </div>`;
  };

  const head = (g) => {
    if (mode === 'due') return '';
    const color = mode === 'status' ? STATUS_COLOR(g.key) : CAT_COLOR(g.key);
    return `<div class="grp-h"><i class="gdot" style="background:${color}"></i><b>${esc(g.key)}</b><span class="n">${g.items.length}</span></div>`;
  };

  return `<div class="lst">
    <div class="seg" role="group" aria-label="묶는 기준">${LIST_GROUPS.map(([k, l]) =>
      `<button aria-pressed="${mode === k}" class="${mode === k ? 'on' : ''}" data-act="list-group" data-mode="${k}">${l}</button>`).join('')}</div>
    ${groups.map((g) => `<section class="card grp">${head(g)}${nest(g.items).map(row).join('')}</section>`).join('')
      || '<div class="card empty">조건에 맞는 태스크가 없습니다.</div>'}
  </div>`;
}

// 열 순서 = 진행상황 설정 순서. 열 머리를 끌어 바꾸면 설정에도 그대로 반영된다.
/** 보드 카드 메타 줄의 마감 표기 — 좁은 줄이라 날짜보다 «얼마나 늦었나»를 먼저 말한다. 마감 없음은 생략. */
function boardDue(t, dm) {
  if (dm.diff === null) return null;
  if (isDone(t.status)) return { text: dm.short, color: 'var(--text-4)' };
  if (isWaiting(t.status)) return { text: dm.text, color: 'var(--text-4)' }; // «MM/DD 대기»
  if (dm.diff < 0) return { text: `${-dm.diff}일 지연`, color: 'var(--danger)' };
  if (dm.diff === 0) return { text: '오늘', color: 'var(--danger)' };
  return { text: dm.short, color: dm.color };
}

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
            <span class="cat tint" style="--c:${CAT_COLOR(t.category)}">${esc(t.category)}</span>
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

function viewCalendar(list) {
  const [y, m] = S.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const gridStart = new Date(first.getTime() - first.getDay() * DAY);
  // 회색 배경 위 요일 글자: color-mix로 텍스트색 쪽으로 20% 당겨 4.5:1 확보 (라이트는 어둡게, 다크는 밝게)
  const week = ['일', '월', '화', '수', '목', '금', '토']
    .map((w, i) => `<div style="color:${i === 0 ? 'color-mix(in oklab, var(--danger) 80%, var(--text))' : i === 6 ? 'color-mix(in oklab, var(--accent) 80%, var(--text))' : 'var(--text-3)'}">${w}</div>`).join('');

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getTime() + i * DAY);
    const key = iso(d), inMonth = d.getMonth() === m - 1, isToday = key === TODAY;
    const evts = list.filter((t) => t.due === key);
    cells.push({
      html: `<div class="day ${inMonth ? '' : 'out'}">
        <span class="n ${isToday ? 'today' : ''}" style="${isToday ? '' : `color:${d.getDay() === 0 ? 'var(--danger)' : d.getDay() === 6 ? 'var(--accent)' : 'var(--text-2)'}`}">${d.getDate()}</span>
        ${evts.map((t) => {
          // 지연 건은 분류색 대신 경고색 — 캘린더에서도 «늦은 것»이 먼저 보여야 한다
          const late = !isDone(t.status) && !isWaiting(t.status) && t.due < TODAY;
          return `<div class="ev tint ${late ? 'late' : ''}" data-act="open" data-id="${t.id}" style="--c:${CAT_COLOR(t.category)};text-decoration:${isDone(t.status) ? 'line-through' : 'none'}">${esc(t.title)}</div>`;
        }).join('')}
      </div>`,
      empty: evts.length === 0,
    });
  }
  if (cells.slice(35).every((c) => c.empty)) cells.length = 35;

  return `<div class="cal">
    <div class="cal-head">
      <button class="icon-btn" data-act="month" data-n="-1" aria-label="이전 달">‹</button>
      <div class="m">${y}년 ${m}월</div>
      <button class="icon-btn" data-act="month" data-n="1" aria-label="다음 달">›</button>
      <button class="icon-btn" data-act="month" data-n="0">오늘</button>
      <div style="flex:1"></div>
      <div class="hint">마감일 기준 · 태스크를 클릭하면 수정</div>
    </div>
    <div class="week">${week}</div>
    <div class="days">${cells.map((c) => c.html).join('')}</div>
  </div>`;
}

// ── 프로젝트 뷰 (구 타임라인) ────────────────────────
// 「하위 태스크를 가진 태스크 = 프로젝트」다. 별도 플래그를 두지 않는다 —
// 하위가 붙는 순간 프로젝트가 되고, 마지막 하위를 떼면 그냥 태스크로 돌아간다.
// 메뉴에서는 뺐다. 전 태스크를 늘어놓은 간트는 개인 업무에 과잉이었고,
// 같은 렌더러가 「한 프로젝트의 하위들」을 볼 때는 실제로 쓸모가 있다.

/** 하위를 가진 태스크들. 프로젝트 목록이자 «프로젝트인가»의 판정 기준. */
const projects = () => S.tasks.filter((t) => !t.parent_id && childrenOf(t.id).length);

// 필터가 걸린 목록을 받지 않는다 — 분류 필터나 «완료 숨김» 때문에
// 프로젝트 안의 하위가 사라지면 일정이 거짓말을 한다.
function viewProject() {
  const parent = S.projectId ? taskById(S.projectId) : null;
  if (!parent) return viewProjectList();
  if (parent.parent_id) return '<div class="card empty">하위 태스크는 프로젝트가 될 수 없습니다 (1단계까지).</div>';

  const kids = childrenOf(parent.id);
  if (!kids.length) {
    return `${projectHead(parent)}
      <div class="card empty">하위 태스크가 없습니다. 아래에서 추가하면 여기에 일정이 그려집니다.</div>
      ${projectAdd(parent)}`;
  }

  // 마감 없는 하위는 막대를 그릴 수 없다 — 축 계산에 넣으면 NaN이 전파된다.
  // 빼는 대신 아래 «일정 미정» 구역으로 내려보내 날짜를 채울 자리를 준다.
  const dated = kids.filter((t) => t.due);
  const undated = kids.filter((t) => !t.due);

  let gantt = '';
  if (dated.length) {
    // 상위 마감도 축에 포함시킨다 — 하위가 상위 마감을 넘겼는지 한눈에 보여야 한다
    const stamps = [
      ...dated.map((t) => parseD(t.start).getTime()),
      ...dated.map((t) => parseD(t.due).getTime()),
      ...(parent.due ? [parseD(parent.due).getTime()] : []),
    ];
    const min = new Date(Math.min(...stamps)), max = new Date(Math.max(...stamps));
    const gs = new Date(min.getFullYear(), min.getMonth(), 1);
    const ge = new Date(max.getFullYear(), max.getMonth() + 1, 0);
    const total = Math.round((ge - gs) / DAY) + 1;
    const pctOf = (d) => ((parseD(d) - gs) / DAY / total) * 100;

    const months = [];
    for (let cur = new Date(gs); cur <= ge; cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)) {
      const dim = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
      months.push(`<div class="mo" style="width:${(dim / total) * 100}%">${cur.getMonth() + 1}월 ${cur.getFullYear()}</div>`);
    }
    const todayLeft = pctOf(TODAY);
    const dueLeft = parent.due ? pctOf(parent.due) : null;

    const rows = dated.slice().sort((a, b) => a.start.localeCompare(b.start)).map((t) => {
      const left = pctOf(t.start);
      const width = Math.max(0.8, ((parseD(t.due) - parseD(t.start)) / DAY + 1) / total * 100);
      const outside = left + width > 62;
      const range = `${md(t.start)} – ${md(t.due)}`;
      // 상위 마감을 넘긴 하위는 경고색 — 상위는 평온해 보여도 안에서 밀려 있을 수 있다
      const over = parent.due && !isDone(t.status) && t.due > parent.due;
      return `<div class="g-row">
        <div class="fix">
          <input type="checkbox" data-act="proj-done" data-id="${t.id}" ${isDone(t.status) ? 'checked' : ''}
                 title="완료 토글">
          <span class="pj-t ${isDone(t.status) ? 'done' : ''}" data-act="open" data-id="${t.id}">${esc(t.title)}</span>
        </div>
        <div class="g-track">
          <div class="today" style="left:${todayLeft >= 0 && todayLeft <= 100 ? todayLeft : -10}%"></div>
          ${dueLeft !== null && dueLeft >= 0 && dueLeft <= 100
            ? `<div class="pj-due" style="left:${dueLeft}%" title="상위 마감 ${md(parent.due)}"></div>` : ''}
          <div class="bar2 ${over ? 'over' : ''}" data-act="open" data-id="${t.id}" title="${range}"
               style="left:${left}%;width:${width}%;${isDone(t.status) ? 'background:var(--done-bar)'
                 : over ? '' : `background:${CAT_COLOR(t.category)}`}"></div>
          <div class="lab" style="left:${outside ? 'auto' : `${left + width}%`};right:${outside ? `${100 - left}%` : '0'};justify-content:${outside ? 'flex-end' : 'flex-start'}">
            <span>${range}${over ? ' ⚠' : ''}</span>
          </div>
        </div>
        <div class="pj-dates">
          <input type="date" value="${t.start}" data-act="proj-start" data-id="${t.id}" title="시작일">
          <input type="date" value="${t.due}" data-act="proj-due" data-id="${t.id}" title="마감일">
        </div>
      </div>`;
    }).join('');

    gantt = `<div class="card" style="overflow:hidden">
      <div class="gantt-cols"><div class="fix">하위 태스크</div><div style="flex:1;display:flex">${months.join('')}</div><div class="pj-dates">시작 · 마감</div></div>
      ${rows}
    </div>`;
  }

  const pending = undated.length ? `<div class="card" style="padding:14px 18px">
    <div class="card-t" style="margin-bottom:4px">일정 미정 ${undated.length}</div>
    <div class="ck-hint" style="margin-bottom:10px">마감일을 채우면 위 간트로 올라갑니다.</div>
    ${undated.map((t) => `<div class="g-row">
      <div class="fix">
        <input type="checkbox" data-act="proj-done" data-id="${t.id}" ${isDone(t.status) ? 'checked' : ''} title="완료 토글">
        <span class="pj-t ${isDone(t.status) ? 'done' : ''}" data-act="open" data-id="${t.id}">${esc(t.title)}</span>
      </div>
      <div style="flex:1"></div>
      <div class="pj-dates">
        <input type="date" value="${t.start}" data-act="proj-start" data-id="${t.id}" title="시작일">
        <input type="date" value="" data-act="proj-due" data-id="${t.id}" title="마감일">
      </div>
    </div>`).join('')}
  </div>` : '';

  return `<div class="stack">${projectHead(parent)}${gantt}${pending}${projectAdd(parent)}</div>`;
}

/** 프로젝트 머리 — 상위 태스크 자체의 정보. 클릭하면 상위 모달이 열린다. */
function projectHead(p) {
  const dm = dueMeta(p), c = childProgress(p.id);
  return `<div class="card pj-head">
    <a class="pj-back" href="/project">‹ 프로젝트</a>
    <span class="dot" style="background:${CAT_COLOR(p.category)}"></span>
    <b data-act="open" data-id="${p.id}" style="cursor:pointer">${esc(p.title)}</b>
    <span class="chip tint" style="--c:${STATUS_COLOR(p.status)}">${esc(p.status)}</span>
    <span class="chip tint" style="--c:${CAT_COLOR(p.category)}">${esc(p.category)}</span>
    ${childBadge(c)}
    <div style="flex:1"></div>
    <span style="color:${dm.color};font-size:12px;font-weight:600">${dm.text}</span>
  </div>`;
}

/** 제목만 받는 인라인 추가. 보드 빠른 추가와 같은 규칙 — 닫는 모든 경로가 저장이다. */
function projectAdd(p) {
  return S.quickChild
    ? `<div class="card" style="padding:10px 14px"><input id="pc-title" placeholder="하위 태스크 제목 입력 후 Enter · 연속 추가 가능"></div>`
    : `<div><button class="btn-sm" data-act="pc-open">＋ 하위 태스크 추가</button></div>`;
}

/** 쿼리 없이 들어왔을 때의 목록. 메뉴에 없는 뷰라 이 화면이 입구 역할을 한다. */
function viewProjectList() {
  const rows = projects().map((p) => {
    const c = childProgress(p.id), dm = dueMeta(p);
    return `<a class="pj-card" href="/project?task=${p.id}">
      <span class="dot" style="background:${CAT_COLOR(p.category)}"></span>
      <b>${esc(p.title)}</b>
      <span class="chip tint" style="--c:${CAT_COLOR(p.category)}">${esc(p.category)}</span>
      ${childBadge(c)}
      <div style="flex:1"></div>
      <span style="color:${dm.color};font-size:12px">${dm.text}</span>
    </a>`;
  }).join('');
  return `<div class="stack"><div class="card" style="padding:18px">
    <div class="card-t" style="margin-bottom:4px">프로젝트</div>
    <div class="ck-hint" style="margin-bottom:12px">하위 태스크를 가진 태스크가 프로젝트입니다. 태스크 모달의 «하위 태스크»에서 붙이면 여기에 나타납니다.</div>
    ${rows || '<div class="empty">아직 프로젝트가 없습니다.</div>'}
  </div></div>`;
}

// ── 메모 뷰 (Keep 스타일) ────────────────────────────
function noteCard(n) {
  const task = n.task_id ? taskById(n.task_id) : null;
  return `<div class="note-card ${n.color ? 'tinted' : ''}" data-act="note-open" data-id="${n.id}" style="${n.color ? `background:${esc(n.color)}` : ''}">
    ${n.title ? `<div class="nt">${esc(n.title)}</div>` : ''}
    ${n.body ? `<div class="nb">${esc(n.body)}</div>` : ''}
    ${n.category || task ? `<div class="nfoot">
      ${n.category ? `<span class="chip tint" style="--c:${CAT_COLOR(n.category)}">${esc(n.category)}</span>` : ''}
      ${task ? `<span class="chip note-task" data-act="open" data-id="${task.id}" title="연결된 태스크 열기">✓ ${esc(task.title)}</span>` : ''}
    </div>` : ''}
    ${S.colorPick === n.id ? `<div class="swatches">${NOTE_COLORS.map((c) =>
      `<button data-act="note-swatch" data-id="${n.id}" data-color="${c}" class="${(n.color || '') === c ? 'on' : ''}"
        style="background:${c || 'var(--surface)'}" title="${c || '기본'}"></button>`).join('')}</div>` : ''}
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
  // 완료 건은 후보에서 뺀다 — 반복 회차가 같은 제목으로 쌓여 구분이 안 되고, 끝난 일 밑에 새 일을 붙일 이유도 없다.
  // 단 이미 연결된 상위는 완료여도 남긴다 — 빼면 저장할 때 연결이 조용히 끊긴다(보관과 같은 이유).
  const cand = S.tasks.filter((t) => t.id !== m.id && t.parent_id == null && (!isDone(t.status) || t.id === m.parent_id));
  // 보관된 태스크가 상위인 경우 목록에 없다 — 선택지를 만들어 두지 않으면 저장할 때 연결이 조용히 끊긴다
  const keep = m.parent_id && !cand.some((t) => t.id === m.parent_id)
    ? `<option value="${m.parent_id}" selected>#${m.parent_id} (보관됨)</option>` : '';
  return `<div class="field"><label>상위 태스크</label>
    <select id="d-parent">
      <option value="">없음</option>${keep}
      ${cand.map((t) => `<option value="${t.id}" ${t.id === m.parent_id ? 'selected' : ''}>${esc(t.title)} · ${t.due ? md(t.due) : '마감 없음'}</option>`).join('')}
    </select></div>`;
}

/** 하위 태스크 목록. 하위는 다시 하위를 못 가지므로 자신이 하위면 아예 표시하지 않는다. */
function viewChildren(m) {
  if (!m.id || m.parent_id) return '';
  const kids = childrenOf(m.id);
  const p = childProgress(m.id);
  return `<div class="field">
    <label>하위 태스크 ${p.total ? `<span class="ck-n">${p.done}/${p.total}</span>` : ''}
      ${p.total ? '<button class="btn-sm" data-act="proj-open" style="float:right">프로젝트 뷰로 열기</button>' : ''}</label>
    <div class="ck-list">${kids.map((t) => {
      const dm = dueMeta(t);
      return `<div class="ck-item" data-act="open" data-id="${t.id}" style="cursor:pointer">
        <span class="ck-t ${isDone(t.status) ? 'done' : ''}">${esc(t.title)}</span>
        <span class="chip tint" style="--c:${STATUS_COLOR(t.status)}">${esc(t.status)}</span>
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
        <button class="opt-color" data-act="opt-color" data-id="${o.id}" style="background:${o.color}" title="색상 선택"></button>
        <input class="opt-name" value="${esc(o.name)}" data-act="opt-name" data-id="${o.id}">
        ${kind === 'status' ? `<label class="opt-done" title="이 상태면 '끝난 것'으로 셉니다">
          <input type="checkbox" ${o.done ? 'checked' : ''} data-act="opt-done" data-id="${o.id}"> 완료
        </label>
        <label class="opt-done" title="공이 남에게 있는 상태 — 마감이 지나도 지연으로 세지 않습니다">
          <input type="checkbox" ${o.waiting ? 'checked' : ''} data-act="opt-waiting" data-id="${o.id}"> 대기
        </label>` : `<span class="ck-n">${used(o.name)}건</span>`}
        <button class="x-btn" data-act="opt-del" data-id="${o.id}" data-name="${esc(o.name)}" data-used="${used(o.name)}">×</button>
      </div>
      ${S.optColor === o.id ? `<div class="swatches opt-swatches">${optPalette(o.color).map((c) =>
        `<button data-act="opt-swatch" data-id="${o.id}" data-color="${c}" class="${o.color === c ? 'on' : ''}"
          style="background:${c}" title="${c}"></button>`).join('')}</div>` : ''}`).join('')}</div>
      <div class="ck-add">
        <input id="s-new" placeholder="${KIND_LABEL[kind]} 추가 후 Enter">
        <button class="btn-sm" data-act="opt-add">추가</button>
      </div>
      <div class="ck-hint">${kind === 'status'
        ? '<b>완료</b>로 표시한 상태는 보관·반복 생성·완료 숨김에서 «끝남»으로 취급됩니다. 최소 하나는 있어야 합니다. <b>대기</b>는 «공이 남에게 있음»이라 마감이 지나도 지연으로 세지 않습니다(없어도 됩니다). 순서는 보드 열 순서이며, 보드에서 열을 끌어도 바뀝니다.'
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
          <span class="ck-n">${t.due ?? '마감 없음'}</span>
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
          <div class="swatches" style="padding-top:10px">${NOTE_COLORS.map((c) =>
            `<button data-act="nm-color" data-color="${c}" class="${(n.color || '') === c ? 'on' : ''}" style="background:${c || 'var(--surface)'}" title="${c || '기본'}"></button>`).join('')}</div></div>
      </div>
      <div class="field"><label>연결 태스크</label>
        <select id="n-task"><option value="">없음</option>
          ${n.task_id && !taskById(n.task_id) ? `<option value="${n.task_id}" selected>#${n.task_id} (보관됨)</option>` : ''}
          ${S.tasks.map((t) => `<option value="${t.id}" ${t.id === n.task_id ? 'selected' : ''}>${esc(t.title)} · ${t.due ? md(t.due) : '마감 없음'}</option>`).join('')}
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
  if (S.ai) return viewAi();
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
        <div class="field"><label>진행상황</label><select id="d-status">${opts(S.statuses, m.status)}</select></div>
        <div class="field"><label>업무분류</label><select id="d-category">${opts(S.categories, m.category)}</select></div>
      </div>
      <div class="field"><label>마감일 <span style="font-weight:400;color:var(--text-4)">· 비우면 «언젠가»</span></label>
        <input type="date" id="d-due" value="${m.due ?? ''}"></div>
      ${viewParent(m)}
      <div class="field">
        <label>반복</label>
        <select id="d-repeat">${repeatOptions(m.repeat_days ?? 0)}</select>
        ${m.repeat_days ? `<div class="ck-hint">완료로 바꾸면 마감일 +${m.repeat_days}일로 다음 회차가 자동 생성됩니다.</div>` : ''}
      </div>
      <div class="field"><label>설명 · 메모</label>
        <div class="ck-add">
          <input id="d-log" placeholder="경과 한 줄 — 날짜가 붙어 맨 위에 쌓입니다">
          <button class="btn-sm" data-act="log-add">경과 추가</button>
        </div>
        <textarea id="d-memo" rows="5" placeholder="세부 내용, 링크 등">${esc(m.memo)}</textarea></div>
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
  localStorage.setItem('mywork.filters', JSON.stringify(Object.fromEntries(FILTER_KEYS.map((k) => [k, S[k]]))));
  const all = filtered();
  // '완료 숨김'은 작업용 뷰에만 적용한다. 요약은 완료 건수·진척률을 보여야 하므로 제외.
  const visible = S.hideDone ? all.filter((t) => !isDone(t.status)) : all;
  const list = S.view === 'summary' ? all : visible;

  document.getElementById('nav').innerHTML = Object.entries(VIEWS).map(([k, label]) =>
    `<a class="nav-btn ${S.view === k ? 'on' : ''}" href="/${k}">
      <span class="ico">${ICON[k]}</span><span class="label">${label}</span>
      <span class="badge">${k === 'summary' ? '' : k === 'notes' ? S.notes.length : visible.length}</span></a>`).join('');

  const catCount = {};
  for (const t of S.tasks) catCount[t.category] = (catCount[t.category] || 0) + 1;
  document.getElementById('sidebar-cats').innerHTML = S.categories.map((c) =>
    `<button class="cat-btn ${S.fCategory === c ? 'on' : ''}" data-act="cat" data-cat="${esc(c)}">
      <span class="cdot" style="background:${CAT_COLOR(c)}"></span>
      <span class="name">${esc(c)}</span><span class="n">${catCount[c] || 0}</span></button>`).join('');

  // 프로젝트 뷰는 메뉴에 없으므로 VIEWS에서 이름이 나오지 않는다
  document.getElementById('view-title').textContent =
    S.view === 'project' ? '프로젝트' : VIEWS[S.view];
  const fc = document.getElementById('f-category');
  fc.innerHTML = `<option value="all">분류: 전체</option>${S.categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
  fc.value = S.fCategory;
  document.getElementById('hide-done')?.classList.toggle('on', S.hideDone);
  document.getElementById('show-arch-notes')?.classList.toggle('on', S.showArchivedNotes);

  const renderers = { summary: viewSummary, list: viewList, board: viewBoard, calendar: viewCalendar, project: viewProject, notes: viewNotes };
  document.getElementById('viewport').innerHTML = renderers[S.view](S.view === 'notes' ? filteredNotes() : list);
  document.getElementById('modal-root').innerHTML = viewModal() + viewNoteModal() + viewToast();
  // 모달이 떠 있으면 뒤쪽을 inert로 — Tab이 배경으로 새어 나가지 않는다.
  // <dialog>+showModal()이면 공짜지만, 매 렌더마다 innerHTML을 갈아끼우는 구조라
  // 다시 showModal()을 불러야 하고 그때 포커스가 강제로 첫 요소로 튄다(아래 규칙과 충돌).
  // 빠른 작성·인라인 추가는 backdrop이 없어 그대로 남는다 — 그쪽은 배경에 포커스가 있어야 한다.
  document.querySelector('.app').inert = !!document.querySelector('#modal-root .backdrop');
  // 지정된 경우에만 포커스 — 체크리스트 조작 중 제목으로 커서가 튀지 않게
  if (S.focusId) { document.getElementById(S.focusId)?.focus(); S.focusId = null; }
}

// ── AI 지시창 ────────────────────────────────────────
function loadSumOpen() {
  try { return JSON.parse(localStorage.getItem('mywork.summary.open')) ?? {}; } catch { return {}; }
}

function loadAiMsgs() {
  try { return JSON.parse(sessionStorage.getItem('mywork.ai')) ?? []; } catch { return []; }
}
function saveAiMsgs() {
  try { sessionStorage.setItem('mywork.ai', JSON.stringify(S.aiMsgs.slice(-40))); } catch { /* 저장 실패는 무시 — 대화만 안 이어질 뿐 */ }
}
// 도구 이름 → 사람이 읽는 라벨. 조회 도구는 화면에 남길 가치가 없어 뺀다.
const AI_ACT = {
  create_task: '태스크 생성', update_task: '태스크 수정', delete_task: '태스크 삭제',
  add_subtask: '체크리스트 추가', update_subtask: '체크리스트 수정', delete_subtask: '체크리스트 삭제',
  archive_tasks: '보관', restore_task: '복원',
  create_note: '메모 생성', update_note: '메모 수정', delete_note: '메모 삭제',
};

function viewAi() {
  const bubble = (m, mi) => {
    const acts = (m.actions ?? []).filter((a) => AI_ACT[a.tool]);
    const wait = (m.confirm ?? []).filter((c) => c.state === 'wait').length;
    const confirm = m.confirm?.length ? `<div class="ai-confirm">${m.confirm.map((c, ci) => `<div class="ai-c-row">
        <span class="ai-c-t">${c.kind} · «${esc(c.title)}»</span>
        ${c.state === 'wait'
          ? `<button class="btn-del" data-act="ai-del" data-mi="${mi}" data-ci="${ci}">삭제</button>
             <button class="btn-ghost" data-act="ai-keep" data-mi="${mi}" data-ci="${ci}">취소</button>`
          : `<span class="ai-c-st ${c.state}">${AI_DEL_STATE[c.state]}${c.error ? ` — ${esc(c.error)}` : ''}</span>`}
      </div>`).join('')}
      ${wait > 1 ? `<button class="btn-del" data-act="ai-del" data-mi="${mi}" data-ci="all">${wait}건 모두 삭제</button>` : ''}</div>` : '';
    return `<div class="ai-msg ${m.role}${m.error ? ' err' : ''}">${esc(m.content)}${acts.length ? `<div class="ai-acts">${acts.map((a) =>
        `<span class="chip">${a.error ? '✕' : '✓'} ${AI_ACT[a.tool]}${a.input?.title ? ` · ${esc(a.input.title)}` : a.input?.id ? ` #${a.input.id}` : ''}</span>`).join('')}</div>` : ''}${confirm}</div>`;
  };
  return `<div class="backdrop" data-act="ai-close-bd"><div class="modal ai-modal" role="dialog" aria-label="AI 지시">
    <div class="mh"><div class="t">AI 지시</div><div style="flex:1"></div>
      ${S.aiMsgs.length ? '<button class="btn-ghost" data-act="ai-clear">대화 지우기</button>' : ''}
      <button class="x-btn" data-act="ai-close" aria-label="닫기">×</button></div>
    <div class="mb ai-log" id="ai-log" aria-live="polite">
      ${S.aiMsgs.length ? S.aiMsgs.map(bubble).join('') : `<div class="ai-hint">예) «내일까지 인사시스템 배포 점검 태스크 만들어줘» · «오늘 뭐 해야 해?» · «지연된 것 전부 다음 주 월요일로 미뤄줘» · «이번 주 회고 요약해줘»</div>`}
      ${S.aiBusy ? '<div class="ai-msg assistant busy">처리 중…</div>' : ''}
    </div>
    <div class="mf">
      <textarea id="ai-input" rows="2" placeholder="지시를 입력하고 Enter (줄바꿈은 Shift+Enter)" ${S.aiBusy ? 'disabled' : ''}></textarea>
      <button class="btn-save" data-act="ai-send" ${S.aiBusy ? 'disabled' : ''}>보내기</button>
    </div>
  </div></div>`;
}

const AI_DEL_STATE = { done: '삭제됨', cancel: '취소함', fail: '실패' };

/**
 * AI가 올린 삭제 요청을 확정(ok) 또는 취소한다. 삭제는 기존 REST로 바로 보낸다 — AI를 다시 부르지 않는다.
 * 결과는 assistant 메시지로 남겨, 다음 지시 때 모델이 무엇이 실제로 지워졌는지 알게 한다.
 */
async function resolveAiDelete(mi, ci, ok) {
  const m = S.aiMsgs[mi];
  const items = (ci === 'all' ? m.confirm : [m.confirm[ci]]).filter((c) => c?.state === 'wait');
  if (!items.length) return;
  for (const c of items) {
    if (!ok) { c.state = 'cancel'; continue; }
    try { await api(c.url, { method: 'DELETE' }); c.state = 'done'; } catch (e) { c.state = 'fail'; c.error = e.message; }
  }
  const names = (st) => items.filter((c) => c.state === st).map((c) => `«${c.title}»`).join(', ');
  if (names('done')) S.aiMsgs.push({ role: 'assistant', content: `삭제했습니다: ${names('done')}` });
  if (names('cancel')) S.aiMsgs.push({ role: 'assistant', content: `삭제를 취소했습니다: ${names('cancel')}` });
  saveAiMsgs();
  if (ok) await reload().catch(() => {});
  openAi();
}

function openAi() {
  S.modal = S.archive = S.settings = null; S.error = '';
  S.ai = true; S.focusId = 'ai-input'; render();
  const log = document.getElementById('ai-log');
  if (log) log.scrollTop = log.scrollHeight;
}

async function sendAi() {
  const input = document.getElementById('ai-input');
  const text = input?.value.trim();
  if (!text || S.aiBusy) return;
  S.aiMsgs.push({ role: 'user', content: text });
  S.aiBusy = true; openAi();
  let actions = [];
  try {
    // 서버는 무상태 — 실패 응답은 이력에서 빼고 보낸다(모델이 오류 문구를 자기 말로 착각하지 않게)
    const history = S.aiMsgs.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
    const r = await send('/api/ai', 'POST', { messages: history });
    actions = r.actions;
    S.aiMsgs.push({ role: 'assistant', content: r.reply, actions, confirm: r.confirm.map((c) => ({ ...c, state: 'wait' })) });
  } catch (e) {
    S.aiMsgs.push({ role: 'assistant', content: e.message, error: true });
  }
  S.aiBusy = false; saveAiMsgs();
  // 무언가 바꿨으면 화면 데이터를 서버 값으로 다시 맞춘다
  if (actions.some((a) => AI_ACT[a.tool] && !a.error)) await reload().catch(() => {});
  if (S.ai) openAi();
}

// ── 모달 조작 ────────────────────────────────────────
// 열 때 스냅샷을 찍고 닫을 때 비교한다 — 저장 안 한 변경을 조용히 버리지 않기 위해.
// 체크리스트·하위 태스크는 즉시 저장이라 비교 대상이 아니다.
const TASK_FIELDS = ['title', 'status', 'category', 'start', 'due', 'memo', 'repeat_days', 'parent_id'];
const NOTE_FIELDS = ['title', 'body', 'category', 'color', 'task_id'];
const snap = (o, fields) => JSON.stringify(fields.map((k) => o[k] ?? '')); // null과 빈 입력을 같게 본다

function closeTask() {
  syncDraft();
  if (snap(S.modal, TASK_FIELDS) !== S.taskSnap && !confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) return;
  S.modal = null; S.convertNoteId = null; S.error = '';
  render();
}
function closeNote() {
  syncNote();
  if (snap(S.noteModal, NOTE_FIELDS) !== S.noteSnap && !confirm('저장하지 않은 변경이 있습니다. 닫을까요?')) return;
  S.noteModal = null; S.error = '';
  render();
}

function openTask(id) {
  const t = S.tasks.find((x) => x.id === Number(id));
  if (!t) return;
  // 완료 대기 중이면 먼저 확정하고 완료 상태로 연다 — 옛 상태로 열면 저장 시 조용히 완료가 풀리고(반복은 중복 생성),
  // 모달에서 바꾼 상태는 뒤늦게 도착한 PATCH에 덮인다. 스냅샷도 같은 값에서 찍어 바로 닫아도 묻지 않는다.
  const completing = isCompleting(t);
  if (completing) commitPending();
  S.modal = { ...t, ...(completing && { status: firstDone() }) };
  S.taskSnap = snap(S.modal, TASK_FIELDS); S.newSub = ''; S.error = ''; S.focusId = 'd-title';
  render();
}
function openNew(status, parentId = null) {
  // 하위 태스크는 상위의 분류·마감일을 물려받는다 — 매번 다시 고르지 않도록
  const p = parentId ? taskById(parentId) : null;
  // 기본값은 설정에서 가져온다 — 이름을 바꾸거나 지워도 기본값이 깨지지 않게
  S.modal = {
    id: null, title: '', status: status || S.statuses.find((s) => !isDone(s)) || S.statuses[0],
    category: p?.category ?? (S.fCategory !== 'all' ? S.fCategory : S.categories[0]),
    // 상위가 이미 지난 마감이면 물려받지 않는다 — 시작일(오늘)보다 앞서면 저장이 막힌다
    // 기본은 «마감 없음» — 자동으로 붙던 +7일이 가짜 마감의 근원이었다.
    // 상위가 아직 안 지난 마감을 갖고 있을 때만 물려받는다.
    start: TODAY, due: p && p.due > TODAY ? p.due : null, memo: '', repeat_days: 0, subtasks: [],
    parent_id: parentId,
  };
  S.taskSnap = snap(S.modal, TASK_FIELDS);
  S.newSub = ''; S.error = ''; S.focusId = 'd-title';
  render();
}
/** DOM 입력값을 모달 상태에 흡수 — 재렌더 시 입력 내용이 날아가지 않게. */
function syncDraft() {
  if (!S.modal) return;
  const v = (id) => document.getElementById(id)?.value;
  Object.assign(S.modal, {
    title: v('d-title'), status: v('d-status'), category: v('d-category'),
    due: v('d-due'), memo: v('d-memo'),
    repeat_days: Number(v('d-repeat') ?? 0),
  });
  // 시작일 입력은 모달에 없다(프로젝트 뷰 전용) — m.start를 그대로 둔다.
  // 여기서 v('d-start')를 읽으면 undefined가 덮어써져 저장이 «start 누락»으로 막힌다.
  // 하위를 가진 태스크는 select 자체가 없다 — 그럴 땐 기존 값을 그대로 둔다
  const parent = v('d-parent');
  if (parent !== undefined) S.modal.parent_id = parent ? Number(parent) : null;
  S.newSub = v('d-newsub') ?? '';
}

/** 지연 태스크 전체의 마감일을 일괄 변경. 메뉴의 지름길 버튼과 날짜 직접 지정이 같은 경로를 쓴다. */
function reschedule(to) {
  const targets = lateOpen();
  if (!targets.length || !confirm(`지연 태스크 ${targets.length}건의 마감일을 ${md(to)}(으)로 옮길까요?`)) return render();
  return mutate(() => Promise.all(targets.map((t) => send(`/api/tasks/${t.id}`, 'PATCH', { due: to }))));
}

/** 보관 모달의 대상 건수와 보관 목록을 서버에서 다시 읽는다. */
async function loadArchive(before) {
  const [{ count }, list] = await Promise.all([
    api(`/api/archivable?before=${before}`),
    api('/api/tasks?archived=1'),
  ]);
  S.archive = { before, count, list: list.slice().sort((a, b) => (b.due ?? '').localeCompare(a.due ?? '')) };
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

/**
 * 경과 로그 한 줄을 memo 맨 위에 붙인다 — 최신이 위.
 * 실사용에서 memo를 이미 «→ 내부 논의 → 차주 회신» 식의 경과 기록으로 쓰고 있었다.
 * 앱이 날짜를 대신 찍어줄 뿐이고, 스키마는 그대로다.
 * 기존 태스크는 체크리스트와 같이 즉시 저장, 신규는 저장 버튼까지 로컬에 쌓인다.
 * textarea는 그대로 둔다 — 잘못 찍은 줄을 지울 수단이 필요하다.
 */
async function addProgress() {
  syncDraft();
  const text = document.getElementById('d-log')?.value.trim();
  if (!text || !S.modal) return;
  const line = `${md(TODAY)} · ${text}`;
  S.modal.memo = S.modal.memo ? `${line}\n${S.modal.memo}` : line;
  S.focusId = 'd-log';
  if (!S.modal.id) return render();
  const memo = S.modal.memo;
  await mutate(() => send(`/api/tasks/${S.modal.id}`, 'PATCH', { memo }));
  // 즉시 저장했으므로 스냅샷도 갱신한다 — 안 하면 닫을 때 «저장 안 한 변경» 확인창이 뜬다
  if (S.modal && !S.error) { S.taskSnap = snap(S.modal, TASK_FIELDS); render(); }
}

async function saveDraft() {
  syncDraft();
  const m = S.modal;
  if (!m.title.trim()) { S.error = '제목을 입력하세요'; return render(); }
  const body = { title: m.title, status: m.status, category: m.category,
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

/**
 * 모달에서 프로젝트 뷰로. 뷰가 물리 페이지라 이동하면 편집 중이던 내용이 날아가므로
 * 하위 추가와 같은 방식으로 먼저 저장한다.
 */
async function openProject() {
  const id = S.modal?.id;
  if (!id) return;
  await saveDraft();
  if (S.modal) return; // 저장 실패 — 에러가 뜬 모달을 그대로 둔다
  location.href = `/project?task=${id}`;
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
  S.noteSnap = snap(S.noteModal, NOTE_FIELDS);
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

/**
 * 보드 인라인 빠른 추가 저장. 닫는 모든 경로가 저장이다 — 메모 빠른 작성과 같은 규칙 (비어 있으면 그냥 닫힘).
 * 제목 외의 필드는 새 태스크 모달과 같은 기본값을 쓴다. Enter는 keepOpen으로 연속 추가.
 */
async function saveQuickTask(keepOpen = false) {
  const st = S.quickTask;
  const title = document.getElementById('bq-title')?.value.trim() ?? '';
  if (!keepOpen) S.quickTask = null;
  if (!title) return keepOpen ? undefined : render();
  if (keepOpen) S.focusId = 'bq-title'; // 재렌더로 입력창이 비워진 뒤 커서를 되돌린다
  await mutate(() => send('/api/tasks', 'POST', {
    title, status: st,
    category: S.fCategory !== 'all' ? S.fCategory : S.categories[0],
    // 빠른 추가에는 마감을 붙이지 않는다 — 캡처가 목적이지 일정 잡기가 아니다
    start: TODAY, due: null, memo: '', repeat_days: 0, parent_id: null,
  }));
}

/**
 * 프로젝트 뷰의 하위 태스크 인라인 추가. 보드 빠른 추가와 같은 규칙 —
 * 닫는 모든 경로(Esc·바깥 클릭)가 저장이고, 비어 있으면 그냥 닫힌다.
 * 상위의 분류를 물려받되 마감은 붙이지 않는다. 날짜는 간트 행에서 바로 채운다.
 */
async function saveQuickChild(keepOpen = false) {
  const parent = taskById(S.projectId);
  const title = document.getElementById('pc-title')?.value.trim() ?? '';
  if (!keepOpen) S.quickChild = false;
  if (!title || !parent) return keepOpen ? undefined : render();
  if (keepOpen) S.focusId = 'pc-title';
  await mutate(() => send('/api/tasks', 'POST', {
    title, status: S.statuses.find((s) => !isDone(s)) ?? S.statuses[0],
    category: parent.category,
    start: TODAY, due: null, memo: '', repeat_days: 0, parent_id: parent.id,
  }));
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
  S.taskSnap = snap(S.modal, TASK_FIELDS); // 프리필까지가 «연 상태» — 그대로 닫으면 dirty가 아니다
  S.convertNoteId = n.id;
  render();
}

// ── 지연 확정 (삭제·완료 되돌리기) ───────────────────
// 요청을 바로 보내지 않는다. 화면에만 반영해 두고 UNDO_MS 뒤에 확정한다 —
// 서버도 스키마도 건드리지 않고 «되돌리기»가 성립한다.
// 삭제: 그때까지 체크리스트 CASCADE가 일어나지 않는다.
// 완료: 반복 태스크는 완료 PATCH 때 서버가 다음 회차를 만든다. 즉시 보내고 되돌리면 다음 회차가 남는다.
const UNDO_MS = 5000;

/** 대기 중인 요청을 서버로 확정. 페이지를 떠나는 중에도 불리므로 keepalive로 보낸다. */
function commitPending(reloadAfter = true) {
  const p = S.pending;
  if (!p) return;
  clearTimeout(p.timer);
  S.pending = null;
  const sent = api(p.url, { method: p.method, body: p.body, keepalive: true });
  if (reloadAfter) sent.then(reload).catch((e) => { S.error = e.message; render(); });
}

function requestDelete(id) {
  commitPending(); // 앞선 대기건은 먼저 확정한다 — 토스트는 항상 하나만 띄운다
  const t = taskById(Number(id));
  if (!t) return;
  S.pending = { id: t.id, kind: 'task', title: t.title, url: `/api/tasks/${t.id}`, method: 'DELETE', timer: setTimeout(commitPending, UNDO_MS) };
  render();
}

function requestDeleteNote(id) {
  commitPending(); // 앞선 대기건 확정 — 토스트는 항상 하나
  const n = noteById(id);
  if (!n) return;
  S.pending = {
    id: n.id, kind: 'note', title: n.title || n.body.slice(0, 30) || '메모',
    url: `/api/notes/${n.id}`, method: 'DELETE', timer: setTimeout(commitPending, UNDO_MS),
  };
  render();
}

/**
 * 동그라미 클릭. 미완료 → 완료는 지연 확정, 완료 → 미완료는 즉시 반영(되돌릴 부작용이 없다).
 * 완료 대기 중에 다시 누르면 취소 — 되돌리기 버튼과 같다.
 */
function requestComplete(id) {
  const t = taskById(Number(id));
  if (!t) return;
  if (isCompleting(t)) return undoPending();
  commitPending();
  if (isDone(t.status)) return mutate(() => send(`/api/tasks/${t.id}`, 'PATCH', { status: firstOpen() }));
  S.pending = {
    id: t.id, kind: 'complete', title: t.title, url: `/api/tasks/${t.id}`,
    method: 'PATCH', body: JSON.stringify({ status: firstDone() }), timer: setTimeout(commitPending, UNDO_MS),
  };
  render();
}

function undoPending() {
  clearTimeout(S.pending?.timer);
  S.pending = null;
  render();
}

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
  // 전송 전에 비워 중복 저장을 막는다 (연타 Enter·Enter 후 Esc 시 같은 제목이 두 번 POST되는 것 방지)
  if (keepOpen) { input.value = ''; drawQuickChips(); }
  try {
    const t = await send('/api/tasks', 'POST', {
      title: p.title, status: firstOpen(), category: p.category,
      start: TODAY, due: p.due, memo: '', repeat_days: 0, parent_id: null,
    });
    setQuickErr('');
    showNotice(t);
    await reload();
  } catch (e) {
    // 실패하면 친 내용을 잃지 않게 돌려준다 — 바가 닫혔으면 다시 열고, 열려 있고 비어 있으면 입력값을 복원
    if (!S.qbar) openQuickBar(text);
    else {
      const cur = document.getElementById('qb-input');
      if (cur && !cur.value) { cur.value = text; drawQuickChips(); }
    }
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

// 뷰 전환이 전부 페이지 이동이라, 떠나기 전에 대기 중인 요청을 흘려보낸다
addEventListener('pagehide', () => commitPending(false));

// ── 이벤트 ───────────────────────────────────────────
document.addEventListener('click', (e) => {
  // 빠른 입력 바 바깥 클릭 = 저장하고 닫기. 바를 여는 버튼·토스트(수정/되돌리기)는 바깥으로 치지 않는다.
  if (S.qbar && !e.target.closest('.qbar, .toast, #new-task')) saveQuickBar(false);
  // 빠른 작성이 열려 있을 때 바깥을 클릭하면 Keep처럼 저장하고 닫는다 (비어 있으면 그냥 닫힘)
  if (S.quick && !e.target.closest('.note-quick')) saveQuick();
  if (S.quickTask && !e.target.closest('.bq-form')) saveQuickTask(); // 동기 구간에서 먼저 닫히므로 다른 열의 ＋와 겹쳐도 안전
  if (S.quickChild && !e.target.closest('#pc-title')) saveQuickChild();
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const { act, id } = el.dataset;

  if (act === 'cat') { S.fCategory = S.fCategory === el.dataset.cat ? 'all' : el.dataset.cat; return render(); }
  if (act === 'list-group') {
    S.listGroup = el.dataset.mode;
    try { localStorage.setItem('mywork.list.group', S.listGroup); } catch { /* 저장 실패는 기본값으로 돌아갈 뿐 */ }
    return render();
  }
  if (act === 'month') {
    const n = Number(el.dataset.n);
    if (n === 0) S.calMonth = TODAY.slice(0, 7);
    else { const [y, m] = S.calMonth.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); S.calMonth = iso(d).slice(0, 7); }
    return render();
  }
  if (act === 'resched') return reschedule(el.dataset.to);
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
  if (act === 'note-close' || (act === 'note-close-bd' && e.target === el)) return closeNote();
  if (act === 'complete') { e.stopPropagation(); return requestComplete(id); }
  if (act === 'open') return openTask(id);
  if (act === 'new') return openNew(el.dataset.status);
  if (act === 'bq-open') {
    S.quickTask = el.dataset.status; render();
    return document.getElementById('bq-title')?.focus();
  }
  if (act === 'pc-open') {
    S.quickChild = true; render();
    return document.getElementById('pc-title')?.focus();
  }
  // 프로젝트 뷰 — 하위의 완료 토글. 가장 잦은 조작이라 모달을 열지 않는다.
  if (act === 'proj-done') {
    e.stopPropagation();
    const t = taskById(Number(id));
    const to = isDone(t.status) ? (S.statuses.find((s) => !isDone(s)) ?? t.status) : S.statuses.find(isDone);
    return mutate(() => send(`/api/tasks/${id}`, 'PATCH', { status: to }));
  }
  if (act === 'del') { e.stopPropagation(); return requestDelete(id); }
  if (act === 'del-modal') { const t = S.modal.id; S.modal = null; return requestDelete(t); }
  if (act === 'undo') return undoPending();
  if (act === 'notice-edit' || act === 'notice-undo') {
    const nid = S.notice?.id;
    clearTimeout(S.notice?.timer);
    S.notice = null;
    if (!nid) return render();
    if (act === 'notice-undo') return mutate(() => api(`/api/tasks/${nid}`, { method: 'DELETE' })); // 막 만든 건이라 CASCADE 걱정이 없다
    if (S.qbar) saveQuickBar(false); // 수정으로 넘어가면 바는 닫는다 — 닫는 경로는 저장
    return openTask(nid);
  }
  if (act === 'save') return saveDraft();
  if (act === 'sub-add') return addSubtask();
  if (act === 'log-add') return addProgress();
  if (act === 'child-add') return openChild();
  if (act === 'proj-open') return openProject();
  if (act === 'sub-toggle') { syncDraft(); return mutate(() => send(`/api/subtasks/${el.dataset.sub}`, 'PATCH', { done: el.dataset.done !== '1' })); }
  if (act === 'sub-del') { syncDraft(); return mutate(() => api(`/api/subtasks/${el.dataset.sub}`, { method: 'DELETE' })); }
  if (act === 'close' || (act === 'close-bd' && e.target === el)) return closeTask();
  if (act === 'close-arch' || (act === 'close-arch-bd' && e.target === el)) { S.archive = null; S.error = ''; return render(); }
  if (act === 'close-set' || (act === 'close-set-bd' && e.target === el)) { S.settings = null; S.optColor = null; S.error = ''; return render(); }
  if (act === 'set-kind') { S.settings = el.dataset.kind; S.optColor = null; S.error = ''; return render(); }
  if (act === 'opt-add') return addOption();
  if (act === 'ai-send') return sendAi();
  if (act === 'ai-del' || act === 'ai-keep') {
    const ci = el.dataset.ci === 'all' ? 'all' : Number(el.dataset.ci);
    return resolveAiDelete(Number(el.dataset.mi), ci, act === 'ai-del');
  }
  if (act === 'ai-clear') { S.aiMsgs = []; saveAiMsgs(); return openAi(); }
  if (act === 'ai-close' || (act === 'ai-close-bd' && e.target === el)) { S.ai = false; return render(); }
  // 색은 고정 팔레트에서만 고른다 — 자유 선택은 대비를 지킬 수 없고 색이 무한정 늘어난다
  if (act === 'opt-color') { S.optColor = S.optColor === Number(id) ? null : Number(id); return render(); }
  if (act === 'opt-swatch') { S.optColor = null; return mutate(() => send(`/api/options/${id}`, 'PATCH', { color: el.dataset.color })); }
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

document.addEventListener('input', (e) => { if (e.target.id === 'qb-input') { drawQuickChips(); setQuickErr(''); } });
document.getElementById('q').addEventListener('input', (e) => { S.query = e.target.value; render(); });
document.getElementById('f-category').addEventListener('change', (e) => { S.fCategory = e.target.value; render(); });
document.getElementById('hide-done')?.addEventListener('click', () => { S.hideDone = !S.hideDone; render(); });
document.getElementById('open-archive')?.addEventListener('click', openArchive);
document.getElementById('open-settings')?.addEventListener('click', () => {
  S.modal = S.archive = null; S.error = ''; S.settings = 'status'; render();
});
document.getElementById('new-task')?.addEventListener('click', () => (S.qbar ? document.getElementById('qb-input')?.focus() : openQuickBar()));
document.getElementById('open-ai')?.addEventListener('click', openAi);
document.getElementById('show-arch-notes')?.addEventListener('click', () => { S.showArchivedNotes = !S.showArchivedNotes; render(); });
// 요약의 접힌 구역 — <details>의 toggle은 버블링하지 않아 캡처 단계에서 받는다.
// 렌더가 innerHTML을 갈아끼워도 open 속성은 S.sumOpen에서 다시 그려진다.
document.addEventListener('toggle', (e) => {
  const key = e.target.dataset?.fold;
  if (!key) return;
  S.sumOpen[key] = e.target.open;
  try { localStorage.setItem('mywork.summary.open', JSON.stringify(S.sumOpen)); } catch { /* 저장 실패는 펼침만 잃는다 */ }
}, true);

// 기준일을 바꾸면 대상 건수를 다시 센다
document.addEventListener('change', (e) => {
  if (e.target.id === 'a-before') return archiveAction(async () => {});
  if (e.target.id === 'resched-date' && e.target.value) return reschedule(e.target.value);
  const act = e.target.dataset?.act, id = e.target.dataset?.id;
  // 프로젝트 뷰의 날짜 인라인 편집 — 고르는 순간 저장. 앱에서 시작일이 보이는 유일한 곳이다.
  if (act === 'proj-start') return mutate(() => send(`/api/tasks/${id}`, 'PATCH', { start: e.target.value }));
  if (act === 'proj-due') return mutate(() => send(`/api/tasks/${id}`, 'PATCH', { due: e.target.value || null }));
  if (act === 'opt-done') return mutate(() => send(`/api/options/${id}`, 'PATCH', { done: e.target.checked }));
  if (act === 'opt-waiting') return mutate(() => send(`/api/options/${id}`, 'PATCH', { waiting: e.target.checked }));
  // 이름은 포커스를 벗어날 때만 저장 — 한 글자마다 태스크를 갱신하지 않도록
  if (act === 'opt-name') {
    const name = e.target.value.trim();
    const cur = S.meta[META_KEY[S.settings]].find((o) => o.id === Number(id));
    if (!name || name === cur?.name) return render();
    return mutate(() => send(`/api/options/${id}`, 'PATCH', { name }));
  }
});
document.addEventListener('keydown', (e) => {
  if (S.qbar) {
    // 한글 조합 중 Enter는 조합 확정용이다 — 저장으로 가로채지 않는다
    if (e.key === 'Enter' && e.target.id === 'qb-input' && !e.isComposing && !e.repeat) {
      e.preventDefault();
      return e.shiftKey ? quickToModal() : saveQuickBar(true);
    }
    if (e.key === 'Escape') { e.preventDefault(); return saveQuickBar(false); }
  }
  if (e.key === 'Escape' && S.ai) { S.ai = false; return render(); }
  if (e.key === 'Escape' && (S.modal || S.archive || S.settings || S.noteModal || S.quick || S.quickTask || S.quickChild || S.colorPick)) {
    if (S.quick) return saveQuick(); // 빠른 작성은 닫는 모든 경로가 저장이다 — Keep과 동일 (비어 있으면 그냥 닫힘)
    if (S.quickTask) return saveQuickTask();
    if (S.quickChild) return saveQuickChild();
    if (S.modal) return closeTask();     // 저장 안 한 변경이 있으면 확인 후 닫는다
    if (S.noteModal) return closeNote();
    if (S.optColor) { S.optColor = null; return render(); } // 스와치가 열려 있으면 모달보다 그것부터 닫는다
    S.archive = S.settings = null;
    S.colorPick = null;
    render();
  }
  // Ctrl(⌘)+Enter = 모달 저장. 아래 Enter 처리보다 먼저 봐야 d-newsub에서 겹치지 않는다.
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (S.modal) return saveDraft();
    if (S.noteModal) return saveNote();
  }
  if (e.key === 'Enter' && e.target.id === 'bq-title') { e.preventDefault(); saveQuickTask(true); }
  if (e.key === 'Enter' && e.target.id === 'pc-title') { e.preventDefault(); saveQuickChild(true); }
  if (e.key === 'Enter' && e.target.id === 'd-newsub') { e.preventDefault(); addSubtask(); }
  if (e.key === 'Enter' && e.target.id === 'd-log') { e.preventDefault(); addProgress(); }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.target.id === 'ai-input') { e.preventDefault(); sendAi(); }
  if (e.key === 'Enter' && e.target.id === 's-new') { e.preventDefault(); addOption(); }
  if (e.key === 'Enter' && e.target.dataset?.act === 'opt-name') e.target.blur();
  // 전역 단축키 — 입력 중이거나 모달·빠른 추가가 열려 있으면 무시
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  const busy = S.modal || S.noteModal || S.settings || S.archive || S.quick || S.quickTask || S.ai || S.qbar;
  if (typing || busy || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') { e.preventDefault(); document.getElementById('q').focus(); }
  if (e.key === 'n') { e.preventDefault(); openQuickBar(); }
  if (e.key === 'i') { e.preventDefault(); openAi(); }
});

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
document.getElementById('q').value = S.query; // 검색창은 정적 DOM이라 복원값을 한 번 넣어 준다
document.getElementById('q').title = '단축키: /';
const newBtn = document.getElementById('new-task');
if (newBtn) newBtn.title = '단축키: n';
reload().catch((e) => { document.getElementById('viewport').innerHTML = `<div class="card empty">서버 연결 실패: ${esc(e.message)}</div>`; });
