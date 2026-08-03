// API 회귀 체크. 인메모리 DB로 CRUD + 검증 + 분류 이관까지 한 번에 확인.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from './db.js';
import { createApp } from './server.js';
import * as store from './store.js';

const app = createApp(openDb(':memory:'));
const server = app.listen(0);
const base = `http://localhost:${server.address().port}`;
const call = (p, method = 'GET', body) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

test('태스크 CRUD + 검증 + 분류 삭제 이관', async (t) => {
  t.after(() => server.close());

  const meta = await (await call('/api/meta')).json();
  assert.ok(meta.categories.some((o) => o.name === '투자심의AI'));
  assert.equal((await (await call('/api/tasks')).json()).length, 15, '시드 15건');

  const valid = { title: '테스트', type: '개발', status: '시작 전', category: '기타', priority: 'High', start: '2026-08-01', due: '2026-08-10', memo: 'm' };

  // 생성
  const created = await (await call('/api/tasks', 'POST', valid)).json();
  assert.equal(created.title, '테스트');

  // 검증: 잘못된 enum / 날짜 역전 / 빈 제목은 400
  for (const bad of [{ ...valid, type: '없는유형' }, { ...valid, start: '2026-09-01' }, { ...valid, title: '  ' }]) {
    assert.equal((await call('/api/tasks', 'POST', bad)).status, 400);
  }

  // 부분 수정 (보드 드래그 경로)
  const moved = await (await call(`/api/tasks/${created.id}`, 'PATCH', { status: '완료' })).json();
  assert.equal(moved.status, '완료');
  assert.equal(moved.title, '테스트', 'PATCH는 나머지 필드를 보존');
  assert.equal((await call(`/api/tasks/${created.id}`, 'PATCH', { status: 'X' })).status, 400);

  // 분류 삭제 → 소속 태스크 이관. 분류도 설정 항목이라 /api/options 경로를 쓴다.
  const cats = await (await call('/api/options/category', 'POST', { name: '임시분류' })).json();
  const tmp = cats.find((o) => o.name === '임시분류');
  await call(`/api/tasks/${created.id}`, 'PATCH', { category: '임시분류' });
  const { movedTo } = await (await call(`/api/options/${tmp.id}`, 'DELETE')).json();
  const all = await (await call('/api/tasks')).json();
  assert.equal(all.find((x) => x.id === created.id).category, movedTo);
  assert.ok(!(await (await call('/api/meta')).json()).categories.some((o) => o.name === '임시분류'));

  // 삭제
  assert.equal((await call(`/api/tasks/${created.id}`, 'DELETE')).status, 204);
  assert.equal((await (await call('/api/tasks')).json()).length, 15);
});

