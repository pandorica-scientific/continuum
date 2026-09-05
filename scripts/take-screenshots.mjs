/**
 * README and docs screenshots, captured from a running demo instance.
 *
 * Every shot is taken twice, in both themes, and at two sizes, so the README
 * can hand GitHub a <picture> that follows the reader's own colour scheme
 * rather than forcing one on them.
 *
 *   docs/screenshots/<screen>-<dark|light>-<web|mobile>.png
 *
 * Usage:
 *   npm install --no-save playwright
 *   DEMO=1 CONTINUUM_PORT=8081 ORIGIN=http://localhost:8081 \
 *     docker compose up -d app db
 *   SHOT_BASE_URL=http://localhost:8081 node scripts/take-screenshots.mjs
 *
 * Playwright is deliberately NOT a dependency. Nothing but this script wants
 * it, it drags a browser download behind it, and screenshots are regenerated a
 * few times a release — so it is installed for the run and not kept.
 *
 * ORIGIN has to match the address you point this at, or every form POST —
 * including the sign-in — is refused as cross-origin and the run dies on the
 * login page.
 *
 * Settings:
 *   SHOT_BASE_URL=http://localhost:8081   which instance to photograph
 *   SHOT_PERSON="Jana Nováková"           who to sign in as
 *   SHOT_PASSWORD=demo-demo-demo          their password
 *   SHOT_ONLY=overview,cashflow           a subset, for iterating on one screen
 *
 * It only ever reads. Point it at a demo instance all the same — a screenshot
 * of real balances is the one thing this project promises never to publish.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

/**
 * The AA pass, on the same run.
 *
 * `docs/ui-guidelines.md` demands AA contrast on every pill and tile in both
 * themes, and nothing checked it: a screenshot is looked at, not measured.
 * Every web capture is also handed to axe, and a `color-contrast` violation
 * fails the run — the one rule a design pass can break without noticing.
 * Off with SHOT_AXE=off, for iterating on a layout that is not done yet.
 * Installed for the run beside playwright: `npm install --no-save playwright
 * @axe-core/playwright`.
 */
const AXE = process.env.SHOT_AXE !== 'off';
const AxeBuilder = AXE ? (await import('@axe-core/playwright')).default : null;
/** @type {{ screen: string, theme: string, id: string, nodes: number, help: string }[]} */
const violations = [];

async function audit(page, screen, theme) {
	if (!AxeBuilder) return;
	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa'])
		// Scans and photographs are content, not chrome, and axe reads a
		// scanned page image as an image with no text alternative.
		.exclude('img')
		.analyze();
	for (const v of results.violations) {
		violations.push({ screen, theme, id: v.id, nodes: v.nodes.length, help: v.help });
	}
}
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/screenshots');

const BASE_URL = process.env.SHOT_BASE_URL ?? 'http://localhost:8081';
const PERSON = process.env.SHOT_PERSON ?? 'Jana Nováková';
const PASSWORD = process.env.SHOT_PASSWORD ?? 'demo-demo-demo';

/**
 * Retina, because GitHub renders these at half width or less. A 1x capture of
 * a chart is legible in the page and mush the moment anyone clicks it.
 */
const DEVICES = [
	// Taller than a laptop on purpose. At 900 the cash-flow Sankey — the one
	// picture that explains what this app is for — was cut off mid-chart in
	// every shot, and a README hero that stops halfway through the thing it is
	// advertising is worse than no hero. 1150 clears the whole flow card.
	{ name: 'web', viewport: { width: 1440, height: 1150 }, scale: 2, mobile: false },
	{ name: 'mobile', viewport: { width: 390, height: 844 }, scale: 3, mobile: true }
];

const THEMES = ['dark', 'light'];

