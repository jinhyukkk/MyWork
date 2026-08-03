#!/usr/bin/env node
// MyWork MCP 서버 — Claude Code에서 태스크·체크리스트를 직접 조회/수정한다.
// 검증과 쿼리는 REST와 동일하게 store.js를 쓴다. DB 파일은 웹 서버와 공유(WAL + busy_timeout).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { openDb } from './db.js';
import * as store from './store.js';

const db = openDb(process.env.MYWORK_DB_PATH);

// 도구 스키마의 enum은 서버 기동 시점의 설정을 굳힌다.
// 설정을 바꾸면 MCP 서버를 재시작해야 새 값이 반영된다(도구 목록은 한 번만 전송되므로).
const TYPES = store.listOptions(db, 'type').map((o) => o.name);
const STATUSES = store.listOptions(db, 'status').map((o) => o.name);
const PRIORITIES = store.listOptions(db, 'priority').map((o) => o.name);
const isDone = (s) => store.doneStatuses(db).has(s);

const DAY = 86400000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());
const parseD = (s) => { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const daysBetween = (from, to) => Math.round((parseD(to) - parseD(from)) / DAY);
const shiftD = (s, n) => iso(new Date(parseD(s).getTime() + n * DAY));
/** 그 주의 월요일. 주간 회고의 기본 구간이 «월~오늘»이라 필요하다(일요일은 직전 월요일로 본다). */
const mondayOf = (s) => shiftD(s, -((parseD(s).getDay() + 6) % 7));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (description) => ({ type: 'string', description });
const enumOf = (values, description) => ({ type: 'string', enum: values, description });
const ID = { type: 'integer', description: '태스크 id' };
const PARENT = {
  type: ['integer', 'null'],
  description: '상위 태스크 id (Jira 하위 태스크). null이면 연결 해제. 하위는 다시 하위를 가질 수 없다(1단계)',
};
const REPEAT = {
  type: 'integer', minimum: 0, maximum: 365,
  description: '반복 주기(일). 0이면 반복 없음. 완료로 바꾸는 순간 이 간격으로 다음 회차가 자동 생성된다 (매주 7, 2주 14, 4주 28)',
};

const TOOLS = [
  {
    name: 'list_tasks',
    description: '태스크 목록을 조회한다. 필터를 겹쳐 쓸 수 있고, 각 태스크에는 체크리스트(subtasks)와 완료 시각(done_at, 미완료면 null)이 함께 들어온다.',
    inputSchema: {
      type: 'object',
      properties: {
        status: enumOf(STATUSES, '진행상황'),
        type: enumOf(TYPES, '업무유형'),
        priority: enumOf(PRIORITIES, '우선순위'),
        category: str('업무분류명 (정확히 일치)'),
        q: str('제목·메모 부분 일치 검색어'),
        due_before: str('이 날짜(YYYY-MM-DD) 이하 마감분만'),
        overdue: { type: 'boolean', description: 'true면 마감일이 지난 미완료 태스크만' },
        archived: { type: 'boolean', description: 'true면 보관된 태스크만 조회 (기본은 보관분 제외)' },
      },
    },
  },
  {
    name: 'create_task',
    description: '새 태스크를 만든다. title만 필수이고 나머지는 기본값이 채워진다(오늘 시작·7일 뒤 마감).',
    inputSchema: {
      type: 'object',
      properties: {
        title: str('제목'),
        type: enumOf(TYPES, '업무유형 (기본 개발)'),
        status: enumOf(STATUSES, '진행상황 (기본 시작 전)'),
        priority: enumOf(PRIORITIES, '우선순위 (기본 Medium)'),
        category: str('업무분류 (기본 첫 번째 분류). 없는 분류면 새로 만든다'),
        start: str('시작일 YYYY-MM-DD (기본 오늘)'),
        due: str('마감일 YYYY-MM-DD (기본 오늘+7일)'),
        memo: str('설명·메모'),
        repeat_days: REPEAT,
        parent_id: PARENT,
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: '태스크를 부분 수정한다. 넘긴 필드만 바뀐다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID,
        title: str('제목'), type: enumOf(TYPES, '업무유형'), status: enumOf(STATUSES, '진행상황'),
        priority: enumOf(PRIORITIES, '우선순위'), category: str('업무분류'),
        start: str('시작일 YYYY-MM-DD'), due: str('마감일 YYYY-MM-DD'), memo: str('설명·메모'),
        repeat_days: REPEAT, parent_id: PARENT,
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_task',
    description: '태스크를 삭제한다. 체크리스트도 함께 지워진다. 하위 태스크는 지워지지 않고 연결만 끊긴다.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'] },
  },
  {
    name: 'add_subtask',
    description: '태스크에 체크리스트 항목을 추가한다.',
    inputSchema: {
      type: 'object',
      properties: { task_id: ID, title: str('항목 내용') },
      required: ['task_id', 'title'],
    },
  },
  {
    name: 'update_subtask',
    description: '체크리스트 항목의 체크 상태나 내용을 바꾼다.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '체크리스트 항목 id' },
        done: { type: 'boolean', description: '체크 여부' },
        title: str('항목 내용'),
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_subtask',
    description: '체크리스트 항목을 삭제한다.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'integer', description: '체크리스트 항목 id' } },
      required: ['id'],
    },
  },
  {
    name: 'list_categories',
    description: '업무분류 목록과 분류별 태스크 수를 조회한다.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'archive_tasks',
    description: '오래된 완료 태스크를 보관한다(삭제 아님, 복원 가능). 보관하면 목록·통계·브리핑에서 빠진다. dry_run으로 먼저 건수만 확인할 수 있다.',
    inputSchema: {
      type: 'object',
      properties: {
        before_days: { type: 'integer', minimum: 0, description: '오늘 기준 며칠 이전에 끝낸 것까지 보관할지 (기본 30). 기준은 완료 시각이며, 없는 구버전 건은 마감일' },
        before: str('직접 날짜 지정 YYYY-MM-DD. before_days보다 우선한다'),
        dry_run: { type: 'boolean', description: 'true면 대상 건수만 반환하고 보관하지 않는다' },
      },
    },
  },
  {
    name: 'restore_task',
    description: '보관된 태스크를 다시 활성 목록으로 되돌린다.',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'] },
  },
  {
    name: 'weekly_review',
    description: '기간 안에 끝낸 일을 모아 준다. 주간보고·회고에 쓴다. 기본 구간은 이번 주 월요일~오늘이며, weeks_ago로 지난 주를 본다. 기준은 완료 시각이고, 그 값이 없는 예전 태스크는 마감일로 갈음한다(estimated: true로 표시).',
    inputSchema: {
      type: 'object',
      properties: {
        weeks_ago: { type: 'integer', minimum: 0, maximum: 52, description: '0이면 이번 주(월~오늘), 1이면 지난 주(월~일). 기본 0' },
        since: str('구간 시작 YYYY-MM-DD. 주면 weeks_ago를 무시한다'),
        until: str('구간 끝 YYYY-MM-DD (포함)'),
        category: str('이 분류만 보고 싶을 때'),
      },
    },
  },
  {
    name: 'today_brief',
    description: '오늘 기준 업무 브리핑. 미완료 태스크를 지연 / 오늘 마감 / 예정으로 나눠서 한 번에 준다. "오늘 뭐 해야 하지" 류의 질문에 쓴다.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '예정 구간 일수 (기본 7)', minimum: 1, maximum: 90 },
        category: str('이 분류만 보고 싶을 때'),
      },
    },
  },
  {
    name: 'list_notes',
    description: '메모 목록을 조회한다(Keep 스타일). 고정된 메모가 앞, 이후 수정일 역순.',
    inputSchema: {
      type: 'object',
      properties: {
        q: str('제목·내용 부분 일치 검색어'),
        category: str('업무분류명 (정확히 일치)'),
        task_id: { type: 'integer', description: '이 태스크에 연결된 메모만' },
        archived: { type: 'boolean', description: 'true면 보관된 메모만 조회 (기본은 보관분 제외)' },
      },
    },
  },
  {
    name: 'create_note',
    description: '메모를 만든다. title/body 중 하나는 있어야 한다. task_id로 태스크에 연결할 수 있다.',
    inputSchema: {
      type: 'object',
      properties: {
        title: str('제목'),
        body: str('내용'),
        category: str('업무분류 (선택). 없는 분류면 새로 만든다'),
        pinned: { type: 'boolean', description: '상단 고정 여부' },
        task_id: { type: ['integer', 'null'], description: '연결할 태스크 id' },
      },
    },
  },
  {
    name: 'update_note',
    description: '메모를 부분 수정한다. 넘긴 필드만 바뀐다. task_id: null이면 연결 해제, archived로 보관/복원.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '메모 id' },
        title: str('제목'), body: str('내용'),
        category: str('업무분류. 없는 분류면 새로 만든다'),
        pinned: { type: 'boolean', description: '상단 고정 여부' },
        archived: { type: 'boolean', description: '보관 여부' },
        task_id: { type: ['integer', 'null'], description: '연결할 태스크 id (null이면 해제)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_note',
    description: '메모를 삭제한다.',
    inputSchema: { type: 'object', properties: { id: { type: 'integer', description: '메모 id' } }, required: ['id'] },
  },
];

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 1) }] });
const bad = (message) => ({ content: [{ type: 'text', text: `오류: ${message}` }], isError: true });
/** store 결과를 MCP 응답으로 옮긴다. */
const out = (r) => (r.error ? bad(r.error) : text(r.data));

