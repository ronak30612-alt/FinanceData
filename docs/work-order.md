# AI 금융데이터 워크스테이션 작업지시서

## 1. 프로젝트 개요

본 프로젝트의 목적은 사용자의 자연어 질의를 분석한 뒤, 다음 5개 금융·경제 데이터 소스에서 데이터를 수집하고 정규화하여 하나의 비교 가능한 시계열 대시보드로 제공하는 것이다.

- FISIS
- ECOS
- KOFIA
- KRX
- INCOS

최종 산출물은 GitHub Pages에 배포 가능한 정적 대시보드와, 이를 생성하는 데이터 수집·정규화·메타데이터 관리 스크립트 세트다.

---

## 2. 목표 산출물

- 자연어 질의를 해석하는 `AgenticRouter`
- 기관별 수집기 `DataFetchers`
- 공통 시계열 스키마 기반 정규화/병합 로직
- 검색 가능한 메타데이터 DB
- 비교 테이블, 차트, CSV/Excel 다운로드를 지원하는 대시보드
- 운영 문서와 배포 문서

---

## 3. 데이터 소스 정의

문서와 코드에는 실제 비밀키를 저장하지 않는다. 실제 값은 로컬 `.env`에만 저장하고, 저장소에는 환경변수 이름과 엔드포인트만 남긴다.

| 소스 | 인증 방식 | 환경변수 | Base URL / URL | 구현 메모 |
|---|---|---|---|---|
| FISIS | API Key | `FISIS_API_KEY` | `http://fisis.fss.or.kr/openapi` | 금융회사/경영지표/공시 계열 메타데이터 필요 |
| ECOS | API Key | `ECOS_API_KEY` | `https://ecos.bok.or.kr/api/StatisticSearch` | 통계표 코드와 항목 코드 매핑 필요 |
| KOFIA | API Key | `KOFIA_API_KEY` | `https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService` | 오퍼레이션명과 `dateType` 처리 필요 |
| KRX | API Key | `KRX_API_KEY` | `https://data-dbg.krx.co.kr/svc/apis/idx/krx_dd_trd` | `basDd` 기준 일별 반복 호출 |
| INCOS | 스크래핑/내부 호출 분석 | `INCOS_API_KEY` 또는 없음 | `https://incos.kidi.or.kr:5443/insMonth/selMonthbookDeList.do` | 웹 구조 분석과 내부 API 파라미터 추적 필요 |
| Gemini | API Key | `GEMINI_API_KEY` | Gemini API | 자연어 질의 해석 보조 |

권장 `.env` 키 목록:

```env
FISIS_API_KEY=
FISIS_BASE_URL=http://fisis.fss.or.kr/openapi
ECOS_API_KEY=
ECOS_BASE_URL=https://ecos.bok.or.kr/api/StatisticSearch
KOFIA_API_KEY=
KOFIA_BASE_URL=https://apis.data.go.kr/1160100/service/GetKofiaStatisticsInfoService
KRX_API_KEY=
KRX_BASE_URL=https://data-dbg.krx.co.kr/svc/apis/idx/krx_dd_trd
INCOS_API_KEY=
INCOS_BASE_URL=https://incos.kidi.or.kr:5443
INCOS_MONTHBOOK_URL=https://incos.kidi.or.kr:5443/insMonth/selMonthbookDeList.do
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
```

---

## 4. 핵심 요구 기능

### A. 자연어 질의 분석기 `AgenticRouter`

목표:
- 사용자의 자연어 질의를 읽고 조회 대상 기관과 지표 후보를 판별한다.
- 메타데이터 DB를 참조해 통계표 코드, 계정 코드, 회사 코드, 종목 코드 후보를 도출한다.
- 실제 API 호출에 사용할 파라미터 JSON을 생성한다.

예시 질의:

```text
국내 은행 이자수익과 KOSPI 지수 추이 비교해줘
```

예상 처리:
- 은행 이자수익 관련 지표 후보 탐색: FISIS
- KOSPI 지수 후보 탐색: KRX
- 비교 목적 인식: 동일 시계열 기준 비교

세부 작업:
1. 질의 파서 구현
2. 키워드/동의어/기관명 추출
3. 기간 표현 추출
4. 분석 의도 추출
5. 메타데이터 기반 후보 시리즈 랭킹
6. API 파라미터 JSON 생성
7. 실패 시 후보 3개 내외 fallback 제시

