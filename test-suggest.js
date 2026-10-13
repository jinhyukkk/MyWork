// 홈 제안 규칙 검증. 순수 함수라 브라우저 없이 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest } from './public/suggest.js';

const ctx = {
  today: '2026-10-13', doneStatus: '완료', openStatus: '진행 전',
  isDone: (s) => s === '완료', isWaiting: (s) => s === '대기 중',
};
const t = (id, o = {}) => ({ id, title: `T${id}`, status: '진행 중', due: null, repeat_days: 0, parent_id: null, subtasks: [], ...o });

test('지연은 한 건으로 묶고, 이전 마감을 취소용으로 남긴다 — 대기는 지연이 아니다', () => {
  const [s, ...rest] = suggest([t(1, { due: '2026-10-10' }), t(2, { due: '2026-10-12' }), t(3, { due: '2026-10-01', status: '대기 중' }), t(4, { due: '2026-10-13' })], ctx);
  assert.equal(s.src, 'DUE');
  assert.equal(s.title, '지연 2건 마감을 오늘로 옮기기');
  assert.match(s.why, /«T1» 3일 지연/);
  assert.deepEqual(s.changes[0], { id: 1, patch: { due: '2026-10-13' }, undo: { due: '2026-10-10' } });
  assert.deepEqual(rest.map((x) => x.src), ['WAIT']); // 마감 지난 대기
});

test('체크리스트·하위를 다 끝낸 열린 태스크는 완료 제안 — 반복 태스크는 제외', () => {
  const done = [{ done: 1 }, { done: 1 }];
  const r = suggest([
    t(1, { subtasks: done }), t(2, { subtasks: done, repeat_days: 7 }), t(3, { subtasks: [{ done: 1 }, { done: 0 }] }),
    t(4), t(5, { parent_id: 4, status: '완료' }), t(6, { status: '완료', subtasks: done }),
  ], ctx);
  assert.deepEqual(r.map((x) => x.key), ['chk:1', 'sub:4']);
  assert.deepEqual(r[0].changes[0].undo, { status: '진행 중' });
});

test('최대 개수와 빈 경우', () => {
  assert.deepEqual(suggest([t(1)], ctx), []);
  const many = Array.from({ length: 9 }, (_, i) => t(i + 1, { status: '대기 중', due: '2026-10-01' }));
  assert.equal(suggest(many, ctx).length, 4);
});
