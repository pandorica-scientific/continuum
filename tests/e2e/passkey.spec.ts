import { expect, test } from '@playwright/test';

// Chromium's CDP virtual authenticator registers and asserts real credentials
// in software, so this needs no hardware. Requires a secure context — the E2E
// base URL is localhost, which browsers treat as secure.

test.describe.configure({ mode: 'serial' });

const AUTH_STATE = 'test-results/e2e-auth.json';

test('registering a passkey, then signing in with it', async ({ browser }) => {
	const context = await browser.newContext({ storageState: AUTH_STATE });
	const page = await context.newPage();

	const client = await context.newCDPSession(page);
	await client.send('WebAuthn.enable');
	await client.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});

	// The label prompt is a window.prompt; answer it before it blocks.
	page.on('dialog', (dialog) => dialog.accept('Test device'));

	await page.goto('/settings');
	await page.getByRole('button', { name: '🔑 Add a passkey' }).click();
	await expect(page.getByText('Test device')).toBeVisible();

	// Sign out, then back in using only the passkey.
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login/);
	await page.getByRole('button', { name: '🔑 Sign in with a passkey' }).click();
	await expect(page).toHaveURL(/\/overview/);

	// Second use is the regression guard: a synced authenticator reports a
	// counter of 0 every time, and a naive counter check would reject this.
	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page).toHaveURL(/\/login/);
	await page.getByRole('button', { name: '🔑 Sign in with a passkey' }).click();
	await expect(page).toHaveURL(/\/overview/);

	await context.close();
});

test('the registration endpoints answer a signed-out caller with JSON, not HTML', async ({
	browser
}) => {
	// They are fetched by script. Redirecting them to the login page meant the
	// browser followed it, got HTML with a 200, and reported "Unexpected token <"
	// — while the endpoints' own 401 could never run.
	const context = await browser.newContext({ storageState: undefined });
	for (const path of ['/auth/passkey/register/options', '/auth/passkey/register/verify']) {
		const response = await context.request.post(path, { data: {} });
		expect(response.status(), path).toBe(401);
		expect((await response.json()).message).toContain('Sign in');
	}
	await context.close();
});

test('a malformed sign-in body is refused rather than crashing', async ({ browser }) => {
	const context = await browser.newContext({ storageState: undefined });
	// The challenge cookie has to exist first, or the request is turned away
	// before it ever reaches the body.
	await context.request.post('/auth/passkey/login/options');
	const response = await context.request.post('/auth/passkey/login/verify', { data: {} });
	expect(response.status()).toBe(400);
	expect((await response.json()).message).toContain('malformed');
	await context.close();
});

test('the passkey button matches whether the context is secure', async ({ page }) => {
	// The E2E base URL is localhost, which browsers treat as secure, so this
	// asserts the flag is wired rather than hard-coded. If the suite ever runs
	// against a non-localhost HTTP origin, this catches a passkey button being
	// offered where it cannot work.
	await page.goto('/login');
	const secure = await page.evaluate(() => window.isSecureContext);
	const button = page.getByRole('button', { name: '🔑 Sign in with a passkey' });
	await expect(button).toHaveCount(secure ? 1 : 0);
});