test('반복 태스크 — 완료 시 다음 회차 생성', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  t.after(() => srv.close());
  const b = `http://localhost:${srv.address().port}`;
  const c = (p, method = 'GET', body) =>
    fetch(b + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const plus = (n) => iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + n)));

  const base = { title: '뉴스레터 발행', type: '운영', status: '시작 전', category: '기타', priority: 'Medium' };

  // repeat_days는 생성 시 선택 항목 — 없으면 0
  const plain = await (await c('/api/tasks', 'POST', { ...base, start: plus(0), due: plus(3) })).json();
  assert.equal(plain.repeat_days, 0);
  await c(`/api/tasks/${plain.id}`, 'PATCH', { status: '완료' });
  assert.equal((await (await c('/api/tasks')).json()).filter((x) => x.title === '뉴스레터 발행').length, 1,
    '반복 없는 태스크는 완료해도 새로 생기지 않는다');

  // 2주 반복 — 시작~마감 간격(3일)과 체크리스트를 이어받는다
  const rep = await (await c('/api/tasks', 'POST', { ...base, title: '격주 뉴스레터', start: plus(1), due: plus(4), repeat_days: 14 })).json();
  const sub = await (await c(`/api/tasks/${rep.id}/subtasks`, 'POST', { title: '원고 취합' })).json();
  await c(`/api/subtasks/${sub.id}`, 'PATCH', { done: true });

  const done = await (await c(`/api/tasks/${rep.id}`, 'PATCH', { status: '완료' })).json();
  assert.ok(done.next, '완료 응답에 다음 회차 정보가 들어온다');
  assert.equal(done.next.due, plus(18), '마감일 + 14일');

  const all = await (await c('/api/tasks')).json();
  const next = all.find((x) => x.id === done.next.id);
  assert.equal(next.status, '시작 전');
  assert.equal(next.repeat_days, 14, '주기를 이어받는다');
  assert.equal(next.start, plus(15), '시작~마감 간격 3일 유지');
  assert.deepEqual(next.subtasks.map((s) => [s.title, s.done]), [['원고 취합', 0]], '체크리스트는 복사하되 전부 해제');

  // 이미 완료된 건을 또 고쳐도 회차가 늘지 않는다
  await c(`/api/tasks/${rep.id}`, 'PATCH', { priority: 'High' });
  assert.equal((await (await c('/api/tasks')).json()).filter((x) => x.title === '격주 뉴스레터').length, 2);

  // 한참 지난 반복을 뒤늦게 완료해도 과거 날짜가 나오지 않는다
  const late = await (await c('/api/tasks', 'POST', { ...base, title: '밀린 반복', start: plus(-60), due: plus(-57), repeat_days: 14 })).json();
  const lateDone = await (await c(`/api/tasks/${late.id}`, 'PATCH', { status: '완료' })).json();
  assert.ok(lateDone.next.due > iso(today), `다음 마감(${lateDone.next.due})은 오늘 이후여야 한다`);
  assert.equal((toDays(lateDone.next.due) - toDays(plus(-57))) % 14, 0, '원래 주기 격자를 유지한다');

  // 범위 밖 주기는 거부
  for (const v of [-1, 400, 1.5, '14']) {
    assert.equal((await c('/api/tasks', 'POST', { ...base, start: plus(0), due: plus(1), repeat_days: v })).status, 400, `repeat_days=${v}`);
  }
});

const toDays = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };

