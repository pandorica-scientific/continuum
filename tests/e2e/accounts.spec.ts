import { expect, test } from '@playwright/test';
import { PASSWORD_HINT } from '../../src/lib/password-policy';

// One ordered journey through account management: invite → enrol → deactivate.
// Runs as its own Playwright project that depends on `desktop`, so the wizard
// in flow.spec.ts has already created the household and saved the auth state.

const AUTH_STATE = 'test-results/e2e-auth.json';
const MEMBER_STATE = 'test-results/e2e-member.json';

test.describe.configure({ mode: 'serial' });

let enrollmentLink = '';

// Form actions are posted the way use:enhance posts them, so a refusal comes
// back as JSON naming the reason. Without the header SvelteKit renders an HTML
// error page and a 403 for "not an administrator" would be indistinguishable
// from a 403 for a missing Origin.
function actionHeaders(baseURL: string | undefined) {
	return { origin: baseURL ?? '', 'x-sveltekit-action': 'true' };
}

test.describe('as the administrator', () => {
	test.use({ storageState: AUTH_STATE });

	test('adding a person reveals a one-time enrollment link', async ({ page }) => {
		await page.goto('/settings');
		await page.getByRole('button', { name: '➕ Add a person' }).click();
		await page.getByPlaceholder('Name').fill('Tomáš Dvořák');
		await page.getByRole('button', { name: 'Add', exact: true }).click();

		const link = page.locator('code.reveal');
		await expect(link).toContainText('/enroll/');
		enrollmentLink = (await link.innerText()).trim();
	});

	test('the new person shows as not yet enrolled', async ({ page }) => {
		await page.goto('/settings');
		await expect(page.getByText('not enrolled yet')).toBeVisible();
	});
});

test('the enrollment link sets a password and signs the person in', async ({ browser }) => {
	// A fresh context: the new person is not the administrator.
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(enrollmentLink);
	await expect(page.getByText('Welcome, Tomáš Dvořák')).toBeVisible();
	await page.getByPlaceholder(`Password (${PASSWORD_HINT})`).fill('parallel-anchor-tin');
	await page.getByPlaceholder('Repeat password').fill('parallel-anchor-tin');
	await page.getByRole('button', { name: 'Set password' }).click();
	await expect(page).toHaveURL(/\/overview/);
	// Kept so the checks below can act as an ordinary member rather than as the
	// administrator every other test in this file runs as.
	await context.storageState({ path: MEMBER_STATE });
	await context.close();
});

test('the same link cannot be used twice', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(enrollmentLink);
	await expect(page.getByText('This link is not valid')).toBeVisible();
	await context.close();
});

test.describe('what a member may do', () => {
	test.use({ storageState: MEMBER_STATE });

	test('the settings page offers them nothing administrative', async ({ page }) => {
		await page.goto('/settings');
		// Their own password and passkeys are the point of the page for them.
		await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
		// Everything else is fetched only for administrators, so it is absent from
		// the payload rather than merely hidden.
		await expect(page.getByText('API tokens')).toHaveCount(0);
		await expect(page.getByText('Destination folder')).toHaveCount(0);
		await expect(page.getByText('Self-hosting')).toHaveCount(0);
		await expect(page.getByRole('button', { name: '➕ Add a person' })).toHaveCount(0);
	});

	// The controls are absent from their page, so these post directly. A member
	// could otherwise point a full database dump at any path the server can write.
	test('the backup actions refuse them', async ({ page, baseURL }) => {
		await page.goto('/settings');
		for (const action of ['saveBackup', 'runBackupNow', 'importConfig', 'toggleModule']) {
			const response = await page.request.post(`/settings?/${action}`, {
				form: { dir: '/tmp/continuum-e2e-should-not-happen', cadence: 'weekly', key: 'property' },
				headers: actionHeaders(baseURL)
			});
			expect(response.status(), `${action} should be refused`).toBe(403);
			expect(await response.text()).toContain('administrator');
		}
	});

	test('creating an api token refuses them', async ({ page, baseURL }) => {
		await page.goto('/settings');
		const response = await page.request.post('/settings?/createApiToken', {
			form: { label: 'should not exist' },
			headers: actionHeaders(baseURL)
		});
		expect(response.status()).toBe(403);
	});
});

