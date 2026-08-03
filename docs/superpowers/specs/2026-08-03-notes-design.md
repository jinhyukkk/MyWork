# 메모(Keep 스타일) 기능 설계

2026-08-03 · 승인됨

## 목표

Google Keep 스타일의 독립 메모 기능을 MyWork에 추가한다. 메모는 태스크와 연결된다:
메모를 태스크로 전환할 수 있고, 기존 태스크에 메모를 연결해 태스크 모달에서도 볼 수 있다.

범위: 고정(핀) · 색상 · 검색 · 보관 · 라벨(기존 업무분류 재사용).
범위 밖: 이미지 첨부, 체크리스트형 메모, 리마인더, 공유.

## 선택한 접근 (A안)

`notes` 전용 테이블 + 업무분류 재사용. 라벨은 메모당 1개로 제한되지만
사이드바 토글·분류 필터·색상 체계·설정 관리 화면이 전부 공짜로 따라온다.

기각안: B안(전용 다중 라벨 — 테이블·설정 종류·관리 UI 추가 비용), C안(tasks에
`is_note` 플래그 — 불필요한 필수 필드가 붙고 모든 뷰·통계·MCP에 제외 분기가 퍼짐).

## 데이터

```sql
CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',      -- '' = 기본 카드색, 아니면 #RRGGBB (8색 고정 팔레트)
  category   TEXT,                          -- 업무분류 재사용, NULL 허용
  pinned     INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
```

- 제목·내용 둘 다 빈 메모는 저장 거부.
- 태스크를 삭제해도 메모는 남는다 (`ON DELETE SET NULL`) — 하위 태스크와 같은 이유.
- 삭제는 hard delete + 기존 5초 되돌리기 토스트 패턴 재사용.
- 기존 DB에는 `migrate()`에서 `CREATE TABLE IF NOT EXISTS`로 추가된다. 시드 없음.

### 분류 이관 (통합 포인트)

`updateOption`(이름 변경)·`deleteOption`은 지금 `tasks`만 UPDATE한다.
`kind='category'`일 때 `notes.category`도 함께 옮긴다:

- 이름 변경 → 같은 이름으로 UPDATE.
- 삭제 → 태스크는 남은 첫 항목으로 이관하지만, **메모는 `NULL`로** 만든다.
  메모의 분류는 필수가 아니므로 임의 항목으로 옮기는 쪽이 오히려 정보를 지어낸다.

## store.js / REST

| 함수 | REST | 비고 |
|------|------|------|
| `listNotes(db, { archived, q, category, task_id })` | `GET /api/notes` | 고정 우선 → 수정일 역순. `?archived=1`, `?task_id=N`, `?q=`, `?category=` |
| `createNote(db, body)` | `POST /api/notes` | title/body 중 하나 필수, color 정규식(또는 ''), category 존재 확인 없음(자유 — 태스크와 동일하게 TEXT), task_id 존재 확인 |
| `updateNote(db, id, body)` | `PATCH /api/notes/:id` | 부분 수정. 내용 변경 시 `updated_at` 갱신 |
| `deleteNote(db, id)` | `DELETE /api/notes/:id` | 204 |

메모→태스크 전환 전용 API는 없다. 프론트가 `POST /api/tasks` →
`PATCH /api/notes/:id { task_id }` 2회 호출한다. 전환 후 메모는 남고 연결 상태가
된다 — "전환"과 "연결"이 한 메커니즘.

검증 스타일은 태스크와 동일: store.js 한 곳, REST/MCP 공유.

## 프론트 (6번째 뷰 「메모」)

- `public/notes.html` 신설 (`body data-view="notes"`), 렌더는 `app.js`에 분기 추가 — 기존 5뷰와 같은 패턴.
- **레이아웃**: CSS `columns` 마소너리. 고정 메모 섹션 상단, 나머지 아래. 빈 섹션은 그리지 않음.
- **빠른 작성**: 상단 「메모 작성…」 입력 — 클릭하면 제목+내용+분류 폼으로 확장, 바깥 클릭 시 자동 저장(둘 다 비었으면 그냥 닫힘).
- **카드**: color 배경(비었으면 기본), 클릭 → 편집 모달. hover 액션: 📌 고정 토글 · 색상 스와치 8색 · 보관/복원 · 삭제(토스트) · 태스크로 전환.
- **태스크로 전환**: 새 태스크 모달을 제목·메모·분류 프리필로 열고, 저장 성공 시 `task_id` 연결.
- **연결 표시**: 메모 카드에 연결 태스크 칩(클릭 → 태스크 모달), 태스크 모달 하단에 연결된 메모 목록(클릭 → 메모 편집 모달). 태스크 모달 쪽은 모달 열 때 `GET /api/notes?task_id=N`으로 조회.
- 헤더 검색(제목·내용)·분류 필터·사이드바 분류 토글 적용. 분류 없는 메모는 필터·토글에 걸리지 않고 항상 보인다.
- 메모 뷰 헤더에 「보관 보기」 토글 — 켜면 `?archived=1`만 표시. 상태는 저장하지 않는다(완료 숨김과 동일).
- 완료 숨김·High만 토글은 메모 뷰와 무관 — 메모 뷰에서는 숨긴다.

## MCP

`list_notes` / `create_note` / `update_note` / `delete_note` 4종.
enum 없는 자유 텍스트라 서버 재시작 이슈 없음. store.js 함수를 그대로 감싼다.

## 테스트

`test.js`에 추가:
- 노트 CRUD 회귀 (빈 메모 거부, 색상 검증, task_id 검증 포함)
- 분류 이름 변경 → notes.category 함께 변경
- 분류 삭제 → notes.category NULL
- 태스크 삭제 → note.task_id NULL

## 문서

README에 「메모」 섹션 추가 (뷰 목록·API 표·MCP 표 갱신 포함).
