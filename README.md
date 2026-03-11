# AI Financial Data Workstation

FISIS, ECOS, KOFIA, KRX, INCOS 데이터를 하나의 시계열 구조로 정리하고, 자연어 질의 기반 탐색과 비교 분석이 가능한 정적 대시보드를 만드는 프로젝트다.

현재 저장소는 다음을 포함한다.

- INCOS 코어 시계열 내장 데이터
- 5개 소스 설명과 메타데이터 구조
- 자연어 질의 라우팅용 규칙 기반 카탈로그
- 실제 기관 호출로 만든 메타데이터 인덱스 검색
- 비교 차트, 비교 테이블, CSV/Excel 다운로드가 가능한 GitHub Pages 대시보드

## 주요 기능

- 자연어 질의 분석
  - 예: `국내 은행 이자수익과 KOSPI 지수 추이 비교해줘`
  - 질의에서 기관, 지표, 기간, 분석 의도를 추출
  - 메타데이터 카탈로그를 바탕으로 적절한 소스를 추천
- 다중 소스 데이터 구조
  - FISIS
  - ECOS
  - KOFIA
  - KRX
  - INCOS
- 공통 시계열 스키마
  - `source`
  - `dataset`
  - `series_id`
  - `series_name`
  - `period`
  - `value`
- 대시보드 기능
  - 검색/필터
  - 메타데이터 탐색기
  - 비교 차트
  - 비교 테이블
  - 메타데이터 설명
  - 데이터 특징 설명
  - CSV/Excel 다운로드
  - 외부 JSON 업로드

## 데이터 소스

| Source | Purpose | Env Key | Base URL |
|---|---|---|---|
| FISIS | 금융회사/경영지표/공시 | `FISIS_API_KEY` | `http://fisis.fss.or.kr/openapi` |
| ECOS | 거시경제/금리/물가/통화 | `ECOS_API_KEY` | `https://ecos.bok.or.kr/api/StatisticSearch` |
| KOFIA | 채권/펀드/투자통계 | `KOFIA_API_KEY` | `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService` |
| KRX | 지수/시장시세 | `KRX_API_KEY` | `https://data-dbg.krx.co.kr/svc/apis/idx/krx_dd_trd` |
| INCOS | 보험월보/손해보험 통계 | `INCOS_API_KEY` 또는 없음 | `https://incos.kidi.or.kr:5443/insMonth/selMonthbookDeList.do` |
| Gemini | 자연어 질의 보조 | `GEMINI_API_KEY` | Gemini API |

## 보안 원칙

- 실제 API 키는 저장소에 저장하지 않는다.
- 실제 값은 로컬 `.env`에만 둔다.
- `.env.example`에는 변수 이름만 유지한다.

준비:

```powershell
Copy-Item .env.example .env
```

## 빠른 시작

### 1. 대시보드 데이터 빌드

```powershell
npm run build:dashboard
```

### 2. 메타데이터 DB 빌드

```powershell
npm run build:metadata
```

- 출력 경로: `exports/metadata/*.json`
- 통합 DB: `exports/metadata/metadata-db.json`
- 브라우저용 사본: `docs/data/metadata-db.json`
- 브라우저 검색 인덱스: `docs/data/metadata-index.json`

### 3. 테스트

```powershell
npm test
```

### 4. 로컬 미리보기

```powershell
npm run serve:dashboard
```

기본 주소:

- `http://127.0.0.1:4173`

## 현재 구조

```text
config/
docs/
  data/
  app.js
  guide.html
  index.html
  styles.css
  work-order.md
exports/
  core-db/
scripts/
src/
  metadata/
  router/
test/
```

## 핵심 파일

- `docs/index.html`
  - GitHub Pages 메인 대시보드
- `docs/app.js`
  - 검색, 메타 탐색, 라우팅 패널, 차트, 다운로드 로직
- `docs/styles.css`
  - 대시보드 스타일
- `docs/data/dashboard-data.json`
  - 정적 대시보드 데이터
- `docs/data/import-template.json`
  - 외부 업로드 템플릿
- `scripts/build-dashboard-data.mjs`
  - INCOS 코어 CSV를 대시보드 JSON으로 변환
- `scripts/build-metadata-db.mjs`
  - FISIS, ECOS, KRX, INCOS, KOFIA 메타데이터를 호출해 통합 DB 생성
- `src/router/agentic-router.mjs`
  - 규칙 기반 자연어 질의 라우터
- `src/metadata/router-catalog.mjs`
  - 기관/지표 카탈로그와 질의 힌트
- `docs/work-order.md`
  - 상세 작업지시서

## 정규화 스키마

```json
{
  "source": "ECOS",
  "dataset": "macro-statistics",
  "series_id": "ecos/base-rate",
  "series_name": "한국은행 기준금리",
  "entity_code": "BOK",
  "entity_name": "한국은행",
  "frequency": "M",
  "period": "2025-12",
  "value": 3.5,
  "unit": "%",
  "dimensions": {},
  "metadata": {}
}
```

## 자연어 라우팅 예시

입력:

```text
국내 은행 이자수익과 KOSPI 지수 추이 비교해줘
```

예상 후보:

- FISIS: 은행 이자수익
- KRX: KOSPI 지수

입력:

```text
한국은행 기준금리와 회사채 수익률 흐름을 보여줘
```

예상 후보:

- ECOS: 기준금리
- KOFIA: 회사채 수익률

## GitHub Pages 배포

### 방법 A. GitHub Actions

- `.github/workflows/deploy-pages.yml` 사용
- GitHub 저장소에서 `Settings > Pages > Source = GitHub Actions`

### 방법 B. `/docs` 배포

- `Settings > Pages > Source = Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

## 검증 명령

```powershell
npm run build:metadata
npm run build:dashboard
npm test
npm run check
```

## 후속 우선순위

1. 기관별 실제 수집기 연결
2. 메타데이터 DB 확대
3. 자연어 라우터 고도화
4. 자동 갱신 배치
5. GitHub Actions 기반 데이터 빌드 자동화