test.describe('enrollment links cannot be reissued over a live account', () => {
	test.use({ storageState: AUTH_STATE });

	test('an administrator is refused a link for someone already enrolled', async ({
		page,
		baseURL
	}) => {
		await page.goto('/settings');
		const row = page.locator('.person-row', { hasText: 'Tomáš Dvořák' });
		// Not offered in the markup either, since the person is no longer pending.
		await expect(row.getByRole('button', { name: 'New link' })).toHaveCount(0);

		const personId = await row.locator('input[name="personId"]').first().inputValue();
		const response = await page.request.post('/settings?/reissueEnrollment', {
			form: { personId },
			headers: actionHeaders(baseURL)
		});
		// A link would overwrite their password and sign the opener in as them.
		const body = await response.json();
		expect(body.type).toBe('failure');
		expect(body.status).toBe(400);
		expect(JSON.stringify(body.data)).toContain('already enrolled');
	});

	test('an unknown person is refused rather than crashing', async ({ page, baseURL }) => {
		await page.goto('/settings');
		// Passed straight to the token insert, this used to violate the person
		// foreign key and surface as a 500.
		const response = await page.request.post('/settings?/reissueEnrollment', {
			form: { personId: 'no-such-person' },
			headers: actionHeaders(baseURL)
		});
		const body = await response.json();
		expect(body.type).toBe('failure');
		expect(body.status).toBe(404);
	});
});

test.describe('roles', () => {
	test.use({ storageState: AUTH_STATE });

	// Promotion and demotion both run inside a transaction that locks the
	// administrator rows, so this also exercises that path end to end.
	test('a member can be promoted and demoted again', async ({ page }) => {
		await page.goto('/settings');
		const row = () => page.locator('.person-row', { hasText: 'Tomáš Dvořák' });

		await row().getByRole('button', { name: 'Make admin' }).click();
		await expect(row().getByText('admin')).toBeVisible();

		await row().getByRole('button', { name: 'Make member' }).click();
		await expect(row().getByText('member')).toBeVisible();
	});

	test('the last administrator cannot demote themselves', async ({ page }) => {
		await page.goto('/settings');
		// Not offered for your own row, and the server refuses it regardless —
		// the guard that keeps an instance from ending up with nobody in charge.
		const ownRow = page.locator('.person-row', { hasText: 'Jana Nováková' });
		await expect(ownRow.getByRole('button', { name: 'Make member' })).toHaveCount(0);
	});
});

test.describe('deactivation', () => {
	test.use({ storageState: AUTH_STATE });

	test('an administrator cannot deactivate themselves', async ({ page }) => {
		await page.goto('/settings');
		// The guard is enforced server-side; the control is not even rendered for
		// your own row, which is the first line of defence.
		const ownRow = page.locator('.person-row', { hasText: 'Jana Nováková' });
		await expect(ownRow.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
	});

	test('deactivating a person marks them deactivated', async ({ page }) => {
		await page.goto('/settings');
		const row = page.locator('.person-row', { hasText: 'Tomáš Dvořák' });
		await row.getByRole('button', { name: 'Deactivate' }).click();
		await expect(page.getByText('deactivated')).toBeVisible();
	});
});

// Outside the describe above on purpose: a context created inside one that sets
// storageState comes back signed in, and this check needs a signed-out browser.
test('the deactivated person is gone from the sign-in picker', async ({ browser }) => {
	const context = await browser.newContext({ storageState: undefined });
	const page = await context.newPage();
	await page.goto('/login');
	await expect(page.getByText('Jana Nováková')).toBeVisible();
	await expect(page.getByText('Tomáš Dvořák')).toHaveCount(0);
	await context.close();
});
