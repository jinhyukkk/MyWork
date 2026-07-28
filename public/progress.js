// 진척 계산. 브라우저(app.js)와 테스트가 같은 함수를 쓴다.

/** 체크리스트 진행 현황. 항목이 없으면 total 0 → UI에서 숨김. */
export function checklist(t) {
  const subs = t.subtasks ?? [];
  const done = subs.filter((s) => s.done).length;
  return { done, total: subs.length, pct: subs.length ? (done / subs.length) * 100 : 0 };
}

/**
 * 태스크 하나의 진척도 0~1.
 * 끝난 상태면 체크 여부와 무관하게 1. 아니면 체크된 항목만 인정하고,
 * 체크리스트가 없으면 0 — 진행 중이라는 이유로 점수를 주지 않는다(임의의 가중치 금지).
 *
 * '끝남'의 판단은 isDone으로 주입받는다. 진행상황 이름은 사용자가 바꿀 수 있으므로
 * '완료'라는 문자열에 기대지 않는다.
 */
export function taskProgress(t, isDone) {
  if (isDone(t.status)) return 1;
  const c = checklist(t);
  return c.total ? c.done / c.total : 0;
}

/** 여러 태스크의 평균 진척률(%). 빈 목록은 0. */
export function weightedPct(tasks, isDone) {
  if (!tasks.length) return 0;
  return Math.round((tasks.reduce((sum, t) => sum + taskProgress(t, isDone), 0) / tasks.length) * 100);
}

/** 태스크 묶음의 체크리스트 항목 합계. */
export function checklistTotals(tasks) {
  return tasks.reduce((acc, t) => {
    const c = checklist(t);
    return { done: acc.done + c.done, total: acc.total + c.total };
  }, { done: 0, total: 0 });
}