const HANDLERS = {
  list_tasks(a) {
    const filter = { ...a };
    if (a.overdue) { filter.due_before = todayIso(); delete filter.overdue; }
    let tasks = store.listTasks(db, filter);
    // overdue는 '마감 지남 + 미완료' — due_before만으로는 완료분이 섞인다
    if (a.overdue) tasks = tasks.filter((t) => !isDone(t.status) && t.due < todayIso());
    return text({ count: tasks.length, tasks });
  },

  create_task(a) {
    const cats = store.listCategories(db);
    const category = a.category ?? cats[0];
    // 없는 분류를 지정하면 만들어 준다 — 매번 list_categories 부터 부르지 않도록
    if (!cats.includes(category)) {
      const r = store.addCategory(db, category);
      if (r.error) return bad(r.error);
    }
    return out(store.createTask(db, {
      title: a.title,
      type: a.type ?? TYPES[0],
      status: a.status ?? store.firstOpenStatus(db),
      priority: a.priority ?? (PRIORITIES[1] ?? PRIORITIES[0]),
      category,
      start: a.start ?? todayIso(),
      due: a.due ?? iso(new Date(Date.now() + 7 * DAY)),
      memo: a.memo ?? '',
      ...(a.parent_id === undefined ? {} : { parent_id: a.parent_id }),
    }));
  },

  update_task({ id, ...patch }) {
    if (patch.category && !store.listCategories(db).includes(patch.category)) {
      const r = store.addCategory(db, patch.category);
      if (r.error) return bad(r.error);
    }
    return out(store.updateTask(db, id, patch));
  },

  delete_task({ id }) {
    const { data } = store.deleteTask(db, id);
    return data.deleted ? text(`태스크 ${id} 삭제 완료`) : bad(`태스크 ${id} 없음`);
  },

  add_subtask: (a) => out(store.addSubtask(db, a.task_id, a.title)),
  update_subtask: ({ id, ...patch }) => out(store.updateSubtask(db, id, patch)),
  delete_subtask({ id }) {
    const { data } = store.deleteSubtask(db, id);
    return data.deleted ? text(`항목 ${id} 삭제 완료`) : bad(`항목 ${id} 없음`);
  },

  list_categories() {
    const tasks = store.listTasks(db);
    return text(store.listCategories(db).map((name) => ({ name, count: tasks.filter((t) => t.category === name).length })));
  },

  archive_tasks({ before_days = 30, before, dry_run }) {
    const cutoff = before ?? iso(new Date(parseD(todayIso()).getTime() - before_days * DAY));
    const count = store.countArchivable(db, cutoff);
    if (dry_run) return text({ before: cutoff, would_archive: count });
    if (!count) return text({ before: cutoff, archived: 0, message: '보관할 완료 태스크가 없습니다' });
    return out(store.archiveCompleted(db, cutoff));
  },

  restore_task({ id }) {
    const r = store.updateTask(db, id, { archived: 0 });
    return r.error ? bad(r.error) : text(`태스크 ${id} 복원 완료: ${r.data.title}`);
  },

  weekly_review({ weeks_ago = 0, since, until, category }) {
    const today = todayIso();
    const monday = shiftD(mondayOf(today), -weeks_ago * 7);
    // 지난 주는 월~일 한 주가 통째로, 이번 주는 아직 안 끝났으니 오늘까지
    const from = since ?? monday;
    const to = until ?? (weeks_ago > 0 ? shiftD(monday, 6) : today);
    if (!DATE.test(from) || !DATE.test(to)) return bad('since·until은 YYYY-MM-DD 형식이어야 합니다');
    if (from > to) return bad(`구간이 뒤집혔습니다: ${from} → ${to}`);

    // 보관분도 함께 본다 — 끝낸 일을 빠뜨리는 게 회고 도구의 최악의 실패다
    const all = [...store.listTasks(db, { category }), ...store.listTasks(db, { category, archived: true })];
    const inRange = (d) => d >= from && d <= to;

    const completed = all
      .filter((t) => isDone(t.status) && inRange(store.endedOn(t)))
      .sort((a, b) => store.endedOn(a).localeCompare(store.endedOn(b)))
      .map((t) => ({
        id: t.id, title: t.title, category: t.category, type: t.type, done: store.endedOn(t), due: t.due,
        ...(t.repeat_days ? { repeat_days: t.repeat_days } : {}),
        ...(t.archived ? { archived: true } : {}),
        // done_at이 없어 마감일로 갈음한 건 — 실제로 끝낸 날이 아닐 수 있다
        ...(t.done_at ? {} : { estimated: true }),
      }));

    // 그 구간이 마감이었는데 아직 안 끝난 것 — 주간보고의 «이월» 항목
    const carried_over = all
      .filter((t) => !isDone(t.status) && !t.archived && inRange(t.due))
      .sort((a, b) => a.due.localeCompare(b.due))
      .map((t) => ({ id: t.id, title: t.title, category: t.category, status: t.status, due: t.due, late_days: daysBetween(t.due, today) }));

    const tally = (rows) => rows.reduce((acc, r) => ({ ...acc, [r.category]: (acc[r.category] ?? 0) + 1 }), {});
    return text({
      range: { since: from, until: to, days: daysBetween(from, to) + 1 },
      summary: {
        completed: completed.length,
        carried_over: carried_over.length,
        by_category: tally(completed),
        by_type: completed.reduce((acc, r) => ({ ...acc, [r.type]: (acc[r.type] ?? 0) + 1 }), {}),
        estimated: completed.filter((r) => r.estimated).length,
      },
      completed, carried_over,
    });
  },

  today_brief({ days = 7, category }) {
    const today = todayIso();
    const limit = iso(new Date(parseD(today).getTime() + days * DAY));
    const open = store.listTasks(db, { category }).filter((t) => !isDone(t.status));
    // 브리핑이므로 memo·날짜 전체 대신 판단에 필요한 것만 남긴다
    const slim = (t) => {
      const done = t.subtasks.filter((s) => s.done).length;
      return {
        id: t.id, title: t.title, category: t.category, priority: t.priority, status: t.status, due: t.due,
        ...(t.subtasks.length ? { checklist: `${done}/${t.subtasks.length}` } : {}),
      };
    };
    const byDue = (a, b) => a.due.localeCompare(b.due);
    const overdue = open.filter((t) => t.due < today).sort(byDue)
      .map((t) => ({ ...slim(t), late_days: daysBetween(t.due, today) }));
    const due_today = open.filter((t) => t.due === today).sort(byDue).map(slim);
    const upcoming = open.filter((t) => t.due > today && t.due <= limit).sort(byDue)
      .map((t) => ({ ...slim(t), d_day: daysBetween(today, t.due) }));

    return text({
      today,
      summary: {
        open: open.length,
        overdue: overdue.length,
        due_today: due_today.length,
        upcoming: upcoming.length,
        in_progress: open.filter((t) => t.status === '진행 중').length,
        later: open.length - overdue.length - due_today.length - upcoming.length,
      },
      overdue, due_today, upcoming,
    });
  },

  list_notes(a) {
    const notes = store.listNotes(db, a);
    return text({ count: notes.length, notes });
  },

  create_note(a) {
    // 없는 분류를 지정하면 만들어 준다 — create_task와 같은 이유
    if (a.category && !store.listCategories(db).includes(a.category)) {
      const r = store.addCategory(db, a.category);
      if (r.error) return bad(r.error);
    }
    return out(store.createNote(db, a));
  },

  update_note({ id, ...patch }) {
    if (patch.category && !store.listCategories(db).includes(patch.category)) {
      const r = store.addCategory(db, patch.category);
      if (r.error) return bad(r.error);
    }
    return out(store.updateNote(db, id, patch));
  },

  delete_note({ id }) {
    const { data } = store.deleteNote(db, id);
    return data.deleted ? text(`메모 ${id} 삭제 완료`) : bad(`메모 ${id} 없음`);
  },
};

const server = new Server({ name: 'mywork', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const handler = HANDLERS[req.params.name];
  if (!handler) return bad(`알 수 없는 도구: ${req.params.name}`);
  try {
    return handler(req.params.arguments ?? {});
  } catch (e) {
    return bad(e.message);
  }
});

await server.connect(new StdioServerTransport());
