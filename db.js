// DB 초기화 + 시드. node:sqlite(내장) 사용 — 외부 DB 드라이버 의존성 없음.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// 설정 항목 초기값. 최초 실행/마이그레이션 때만 쓰이고, 이후에는 DB의 options 테이블이 정답이다.
// done=1인 상태는 '끝난 것'으로 취급된다 — 진척률·보관·반복 생성·완료 숨김이 이 플래그를 본다.
export const DEFAULT_OPTIONS = {
  type: [
    ['개발', '#2F6FED'], ['기획·문서', '#7A5AF8'], ['운영', '#0E9AA0'],
    ['학습', '#D98200'], ['회의', '#D9568A'], ['투자', '#2FA84F'], ['개인', '#6B7280'],
  ],
  status: [['시작 전', '#6B7280', 0], ['진행 중', '#2F6FED', 0], ['완료', '#2FA84F', 1]],
  priority: [['High', '#D64545'], ['Medium', '#D98200'], ['Low', '#6B8AA0']],
};
export const TYPES = DEFAULT_OPTIONS.type.map(([n]) => n);
export const STATUSES = DEFAULT_OPTIONS.status.map(([n]) => n);
export const PRIORITIES = DEFAULT_OPTIONS.priority.map(([n]) => n);
const DEFAULT_CATS = ['인사시스템 운영', '유진GPT 운영', '투자심의AI', '대학원·논문', '구직', '개인투자', '부동산', '기타'];

const DAY = 86400000;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (base, n) => iso(new Date(base.getTime() + n * DAY));

