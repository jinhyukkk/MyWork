// 체크리스트 집계 검증. 순수 함수라 브라우저 없이 돌린다.
// 진척률(taskProgress·weightedPct)은 폐기했다 — 체크리스트를 거의 안 쓰는 데이터에서
// 나온 평균 %가 실제와 무관해서, 요약 뷰에서 숫자를 없애고 함수도 같이 지웠다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklist, checklistTotals } from './public/progress.js';

const t = (status, ...done) => ({ status, subtasks: done.map((d, i) => ({ id: i, done: d })) });

test('checklist / checklistTotals — 집계', () => {
  assert.deepEqual(checklist(t('진행 중', 1, 0, 1)), { done: 2, total: 3, pct: (2 / 3) * 100 });
  assert.deepEqual(checklist(t('진행 중')), { done: 0, total: 0, pct: 0 });
  // subtasks 필드가 아예 없어도 터지지 않는다 (신규 태스크 draft 등)
  assert.deepEqual(checklist({}), { done: 0, total: 0, pct: 0 });

  assert.deepEqual(checklistTotals([t('완료', 1, 1), t('진행 중', 1, 0, 0), t('시작 전')]), { done: 3, total: 5 });
  assert.deepEqual(checklistTotals([]), { done: 0, total: 0 });
});
