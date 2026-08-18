import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import path from 'node:path';

const DESIGN_ROOT = path.resolve('design_system');
let designUrl = '';
let server: Server;

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async () => {
	server = createServer(async (request, response) => {
		try {
			const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
			const relativePath =
				pathname === '/' ? 'Continuum Error Pages.dc.html' : pathname.replace(/^\/+/, '');
			const filePath = path.resolve(DESIGN_ROOT, relativePath);

			if (!filePath.startsWith(`${DESIGN_ROOT}${path.sep}`)) {
				response.writeHead(403).end();
				return;
			}

			const body = await readFile(filePath);
			const contentType =
				path.extname(filePath) === '.html'
					? 'text/html; charset=utf-8'
					: path.extname(filePath) === '.js'
						? 'text/javascript; charset=utf-8'
						: path.extname(filePath) === '.webp'
							? 'image/webp'
							: 'application/octet-stream';

			response.writeHead(200, { 'Content-Type': contentType });
			response.end(body);
		} catch {
			response.writeHead(404).end();
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});

	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Static test server did not start');
	designUrl = `http://127.0.0.1:${address.port}/Continuum%20Error%20Pages.dc.html`;
});

test.afterAll(async () => {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
});

test('every coloured Continuum logo reveals its matching coloured illustration', async ({
	page
}) => {
	await page.goto(designUrl);
	const errorCodes = ['400', '401', '403', '404', '408', '429', '500', '502', '503', '000'];

	for (const code of errorCodes) {
		await page.getByRole('button', { name: code, exact: true }).click();

		const closed = page.getByRole('button', { name: `Reveal ${code} illustration` });
		await expect(closed).toBeVisible();

		const logo = closed.locator('[data-error-logo]');
		await expect(logo).toBeVisible();
		await expect(closed.locator('[data-error-artwork]')).toBeHidden();

		const closedHue = await closed.evaluate((node) => getComputedStyle(node).color);
		expect(await logo.evaluate((node) => getComputedStyle(node).color)).toBe(closedHue);

		await closed.click();

		const open = page.getByRole('button', { name: `Hide ${code} illustration` });
		await expect(open).toBeVisible();
		await expect(open.locator('[data-error-logo]')).toBeHidden();

		const artwork = open.locator('[data-error-artwork]');
		const assetPath = `./assets/error-pages/${code}.webp`;
		await expect(artwork).toBeVisible();
		await expect(artwork.locator('image')).toHaveAttribute('href', assetPath);
		expect(await artwork.evaluate((node) => getComputedStyle(node).color)).toBe(closedHue);
		expect(await page.evaluate(async (url) => (await fetch(url)).status, assetPath)).toBe(200);

		await open.click();
		await expect(page.getByRole('button', { name: `Reveal ${code} illustration` })).toBeVisible();
	}

	await page.getByRole('button', { name: '404', exact: true }).click();
	const darkLogo = page.getByRole('button', { name: 'Reveal 404 illustration' });
	const darkHue = await darkLogo.evaluate((node) => getComputedStyle(node).color);

	await page.getByRole('button', { name: 'Light', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-ledger-theme', 'light');

	const lightLogo = page.getByRole('button', { name: 'Reveal 404 illustration' });
	const lightHue = await lightLogo.evaluate((node) => getComputedStyle(node).color);
	expect(lightHue).not.toBe(darkHue);
	expect(
		await lightLogo.locator('[data-error-logo]').evaluate((node) => getComputedStyle(node).color)
	).toBe(lightHue);

	await lightLogo.click();
	const lightArtwork = page.getByRole('button', { name: 'Hide 404 illustration' });
	expect(
		await lightArtwork
			.locator('[data-error-artwork]')
			.evaluate((node) => getComputedStyle(node).color)
	).toBe(lightHue);
});
