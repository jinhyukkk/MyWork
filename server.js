// MyWork REST API + 정적 프론트 서빙. 데이터 규칙은 전부 store.js에 있다.
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { createAgent } from './ai.js';
import { createAdvisor } from './advise.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import * as store from './store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// mcp.js와 같은 환경변수로 DB 경로를 바꿀 수 있다 (테스트·격리 실행용)
export function createApp(db = openDb(process.env.MYWORK_DB_PATH), getAiClient = undefined) {
  const app = express();
  app.use(express.json());
  // 뷰별 페이지가 물리 파일로 나뉘어 있다 — /summary → summary.html
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
  app.get('/', (_req, res) => res.redirect('/home'));

  /** store 결과를 HTTP 응답으로 옮긴다. */
  const reply = (res, result, okStatus = 200) =>
    result.error
      ? res.status(result.status ?? 400).json({ error: result.error })
      : res.status(okStatus).json(result.data);

  // 설정 항목은 이름만이 아니라 색상·done 플래그까지 내려간다 (프론트가 색을 직접 들고 있지 않도록)
  app.get('/api/meta', (_req, res) => {
    res.json({
      statuses: store.listOptions(db, 'status'),
      categories: store.listOptions(db, 'category'),
    });
  });

  app.post('/api/options/:kind', (req, res) => reply(res, store.addOption(db, req.params.kind, req.body ?? {}), 201));
  app.patch('/api/options/:kind/order', (req, res) => reply(res, store.reorderOptions(db, req.params.kind, req.body?.ids)));
  app.patch('/api/options/:id', (req, res) => reply(res, store.updateOption(db, req.params.id, req.body ?? {})));
  app.delete('/api/options/:id', (req, res) => reply(res, store.deleteOption(db, req.params.id)));

  app.get('/api/tasks', (req, res) => res.json(store.listTasks(db, { archived: req.query.archived === '1' })));
  app.get('/api/archivable', (req, res) => res.json({ count: store.countArchivable(db, req.query.before) }));
  app.post('/api/tasks/archive', (req, res) => reply(res, store.archiveCompleted(db, req.body?.before)));
  app.post('/api/tasks', (req, res) => reply(res, store.createTask(db, req.body), 201));
  // 부분 수정 — 모달 저장과 보드 드래그(status만) 양쪽에서 사용
  app.patch('/api/tasks/:id', (req, res) => reply(res, store.updateTask(db, req.params.id, req.body)));
  app.delete('/api/tasks/:id', (req, res) => { store.deleteTask(db, req.params.id); res.status(204).end(); });

  app.post('/api/tasks/:id/subtasks', (req, res) => reply(res, store.addSubtask(db, req.params.id, req.body?.title), 201));
  app.patch('/api/tasks/:id/subtasks/order', (req, res) => reply(res, store.reorderSubtasks(db, req.params.id, req.body?.ids)));
  app.patch('/api/subtasks/:id', (req, res) => reply(res, store.updateSubtask(db, req.params.id, req.body ?? {})));
  app.delete('/api/subtasks/:id', (req, res) => { store.deleteSubtask(db, req.params.id); res.status(204).end(); });

  // 메모 (Keep 스타일). 전환 전용 API는 없다 — 프론트가 POST /api/tasks 후 task_id를 PATCH한다.
  app.get('/api/notes', (req, res) => res.json(store.listNotes(db, {
    archived: req.query.archived === '1',
    q: req.query.q, category: req.query.category, task_id: req.query.task_id,
  })));
  app.post('/api/notes', (req, res) => reply(res, store.createNote(db, req.body ?? {}), 201));
  app.patch('/api/notes/:id', (req, res) => reply(res, store.updateNote(db, req.params.id, req.body ?? {})));
  app.delete('/api/notes/:id', (req, res) => { store.deleteNote(db, req.params.id); res.status(204).end(); });

  // 분류 전용 라우트는 없다 — kind='category'로 /api/options/* 를 그대로 쓴다.

  // AI 지시창. 대화 이력은 클라이언트가 들고 있다가 매번 통째로 보낸다(서버 무상태).
  const agent = createAgent(db, getAiClient);
  app.post('/api/ai', async (req, res) => {
    const msgs = req.body?.messages;
    const valid = Array.isArray(msgs) && msgs.length > 0 && msgs.length <= 100 &&
      msgs.every((m) => ['user', 'assistant'].includes(m?.role) && typeof m.content === 'string' && m.content.trim() && m.content.length <= 4000) &&
      msgs.at(-1).role === 'user';
    if (!valid) return res.status(400).json({ error: 'messages는 user로 끝나는 {role, content} 배열이어야 합니다' });
    try {
      res.json(await agent(msgs));
    } catch (e) {
      aiError(res, e);
    }
  });

  // 홈 «지금 집중할 일 · 다음 행동». 판단만 돌려주고 실행은 프론트가 사용자 승인 후 기존 REST로 한다.
  const advise = createAdvisor(db, getAiClient);
  app.post('/api/advise', async (_req, res) => {
    try {
      res.json(await advise());
    } catch (e) {
      aiError(res, e);
    }
  });

  return app;
}

/** AI 호출 실패를 HTTP 응답으로. 지시창과 홈 판단이 같은 안내를 쓴다. */
function aiError(res, e) {
  if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'Anthropic API 키가 올바르지 않습니다 (ANTHROPIC_API_KEY)' });
  if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: '요청이 많습니다. 잠시 후 다시 시도하세요' });
  if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `AI 호출 실패 (${e.status ?? '연결'}): ${e.message}` });
  // 키가 아예 없으면 SDK가 일반 Error를 던진다. 응답 JSON이 깨진 경우(SyntaxError)도 여기로 온다.
  res.status(503).json({ error: process.env.ANTHROPIC_API_KEY
    ? `AI를 쓸 수 없습니다: ${e.message}`
    : '.env 파일에 ANTHROPIC_API_KEY를 넣고 서버를 다시 시작하세요 (.env.example 참고)' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // 비밀값은 .env 파일로 관리한다(git 제외). 이미 셸에 있는 환경변수가 우선한다. 테스트는 import만 하므로 읽지 않는다.
  try { process.loadEnvFile(path.join(ROOT, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const PORT = Number(process.env.PORT) || 4000;
  createApp().listen(PORT, () => console.log(`MyWork → http://localhost:${PORT}`));
}
