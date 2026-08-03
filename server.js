// MyWork REST API + 정적 프론트 서빙. 데이터 규칙은 전부 store.js에 있다.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import * as store from './store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4000;

// mcp.js와 같은 환경변수로 DB 경로를 바꿀 수 있다 (테스트·격리 실행용)
export function createApp(db = openDb(process.env.MYWORK_DB_PATH)) {
  const app = express();
  app.use(express.json());
  // 뷰별 페이지가 물리 파일로 나뉘어 있다 — /summary → summary.html
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
  app.get('/', (_req, res) => res.redirect('/summary'));

  /** store 결과를 HTTP 응답으로 옮긴다. */
  const reply = (res, result, okStatus = 200) =>
    result.error
      ? res.status(result.status ?? 400).json({ error: result.error })
      : res.status(okStatus).json(result.data);

  // 설정 항목은 이름만이 아니라 색상·done 플래그까지 내려간다 (프론트가 색을 직접 들고 있지 않도록)
  app.get('/api/meta', (_req, res) => {
    res.json({
      types: store.listOptions(db, 'type'),
      statuses: store.listOptions(db, 'status'),
      priorities: store.listOptions(db, 'priority'),
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

  // 분류 전용 라우트는 없다 — kind='category'로 /api/options/* 를 그대로 쓴다.

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createApp().listen(PORT, () => console.log(`MyWork → http://localhost:${PORT}`));
}