export function openDb(file = path.join(ROOT, 'data', 'mywork.db')) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;   -- 웹 서버와 MCP 서버가 같은 파일을 동시에 열 수 있다
    CREATE TABLE IF NOT EXISTS categories (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT '개발',
      status     TEXT NOT NULL DEFAULT '시작 전',
      category   TEXT NOT NULL DEFAULT '기타',
      priority   TEXT NOT NULL DEFAULT 'Medium',
      start      TEXT NOT NULL,
      due        TEXT NOT NULL,
      memo       TEXT NOT NULL DEFAULT '',
      repeat_days INTEGER NOT NULL DEFAULT 0,   -- 0이면 반복 없음. 완료 시 이 간격으로 다음 건이 생긴다
      archived   INTEGER NOT NULL DEFAULT 0,    -- 1이면 모든 뷰·통계에서 빠진다 (삭제 아님, 복원 가능)
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);
    CREATE TABLE IF NOT EXISTS subtasks (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title   TEXT NOT NULL,
      done    INTEGER NOT NULL DEFAULT 0,
      sort    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
    CREATE TABLE IF NOT EXISTS options (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      kind  TEXT NOT NULL,                       -- 'type' | 'status' | 'priority'
      name  TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6B7280',
      sort  INTEGER NOT NULL DEFAULT 0,
      done  INTEGER NOT NULL DEFAULT 0,          -- status 전용
      UNIQUE(kind, name)
    );
  `);
  migrate(db);
  if (db.prepare('SELECT COUNT(*) n FROM categories').get().n === 0) seed(db);
  return db;
}

/** 기존 DB에 나중에 추가된 컬럼을 채워 넣는다. SQLite는 ADD COLUMN IF NOT EXISTS가 없다. */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
  if (!cols.includes('repeat_days')) {
    db.exec('ALTER TABLE tasks ADD COLUMN repeat_days INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('archived')) {
    db.exec('ALTER TABLE tasks ADD COLUMN archived INTEGER NOT NULL DEFAULT 0');
  }

  // 설정 항목이 비어 있으면 기본값을 심는다. 기존 DB에도 그대로 적용된다.
  if (db.prepare('SELECT COUNT(*) n FROM options').get().n === 0) {
    const ins = db.prepare('INSERT OR IGNORE INTO options (kind, name, color, sort, done) VALUES (?,?,?,?,?)');
    for (const [kind, rows] of Object.entries(DEFAULT_OPTIONS)) {
      rows.forEach(([name, color, done = 0], i) => ins.run(kind, name, color, i, done));
    }
    // 기본값에 없는 값이 태스크에 이미 들어가 있으면(외부 임포트 등) 설정에서 사라지지 않게 주워 담는다
    for (const kind of ['type', 'status', 'priority']) {
      for (const { v } of db.prepare(`SELECT DISTINCT ${kind} v FROM tasks`).all()) {
        ins.run(kind, v, '#6B7280', 99, 0);
      }
    }
  }
}

function seed(db) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const insCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
  for (const c of DEFAULT_CATS) insCat.run(c);

  // 최초 실행 시에만 넣는 예시 데이터. 전부 지우면 다시 생기지 않음.
  const rows = [
    ['인사시스템 정기 배포 (7월 R2)', '개발', '진행 중', '인사시스템 운영', 'High', -6, 2, '근태 모듈 hotfix 2건 포함. 배포 전 QA 시나리오 재확인.'],
    ['연차 정산 로직 오류 대응', '운영', '진행 중', '인사시스템 운영', 'High', -2, 0, '이월 연차 계산에서 반차 차감 누락. 재현 케이스 3건 확보.'],
    ['인사시스템 사용자 매뉴얼 개정', '기획·문서', '시작 전', '인사시스템 운영', 'Low', 3, 12, '조직개편 반영분 반영 필요.'],
    ['2분기 인사데이터 정합성 점검', '운영', '완료', '인사시스템 운영', 'Medium', -20, -8, '부서 코드 미스매치 12건 정리 완료.'],
    ['유진GPT 사내 사용량 리포트', '운영', '진행 중', '유진GPT 운영', 'Medium', -4, 1, '부서별 MAU / 질의 유형 상위 20개 정리.'],
    ['프롬프트 가이드라인 v2 배포', '기획·문서', '시작 전', '유진GPT 운영', 'High', 1, 6, '보안 준수 항목 + 업무별 예시 프롬프트 추가.'],
    ['RAG 문서 인덱싱 파이프라인 개선', '개발', '진행 중', '유진GPT 운영', 'High', -9, 5, '청크 사이즈/오버랩 튜닝, 사내 규정문서 우선 적용.'],
    ['현업 부서 온보딩 세션 (재무팀)', '회의', '시작 전', '유진GPT 운영', 'Medium', 4, 4, '60분, 실습 30분 포함.'],
    ['유진GPT 장애 대응 매뉴얼 작성', '운영', '완료', '유진GPT 운영', 'Low', -18, -6, '1차 초안 배포 완료.'],
    ['투자심의AI 요구사항 정의서 확정', '기획·문서', '완료', '투자심의AI', 'High', -22, -10, '심의위원 인터뷰 5건 반영.'],
    ['심의보고서 자동요약 모델 실험', '개발', '진행 중', '투자심의AI', 'High', -7, 8, '요약 품질 평가지표 3종 비교 중.'],
    ['투자심의AI 파일럿 리뷰 회의', '회의', '시작 전', '투자심의AI', 'High', 2, 2, '심의팀 + IT 합동, 파일럿 결과 공유.'],
    ['리스크 지표 데이터 소스 정리', '기획·문서', '시작 전', '투자심의AI', 'Medium', 5, 14, '외부 데이터 라이선스 확인 포함.'],
    ['논문 3장 실험 설계 정리', '학습', '진행 중', '대학원·논문', 'Medium', -12, 9, '베이스라인 재현 + 지표 정의.'],
    ['포트폴리오 리밸런싱 검토', '투자', '시작 전', '개인투자', 'Low', 6, 10, '채권 비중 조정 여부 판단.'],
  ];
  const ins = db.prepare(
    'INSERT INTO tasks (title, type, status, category, priority, start, due, memo) VALUES (?,?,?,?,?,?,?,?)'
  );
  for (const [title, type, status, category, priority, s, e, memo] of rows) {
    ins.run(title, type, status, category, priority, shift(today, s), shift(today, e), memo);
  }

  // 체크리스트 예시 — '인사시스템 정기 배포'(1번)에만
  const insSub = db.prepare('INSERT INTO subtasks (task_id, title, done, sort) VALUES (1,?,?,?)');
  [['근태 모듈 hotfix 반영', 1], ['QA 시나리오 재확인', 1], ['배포 롤백 절차 점검', 0], ['릴리스 노트 작성', 0]]
    .forEach(([t, done], i) => insSub.run(t, done, i));
}
