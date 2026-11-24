# Nutrimaxxlent

Nutrimaxxlent is a single-user nutrition log for localhost. One SvelteKit app serves the
client-rendered UI and API, with PostgreSQL 18 and Drizzle for persistence.

## Working here

- Prefer explicit code, simple data models, and local reasoning. Minimize dependencies and
  introduce abstractions when a pattern has proven useful.
- Keep failure paths easy to diagnose. Resolve routine choices without gating questions.
- Use Node.js 26, pnpm, and Docker Compose. Follow the [README](README.md) for setup, migrations,
  seeding, catalog imports, and provider login.
- Run `pnpm check` for type, lint, and format checks, `pnpm test` for Vitest, and `pnpm build`
  for the Node build. Vitest integration tests require `TEST_DATABASE_URL` pointing to a
  migrated, seeded test database.
- For browser flows, use `pnpm test:e2e`. Its runner creates a temporary database and sets the
  fake provider. Follow the README for Chromium and database privileges.
- Run `pnpm demo` to show the app with synthetic data in an isolated temporary database. GitHub
  Actions runs checks, the build, PostgreSQL integration tests, and the Chromium suite.

## Where to look

- Today opens by default. Its **+ Log** panel contains the selected day's chat and manual logging.
  Older conversations are accessible through **Chat history** in that panel.
- Start with the [architecture overview](docs/architecture/overview.md) for the code map and
  the paths from chat or manual input to stored meals and totals.
- Use [OpenSpec main specs](openspec/specs/) for published requirements and
  [OpenSpec changes](openspec/changes/) for work in progress. Verify current behavior in code
  and tests.
- Keep nutrient calculation and log snapshots on the server. Historical totals use saved
  snapshots, so a catalog refresh must preserve past totals.
- Keep the unauthenticated runtime local and use the configured origin for API writes. Keep
  provider credentials on the server and use the fake provider for automated flows.
- Update this guide when commands, navigation, or verification change. Update the architecture
  overview when component boundaries, integrations, or data flows change.
