// WorkBoard(Electron 앱) DB → MyWork DB 일회성 이관.
// 실행: node import-workboard.js  [workboard.db 경로]
// 기존 MyWork 태스크는 전부 지우고 새로 넣는다(시드 예시 제거 목적).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { openDb, TYPES, STATUSES, PRIORITIES } from './db.js';

const SRC = process.argv[2] ?? path.join(process.env.APPDATA, 'workboard-app', 'workboard.db');

const STATUS = { todo: '시작 전', in_progress: '진행 중', done: '완료' };
const PRIORITY = { high: 'High', medium: 'Medium', low: 'Low' };
// WorkBoard 분류명 → MyWork 분류명. 매핑에 없으면 '기타'.
const CATEGORY = { 인사시스템: '인사시스템 운영', 유진GPT: '유진GPT 운영', TOPICS: '기타' };

// WorkBoard에는 업무유형이 없다. 제목+설명 키워드로 추정하고, 안 걸리면 '운영'.
// ponytail: 단순 키워드 매칭. 오분류는 대시보드에서 직접 고치는 게 규칙 늘리는 것보다 싸다.
const TYPE_RULES = [
  ['회의', /회의|미팅|세션|인터뷰/],
  ['학습', /교육|논문|학습|커리큘럼/],
  ['개발', /개발|구축|개선|세팅|배포|파이프라인|CI\/CD|에러|오류|서비스화/],
  ['기획·문서', /요구사항|자료|문서|매뉴얼|가이드|리포트|보고|레터|정리|검토/],
  ['투자', /투자심의|포트폴리오|리밸런싱/],
];
const guessType = (text) => TYPE_RULES.find(([, re]) => re.test(text))?.[0] ?? '운영';

/** WorkBoard는 'YYYY-MM-DD'와 ISO(Z) 두 형태를 섞어 쓴다. 둘 다 로컬 기준 날짜로 통일. */
function toDate(v) {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const src = new DatabaseSync(SRC, { readOnly: true });
const dst = openDb();

// 소스 읽기
const cats = new Map(src.prepare('SELECT id, name FROM categories').all().map((c) => [c.id, c.name]));
const links = src.prepare('SELECT task_id, category_id FROM task_categories').all();
const byTask = new Map();
for (const { task_id, category_id } of links) {
  const name = CATEGORY[cats.get(category_id)] ?? '기타';
  if (!byTask.has(task_id)) byTask.set(task_id, []);
  byTask.get(task_id).push(name);
}
const tasks = src.prepare('SELECT * FROM tasks ORDER BY created_at, sort_order').all();
const subs = src.prepare('SELECT * FROM subtasks ORDER BY task_id, sort_order, created_at').all();
const subsByTask = new Map();
for (const s of subs) {
  if (!subsByTask.has(s.task_id)) subsByTask.set(s.task_id, []);
  subsByTask.get(s.task_id).push(s);
}

// 기존 데이터 제거 (subtasks는 FK CASCADE)
dst.exec('DELETE FROM tasks');
dst.exec("DELETE FROM sqlite_sequence WHERE name IN ('tasks','subtasks')");

const insTask = dst.prepare(
  'INSERT INTO tasks (title, type, status, category, priority, start, due, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
);
const insSub = dst.prepare('INSERT INTO subtasks (task_id, title, done, sort) VALUES (?,?,?,?)');

dst.exec('BEGIN');
let nTask = 0, nSub = 0;
for (const t of tasks) {
  const created = toDate(t.created_at);
  // MyWork는 start/due가 필수다. 없으면 생성일로 메우고, 시작일이 마감일보다 늦지 않게 맞춘다.
  const due = toDate(t.due_date) ?? created;
  let start = toDate(t.start_date) ?? created;
  if (start > due) start = due;

  // 분류가 여럿이면 '기타'가 아닌 쪽을 우선 (예: TOPICS + 인사시스템 → 인사시스템 운영)
  const linked = byTask.get(t.id) ?? [];
  const category = linked.find((c) => c !== '기타') ?? linked[0] ?? '기타';

  const { lastInsertRowid } = insTask.run(
    t.title,
    guessType(`${t.title} ${t.description ?? ''}`),
    STATUS[t.status],
    category,
    PRIORITY[t.priority],
    start,
    due,
    t.description ?? '',
    t.created_at
  );
  nTask++;
  (subsByTask.get(t.id) ?? []).forEach((s, i) => {
    insSub.run(lastInsertRowid, s.title, s.is_done ? 1 : 0, i);
    nSub++;
  });
}
dst.exec('COMMIT');

// 검증 — 값이 하나라도 스키마 밖으로 나가면 즉시 실패
const bad = dst.prepare(`
  SELECT COUNT(*) n FROM tasks
  WHERE status NOT IN (${STATUSES.map(() => '?').join(',')})
     OR priority NOT IN (${PRIORITIES.map(() => '?').join(',')})
     OR type NOT IN (${TYPES.map(() => '?').join(',')})
     OR start > due
     OR start IS NULL OR due IS NULL
`).get(...STATUSES, ...PRIORITIES, ...TYPES).n;
if (bad) throw new Error(`이관 검증 실패: 잘못된 행 ${bad}건`);

console.log(`이관 완료 — 태스크 ${nTask}건, 체크리스트 ${nSub}건`);
console.table(dst.prepare('SELECT category, status, COUNT(*) n FROM tasks GROUP BY category, status').all());
