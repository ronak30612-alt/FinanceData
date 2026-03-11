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
npm run build:dashboard
npm test
npm run serve:dashboard
```

## Output

- Dashboard site: `docs/`
- Dashboard data: `docs/data/dashboard-data.json`
- Metadata index for browser search: `docs/data/metadata-index.json`
- Raw metadata cache: `exports/metadata/`

## GitHub Pages

GitHub Actions workflow is included at `.github/workflows/deploy-pages.yml`.
Push to `main` to trigger deployment after Pages is configured to use GitHub Actions.