/**
 * What to photograph.
 *
 * `settle` is for the screens that draw themselves after the data arrives —
 * a chart caught mid-animation is a screenshot of a half-drawn chart.
 *
 * `phone` marks the handful the README actually shows in a phone frame. Every
 * screen reflows to one column, but committing a retina phone capture of all
 * eleven costs several megabytes of repository for pictures nothing links to.
 *
 * `open` is a selector to click before the shot. The register collapses to a
 * row per month, so photographed as it loads it is a table of totals with no
 * transaction in it — a picture of the one thing that screen is not for. The
 * selector is followed rather than a `?month=` in the path because which month
 * is newest moves with the demo seed, and a path pinned to one would go blank
 * the moment the seed rolled past it.
 */
const SCREENS = [
	{ name: 'overview', path: '/overview', settle: 900, phone: true },
	{ name: 'cashflow', path: '/cashflow', settle: 900 },
	{ name: 'accounts', path: '/accounts', settle: 600 },
	// The newest month opens by itself since v0.8.1; nothing to click.
	{ name: 'transactions', path: '/transactions', phone: true, settle: 400 },
	{ name: 'import', path: '/import' },
	{ name: 'rules', path: '/rules' },
	{ name: 'tags', path: '/tags', settle: 600 },
	{ name: 'property', path: '/property', settle: 600, phone: true },
	{ name: 'loans', path: '/loans', settle: 600 },
	{ name: 'investments', path: '/investments', settle: 900 },
	{ name: 'retirement', path: '/retirement', settle: 900 },
	// Its own screen since v0.4.4, and unphotographed until v0.4.6. The band and
	// the chart both draw after their data arrives, hence the settle.
	{ name: 'salary', path: '/salary', settle: 900 },
	// Nine statements push the history charts past a 1150px viewport, and the
	// charts are the point of the screen — scroll to them rather than trimming
	// the demo data to fit the frame.
	{ name: 'tax', path: '/tax', settle: 600, scrollTo: 'text=one line per person and country' },
	{ name: 'calendar', path: '/calendar', phone: true },
	{ name: 'contacts', path: '/contacts' },
	// One per shelf: each draws a different engine, and a single screenshot of
	// "Documents" shows one of eight answers.
	{ name: 'documents', path: '/documents' },
	{ name: 'documents-inbox', path: '/documents?shelf=inbox' },
	{ name: 'documents-ids', path: '/documents?shelf=identity' },
	{ name: 'documents-statements', path: '/documents?shelf=statements' },
	{ name: 'documents-income-tax', path: '/documents?shelf=income_tax' },
	{ name: 'documents-health', path: '/documents?shelf=health' },
	{ name: 'documents-inventory', path: '/documents?shelf=inventory' },
	{ name: 'documents-property', path: '/documents?shelf=property' },
	{ name: 'documents-vehicles', path: '/documents?shelf=vehicles' },
	{ name: 'documents-list', path: '/documents?shelf=vehicles&view=list' }
];

const only = process.env.SHOT_ONLY?.split(',').map((s) => s.trim());
const wanted = only ? SCREENS.filter((s) => only.includes(s.name)) : SCREENS;

async function signIn(page) {
	await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
	// The sign-in screen is a person picker, not a username field: pick the
	// person by their name, then type the password.
	const person = page.locator(`button:has-text("${PERSON}"), label:has-text("${PERSON}")`).first();
	if (await person.count()) await person.click();
	// An open instance asks for nobody's password: the field is not drawn, and
	// waiting for it is how a demo run used to stall on the sign-in page.
	const password = page.locator('input[name="password"]');
	if (await password.count()) await password.fill(PASSWORD);
	await page.locator('button[type="submit"]:has-text("Sign in")').click();
	await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/**
 * Put this person into the theme being photographed.
 *
 * The theme is stored against the PERSON and handed back in a cookie that
 * `app.html` reads before first paint, so it can only be set once signed in —
 * signing in rewrites the cookie from what the database holds.
 *
 * This used to seed a localStorage key instead, which nothing has read since
 * the theme moved server-side. Every `-light-` capture was silently identical
 * to its `-dark-` twin, named after a theme it was not in.
 */
async function setTheme(page, theme) {
	const response = await page.evaluate(async (next) => {
		const res = await fetch('/settings/theme', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ theme: next })
		});
		return res.status;
	}, theme);
	if (response !== 200) throw new Error(`Could not set the ${theme} theme (${response}).`);
	// The choice is applied before paint from the cookie, so the page has to be
	// loaded again for it to take.
	await page.reload({ waitUntil: 'networkidle' });
}

