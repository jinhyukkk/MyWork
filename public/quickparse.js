// 빠른 입력 한 줄 해석. 브라우저(app.js)와 테스트가 같은 함수를 쓴다.
// AI 대신 규칙인 이유: 한 줄에 오는 날짜 표현은 «금요일까지·내일·10/20» 정도라 규칙이면 충분하고,
// Enter마다 수 초를 기다리게 하면 «빨리 적기»라는 목적이 무너진다. 긴 문장은 AI 지시창이 받는다.

const DOW = '일월화수목금토';
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const add = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
// 실재하는 날짜만 — new Date(2026, 1, 30)은 3/2로 넘어가므로 되짚어 확인한다
const valid = (y, m, d) => {
  const x = new Date(y, m - 1, d);
  return x.getFullYear() === y && x.getMonth() === m - 1 && x.getDate() === d ? x : null;
};

// 앞뒤가 글자·숫자면 날짜 표현이 아니다 — «금액»의 금, «오늘의»의 오늘을 잡지 않게
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const SUFFIX = '(?:\\s*(?:전까지|까지는|까지))?'; // 날짜 뒤에 붙는 «까지»류는 표현의 일부로 함께 지운다

/** 규칙 목록. at()이 null이면 그 매치는 날짜가 아니다(예: 2/30). */
const RULES = [
  { re: '(오늘|내일|모레)', at: (m, t) => add(t, ['오늘', '내일', '모레'].indexOf(m[1])) },
  {
    // «일» 한 글자는 «일 정리» 같은 오탐이 잦아 «일요일»만 인정한다
    re: '(?:(이번|다음)\\s*주\\s*)?(?:([월화수목금토])(?:요일)?|(일)요일)',
    at: (m, t) => {
      const dow = DOW.indexOf(m[2] ?? m[3]);
      const monday = add(t, -((t.getDay() + 6) % 7)); // 주는 월~일
      const inWeek = (w) => add(monday, w * 7 + ((dow + 6) % 7));
      if (m[1] === '다음') return inWeek(1);
      if (m[1] === '이번' && inWeek(0) >= t) return inWeek(0);
      return add(t, (dow - t.getDay() + 7) % 7); // 다가오는 그 요일, 오늘이면 오늘
    },
  },
  {
    re: '(\\d{1,2})\\s*(?:[/.]|월\\s*)(\\d{1,2})일?',
    at: (m, t) => {
      const [mo, d] = [Number(m[1]), Number(m[2])];
      const x = valid(t.getFullYear(), mo, d);
      return x && x < t ? valid(t.getFullYear() + 1, mo, d) : x;
    },
  },
  {
    re: '(\\d{1,2})일',
    at: (m, t) => {
      const d = Number(m[1]);
      const x = valid(t.getFullYear(), t.getMonth() + 1, d);
      if (!x || x >= t) return x;
      const next = new Date(t.getFullYear(), t.getMonth() + 1, 1);
      return valid(next.getFullYear(), next.getMonth() + 1, d);
    },
  },
].map((r) => ({ ...r, re: new RegExp(B + r.re + SUFFIX + E, 'gu') }));

/**
 * @param {string} text 사용자가 친 한 줄
 * @param {{ today: string, categories: string[] }} ctx today는 YYYY-MM-DD, categories는 설정 순서
 * @returns {{ title: string, due: string|null, category: string|null }}
 */
export function parseQuick(text, { today, categories }) {
  const [y, mo, d] = today.split('-').map(Number);
  const t = new Date(y, mo - 1, d);

  // 날짜 — 모든 규칙에서 «가장 앞에 나온» 유효한 표현 하나만 쓴다
  let hit = null;
  for (const r of RULES) {
    for (const m of text.matchAll(r.re)) {
      const at = r.at(m, t);
      if (!at) continue;
      if (!hit || m.index < hit.index) hit = { index: m.index, len: m[0].length, due: iso(at) };
      break;
    }
  }
  let rest = hit ? `${text.slice(0, hit.index)} ${text.slice(hit.index + hit.len)}` : text;

  // 분류 — #태그(지움)가 우선, 없으면 이름 포함(제목에 남김, 가장 긴 이름)
  const low = (s) => s.toLowerCase();
  let category = null;
  const tag = rest.match(/(?<!\S)#(\S+)/u);
  const tagged = tag && categories.find((c) => low(c) === low(tag[1]));
  if (tagged) {
    category = tagged;
    rest = rest.replace(tag[0], ' ');
  } else {
    category = [...categories].sort((a, b) => b.length - a.length).find((c) => low(rest).includes(low(c))) ?? null;
  }

  return { title: rest.replace(/\s+/g, ' ').trim(), due: hit?.due ?? null, category };
}
