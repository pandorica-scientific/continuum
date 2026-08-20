import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { DEFAULT_PASSWORD_MIN_LENGTH, passwordHint } from '../../src/lib/password-policy';

const HINT = passwordHint(DEFAULT_PASSWORD_MIN_LENGTH);

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

// Your own row deliberately renders no controls, so the page never puts your id
// in the DOM — and the one guard that can only be reached by acting on yourself
// cannot be posted without it. The suite already owns this database; the same
// connection string the app was started with is in the Playwright config.
async function personIdByName(name: string): Promise<string> {
	const url =
		process.env.E2E_DATABASE_URL ?? 'postgres://continuum:continuum@localhost:5432/continuum_e2e';
	const sql = postgres(url, { onnotice: () => {} });
	try {
		const rows = await sql<{ id: string }[]>`select id from person where name = ${name}`;
		if (!rows[0]) throw new Error(`no person named ${name}`);
		return rows[0].id;
	} finally {
		await sql.end();
	}
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
	await page.getByPlaceholder(`Password (${HINT})`).fill('parallel-anchor-tin');
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

		// The roster names the household, and stops there. "admin" would say who
		// runs the instance; "not enrolled yet" would name every account with a
		// live enrollment link.
		await expect(page.getByText('Jana Nováková')).toBeVisible();
		// Scoped to the household rows: the passkey card below reuses .person-row
		// and puts a last-used note in every one of them, so a bare
		// `.person-row .note` would start failing the day this member registers a
		// passkey — for a reason with nothing to do with the roster.
		await expect(page.locator('.person-row:not(.passkey-row) .note')).toHaveCount(0);
	});

	test('the settings export refuses them', async ({ page }) => {
		// The read counterpart of importConfig: it returns the backup destination
		// on the host filesystem.
		const response = await page.request.get('/settings/export');
		expect(response.status()).toBe(403);
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

	test('demoting yourself is not offered in your own row', async ({ page }) => {
		// The first line of defence only. This asserts what the markup does — the
		// server guard behind it is exercised further down, where the count it
		// depends on can be made to lie.
		await page.goto('/settings');
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

// The last-administrator guard, exercised against the server rather than
// against the markup that hides the control.
//
// The count behind it used to be "admins who are not deactivated", which
// included one an administrator had created and who had never opened their
// enrollment link — somebody with no password, who cannot sign in, and who
// certainly cannot administer anything. Adding one was enough to make the count
// read two, and the only administrator who could actually sign in was then free
// to step down. Recovering from that meant the psql one-liner in the README.
test.describe('a pending administrator does not stand in for a real one', () => {
	test.use({ storageState: AUTH_STATE });

	test('an administrator can be created without enrolling', async ({ page }) => {
		await page.goto('/settings');
		await page.getByRole('button', { name: '➕ Add a person' }).click();
		await page.getByPlaceholder('Name').fill('Pavel Ročeň');
		await page.locator('select[name="role"]').selectOption('admin');
		await page.getByRole('button', { name: 'Add', exact: true }).click();

		const row = page.locator('.person-row', { hasText: 'Pavel Ročeň' });
		await expect(row.locator('.note')).toContainText('admin');
		await expect(row.locator('.note')).toContainText('not enrolled yet');
	});

	test('the only administrator who can sign in is still refused self-demotion', async ({
		page,
		baseURL
	}) => {
		await page.goto('/settings');
		const response = await page.request.post('/settings?/changePersonRole', {
			form: { personId: await personIdByName('Jana Nováková'), role: 'member' },
			headers: actionHeaders(baseURL)
		});
		const body = await response.json();
		expect(body.type).toBe('failure');
		expect(body.status).toBe(400);
		expect(JSON.stringify(body.data)).toContain('last administrator');

		// And she really is still an administrator, not merely told she is not.
		await page.reload();
		await expect(page.getByRole('button', { name: '➕ Add a person' })).toBeVisible();
	});

	test('but an administrator who cannot sign in may be demoted', async ({ page }) => {
		// The mirror of the check above. Pavel was never in the count, so demoting
		// him takes nothing away — refusing it would name him as the last
		// administrator, which he has never been.
		await page.goto('/settings');
		const row = page.locator('.person-row', { hasText: 'Pavel Ročeň' });
		await row.getByRole('button', { name: 'Make member' }).click();
		await expect(row.locator('.note')).toContainText('member');
	});
});

test.describe('a link is not offered for an account that cannot use one', () => {
	test.use({ storageState: AUTH_STATE });

	// Someone of their own, rather than reusing Pavel: he has to stay pending and
	// active for the picker check at the end of the file, which cannot tell the
	// enrollment filter from the deactivation one if its subject is both.
	test('deactivating a pending person withdraws their link', async ({ page, baseURL }) => {
		await page.goto('/settings');
		await page.getByRole('button', { name: '➕ Add a person' }).click();
		await page.getByPlaceholder('Name').fill('Eva Horáková');
		await page.getByRole('button', { name: 'Add', exact: true }).click();

		const row = page.locator('.person-row', { hasText: 'Eva Horáková' });
		await expect(row.getByRole('button', { name: 'New link' })).toHaveCount(1);

		await row.getByRole('button', { name: 'Deactivate' }).click();
		await expect(row.locator('.note')).toContainText('deactivated');
		await expect(row.getByRole('button', { name: 'New link' })).toHaveCount(0);

		// Deactivation revoked whatever link she had. A replacement would look
		// valid, be passed on, and then be refused at /enroll with the wording a
		// broken link gets — leaving both sides blaming the URL, not the account.
		const response = await page.request.post('/settings?/reissueEnrollment', {
			form: { personId: await personIdByName('Eva Horáková') },
			headers: actionHeaders(baseURL)
		});
		const body = await response.json();
		expect(body.type).toBe('failure');
		expect(body.status).toBe(400);
		expect(JSON.stringify(body.data)).toContain('deactivated');
	});
});

// Outside a describe that sets storageState, for the reason given above the
// first picker check.
test('nobody who cannot sign in is offered in the picker', async ({ browser }) => {
	const context = await browser.newContext({ storageState: undefined });
	const page = await context.newPage();
	await page.goto('/login');
	await expect(page.getByText('Jana Nováková')).toBeVisible();
	// Deactivated, and enrolled — caught by the older half of the filter.
	await expect(page.getByText('Tomáš Dvořák')).toHaveCount(0);
	await expect(page.getByText('Eva Horáková')).toHaveCount(0);
	// Active, but never enrolled: no password, so every attempt he made would
	// fail — spending the per-address failure budget that the whole household
	// shares behind a reverse proxy or Tailscale. He is the one who distinguishes
	// this check from the deactivation one above it.
	await expect(page.getByText('Pavel Ročeň')).toHaveCount(0);
	await context.close();
});

// Open mode is instance-wide, so it runs last and closes itself again: leaving
// it on would let every later test sign in without a credential and quietly
// stop proving anything about authentication.
test.describe('open mode', () => {
	test.use({ storageState: AUTH_STATE });

	test('an administrator opens the instance with their own password', async ({ page }) => {
		await page.goto('/settings');
		await page.locator('.open-form input[name=password]').fill('correct-horse-battery');
		await page.getByRole('button', { name: 'Open the instance' }).click();

		// Said on every screen, not just this one.
		await expect(page.locator('.open-banner')).toBeVisible();
		await page.goto('/overview');
		await expect(page.locator('.open-banner')).toBeVisible();
	});

	test('the wrong password does not open it', async ({ page }) => {
		await page.goto('/settings');
		// Already open from the test above, so close it first to test the guard.
		await page.getByRole('button', { name: 'Close it' }).click();
		await expect(page.locator('.open-banner')).toHaveCount(0);

		await page.locator('.open-form input[name=password]').fill('not-the-password');
		await page.getByRole('button', { name: 'Open the instance' }).click();
		await expect(page.locator('.open-banner')).toHaveCount(0);
	});

	test('with it on, signing in asks for nothing', async ({ browser }) => {
		const admin = await browser.newContext({ storageState: AUTH_STATE });
		const adminPage = await admin.newPage();
		await adminPage.goto('/settings');
		await adminPage.locator('.open-form input[name=password]').fill('correct-horse-battery');
		await adminPage.getByRole('button', { name: 'Open the instance' }).click();
		await expect(adminPage.locator('.open-banner')).toBeVisible();

		// A browser that has never seen this instance.
		// EMPTY storage state, explicitly. `browser.newContext()` inherits the
		// describe's `test.use({ storageState })`, so a plain newContext() here
		// carried the administrator's session cookie and "signed in without a
		// password" was really "was already signed in".
		const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const page = await stranger.newPage();
		await page.goto('/login');
		await expect(page.locator('input[name=password]')).toHaveCount(0);
		await page.getByText('Jana Nováková').click();
		// exact: the passkey button is also named "…Sign in with a passkey", and
		// the name option matches by substring.
		await page.getByRole('button', { name: 'Sign in', exact: true }).click();
		await expect(page).toHaveURL(/\/overview/);
		await stranger.close();

		// Close it again, and the password field comes back with every credential
		// intact — turning it off is a restoration, not a repair.
		await adminPage.goto('/settings');
		await adminPage.getByRole('button', { name: 'Close it' }).click();
		await expect(adminPage.locator('.open-banner')).toHaveCount(0);

		const after = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const afterPage = await after.newPage();
		await afterPage.goto('/login');
		await expect(afterPage.locator('input[name=password]')).toHaveCount(1);
		await after.close();
		await admin.close();
	});
});
