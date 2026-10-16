// AI 답변 마크다운 렌더러(public/mdlite.js) 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMd } from './public/mdlite.js';

test('모델 출력에 섞인 HTML은 이스케이프된다', () => {
  assert.equal(renderMd('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
});

test('javascript: 링크는 링크로 만들지 않는다', () => {
  assert.equal(renderMd('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.match(renderMd('[문서](https://a.b/c?d=1&e=2)'), /<a href="https:\/\/a\.b\/c\?d=1&amp;e=2" target="_blank" rel="noopener noreferrer">문서<\/a>/);
});

test('인라인 — 굵게·기울임·코드, 코드 안은 서식을 입히지 않는다', () => {
  assert.equal(renderMd('**굵게** *기울임* `a**b**`'), '<p><strong>굵게</strong> <em>기울임</em> <code>a**b**</code></p>');
  assert.equal(renderMd('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
});

test('블록 — 제목·목록·문단 줄바꿈', () => {
  assert.equal(renderMd('## 오늘\n- 배포 점검\n- 회고\n\n1. 하나\n2. 둘\n\n첫 줄\n둘째 줄'),
    '<h4>오늘</h4><ul><li>배포 점검</li><li>회고</li></ul><ol><li>하나</li><li>둘</li></ol><p>첫 줄<br>둘째 줄</p>');
});

test('코드 블록 안은 그대로, 닫지 않아도 끝까지 코드', () => {
  assert.equal(renderMd('```js\nconst a = **1**;\n```'), '<pre><code>const a = **1**;</code></pre>');
  assert.equal(renderMd('```\nx'), '<pre><code>x</code></pre>');
});

test('표', () => {
  assert.equal(renderMd('| 태스크 | 마감 |\n|---|:---:|\n| 배포 | 10/20 |'),
    '<table><thead><tr><th>태스크</th><th>마감</th></tr></thead><tbody><tr><td>배포</td><td>10/20</td></tr></tbody></table>');
});
