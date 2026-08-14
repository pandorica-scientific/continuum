import { expect, test } from '@playwright/test';

// One ordered journey through account management: invite → enrol → deactivate.
// Runs as its own Playwright project that depends on `desktop`, so the wizard
// in flow.spec.ts has already created the household and saved the auth state.

const AUTH_STATE = 'test-results/e2e-auth.json';

test.describe.configure({ mode: 'serial' });

let enrollmentLink = '';

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
	await page.getByPlaceholder('Password (8+ characters)').fill('parallel-anchor-tin');
	await page.getByPlaceholder('Repeat password').fill('parallel-anchor-tin');
	await page.getByRole('button', { name: 'Set password' }).click();
	await expect(page).toHaveURL(/\/overview/);
	await context.close();
});

test('the same link cannot be used twice', async ({ browser }) => {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto(enrollmentLink);
	await expect(page.getByText('This link is not valid')).toBeVisible();
	await context.close();
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
