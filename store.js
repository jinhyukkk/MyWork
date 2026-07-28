// 데이터 조작 + 검증. REST(server.js)와 MCP(mcp.js)가 이 한 곳을 공유한다.
// 업무유형·진행상황·우선순위는 상수가 아니라 options 테이블에서 읽는다.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;

/** 형태뿐 아니라 실재하는 날짜인지까지 본다 — 2026-13-01, 2026-02-30을 걸러낸다. */
function isDate(s) {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
const ok = (data) => ({ data });
const fail = (error, status = 400) => ({ error, status });

// 날짜 계산은 UTC로 — 로컬 타임존/서머타임에 따라 하루가 밀리는 걸 막는다
const toUTC = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const addDays = (s, n) => new Date(toUTC(s) + n * DAY).toISOString().slice(0, 10);
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ── 설정 항목(업무유형·진행상황·우선순위) ──────────────
export const KINDS = ['type', 'status', 'priority'];
const KIND_LABEL = { type: '업무유형', status: '진행상황', priority: '우선순위' };

export const listOptions = (db, kind) =>
  db.prepare('SELECT id, name, color, sort, done FROM options WHERE kind = ? ORDER BY sort, id').all(kind);
const names = (db, kind) => listOptions(db, kind).map((o) => o.name);

/** done=1로 표시된 진행상황들. '완료'라는 이름 대신 이 집합이 '끝남'의 정의다. */
export const doneStatuses = (db) =>
  new Set(db.prepare("SELECT name FROM options WHERE kind = 'status' AND done = 1").all().map((r) => r.name));

/** 새로 만드는 태스크의 기본 상태 — 끝나지 않은 것 중 첫 번째. */
export function firstOpenStatus(db) {
  const done = doneStatuses(db);
  const all = names(db, 'status');
  return all.find((n) => !done.has(n)) ?? all[0];
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const optName = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function addOption(db, kind, { name, color, done } = {}) {
  if (!KINDS.includes(kind)) return fail('알 수 없는 설정 종류', 404);
  const clean = optName(name);
  if (!clean) return fail(`${KIND_LABEL[kind]} 이름이 비었습니다`);
  if (names(db, kind).includes(clean)) return fail(`이미 있는 ${KIND_LABEL[kind]}입니다`);
  if (color !== undefined && !COLOR.test(color)) return fail('색상은 #RRGGBB 형식이어야 합니다');
  const { next } = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 next FROM options WHERE kind = ?').get(kind);
  db.prepare('INSERT INTO options (kind, name, color, sort, done) VALUES (?,?,?,?,?)')
    .run(kind, clean, color ?? '#6B7280', next, kind === 'status' && done ? 1 : 0);
  return ok(listOptions(db, kind));
}

/** 이름을 바꾸면 그 값을 쓰던 태스크도 함께 옮긴다 — 참조가 끊기면 안 된다. */
export function updateOption(db, id, { name, color, done } = {}) {
  const cur = db.prepare('SELECT * FROM options WHERE id = ?').get(id);
  if (!cur) return fail('설정 항목 없음', 404);
  const patch = {};

  if (name !== undefined) {
    const clean = optName(name);
    if (!clean) return fail('이름이 비었습니다');
    if (clean !== cur.name && names(db, cur.kind).includes(clean)) return fail(`이미 있는 ${KIND_LABEL[cur.kind]}입니다`);
    patch.name = clean;
  }
  if (color !== undefined) {
    if (!COLOR.test(color)) return fail('색상은 #RRGGBB 형식이어야 합니다');
    patch.color = color;
  }
  if (done !== undefined && cur.kind === 'status') {
    const v = done ? 1 : 0;
    // 완료로 표시된 상태가 하나도 없으면 진척률·보관·반복이 기준을 잃는다
    if (!v && cur.done && doneStatuses(db).size <= 1) return fail('완료로 표시된 진행상황이 최소 하나는 있어야 합니다');
    patch.done = v;
  }

  const keys = Object.keys(patch);
  if (!keys.length) return ok(listOptions(db, cur.kind));
  db.prepare(`UPDATE options SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), cur.id);
  if (patch.name && patch.name !== cur.name) {
    db.prepare(`UPDATE tasks SET ${cur.kind} = ? WHERE ${cur.kind} = ?`).run(patch.name, cur.name);
  }
  return ok(listOptions(db, cur.kind));
}

/** 삭제하면 그 값을 쓰던 태스크는 남은 첫 항목으로 옮긴다(업무분류와 동일한 방식). */
export function deleteOption(db, id) {
  const cur = db.prepare('SELECT * FROM options WHERE id = ?').get(id);
  if (!cur) return fail('설정 항목 없음', 404);
  const rest = listOptions(db, cur.kind).filter((o) => o.id !== cur.id);
  if (!rest.length) return fail(`${KIND_LABEL[cur.kind]}은(는) 최소 하나가 있어야 합니다`);
  if (cur.kind === 'status' && cur.done && doneStatuses(db).size <= 1) {
    return fail('완료로 표시된 진행상황이 최소 하나는 있어야 합니다');
  }
  const moved = db.prepare(`UPDATE tasks SET ${cur.kind} = ? WHERE ${cur.kind} = ?`).run(rest[0].name, cur.name);
  db.prepare('DELETE FROM options WHERE id = ?').run(cur.id);
  return ok({ options: listOptions(db, cur.kind), movedTo: rest[0].name, moved: Number(moved.changes) });
}

/** 순서를 통째로 다시 쓴다 — 체크리스트 정렬과 같은 방식. */
export function reorderOptions(db, kind, ids) {
  if (!KINDS.includes(kind)) return fail('알 수 없는 설정 종류', 404);
  if (!Array.isArray(ids)) return fail('ids는 배열이어야 합니다');
  const current = listOptions(db, kind).map((o) => o.id);
  const given = ids.map(Number);
  if (given.length !== current.length || new Set(given).size !== given.length
      || !given.every((id) => current.includes(id))) {
    return fail('ids는 해당 설정의 전체 항목이어야 합니다');
  }
  const upd = db.prepare('UPDATE options SET sort = ? WHERE id = ?');
  given.forEach((id, i) => upd.run(i, id));
  return ok(listOptions(db, kind));
}

const FIELDS = {
  title: (v) => (typeof v === 'string' && v.trim() ? v.trim() : null),
  type: (v, db) => (names(db, 'type').includes(v) ? v : null),
  status: (v, db) => (names(db, 'status').includes(v) ? v : null),
  priority: (v, db) => (names(db, 'priority').includes(v) ? v : null),
  category: (v) => (typeof v === 'string' && v.trim() ? v.trim() : null),
  start: (v) => (isDate(v) ? v : null),
  due: (v) => (isDate(v) ? v : null),
  memo: (v) => (typeof v === 'string' ? v : null),
  repeat_days: (v) => (Number.isInteger(v) && v >= 0 && v <= 365 ? v : null),
  archived: (v) => (typeof v === 'boolean' ? Number(v) : v === 0 || v === 1 ? v : null),
};
// 생성 시 없어도 되는 필드
const OPTIONAL = new Set(['memo', 'repeat_days', 'archived']);

/** 허용된 필드만 추려 검증. required면 OPTIONAL을 뺀 전 필드가 있어야 한다. */
function pick(db, body, required) {
  const out = {};
  for (const [key, check] of Object.entries(FIELDS)) {
    if (!(key in body)) {
      if (required && !OPTIONAL.has(key)) return fail(`${key} 누락`);
      continue;
    }
    const v = check(body[key], db);
    if (v === null) return fail(`${key} 값이 올바르지 않습니다`);
    out[key] = v;
  }
  return ok(out);
}

// ── 조회 ──────────────────────────────────────────────
const subsOf = (db, taskId) =>
  db.prepare('SELECT id, title, done, sort FROM subtasks WHERE task_id = ? ORDER BY sort, id').all(taskId);

export const getTask = (db, id) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return t && { ...t, subtasks: subsOf(db, id) };
};

/**
 * 필터는 JS에서 적용 — 개인용 규모(수십~수백 건)라 SQL 조립보다 읽기 쉽다.
 * 보관된 태스크는 기본적으로 빠진다. filter.archived === true면 보관분만 본다.
 */
export function listTasks(db, filter = {}) {
  const want = filter.archived === true ? 1 : 0;
  const tasks = db.prepare('SELECT * FROM tasks WHERE archived = ? ORDER BY due, id').all(want);
  // 태스크당 조회 대신 한 번에 읽어 묶는다 (N+1 회피)
  const byTask = new Map();
  for (const s of db.prepare('SELECT * FROM subtasks ORDER BY task_id, sort, id').all()) {
    if (!byTask.has(s.task_id)) byTask.set(s.task_id, []);
    byTask.get(s.task_id).push({ id: s.id, title: s.title, done: s.done, sort: s.sort });
  }
  const q = (filter.q || '').trim().toLowerCase();
  return tasks
    .filter((t) =>
      (!filter.status || t.status === filter.status) &&
      (!filter.category || t.category === filter.category) &&
      (!filter.type || t.type === filter.type) &&
      (!filter.priority || t.priority === filter.priority) &&
      (!filter.due_before || t.due <= filter.due_before) &&
      (!q || t.title.toLowerCase().includes(q) || (t.memo || '').toLowerCase().includes(q)))
    .map((t) => ({ ...t, subtasks: byTask.get(t.id) ?? [] }));
}

// ── 태스크 ────────────────────────────────────────────
export function createTask(db, body) {
  const { data, error, status } = pick(db, body, true);
  if (error) return fail(error, status);
  if (data.start > data.due) return fail('시작일이 마감일보다 늦습니다');
  const { lastInsertRowid } = db
    .prepare('INSERT INTO tasks (title, type, status, category, priority, start, due, memo, repeat_days) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(data.title, data.type, data.status, data.category, data.priority, data.start, data.due, data.memo ?? '', data.repeat_days ?? 0);
  return ok(getTask(db, lastInsertRowid));
}

/**
 * 반복 태스크를 완료했을 때 다음 회차를 만든다.
 * 마감일 + 주기로 잡되, 한참 늦게 완료해도 이미 지난 날짜가 나오지 않도록 오늘을 넘길 때까지 주기를 더한다.
 * 시작일~마감일 간격과 체크리스트는 템플릿처럼 그대로 이어받는다(체크는 모두 해제).
 */
function spawnNext(db, task) {
  if (!(task.repeat_days > 0)) return null;
  const gap = (toUTC(task.due) - toUTC(task.start)) / DAY;
  const today = localToday();
  let due = addDays(task.due, task.repeat_days);
  while (due <= today) due = addDays(due, task.repeat_days);

  const { lastInsertRowid } = db
    .prepare('INSERT INTO tasks (title, type, status, category, priority, start, due, memo, repeat_days) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(task.title, task.type, firstOpenStatus(db), task.category, task.priority, addDays(due, -gap), due, task.memo, task.repeat_days);

  const ins = db.prepare('INSERT INTO subtasks (task_id, title, done, sort) VALUES (?,?,0,?)');
  for (const s of subsOf(db, task.id)) ins.run(lastInsertRowid, s.title, s.sort);
  return getTask(db, lastInsertRowid);
}

export function updateTask(db, id, body) {
  const cur = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!cur) return fail('태스크 없음', 404);
  const { data, error, status } = pick(db, body, false);
  if (error) return fail(error, status);
  const keys = Object.keys(data);
  if (!keys.length) return ok(getTask(db, cur.id));
  const merged = { ...cur, ...data };
  if (merged.start > merged.due) return fail('시작일이 마감일보다 늦습니다');
  db.prepare(`UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => data[k]), cur.id);

  const updated = getTask(db, cur.id);
  // 완료로 '넘어간' 순간에만 다음 회차를 만든다. 이미 완료된 건을 또 고칠 때는 생기지 않는다.
  const done = doneStatuses(db);
  if (!done.has(cur.status) && done.has(updated.status)) {
    const next = spawnNext(db, updated);
    if (next) updated.next = { id: next.id, due: next.due };
  }
  return ok(updated);
}

export function deleteTask(db, id) {
  const { changes } = db.prepare('DELETE FROM tasks WHERE id = ?').run(id); // subtasks는 CASCADE
  return ok({ deleted: Number(changes) });
}

/**
 * 마감일이 before 이전인 완료 태스크를 보관한다. 되돌릴 수 있도록 삭제가 아닌 플래그.
 * 기준을 '완료 시각'이 아니라 마감일로 잡는 이유는 완료 시각을 저장하지 않기 때문 —
 * 완료된 태스크에서는 마감일이 실제로 끝낸 시점의 근사치다.
 */
export function archiveCompleted(db, before) {
  if (!isDate(before)) return fail('before는 YYYY-MM-DD 형식이어야 합니다');
  const done = [...doneStatuses(db)];
  if (!done.length) return fail('완료로 표시된 진행상황이 없습니다');
  const { changes } = db
    .prepare(`UPDATE tasks SET archived = 1 WHERE archived = 0 AND due <= ? AND status IN (${done.map(() => '?').join(',')})`)
    .run(before, ...done);
  return ok({ archived: Number(changes), before });
}

/** 보관 대상 미리보기 — 실제로 옮기기 전 몇 건인지 보여주기 위한 것. */
export function countArchivable(db, before) {
  if (!isDate(before)) return 0;
  const done = [...doneStatuses(db)];
  if (!done.length) return 0;
  return db
    .prepare(`SELECT COUNT(*) n FROM tasks WHERE archived = 0 AND due <= ? AND status IN (${done.map(() => '?').join(',')})`)
    .get(before, ...done).n;
}

// ── 체크리스트 ────────────────────────────────────────
const subTitle = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const subDone = (v) => (typeof v === 'boolean' ? Number(v) : v === 0 || v === 1 ? v : null);
const oneSub = (db, id) => db.prepare('SELECT id, title, done, sort FROM subtasks WHERE id = ?').get(id);

export function addSubtask(db, taskId, title) {
  if (!db.prepare('SELECT 1 FROM tasks WHERE id = ?').get(taskId)) return fail('태스크 없음', 404);
  const clean = subTitle(title);
  if (!clean) return fail('항목명이 비었습니다');
  const { next } = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 next FROM subtasks WHERE task_id = ?').get(taskId);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO subtasks (task_id, title, done, sort) VALUES (?,?,0,?)')
    .run(taskId, clean, next);
  return ok(oneSub(db, lastInsertRowid));
}

