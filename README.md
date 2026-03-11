# FinanceData

AI financial data workstation dashboard for FISIS, ECOS, KOFIA, KRX, and INCOS.

## Features

- Static GitHub Pages dashboard
- Natural-language routing panel
- Metadata explorer backed by live-built metadata index
- Time-series comparison chart and table
- CSV, Excel, and JSON export
- INCOS core data bundled into the dashboard

## Commands

```powershell
npm run build:metadata
npm run build:remote
npm run build:dashboard
npm test
npm run serve:dashboard
npm run serve:private
```

## Output

- Dashboard site: `docs/`
- Private local app: `private-app/` served by `server/private-server.mjs`
- Dashboard data: `docs/data/dashboard-data.json`
- Metadata index for browser search: `docs/data/metadata-index.json`
- Curated remote series cache: `docs/data/remote-series.json`
- Raw metadata cache: `exports/metadata/`

## Private Local Mode

```powershell
npm run serve:private
```

- URL: `http://127.0.0.1:4317`
- Login credentials come from `.env`
- Default fallback: `admin / change-me`
- This mode is intended for local testing and private deployment with backend API calls

## GitHub Pages

GitHub Actions workflow is included at `.github/workflows/deploy-pages.yml`.
Push to `main` to trigger deployment after Pages is configured to use GitHub Actions.