/**
 * Refuse to photograph the sign-in screen.
 *
 * Every protected route redirects to /login, so a sign-in that quietly failed
 * does not throw — it produces a complete set of screenshots of the login form,
 * named after the screens they are not. That is worse than an error, because it
 * looks like success right up until someone opens the README.
 */
async function assertSignedIn(page, label) {
	if (new URL(page.url()).pathname.startsWith('/login')) {
		throw new Error(
			`Not signed in — ${label} redirected to /login. Check SHOT_PERSON/SHOT_PASSWORD.`
		);
	}
}

async function capture(browser, device, theme) {
	const context = await browser.newContext({
		viewport: device.viewport,
		deviceScaleFactor: device.scale,
		isMobile: device.mobile,
		hasTouch: device.mobile,
		locale: 'en-GB',
		timezoneId: 'Europe/Prague',
		colorScheme: theme
	});

	const page = await context.newPage();
	await signIn(page);
	await assertSignedIn(page, 'sign-in');
	await setTheme(page, theme);

	for (const screen of wanted.filter((s) => !device.mobile || s.phone)) {
		await page.goto(`${BASE_URL}${screen.path}`, { waitUntil: 'networkidle' });
		await assertSignedIn(page, screen.path);
		// Charts and counters animate in; a fixed settle is cruder than waiting
		// on an idle signal the app does not emit, but it is honest about what
		// it is waiting for.
		if (screen.settle) await page.waitForTimeout(screen.settle);
		// Expanding a row navigates — the open one lives in the URL — so wait for
		// the load rather than a fixed pause after the click.
		if (screen.open) {
			const row = page.locator(screen.open).first();
			if (await row.count()) {
				await row.click();
				await page.waitForLoadState('networkidle');
				await page.waitForTimeout(300);
			}
		}
		// Some screens carry a list above the thing worth photographing.
		// scrollIntoViewIfNeeded() is not enough: it treats an element peeking
		// over the bottom edge as already visible and does nothing.
		if (screen.scrollTo) {
			const target = page.locator(screen.scrollTo).first();
			if (await target.count()) {
				await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
				await page.waitForTimeout(400);
			}
		}
		const file = `${OUT}/${screen.name}-${theme}-${device.name}.png`;
		await page.screenshot({ path: file });
		process.stdout.write(`  ${screen.name}-${theme}-${device.name}\n`);
		if (!device.mobile) await audit(page, screen.name, theme);
	}

	await context.close();
}

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
try {
	for (const device of DEVICES) {
		for (const theme of THEMES) {
			console.log(`${device.name} · ${theme}`);
			await capture(browser, device, theme);
		}
	}
} finally {
	await browser.close();
}

const shots =
	THEMES.length *
	DEVICES.reduce(
		(total, device) => total + wanted.filter((s) => !device.mobile || s.phone).length,
		0
	);
console.log(`\n${shots} screenshots → docs/screenshots/`);

if (AXE) {
	const contrast = violations.filter((v) => v.id === 'color-contrast');
	const other = violations.filter((v) => v.id !== 'color-contrast');
	if (violations.length === 0) {
		console.log('axe: no WCAG 2 A/AA violations on any screen, either theme');
	} else {
		console.log(`\naxe: ${violations.length} violation(s)`);
		for (const v of violations) {
			console.log(`  ${v.screen} · ${v.theme} · ${v.id} × ${v.nodes} — ${v.help}`);
		}
	}
	// Contrast is the rule the guidelines name; the rest are reported and
	// left to a person, since an aria finding on a chart is often a judgement.
	if (contrast.length > 0) {
		console.error(
			`\n${contrast.length} contrast violation(s) — the guidelines require AA on every pill and tile.`
		);
		process.exitCode = 1;
	} else if (other.length > 0) {
		console.log('(no contrast violations; the findings above are advisory)');
	}
}