test('설정 항목 — 추가·이름변경·삭제·순서, done 플래그 보호', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  t.after(() => srv.close());
  const b = `http://localhost:${srv.address().port}`;
  const c = (p, method = 'GET', body) =>
    fetch(b + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const meta = async () => (await c('/api/meta')).json();

  // 기본값이 심어져 있고 색상·done이 함께 온다
  const m0 = await meta();
  assert.deepEqual(m0.statuses.map((o) => o.name), ['시작 전', '진행 중', '완료']);
  assert.deepEqual(m0.statuses.map((o) => o.done), [0, 0, 1]);
  assert.equal(m0.types.find((o) => o.name === '개발').color, '#2F6FED');

  // 추가
  const added = await (await c('/api/options/type', 'POST', { name: '데브옵스', color: '#123456' })).json();
  assert.ok(added.some((o) => o.name === '데브옵스'));
  assert.equal((await c('/api/options/type', 'POST', { name: '데브옵스' })).status, 400, '중복 거부');
  assert.equal((await c('/api/options/type', 'POST', { name: '  ' })).status, 400, '빈 이름 거부');
  assert.equal((await c('/api/options/type', 'POST', { name: 'x', color: 'red' })).status, 400, '색상 형식 거부');
  assert.equal((await c('/api/options/nope', 'POST', { name: 'x' })).status, 404);

  // 이름을 바꾸면 그 값을 쓰던 태스크도 함께 바뀐다
  const devops = (await meta()).types.find((o) => o.name === '데브옵스');
  const task = await (await c('/api/tasks', 'POST', {
    title: '파이프라인', type: '데브옵스', status: '시작 전', category: '기타',
    priority: 'Medium', start: '2026-07-01', due: '2026-07-02',
  })).json();
  await c(`/api/options/${devops.id}`, 'PATCH', { name: 'DevOps' });
  assert.equal((await (await c('/api/tasks')).json()).find((x) => x.id === task.id).type, 'DevOps', '태스크 참조가 따라온다');

  // 사라진 이름으로는 더 이상 만들 수 없다
  assert.equal((await c('/api/tasks', 'POST', {
    title: 'x', type: '데브옵스', status: '시작 전', category: '기타',
    priority: 'Medium', start: '2026-07-01', due: '2026-07-02',
  })).status, 400);

  // 순서 변경
  const ids = (await meta()).types.map((o) => o.id);
  const flipped = await (await c('/api/options/type/order', 'PATCH', { ids: [...ids].reverse() })).json();
  assert.deepEqual(flipped.map((o) => o.id), [...ids].reverse());
  assert.equal((await c('/api/options/type/order', 'PATCH', { ids: ids.slice(0, 2) })).status, 400, '부분 목록 거부');

  // 진행상황 순서 = 보드 열 순서. 보드에서 열 머리를 끌면 같은 요청이 나간다.
  const sIds = (await meta()).statuses.map((o) => o.id);
  const sFlipped = await (await c('/api/options/status/order', 'PATCH', { ids: [...sIds].reverse() })).json();
  assert.deepEqual(sFlipped.map((o) => o.id), [...sIds].reverse());
  await c('/api/options/status/order', 'PATCH', { ids: sIds });

  // 분류도 같은 방식으로 이름변경·순서변경이 된다
  const catIds = (await meta()).categories.map((o) => o.id);
  const catFlipped = await (await c('/api/options/category/order', 'PATCH', { ids: [...catIds].reverse() })).json();
  assert.deepEqual(catFlipped.map((o) => o.id), [...catIds].reverse());
  await c(`/api/options/${catIds[0]}`, 'PATCH', { name: '이름바꾼분류' });
  assert.ok((await (await c('/api/tasks')).json()).some((x) => x.category === '이름바꾼분류'), '태스크 분류도 따라온다');

  // 삭제하면 쓰던 태스크는 남은 첫 항목으로 이관
  const devopsId = (await meta()).types.find((o) => o.name === 'DevOps').id;
  const del = await (await c(`/api/options/${devopsId}`, 'DELETE')).json();
  assert.equal((await (await c('/api/tasks')).json()).find((x) => x.id === task.id).type, del.movedTo);
  assert.equal(del.moved, 1);

  // done 플래그 보호 — 마지막 완료 상태는 해제도 삭제도 못 한다
  const doneOpt = (await meta()).statuses.find((o) => o.done);
  assert.equal((await c(`/api/options/${doneOpt.id}`, 'PATCH', { done: false })).status, 400);
  assert.equal((await c(`/api/options/${doneOpt.id}`, 'DELETE')).status, 400);

  // 완료 상태를 하나 더 만들면 기존 것을 해제할 수 있다
  await c('/api/options/status', 'POST', { name: '취소', done: true });
  assert.equal((await c(`/api/options/${doneOpt.id}`, 'PATCH', { done: false })).status, 200);
  assert.deepEqual([...(await meta()).statuses.filter((o) => o.done).map((o) => o.name)], ['취소']);

  // '완료'가 더 이상 끝난 상태가 아니므로 보관 대상에서도 빠진다
  await c('/api/tasks', 'POST', {
    title: '옛날 완료', type: '개발', status: '완료', category: '기타',
    priority: 'Medium', start: '2025-01-01', due: '2025-01-02',
  });
  assert.equal((await (await c('/api/archivable?before=2026-01-01')).json()).count, 0,
    'done 플래그가 빠진 상태는 완료로 세지 않는다');
  await c('/api/tasks', 'POST', {
    title: '취소된 건', type: '개발', status: '취소', category: '기타',
    priority: 'Medium', start: '2025-01-01', due: '2025-01-02',
  });
  assert.equal((await (await c('/api/archivable?before=2026-01-01')).json()).count, 1);

  // 마지막 항목은 지울 수 없다
  for (const o of (await meta()).priorities.slice(1)) await c(`/api/options/${o.id}`, 'DELETE');
  const last = (await meta()).priorities;
  assert.equal(last.length, 1);
  assert.equal((await c(`/api/options/${last[0].id}`, 'DELETE')).status, 400);
});

