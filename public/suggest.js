// 홈 «제안하는 다음 행동». 브라우저(app.js)와 테스트가 같은 함수를 쓴다.
// AI가 아니라 규칙이다 — 화면을 열 때마다 모델을 부르지 않는다. 제안만 하고, 승인해야 PATCH가 나간다.

/**
 * 제안 목록. 각 항목의 changes는 승인 때 보낼 PATCH와 취소 때 되돌릴 이전 값이다.
 * 반복 태스크는 완료 제안에서 뺀다 — 완료 PATCH 때 서버가 다음 회차를 만들어서 «취소»로 되돌릴 수 없다.
 * @param {object[]} tasks 보관 안 된 태스크 (subtasks 포함)
 * @param {{today: string, isDone: Function, isWaiting: Function, doneStatus?: string, openStatus?: string, max?: number}} ctx
 */
export function suggest(tasks, { today, isDone, isWaiting, doneStatus, openStatus, max = 4 }) {
  const open = tasks.filter((t) => !isDone(t.status));
  const change = (t, patch) => ({ id: t.id, patch, undo: Object.fromEntries(Object.keys(patch).map((k) => [k, t[k] ?? null])) });
  const out = [];

  // 1) 지연 — 한 건으로 묶는다. 하나씩 늘어놓으면 제안 칸이 지연으로만 찬다.
  const late = open.filter((t) => !isWaiting(t.status) && t.due && t.due < today).sort((a, b) => a.due.localeCompare(b.due));
  if (late.length) {
    const days = Math.round((Date.parse(today) - Date.parse(late[0].due)) / 86400000);
    out.push({
      key: 'late', src: 'DUE', title: `지연 ${late.length}건 마감을 오늘로 옮기기`,
      why: `가장 오래된 «${late[0].title}» ${days}일 지연`,
      changes: late.map((t) => change(t, { due: today })),
    });
  }

  if (doneStatus) {
    for (const t of open) {
      if (t.repeat_days > 0 || isWaiting(t.status)) continue;
      // 2) 체크리스트를 다 끝냈는데 태스크는 열려 있다
      const subs = t.subtasks ?? [];
      if (subs.length && subs.every((s) => s.done)) {
        out.push({ key: `chk:${t.id}`, src: 'CHK', title: `«${t.title}» 완료 처리`, why: `체크리스트 ${subs.length}/${subs.length} 완료`, changes: [change(t, { status: doneStatus })] });
        continue;
      }
      // 3) 하위를 다 끝냈는데 상위는 열려 있다
      const kids = tasks.filter((k) => k.parent_id === t.id);
      if (kids.length && kids.every((k) => isDone(k.status))) {
        out.push({ key: `sub:${t.id}`, src: 'SUB', title: `«${t.title}» 완료 처리`, why: `하위 ${kids.length}건 모두 완료`, changes: [change(t, { status: doneStatus })] });
      }
    }
  }

  // 4) 마감이 지난 대기 — 회신이 안 왔으면 다시 내 차례다
  if (openStatus) {
    for (const t of open) {
      if (isWaiting(t.status) && t.due && t.due < today) {
        out.push({ key: `wait:${t.id}`, src: 'WAIT', title: `«${t.title}» 다시 내 차례로`, why: `${t.due.slice(5).replace('-', '/')} 마감 지남 · 대기 중`, changes: [change(t, { status: openStatus })] });
      }
    }
  }
  return out.slice(0, max);
}
