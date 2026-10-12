// 웹 AI 지시창 — 자연어 지시를 Claude가 tools.js 도구(MCP와 같은 도구·규칙)로 수행한다.
import Anthropic from '@anthropic-ai/sdk';
import { createTools } from './tools.js';

const MODEL = 'claude-opus-5-5';
// ponytail: 한 지시당 도구 왕복 상한. 일괄 정리처럼 긴 작업이 잘리면 늘린다.
const MAX_STEPS = 12;
const HISTORY = 20; // 이전 대화는 최근 N턴(텍스트만)만 넘긴다

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const system = () => `당신은 개인 업무 관리 앱 MyWork의 비서다. 사용자의 지시를 도구로 직접 수행한다.
- 오늘은 ${iso(new Date())} (${'일월화수목금토'[new Date().getDay()]}요일). "내일", "다음 주 금요일" 같은 표현은 YYYY-MM-DD로 바꿔 쓴다.
- 대상 태스크가 모호하면 먼저 list_tasks로 찾고, 후보가 여럿이면 실행하지 말고 되묻는다.
- 삭제는 사용자가 명시적으로 지시했을 때만 한다.
- 실행 후에는 무엇을 바꿨는지 한국어로 짧게 보고한다(제목·변경 내용). 마크다운 표·헤더는 쓰지 않는다.`;

// 워크스페이스에 묶이지 않은(조직 단위) 키는 매 요청에 워크스페이스 id 헤더가 필요하다.
// SDK는 이 변수를 페더레이션·프로필 인증일 때만 읽으므로 API 키 경로에선 직접 붙인다.
const defaultClient = () => {
  const ws = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(ws ? { defaultHeaders: { 'anthropic-workspace-id': ws } } : {});
};

/**
 * @param db  node:sqlite DB — 웹 서버와 같은 연결을 쓴다
 * @param getClient  테스트에서 가짜 클라이언트를 주입하기 위한 훅
 */
export function createAgent(db, getClient = defaultClient) {
  const { TOOLS, call } = createTools(db);
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
  let client;

  /**
   * @param history [{ role: 'user'|'assistant', content: string }] — 마지막이 이번 지시
   * @returns {{ reply: string, actions: { tool: string, input: object, error: boolean }[] }}
   */
  return async function run(history) {
    client ??= getClient();
    // 이전 턴은 텍스트만 다시 보낸다(thinking 블록을 재전송하지 않으므로 이력 편집 검사와 무관)
    const messages = history.slice(-HISTORY).map(({ role, content }) => ({ role, content }));
    const actions = [];

    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default', // 안전 분류기가 거절하면 서버가 다른 모델로 재시도
        cache_control: { type: 'ephemeral' }, // 도구 정의·시스템 프롬프트가 매번 같아 캐시가 잘 맞는다
        system: system(),
        tools,
        messages,
      });

      if (res.stop_reason === 'refusal') return { reply: '요청을 처리할 수 없습니다(안전 정책).', actions };
      messages.push({ role: 'assistant', content: res.content });
      if (res.stop_reason === 'pause_turn') continue;

      const uses = res.content.filter((b) => b.type === 'tool_use');
      if (res.stop_reason !== 'tool_use' || !uses.length) {
        const reply = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
        return { reply: reply || '(응답 없음)', actions };
      }

      // 같은 턴의 결과는 한 user 메시지에 모아 보낸다
      messages.push({
        role: 'user',
        content: uses.map((u) => {
          const r = call(u.name, u.input ?? {});
          actions.push({ tool: u.name, input: u.input, error: !!r.isError });
          return { type: 'tool_result', tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
        }),
      });
    }
    return { reply: `작업이 길어 ${MAX_STEPS}단계에서 멈췄습니다. 이어서 지시해 주세요.`, actions };
  };
}
