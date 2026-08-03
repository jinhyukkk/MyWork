// 체크리스트 집계. 브라우저(app.js)와 테스트가 같은 함수를 쓴다.

/** 체크리스트 진행 현황. 항목이 없으면 total 0 → UI에서 숨김. */
export function checklist(t) {
  const subs = t.subtasks ?? [];
  const done = subs.filter((s) => s.done).length;
  return { done, total: subs.length, pct: subs.length ? (done / subs.length) * 100 : 0 };
}

/**
 * 진척률(taskProgress·weightedPct)은 폐기했다.
 * 44건에 체크리스트 항목이 3개뿐이라 평균값이 «데이터 없는 계산»이었고,
 * 요약 뷰가 실제와 무관한 숫자를 자신 있게 띄우는 쪽이 안 띄우는 것보다 나빴다.
 * 개별 카운트 배지(2/5)는 정보가 있으므로 아래 두 함수로 남는다.
 */

/** 태스크 묶음의 체크리스트 항목 합계. */
export function checklistTotals(tasks) {
  return tasks.reduce((acc, t) => {
    const c = checklist(t);
    return { done: acc.done + c.done, total: acc.total + c.total };
  }, { done: 0, total: 0 });
}