export function updateSubtask(db, id, body) {
  const cur = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id);
  if (!cur) return fail('항목 없음', 404);
  const patch = {};
  if ('title' in body) {
    const v = subTitle(body.title);
    if (v === null) return fail('항목명이 비었습니다');
    patch.title = v;
  }
  if ('done' in body) {
    const v = subDone(body.done);
    if (v === null) return fail('done 값이 올바르지 않습니다');
    patch.done = v;
  }
  const keys = Object.keys(patch);
  if (keys.length) {
    db.prepare(`UPDATE subtasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...keys.map((k) => patch[k]), cur.id);
  }
  return ok(oneSub(db, cur.id));
}

export function deleteSubtask(db, id) {
  const { changes } = db.prepare('DELETE FROM subtasks WHERE id = ?').run(id);
  return ok({ deleted: Number(changes) });
}

/**
 * 항목 순서를 통째로 다시 쓴다. 부분 이동(sort 하나만 수정)은 값이 겹치거나
 * 비는 경우를 다 처리해야 해서, 전체 순서를 받아 0..n-1로 새로 매기는 편이 짧고 안전하다.
 */
export function reorderSubtasks(db, taskId, ids) {
  if (!Array.isArray(ids)) return fail('ids는 배열이어야 합니다');
  const current = subsOf(db, taskId).map((s) => s.id);
  if (!current.length) return fail('항목 없음', 404);
  const given = ids.map(Number);
  if (given.length !== current.length || new Set(given).size !== given.length
      || !given.every((id) => current.includes(id))) {
    return fail('ids는 해당 태스크의 전체 항목이어야 합니다');
  }
  const upd = db.prepare('UPDATE subtasks SET sort = ? WHERE id = ?');
  given.forEach((id, i) => upd.run(i, id));
  return ok(subsOf(db, taskId));
}

// ── 분류 ──────────────────────────────────────────────
export const listCategories = (db) =>
  db.prepare('SELECT name FROM categories ORDER BY id').all().map((r) => r.name);

export function addCategory(db, name) {
  const clean = typeof name === 'string' ? name.trim() : '';
  if (!clean) return fail('분류명이 비었습니다');
  db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(clean);
  return ok({ name: clean });
}

/** 분류를 지우면 소속 태스크는 남은 첫 분류로 이관한다. */
export function removeCategory(db, name) {
  const all = listCategories(db);
  if (all.length <= 1) return fail('마지막 분류는 삭제할 수 없습니다');
  if (!all.includes(name)) return fail('분류 없음', 404);
  const fallback = all.find((c) => c !== name);
  db.prepare('UPDATE tasks SET category = ? WHERE category = ?').run(fallback, name);
  db.prepare('DELETE FROM categories WHERE name = ?').run(name);
  return ok({ movedTo: fallback });
}
