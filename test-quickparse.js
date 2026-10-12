// 빠른 입력 해석 검증. 순수 함수라 브라우저 없이 돌린다. 기준일 2026-10-12는 월요일.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuick } from './public/quickparse.js';

const ctx = { today: '2026-10-12', categories: ['인사시스템', '유진GPT', 'GPT', 'TOPICS', '기타'] };
const p = (text) => parseQuick(text, ctx);

test('상대 날짜 — 오늘·내일·모레, 뒤의 «까지»도 지운다', () => {
  assert.deepEqual(p('내일 보고서'), { title: '보고서', due: '2026-10-13', category: null });
  assert.equal(p('오늘까지 정산').due, '2026-10-12');
  assert.deepEqual(p('모레'), { title: '', due: '2026-10-14', category: null });
});

test('요일 — 다가오는 그 요일(오늘이면 오늘), 이번 주·다음 주', () => {
  assert.deepEqual(p('금요일까지 발령 에러 확인'), { title: '발령 에러 확인', due: '2026-10-16', category: null });
  assert.equal(p('금 회의 준비').due, '2026-10-16');
  assert.equal(p('월 회의').due, '2026-10-12');
  assert.equal(p('다음주 월요일 배포').due, '2026-10-19');
  assert.equal(p('이번 주 금요일 정리').due, '2026-10-16');
  assert.equal(p('이번주 일요일').due, '2026-10-18');
  assert.equal(p('다음 주 일요일 전까지 점검').due, '2026-10-25');
});

test('월/일 — 지났으면 다음 해, «N일»은 지났으면 다음 달', () => {
  assert.deepEqual(p('10/20 마감 건'), { title: '마감 건', due: '2026-10-20', category: null });
  assert.equal(p('10.20 리뷰').due, '2026-10-20');
  assert.equal(p('10월 20일 리뷰').due, '2026-10-20');
  assert.equal(p('1/5 신년 계획').due, '2027-01-05');
  assert.equal(p('20일 정산').due, '2026-10-20');
  assert.equal(p('5일 정산').due, '2026-11-05');
});

test('오탐 방지 — 단어 속 글자·없는 날짜·«일» 단독은 날짜가 아니다', () => {
  assert.deepEqual(p('금액 확인'), { title: '금액 확인', due: null, category: null });
  assert.deepEqual(p('일 정리'), { title: '일 정리', due: null, category: null });
  assert.deepEqual(p('오늘의 할 일'), { title: '오늘의 할 일', due: null, category: null });
  assert.deepEqual(p('2/30 이상'), { title: '2/30 이상', due: null, category: null });
});

test('날짜가 여럿이면 첫 번째만 쓰고 나머지는 제목에 남긴다', () => {
  assert.deepEqual(p('내일 그리고 금요일'), { title: '그리고 금요일', due: '2026-10-13', category: null });
});

test('분류 — #태그는 지우고 우선, 포함 매칭은 제목에 남기고 최장 이름', () => {
  assert.deepEqual(p('#인사시스템 발령 확인'), { title: '발령 확인', due: null, category: '인사시스템' });
  assert.deepEqual(p('인사시스템 발령 확인'), { title: '인사시스템 발령 확인', due: null, category: '인사시스템' });
  assert.equal(p('유진GPT 교육').category, '유진GPT');
  assert.equal(p('#topics 정리').category, 'TOPICS');
  assert.deepEqual(p('#없는분류 메모'), { title: '#없는분류 메모', due: null, category: null });
  assert.deepEqual(p('금요일까지 #인사시스템 발령 에러 확인'),
    { title: '발령 에러 확인', due: '2026-10-16', category: '인사시스템' });
});