test('보관 — 오래된 완료분만 빠지고 되돌릴 수 있다', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  t.after(() => srv.close());
  const b = `http://localhost:${srv.address().port}`;
  const c = (p, method = 'GET', body) =>
    fetch(b + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

  const base = { type: '운영', category: '기타', priority: 'Medium' };
  const mk = async (title, status, due) =>
    (await (await c('/api/tasks', 'POST', { ...base, title, status, start: due, due })).json());

  const oldDone = await mk('작년 완료', '완료', '2025-01-10');
  const newDone = await mk('최근 완료', '완료', '2026-07-20');
  const oldOpen = await mk('오래된 미완료', '진행 중', '2025-02-01');

  const CUT = '2026-01-01';
  assert.equal((await (await c(`/api/archivable?before=${CUT}`)).json()).count, 1, '미리보기는 대상만 센다');

  const res = await (await c('/api/tasks/archive', 'POST', { before: CUT })).json();
  assert.equal(res.archived, 1);

  // 기본 조회에서 빠지고, 완료·미완료 다른 건은 그대로
  const active = await (await c('/api/tasks')).json();
  const ids = active.map((x) => x.id);
  assert.ok(!ids.includes(oldDone.id), '보관된 건은 기본 목록에서 빠진다');
  assert.ok(ids.includes(newDone.id), '기준일 이후 완료분은 남는다');
  assert.ok(ids.includes(oldOpen.id), '미완료는 오래돼도 보관하지 않는다');

  // 보관 목록에서는 보인다
  const archived = await (await c('/api/tasks?archived=1')).json();
  assert.deepEqual(archived.map((x) => x.id), [oldDone.id]);

  // 두 번 돌려도 중복 보관되지 않는다
  assert.equal((await (await c('/api/tasks/archive', 'POST', { before: CUT })).json()).archived, 0);

  // 복원
  await c(`/api/tasks/${oldDone.id}`, 'PATCH', { archived: 0 });
  assert.ok((await (await c('/api/tasks')).json()).map((x) => x.id).includes(oldDone.id));
  assert.equal((await (await c('/api/tasks?archived=1')).json()).length, 0);

  // 잘못된 기준일은 거부 — 형태뿐 아니라 실재하지 않는 날짜도
  for (const bad of ['어제', '2026-13-01', '2026-02-30', '', undefined]) {
    assert.equal((await c('/api/tasks/archive', 'POST', { before: bad })).status, 400, `before=${bad}`);
  }

  // 같은 검증이 마감일·시작일에도 걸린다
  for (const bad of ['2026-13-01', '2026-02-30', '2026-04-31']) {
    assert.equal((await c('/api/tasks', 'POST', { ...base, title: 'x', status: '시작 전', start: '2026-01-01', due: bad })).status, 400, `due=${bad}`);
  }
});

test('완료 시각(done_at) — 전환 순간에만 찍히고 보관 기준이 된다', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  t.after(() => srv.close());
  const b = `http://localhost:${srv.address().port}`;
  const c = (p, method = 'GET', body) =>
    fetch(b + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

  const today = new Date();
  const TODAY = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const task = await (await c('/api/tasks', 'POST', {
    title: '완료시각', type: '운영', status: '시작 전', category: '기타', priority: 'Medium',
    start: '2025-03-01', due: '2025-03-05',
  })).json();
  assert.equal(task.done_at, null, '미완료는 비어 있다');

  // 완료로 넘어가는 순간 찍힌다
  const done = await (await c(`/api/tasks/${task.id}`, 'PATCH', { status: '완료' })).json();
  assert.equal(done.done_at?.slice(0, 10), TODAY, '전환 시각은 오늘');

  // 이미 완료된 건을 다시 저장해도 밀리지 않는다
  const again = await (await c(`/api/tasks/${task.id}`, 'PATCH', { memo: '수정' })).json();
  assert.equal(again.done_at, done.done_at, '재저장으로 시각이 갱신되지 않는다');

  // 되돌리면 지워진다
  const back = await (await c(`/api/tasks/${task.id}`, 'PATCH', { status: '진행 중' })).json();
  assert.equal(back.done_at, null, '완료를 풀면 시각도 사라진다');

  // 다시 완료 → 마감일(2025-03-05)은 한참 지났지만 오늘 끝냈으므로 보관 대상이 아니다
  await c(`/api/tasks/${task.id}`, 'PATCH', { status: '완료' });
  assert.equal((await (await c('/api/archivable?before=2026-01-01')).json()).count, 0,
    '마감일이 아니라 완료 시각으로 판단한다');

  // done_at이 없는 구버전 행은 마감일로 갈음한다
  db.prepare('UPDATE tasks SET done_at = NULL WHERE id = ?').run(task.id);
  assert.equal((await (await c('/api/archivable?before=2026-01-01')).json()).count, 1,
    'done_at이 없으면 마감일을 근사치로 쓴다');
});

