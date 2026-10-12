#!/usr/bin/env node
// MyWork MCP 서버 — Claude Code에서 태스크·체크리스트를 직접 조회/수정한다.
// 도구 정의·실행은 tools.js(웹 AI 지시창과 공유). DB 파일은 웹 서버와 공유(WAL + busy_timeout).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { openDb } from './db.js';
import { createTools } from './tools.js';

const { TOOLS, call } = createTools(openDb(process.env.MYWORK_DB_PATH));

const server = new Server({ name: 'mywork', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => call(req.params.name, req.params.arguments ?? {}));

await server.connect(new StdioServerTransport());
