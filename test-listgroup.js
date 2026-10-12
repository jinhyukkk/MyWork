// 목록 뷰 묶음 검증. 순수 함수라 브라우저 없이 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTasks, nest } from './public/listgroup.js';

const ctx = { statuses: ['할 일', '완료', '진행 중'], categories: ['A', 'B'], isDone: (s) => s === '완료' };
const t = (id, status, category, parent_id = null) => ({ id, status, category, parent_id });
const ids = (groups) => groups.map((g) => [g.key, g.items.map((x) => x.id)]);

test('groupTasks — 상태별: 설정 순서, done 그룹은 맨 뒤, 빈 그룹 제외', () => {
  const list = [t(1, '완료', 'A'), t(2, '진행 중', 'B'), t(3, '할 일', 'A')];
  assert.deepEqual(ids(groupTasks(list, 'status', ctx)), [['할 일', [3]], ['진행 중', [2]], ['완료', [1]]]);
});

test('groupTasks — 분류별: 설정 순서, 그룹 안에서 완료 건은 뒤로', () => {
  const list = [t(1, '완료', 'A'), t(2, '할 일', 'A'), t(3, '진행 중', 'B')];
  assert.deepEqual(ids(groupTasks(list, 'category', ctx)), [['A', [2, 1]], ['B', [3]]]);
});

test('groupTasks — 마감순: 그룹 하나, 입력 순서 유지 + 완료 건 뒤로, 비면 빈 배열', () => {
  const list = [t(1, '완료', 'A'), t(2, '할 일', 'B'), t(3, '진행 중', 'A')];
  assert.deepEqual(ids(groupTasks(list, 'due', ctx)), [['all', [2, 3, 1]]]);
  assert.deepEqual(groupTasks([], 'due', ctx), []);
});

test('nest — 같은 그룹의 하위는 상위 뒤로, 상위가 없으면 제자리', () => {
  const items = [t(5, '할 일', 'A', 1), t(1, '할 일', 'A'), t(2, '할 일', 'A'), t(6, '할 일', 'A', 9)];
  assert.deepEqual(nest(items).map(({ t: x, sub }) => [x.id, sub]), [[1, false], [5, true], [2, false], [6, false]]);
});