test('체크리스트 CRUD + 태스크 삭제 시 CASCADE', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  t.after(() => srv.close());
  const b = `http://localhost:${srv.address().port}`;
  const c = (p, method = 'GET', body) =>
    fetch(b + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

  // 시드 체크리스트가 태스크에 묶여서 내려온다
  const seeded = (await (await c('/api/tasks')).json()).find((x) => x.id === 1);
  assert.equal(seeded.subtasks.length, 4);
  assert.equal(seeded.subtasks.filter((s) => s.done).length, 2);
  assert.deepEqual(seeded.subtasks.map((s) => s.sort), [0, 1, 2, 3], 'sort 순서 유지');

  // 추가 — sort는 이어서 붙는다
  const added = await (await c('/api/tasks/1/subtasks', 'POST', { title: '배포 공지' })).json();
  assert.equal(added.sort, 4);
  assert.equal(added.done, 0);
  assert.equal((await c('/api/tasks/1/subtasks', 'POST', { title: '  ' })).status, 400);
  assert.equal((await c('/api/tasks/9999/subtasks', 'POST', { title: 'x' })).status, 404);

  // 토글 — boolean 수용, 잘못된 값은 400
  assert.equal((await (await c(`/api/subtasks/${added.id}`, 'PATCH', { done: true })).json()).done, 1);
  assert.equal((await (await c(`/api/subtasks/${added.id}`, 'PATCH', { title: '배포 공지 발송' })).json()).done, 1, 'title만 고쳐도 done 보존');
  assert.equal((await c(`/api/subtasks/${added.id}`, 'PATCH', { done: 'yes' })).status, 400);

  // 삭제
  assert.equal((await c(`/api/subtasks/${added.id}`, 'DELETE')).status, 204);
  assert.equal((await (await c('/api/tasks')).json()).find((x) => x.id === 1).subtasks.length, 4);

  // ── 순서 변경 ──
  const subsOf = async () => (await (await c('/api/tasks')).json()).find((x) => x.id === 1).subtasks;
  const ids = (await subsOf()).map((s) => s.id);

  // 뒤집으면 그대로 반영되고 sort는 0..n-1로 다시 매겨진다
  const flipped = await (await c('/api/tasks/1/subtasks/order', 'PATCH', { ids: [...ids].reverse() })).json();
  assert.deepEqual(flipped.map((s) => s.id), [...ids].reverse());
  assert.deepEqual(flipped.map((s) => s.sort), [0, 1, 2, 3], 'sort 재부여');
  assert.deepEqual((await subsOf()).map((s) => s.id), [...ids].reverse(), '조회 시에도 새 순서');

  // 부분 목록·중복·남의 항목·배열 아닌 값은 거부 (순서가 깨지면 안 됨)
  for (const bad of [{ ids: ids.slice(0, 2) }, { ids: [ids[0], ids[0], ids[1], ids[2]] }, { ids: [...ids.slice(1), 9999] }, { ids: 'x' }]) {
    assert.equal((await c('/api/tasks/1/subtasks/order', 'PATCH', bad)).status, 400);
  }
  assert.deepEqual((await subsOf()).map((s) => s.id), [...ids].reverse(), '거부된 요청은 순서를 바꾸지 않는다');
  assert.equal((await c('/api/tasks/2/subtasks/order', 'PATCH', { ids })).status, 404, '항목 없는 태스크');

  // 태스크를 지우면 하위 항목도 함께 사라진다
  await c('/api/tasks/1', 'DELETE');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subtasks WHERE task_id = 1').get().n, 0, 'CASCADE 동작');
});

