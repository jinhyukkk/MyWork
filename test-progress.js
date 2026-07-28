// 요약 뷰 진척률 계산 검증. 순수 함수라 브라우저 없이 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklist, taskProgress, weightedPct, checklistTotals } from './public/progress.js';

const DONE = (s) => s === '완료';
const t = (status, ...done) => ({ status, subtasks: done.map((d, i) => ({ id: i, done: d })) });

test('taskProgress — 체크리스트 반영', () => {
  assert.equal(taskProgress(t('시작 전'), DONE), 0);
  assert.equal(taskProgress(t('진행 중'), DONE), 0, '체크리스트가 없으면 진행 중이어도 0 (임의 가중치 금지)');
  assert.equal(taskProgress(t('완료'), DONE), 1);

  assert.equal(taskProgress(t('진행 중', 1, 0, 0, 0), DONE), 0.25);
  assert.equal(taskProgress(t('진행 중', 1, 1, 1, 1), DONE), 1, '전부 체크하면 1 (상태는 그대로 진행 중)');

  // 완료 태스크는 미체크 항목이 남아 있어도 1
  assert.equal(taskProgress(t('완료', 0, 0), DONE), 1);

  // subtasks 필드가 아예 없어도 터지지 않는다 (신규 태스크 draft 등)
  assert.equal(taskProgress({ status: '진행 중' }, DONE), 0);
});

test('weightedPct — 평균 진척률', () => {
  assert.equal(weightedPct([], DONE), 0, '빈 목록은 0 (0으로 나누지 않는다)');
  assert.equal(weightedPct([t('완료'), t('시작 전')], DONE), 50);

  // 체크리스트가 진척으로 잡히는지 — 상태만 보면 33%, 체크 반영하면 50%
  const list = [t('완료'), t('진행 중', 1, 1, 0, 0), t('시작 전')];
  assert.equal(Math.round((1 / 3) * 100), 33, '상태 기준 완료율');
  assert.equal(weightedPct(list, DONE), 50);

  // 항목을 하나 더 체크하면 올라간다
  assert.ok(weightedPct([t('진행 중', 1, 1, 1, 0)], DONE) > weightedPct([t('진행 중', 1, 1, 0, 0)], DONE));

  // 체크리스트가 하나도 없으면 기존 완료율과 같아야 한다 (회귀 방지)
  const plain = [t('완료'), t('완료'), t('진행 중'), t('시작 전')];
  assert.equal(weightedPct(plain, DONE), 50);
});

test('checklist / checklistTotals — 집계', () => {
  assert.deepEqual(checklist(t('진행 중', 1, 0, 1)), { done: 2, total: 3, pct: (2 / 3) * 100 });
  assert.deepEqual(checklist(t('진행 중')), { done: 0, total: 0, pct: 0 });
  assert.deepEqual(checklist({}), { done: 0, total: 0, pct: 0 });

  assert.deepEqual(checklistTotals([t('완료', 1, 1), t('진행 중', 1, 0, 0), t('시작 전')]), { done: 3, total: 5 });
  assert.deepEqual(checklistTotals([]), { done: 0, total: 0 });
});
