// 목록 뷰 묶음. 브라우저(app.js)와 테스트가 같은 함수를 쓴다.

/**
 * 태스크를 그룹으로 나눈다. 입력은 이미 마감일 순으로 정렬돼 있다고 보고 그 순서를 지킨다.
 * 완료 건은 어느 모드든 뒤로 — 첫 화면이 끝난 일로 시작하지 않게.
 * @param {'status'|'category'|'due'} mode
 * @returns {{ key: string, items: object[] }[]} 빈 그룹은 뺀다
 */
export function groupTasks(tasks, mode, { statuses, categories, isDone }) {
  const doneLast = (arr) => [...arr.filter((t) => !isDone(t.status)), ...arr.filter((t) => isDone(t.status))];
  if (mode === 'due') return tasks.length ? [{ key: 'all', items: doneLast(tasks) }] : [];
  const field = mode === 'status' ? 'status' : 'category';
  // 상태별은 done 상태 그룹을 맨 뒤로 보낸다(설정에서 완료가 중간에 있어도)
  const keys = mode === 'status' ? [...statuses.filter((s) => !isDone(s)), ...statuses.filter(isDone)] : categories;
  return keys
    .map((key) => ({ key, items: doneLast(tasks.filter((t) => t[field] === key)) }))
    .filter((g) => g.items.length);
}

/**
 * 하위 태스크를 같은 그룹 안의 상위 바로 뒤에 붙인다(상하위는 1단계뿐).
 * 상위가 다른 그룹에 있거나 필터에 걸려 없으면 제자리에 일반 행으로 둔다.
 */
export function nest(items) {
  const here = new Set(items.map((t) => t.id));
  const kids = new Map();
  for (const t of items) if (t.parent_id && here.has(t.parent_id)) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]);
  return items.flatMap((t) => ((t.parent_id && here.has(t.parent_id))
    ? []
    : [{ t, sub: false }, ...(kids.get(t.id) ?? []).map((k) => ({ t: k, sub: true }))]));
}