test('상하위 태스크 — 1단계 제한 + 삭제 시 연결만 해제', async (t) => {
  const db = openDb(':memory:');
  const srv = createApp(db).listen(0);
  t.after(() => srv.close());
  const b = `http://localhost:${srv.address().port}`;
  const c = (p, method = 'GET', body) =>
    fetch(b + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });

  const base = { type: '개발', status: '시작 전', category: '기타', priority: 'Medium', start: '2026-08-01', due: '2026-08-10' };
  const mk = async (title, extra = {}) => (await (await c('/api/tasks', 'POST', { ...base, title, ...extra })).json());

  const parent = await mk('상위');
  const child = await mk('하위', { parent_id: parent.id });
  assert.equal(child.parent_id, parent.id, '생성 시 상위 지정');

  // 1단계 제한 — 손자도, 자기 자신도, 없는 상위도 안 된다
  assert.equal((await c('/api/tasks', 'POST', { ...base, title: '손자', parent_id: child.id })).status, 400);
  assert.equal((await c(`/api/tasks/${parent.id}`, 'PATCH', { parent_id: parent.id })).status, 400, '자기 자신');
  assert.equal((await c(`/api/tasks/${parent.id}`, 'PATCH', { parent_id: 9999 })).status, 400, '없는 상위');
  assert.equal((await c(`/api/tasks/${parent.id}`, 'PATCH', { parent_id: child.id })).status, 400, '하위를 가진 태스크는 하위가 못 된다');

  // 연결 해제 후에는 상위가 될 수 있다
  const other = await mk('제3');
  assert.equal((await (await c(`/api/tasks/${child.id}`, 'PATCH', { parent_id: null })).json()).parent_id, null);
  assert.equal((await (await c(`/api/tasks/${child.id}`, 'PATCH', { parent_id: other.id })).json()).parent_id, other.id);

  // 다른 필드 수정은 상위 연결을 건드리지 않는다
  assert.equal((await (await c(`/api/tasks/${child.id}`, 'PATCH', { status: '진행 중' })).json()).parent_id, other.id);

  // 상위를 지워도 하위는 남고 연결만 끊긴다 (삭제 버튼에 확인이 없어 CASCADE는 쓰지 않는다)
  await c(`/api/tasks/${other.id}`, 'DELETE');
  const left = (await (await c('/api/tasks')).json()).find((x) => x.id === child.id);
  assert.ok(left, '하위 태스크는 살아남는다');
  assert.equal(left.parent_id, null);
});

test('구버전 categories 테이블 → options 이관', (t) => {
  const file = path.join(os.tmpdir(), `mywork-mig-${process.pid}.db`);
  const clean = () => ['', '-wal', '-shm'].forEach((s) => rmSync(file + s, { force: true }));
  clean();
  t.after(clean);

  // 구버전 스키마 그대로 만들어 둔다 — 분류는 별도 테이블, 태스크는 그 분류를 참조
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
    INSERT INTO categories (name) VALUES ('가분류'),('나분류');
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
      category TEXT NOT NULL, priority TEXT NOT NULL, start TEXT NOT NULL, due TEXT NOT NULL, memo TEXT NOT NULL DEFAULT '');
    INSERT INTO tasks (title, type, status, category, priority, start, due)
      VALUES ('옛 태스크','개발','진행 중','다분류','High','2026-01-01','2026-01-02');
  `);
  old.close();

  const db = openDb(file);
  assert.deepEqual(store.listCategories(db), ['가분류', '나분류', '다분류'],
    '순서를 유지하고, 표에 없던 분류(다분류)도 주워 담는다');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'categories'").get().n, 0, '구버전 표는 사라진다');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tasks').get().n, 1, '기존 DB에는 예시 데이터를 넣지 않는다');
  db.close(); // 윈도우에서는 열린 파일을 지울 수 없다
});