완료 기준:
- 대표 질의 세트에서 기대 기관이 우선 선택된다.
- 라우팅 결과가 재현 가능한 JSON으로 출력된다.

### B. 다중 소스 데이터 수집기 `DataFetchers`

목표:
- 기관별 호출 방식 차이를 흡수하는 공통 수집 계층을 만든다.

필수 요구:
- 공통 timeout
- retry with backoff
- 에러 로그 기록
- 기관별 파라미터 규칙 분리

기관별 구현 메모:
- FISIS: 회사/업권/지표 코드 기반 조회
- ECOS: 통계표 코드와 항목 코드 조합
- KOFIA: 오퍼레이션명과 `dateType` 규칙 적용
- KRX: `basDd` 일자 반복 호출
- INCOS: 스크래핑 또는 내부 API 분석 기반 수집

완료 기준:
- 각 소스별 최소 1개 이상 샘플 수집 경로가 자동화된다.
- 실패 시 재시도와 로그 기록이 작동한다.

### C. 데이터 정규화 및 통합 `DataMerging`

목표:
- 소스마다 다른 날짜 형식과 필드 구조를 하나의 공통 시계열 구조로 통합한다.

표준 row 스키마:

```json
{
  "source": "ECOS",
  "dataset": "macro-statistics",
  "series_id": "ecos/base-rate",
  "series_name": "한국은행 기준금리",
  "entity_code": "BOK",
  "entity_name": "한국은행",
  "category": "금리",
  "frequency": "M",
  "period": "2025-12",
  "value": 3.5,
  "unit": "%",
  "dimensions": {},
  "metadata": {}
}
```

필수 처리:
- `YYYYMM`, `YYYYMMDD`, `YYYYQn` 정규화
- 단위 정보 유지
- 원본 출처 유지
- 같은 기준일자 기준 outer join
- 비교용 테이블 생성

추가 파생지표:
- MoM
- YoY
- index(시작값=100)
- rolling average

완료 기준:
- 서로 다른 기관의 시계열을 같은 기간축에서 비교할 수 있다.
- 차트, 테이블, 다운로드에 같은 표준 스키마를 사용한다.

### D. 메타데이터 관리 시스템 `MetadataDB`

목표:
- 기관별 통계표, 계정, 회사 코드, 종목 코드 정보를 내부 검색용 캐시로 관리한다.

저장 대상:
- FISIS 회사/업권/지표 메타
- ECOS 통계표/항목 코드
- KOFIA 통계명/오퍼레이션 메타
- KRX 지수/시장 메타
- INCOS 보험사/종목/월보 항목 메타

필수 기능:
- 메타데이터 수집 스크립트
- 검색 가능한 JSON 또는 CSV 캐시
- 동의어 사전
- 라우터와의 연동

완료 기준:
- 키워드 검색 시 관련 시리즈 후보를 반환한다.
- 라우터가 이 DB를 참조해 호출 파라미터를 만든다.

### E. 프론트엔드 대시보드 `UI/UX`

목표:
- 사용자가 데이터를 검색, 비교, 시각화, 다운로드할 수 있는 정적 대시보드를 제공한다.

필수 화면 요소:
- 검색 바
- 소스 필터
- 데이터셋 필터
- 시리즈 선택 목록
- 비교 차트
- 비교 테이블
- CSV 다운로드
- Excel 다운로드
- 데이터 메타데이터 설명 패널
- 소스 연결 상태 패널

필수 동작:
- 같은 시계열 기준 비교
- 원본값/지수화 모드 전환
- 테이블과 차트 동기화
- 메타데이터와 특징 설명 동시 표시

완료 기준:
- 차트와 테이블이 같은 선택 집합을 반영한다.
- CSV/Excel 파일 다운로드가 동작한다.
- GitHub Pages에서 정적으로 동작한다.

---

## 5. 권장 시스템 구조

```text
config/
  data-sources.example.json
docs/
  index.html
  app.js
  styles.css
  guide.html
  work-order.md
  data/
scripts/
  build-dashboard-data.mjs
  serve-dashboard.mjs
src/
  collectors/
    fisis/
    ecos/
    kofia/
    krx/
    incos/
  metadata/
  normalize/
  merge/
  router/
test/
```

