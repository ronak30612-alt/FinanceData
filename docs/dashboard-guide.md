# AI Financial Data Workstation Guide

## 1. 데이터 빌드

```powershell
npm run build:dashboard
```

- `exports/core-db/*.csv`를 읽어 `docs/data/dashboard-data.json`을 생성한다.
- 같은 단계에서 `docs/data/import-template.json`도 함께 갱신한다.

## 2. 메타데이터 DB 빌드

```powershell
npm run build:metadata
```

- FISIS, ECOS, KRX, INCOS, KOFIA 메타데이터를 실제 호출해 저장한다.
- 산출물은 `exports/metadata/*.json`, `exports/metadata/metadata-db.json`, `docs/data/metadata-db.json`이다.

## 3. 현재 지원 기능

- INCOS 코어 시계열 내장 데이터
- 자연어 질의 라우터 패널
- 시리즈 검색/필터
- 비교 차트
- 비교 테이블
- 메타데이터 설명 패널
- CSV / Excel / JSON 다운로드

## 4. 업로드 JSON 스키마

`docs/data/import-template.json`을 기준으로 맞추면 된다.

핵심 필드:

- `source`
- `dataset`
- `datasetName`
- `seriesId`
- `title`
- `entity`
- `frequency`
- `unit`
- `description`
- `metadataDescription`
- `points`

## 5. 로컬 미리보기

```powershell
npm run serve:dashboard
```

기본 주소:

- `http://127.0.0.1:4173`

## 6. 배포

### 방법 A. GitHub Actions

- `.github/workflows/deploy-pages.yml` 사용
- GitHub 저장소에서 Pages Source를 `GitHub Actions`로 설정

### 방법 B. `/docs` 직접 배포

- Branch: `main`
- Folder: `/docs`

## 7. 배포 전 검증

```powershell
npm test
npm run check
```
