import { defineConfig } from '@playwright/test';

const DATABASE_URL =
	process.env.E2E_DATABASE_URL ?? 'postgres://continuum:continuum@localhost:5432/continuum_e2e';

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 60000,
	// Screens build on each other's state (wizard → import → review), so the
	// suite runs as one ordered worker.
	workers: 1,
	use: {
		baseURL: 'http://localhost:4173'
	},
	projects: [
		{
			name: 'desktop',
			use: { viewport: { width: 1440, height: 900 } },
			testIgnore: /accounts|passkey|board|errors/
		},
		// The error screens need a signed-in session, which the wizard in
		// flow.spec.ts is what creates. Alphabetical order would put this file
		// first, before that session exists, so it says so instead of relying on
		// the name.
		{
			name: 'errors',
			use: { viewport: { width: 1440, height: 900 } },
			testMatch: /errors/,
			dependencies: ['desktop']
		},
		// Account management and passkeys build on the household the wizard
		// creates in flow.spec.ts, so they wait for `desktop` rather than relying
		// on the alphabetical file order — which would otherwise run them first.
		{
			name: 'accounts',
			use: { viewport: { width: 1440, height: 900 } },
			testMatch: /accounts|passkey/,
			dependencies: ['desktop']
		},
		// The board customises the administrator's Overview and toggles a module,
		// so it runs last: after `accounts` has added a second person, which is
		// what makes the per-person isolation check say anything.
		{
			name: 'board',
			use: { viewport: { width: 1440, height: 900 } },
			testMatch: /board/,
			dependencies: ['accounts']
		},
		{ name: 'tablet', use: { viewport: { width: 900, height: 1200 } }, testMatch: /smoke/ },
		{ name: 'mobile', use: { viewport: { width: 390, height: 844 } }, testMatch: /smoke/ }
	],
	webServer: {
		// Build first: `node build` serves whatever was compiled last, so without
		// this the suite silently tests a stale artifact and passes on code that
		// is no longer in the repository.
		command: 'npm run build && node tests/e2e/reset-db.mjs && node build',
		port: 4173,
		// The build is part of this command, and webServer.timeout defaults to 60
		// seconds — which a cold Vite build of this project (pdfjs, drizzle,
		// argon2) will exceed, aborting the whole suite before a test runs. The
		// top-level `timeout` above is the per-test one and does not apply here.
		timeout: 300_000,
		reuseExistingServer: false,
		env: {
			DATABASE_URL,
			PORT: '4173',
			ORIGIN: 'http://localhost:4173'
		}
	}
});
