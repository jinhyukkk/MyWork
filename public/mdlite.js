// AI 답변용 마크다운 → HTML. 브라우저(app.js)와 테스트가 같은 함수를 쓴다.
// 라이브러리 대신 직접 쓰는 이유: 모델 답변에 나오는 문법(제목·목록·굵게·코드·표·링크)만 그리면 되고,
// 먼저 전부 이스케이프한 뒤 태그를 붙이므로 모델 출력에 섞인 HTML이 그대로 실행될 길이 없다.
// shortcut: 중첩 목록은 들여쓰기를 무시하고 한 단계로 그린다 — 깊은 목록이 자주 보이면 그때 스택으로 바꾼다.

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 이미 이스케이프된 한 줄에 인라인 서식을 입힌다. 코드 스팬 안은 서식을 건드리지 않는다. */
function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    // http(s)만 링크로 — javascript: 같은 스킴을 막는다
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const UL = /^\s*[-*+]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

export function renderMd(src) {
  const lines = esc(String(src ?? '').replace(/\r\n?/g, '\n')).split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      const body = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i]);
      i++; // 닫는 ``` (없으면 끝까지 코드로 본다)
      out.push(`<pre><code>${body.join('\n')}</code></pre>`);
    } else if (/^#{1,6}\s/.test(l)) {
      const n = Math.min(l.match(/^#+/)[0].length + 2, 6); // 말풍선 안이라 h3부터 — 화면 제목보다 커지지 않게
      out.push(`<h${n}>${inline(l.replace(/^#+\s+/, ''))}</h${n}>`);
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) {
      out.push('<hr>');
      i++;
    } else if (l.includes('|') && TABLE_SEP.test(lines[i + 1] ?? '')) {
      const head = cells(l);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) rows.push(cells(lines[i]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
        + `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (UL.test(l) || OL.test(l)) {
      const re = UL.test(l) ? UL : OL;
      const tag = re === UL ? 'ul' : 'ol';
      const items = [];
      for (; i < lines.length && re.test(lines[i]); i++) items.push(lines[i].match(re)[1]);
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`);
    } else if (/^&gt;\s?/.test(l)) {
      const q = [];
      for (; i < lines.length && /^&gt;\s?/.test(lines[i]); i++) q.push(inline(lines[i].replace(/^&gt;\s?/, '')));
      out.push(`<blockquote>${q.join('<br>')}</blockquote>`);
    } else if (!l.trim()) {
      i++;
    } else {
      // 문단 — 다음 빈 줄이나 다른 블록이 나올 때까지. 한 줄 바꿈은 <br>로 살린다(모델이 줄을 의도해서 끊는다).
      const p = [];
      for (; i < lines.length && lines[i].trim() && !/^\s*```|^#{1,6}\s|^&gt;/.test(lines[i]) && !UL.test(lines[i]) && !OL.test(lines[i]); i++) p.push(inline(lines[i]));
      out.push(`<p>${p.join('<br>')}</p>`);
    }
  }
  return out.join('');
}