정적 대시보드 배포는 `docs/` 기준으로 유지한다.

---

## 6. 구현 단계

### Phase 1. 보안 및 설정 정비

- `.env.example` 정리
- 실제 키는 `.env`에서만 관리
- 공통 설정 로더 작성
- 공통 HTTP 클라이언트 작성

### Phase 2. 메타데이터 DB 구축

- 기관별 메타데이터 수집 경로 정의
- 내부 검색 캐시 생성
- 동의어 사전 구성

### Phase 3. 기관별 수집기 구현

- FISIS 수집기
- ECOS 수집기
- KOFIA 수집기
- KRX 수집기
- INCOS 수집기

### Phase 4. 정규화 및 병합

- 공통 row 스키마 확정
- period 정규화
- 단위/주기 정규화
- 다중 소스 병합 유틸 작성

### Phase 5. 라우터 구현

- 규칙 기반 라우터 MVP
- 메타데이터 검색 연동
- Gemini 보조 질의 해석 옵션 추가

### Phase 6. 대시보드 완성

- 검색/필터 강화
- 비교 차트
- 비교 테이블
- 메타데이터 설명 패널
- CSV/Excel 다운로드
- GitHub Pages 배포 점검

---

## 7. 기능별 세부 완료 정의

### 라우터
- 입력 질의에서 기관, 지표, 기간, 분석 의도를 추출한다.
- 메타데이터 DB를 기반으로 후보를 점수화한다.
- API 호출용 JSON을 생성한다.

### 수집기
- 최소 5개 소스 전체에 대한 호출 모듈이 존재한다.
- 인증, 재시도, 로그 처리가 공통화된다.

### 정규화
- period 정규화가 일관되게 적용된다.
- 단위와 메타데이터가 보존된다.

### 대시보드
- 같은 기간축에서 테이블과 차트가 비교된다.
- CSV와 Excel 다운로드가 제공된다.
- 메타데이터 설명과 데이터 특징 설명이 포함된다.

---

## 8. 문서 요구사항

필수 문서:
- `README.md`
- `docs/work-order.md`
- `docs/guide.html` 또는 동등 문서

README에는 다음이 포함되어야 한다.
- 프로젝트 목적
- 데이터 소스 개요
- 환경변수 설정법
- 빌드 및 실행 방법
- GitHub Pages 배포 절차

---

## 9. 테스트 및 검증

필수 검증 항목:
- 대시보드 데이터 빌드 성공
- 라우터 샘플 질의 테스트
- 메타데이터 검색 테스트
- 병합 로직 테스트
- 다운로드 파일 생성 테스트
- GitHub Pages 정적 구동 확인

권장 명령:

```powershell
npm run build:dashboard
npm test
npm run check
```

추가 검증:
- 샘플 자연어 질의 10개 이상
- 기관별 최소 1개 샘플 호출
- CSV와 Excel 산출물 열기 확인

---

## 10. 제약 및 원칙

- 실제 API 키는 저장소에 저장하지 않는다.
- 새 의존성 추가는 필요한 경우에만 한다.
- 정적 배포 가능한 구조를 유지한다.
- 대시보드와 데이터 빌드 스크립트는 분리한다.
- 메타데이터 설명과 데이터 특징 설명은 사용자에게 직접 노출한다.

---

## 11. Definition of Done

다음 조건을 모두 만족하면 완료로 본다.

- 사용자의 자연어 질의를 바탕으로 적절한 기관/지표 후보를 제안할 수 있다.
- 5개 소스 모두에 대해 수집 경로가 정의되어 있다.
- 수집 데이터가 하나의 공통 시계열 스키마로 정규화된다.
- 대시보드에서 검색, 비교, 차트, 테이블, CSV/Excel 다운로드가 가능하다.
- 메타데이터와 데이터 특징 설명이 화면에 포함된다.
- GitHub Pages로 배포 가능한 상태다.

---

## 12. 현재 지시 기준 우선순위

1. 작업지시서 및 README 최신화
2. 설정/보안 구조 정리
3. 메타데이터 DB 초안 구축
4. 5개 소스 수집기 연결
5. 시계열 정규화/병합
6. 대시보드 다운로드와 설명 패널 완성
7. GitHub Pages 배포 검증
