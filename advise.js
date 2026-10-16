// 홈 «지금 집중할 일 · 다음 행동» — 등록된 태스크·메모를 Claude가 읽고 우선순위와 다음 행동을 판단한다.
// 판단만 하고 실행하지 않는다. 행동은 앱이 실행할 수 있는 한 가지 변경(체크리스트 추가·상태·마감)으로 받아,
// 사용자가 승인하면 프론트가 기존 REST로 보낸다.
import * as store from './store.js';
import { defaultClient } from './ai.js';

const MODEL = 'claude-opus-5-5';
const MEMO_MAX = 600;     // ponytail: 메모를 잘라 보낸다. 긴 경과 로그에서 앞부분(최신)이 판단에 가장 쓸모 있다
const DONE_DAYS = 14;     // 최근 완료 건도 맥락으로 넣는다(무엇이 막 끝났는지)
const MAX_FOCUS = 3;
const MAX_ACTIONS = 5;

// 매 요청 같은 문자열이라 캐시가 맞는다 — 날짜·데이터는 user 메시지로 보낸다
const SYSTEM = `당신은 개인 업무 관리 앱 MyWork의 업무 코치다. 등록된 태스크·메모만 근거로, 지금 우선 진행해야 할 일과 필요한 다음 행동을 판단한다.

판단할 때 볼 것:
- 메모·체크리스트에 적힌 확정 일정(교육일, 회의일, 회신 기한)과 마감까지 남은 시간
- 이미 «진행 중»·«검토 중»인 일 — 흐름이 끊기지 않게 하는 것이 우선이다
- 남의 회신이나 선행 작업에 막힌 일(대기 상태, 메모의 "~후 진행", "회신 예정")은 우선순위에서 내린다. 다만 오래 멈춰 있으면 확인하는 행동을 제안한다
- 오래 «아이디어»·«할 일»에 머문 일, 서로 중복으로 보이는 일
- 결재·회신처럼 이미 남의 손에 넘어간 일은 마감이 오늘이어도 집중 대상이 아니다. 필요하면 확인하는 행동으로 제안한다
- 오래전에 시작해 아직 «진행 중»인 장기 과제는 메모·체크리스트에 진척 기록이 없을수록 멈춰 있을 위험이 크다. 마감이 몇 주 남았어도 집중 대상으로 보고 다음 단계를 행동으로 제안한다
- 마감이 지났다는 사실만으로 우선순위를 올리지 않는다. 실제 진척과 일정이 근거다

출력:
- summary: 지금 상황을 한 문장으로(40자 안팎, 존댓말 "~요")
- focus: 지금 우선 진행할 태스크, 중요한 순서로 최대 ${MAX_FOCUS}개. reason은 데이터에서 근거를 짚은 한 문장
- actions: 다음 행동 최대 ${MAX_ACTIONS}개. 각각 앱이 실행할 수 있는 변경 하나다
  · kind "todo": 그 태스크 체크리스트에 넣을 구체적인 할 일. value는 항목 문구(예: "10/28 교육 자료 리허설")
  · kind "status": 진행상황 변경. value는 데이터의 statuses 이름 중 하나
  · kind "due": 마감일 변경. value는 YYYY-MM-DD, 마감을 지우려면 빈 문자열
  · title은 승인 버튼 옆에 보일 짧은 문장, why는 근거 한 문장
- 데이터에 없는 사실을 지어내지 않는다. task_id는 반드시 데이터에 있는 id를 쓴다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    focus: {
      type: 'array',
      items: {
        type: 'object',
        properties: { task_id: { type: 'integer' }, reason: { type: 'string' } },
        required: ['task_id', 'reason'], additionalProperties: false,
      },
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          task_id: { type: 'integer' }, kind: { type: 'string', enum: ['todo', 'status', 'due'] },
          value: { type: 'string' }, title: { type: 'string' }, why: { type: 'string' },
        },
        required: ['task_id', 'kind', 'value', 'title', 'why'], additionalProperties: false,
      },
    },
  },
  required: ['summary', 'focus', 'actions'], additionalProperties: false,
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 모델에 넘길 데이터 — 판단에 필요한 필드만. 같은 입력이면 같은 문자열이 되게 키 순서를 고정한다. */
export function snapshot(db, now = new Date()) {
  const today = iso(now);
  const statuses = store.listOptions(db, 'status');
  const done = new Set(statuses.filter((o) => o.done).map((o) => o.name));
  const since = iso(new Date(now.getTime() - DONE_DAYS * 86400000));
  const tasks = store.listTasks(db)
    .filter((t) => !done.has(t.status) || (t.done_at ?? '').slice(0, 10) >= since)
    .map((t) => ({
      id: t.id, title: t.title, status: t.status, category: t.category,
      start: t.start, due: t.due, parent_id: t.parent_id, repeat_days: t.repeat_days || undefined,
      memo: t.memo ? t.memo.slice(0, MEMO_MAX) : undefined,
      checklist: t.subtasks.length ? t.subtasks.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.title}`) : undefined,
    }));
  const notes = store.listNotes(db).map((n) => ({
    id: n.id, title: n.title || undefined, body: n.body.slice(0, MEMO_MAX), task_id: n.task_id ?? undefined,
  }));
  return {
    today: `${today} (${'일월화수목금토'[now.getDay()]}요일)`,
    statuses: statuses.map((o) => ({ name: o.name, done: !!o.done, waiting: !!o.waiting })),
    tasks, notes,
  };
}

/** 모델 출력 검증 — 없는 태스크, 없는 상태, 이미 그 값인 변경은 버린다. 화면에는 실행 가능한 것만 간다. */
export function clean(out, db) {
  const tasks = new Map(store.listTasks(db).map((t) => [t.id, t]));
  const statusNames = new Set(store.listOptions(db, 'status').map((o) => o.name));
  const focus = out.focus.filter((f) => tasks.has(f.task_id)).slice(0, MAX_FOCUS);
  const actions = out.actions.filter((a) => {
    const t = tasks.get(a.task_id);
    if (!t || !a.title.trim()) return false;
    if (a.kind === 'status') return statusNames.has(a.value) && a.value !== t.status;
    if (a.kind === 'due') return (a.value === '' || DATE.test(a.value)) && (a.value || null) !== t.due;
    return !!a.value.trim(); // todo
  }).slice(0, MAX_ACTIONS).map((a) => ({ ...a, key: `${a.task_id}:${a.kind}:${a.value}` }));
  return { summary: out.summary.trim(), focus, actions };
}

/**
 * @param db  node:sqlite DB
 * @param getClient  테스트에서 가짜 클라이언트를 주입하기 위한 훅
 */
export function createAdvisor(db, getClient = defaultClient) {
  let client;
  return async function advise() {
    client ??= getClient();
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // 안전 분류기가 거절하면 서버가 다른 모델로 재시도
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify(snapshot(db)) }],
    });
    if (res.stop_reason === 'refusal') throw new Error('AI가 판단을 거절했습니다(안전 정책)');
    if (res.stop_reason === 'max_tokens') throw new Error('AI 응답이 길이 제한에서 잘렸습니다');
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { at: new Date().toISOString(), ...clean(JSON.parse(text), db) };
  };
}
