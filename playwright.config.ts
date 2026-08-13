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
		{ name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
		{ name: 'tablet', use: { viewport: { width: 900, height: 1200 } }, testMatch: /smoke/ },
		{ name: 'mobile', use: { viewport: { width: 390, height: 844 } }, testMatch: /smoke/ }
	],
	webServer: {
		command: 'node tests/e2e/reset-db.mjs && node build',
		port: 4173,
		reuseExistingServer: false,
		env: {
			DATABASE_URL,
			PORT: '4173',
			ORIGIN: 'http://localhost:4173'
		}
	}
});
