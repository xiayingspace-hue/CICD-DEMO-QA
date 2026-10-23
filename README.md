# CICD-DEMO-QA

API and E2E tests using [Playwright](https://playwright.dev) + TypeScript.

## Layout
- `tests/api/` – API tests (Playwright `request` fixture, no browser)
- `tests/e2e/` – browser end-to-end tests
- `.github/workflows/test.yml` – CI

## Usage
```sh
npm install
npx playwright install chromium
cp .env.example .env   # set API_BASE_URL / WEB_BASE_URL for your system under test
npm run test:api
npm run test:e2e
npm run report
```
