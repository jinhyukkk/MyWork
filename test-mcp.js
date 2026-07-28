// MCP 서버를 실제 stdio로 띄워 왕복 확인. DB는 임시 파일이라 실사용 데이터를 건드리지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'mywork-mcp-'));
const child = spawn(process.execPath, ['mcp.js'], {
  env: { ...process.env, MYWORK_DB_PATH: path.join(dir, 'test.db') },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buf += chunk;
  for (let nl; (nl = buf.indexOf('\n')) >= 0; ) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});

let seq = 0;
const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
/** tools/call 결과에서 본문 텍스트만 꺼낸다. */
const call = async (name, args) => {
  const { result } = await rpc('tools/call', { name, arguments: args });
  return { text: result.content[0].text, isError: !!result.isError };
};
const json = async (name, args) => JSON.parse((await call(name, args)).text);

// 모든 테스트가 한 서버를 공유한다. Windows는 프로세스가 죽기 전엔 DB 파일이 잠겨 있어 exit를 기다린다.
after(async () => {
  child.kill();
  await new Promise((r) => child.once('exit', r));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('MCP 도구 등록 · 태스크/체크리스트 왕복', async () => {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(init.result.serverInfo.name, 'mywork');
  notify('notifications/initialized');

  const { result: listed } = await rpc('tools/list', {});
  assert.deepEqual(listed.tools.map((x) => x.name).sort(), [
    'add_subtask', 'archive_tasks', 'create_task', 'delete_subtask', 'delete_task',
    'list_categories', 'list_tasks', 'restore_task', 'today_brief', 'update_subtask', 'update_task',
  ]);

  // 시드 15건이 그대로 보인다
  assert.equal((await json('list_tasks')).count, 15);
  assert.equal((await json('list_tasks', { status: '완료' })).tasks.every((x) => x.status === '완료'), true);
  assert.equal((await json('list_tasks', { q: 'RAG' })).count, 1);

  // overdue = 마감 지남 + 미완료.
  // 시드에서 마감이 지난 건 전부 '완료'라 기본 상태에서는 0건이어야 한다.
  assert.equal((await json('list_tasks', { overdue: true })).count, 0, '완료된 지난 태스크가 섞이면 안 된다');
  const late = await json('create_task', { title: '지연된 태스크', start: '2020-01-01', due: '2020-02-01', status: '진행 중' });
  const od = await json('list_tasks', { overdue: true });
  assert.deepEqual(od.tasks.map((x) => x.id), [late.id]);
  await call('delete_task', { id: late.id });

  // title만으로 생성 — 나머지는 기본값
  const made = await json('create_task', { title: 'MCP로 만든 태스크' });
  assert.equal(made.status, '시작 전');
  assert.equal(made.priority, 'Medium');
  assert.ok(made.start <= made.due);
  assert.deepEqual(made.subtasks, []);

  // 없는 분류를 주면 만들어 준다
  const withNewCat = await json('create_task', { title: '새 분류 태스크', category: '사이드프로젝트' });
  assert.equal(withNewCat.category, '사이드프로젝트');
  assert.ok((await json('list_categories')).some((c) => c.name === '사이드프로젝트'));

  // 잘못된 enum은 도구 오류로 되돌아온다
  assert.equal((await call('update_task', { id: made.id, status: '어중간' })).isError, true);
  assert.equal((await call('update_task', { id: 99999, title: 'x' })).isError, true);

  // 체크리스트
  const sub = await json('add_subtask', { task_id: made.id, title: '초안 작성' });
  assert.equal(sub.done, 0);
  assert.equal((await json('update_subtask', { id: sub.id, done: true })).done, 1);
  const reread = (await json('list_tasks', { q: 'MCP로' })).tasks[0];
  assert.equal(reread.subtasks.length, 1);
  assert.equal(reread.subtasks[0].done, 1);
  assert.equal((await call('delete_subtask', { id: sub.id })).text, `항목 ${sub.id} 삭제 완료`);

  // 삭제 + 없는 id 삭제는 오류
  assert.equal((await call('delete_task', { id: made.id })).text, `태스크 ${made.id} 삭제 완료`);
  assert.equal((await call('delete_task', { id: made.id })).isError, true);
  assert.equal((await json('list_tasks')).count, 16);

  await call('delete_task', { id: withNewCat.id });
});

test('today_brief 버킷 분류', async (t) => {
  const b = await json('today_brief');
  const all = [...b.overdue, ...b.due_today, ...b.upcoming];

  // 완료 태스크는 어느 버킷에도 없어야 한다
  assert.ok(all.every((x) => x.status !== '완료'));
  // 버킷 + later가 미완료 전체와 맞아떨어져야 한다 (누락/중복 없음)
  assert.equal(b.summary.overdue + b.summary.due_today + b.summary.upcoming + b.summary.later, b.summary.open);
  assert.equal(b.summary.overdue, b.overdue.length);

  // 경계: 오늘 마감은 due_today에만, 예정은 1~7일 사이
  assert.ok(b.due_today.every((x) => x.due === b.today));
  assert.ok(b.upcoming.every((x) => x.d_day >= 1 && x.d_day <= 7), '기본 창은 7일');
  assert.ok(b.upcoming.every((x) => x.due > b.today));

  // days 인자로 창을 좁히면 upcoming이 줄고 later로 넘어간다
  const narrow = await json('today_brief', { days: 2 });
  assert.ok(narrow.summary.upcoming <= b.summary.upcoming);
  assert.ok(narrow.upcoming.every((x) => x.d_day <= 2));
  assert.equal(narrow.summary.open, b.summary.open);

  // 지연 태스크를 넣으면 late_days와 함께 overdue로 들어간다
  const late = await json('create_task', { title: '늦은 일', start: '2020-01-01', due: '2020-01-05', status: '진행 중' });
  const after = await json('today_brief');
  const found = after.overdue.find((x) => x.id === late.id);
  assert.ok(found, 'overdue 버킷에 있어야 한다');
  assert.equal(found.late_days, Math.round((new Date(after.today) - new Date('2020-01-05')) / 86400000));
  assert.equal(after.summary.overdue, b.summary.overdue + 1);

  // 체크리스트가 있으면 진행률이 붙는다
  await call('add_subtask', { task_id: late.id, title: 'a' });
  const sub = await json('add_subtask', { task_id: late.id, title: 'b' });
  await call('update_subtask', { id: sub.id, done: true });
  assert.equal((await json('today_brief')).overdue.find((x) => x.id === late.id).checklist, '1/2');

  // 분류 필터
  const only = await json('today_brief', { category: '투자심의AI' });
  assert.ok([...only.overdue, ...only.due_today, ...only.upcoming].every((x) => x.category === '투자심의AI'));

  await call('delete_task', { id: late.id });
});
