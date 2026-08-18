import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ERROR_STATES, NOTES, huesFor, isGenericMessage, stateFor } from '$lib/errors/states';
import { ARTWORK_DIR, artworkFor } from '$lib/errors/artwork';

describe('choosing a screen for a status', () => {
	it('uses the state written for that status', () => {
		expect(stateFor(404).code).toBe('404');
		expect(stateFor(403).code).toBe('403');
		expect(stateFor(503).code).toBe('503');
	});

	// The point of the fallback: a status nobody wrote a screen for must still
	// render something a person can act on, not a blank page.
	it('falls back to a server error for any other 5xx', () => {
		expect(stateFor(504).code).toBe('500');
		expect(stateFor(507).code).toBe('500');
	});

	it('falls back to a bad request for any other 4xx', () => {
		expect(stateFor(418).code).toBe('400');
		expect(stateFor(422).code).toBe('400');
	});

	it('never returns nothing, for any status a server can send', () => {
		for (let status = 400; status < 600; status++) {
			expect(stateFor(status).title.length).toBeGreaterThan(0);
		}
	});
});

describe('which message gets shown', () => {
	// SvelteKit fills in a stand-in when the thrown error carried no message.
	// "Not Found" under "This page is not in this timeline" says less than the
	// catalogue's own sentence, so it must lose.
	it('treats SvelteKit stand-ins as saying nothing', () => {
		expect(isGenericMessage('Not Found')).toBe(true);
		expect(isGenericMessage('Internal Error')).toBe(true);
		expect(isGenericMessage(undefined)).toBe(true);
		expect(isGenericMessage('')).toBe(true);
	});

	it('keeps a message a call site actually wrote', () => {
		expect(isGenericMessage('This tenancy has already ended.')).toBe(false);
		expect(isGenericMessage('Amount must be positive.')).toBe(false);
	});
});

describe('the catalogue', () => {
	it('has a screen for every status the app throws', () => {
		// Every status reached by an `error(…)` call anywhere in the app.
		for (const status of [400, 401, 403, 404, 429]) {
			expect(stateFor(status).code).toBe(String(status));
		}
	});

	it('resolves a colour for every state', () => {
		for (const state of ERROR_STATES) {
			const { hue, tint } = huesFor(state);
			expect(hue.startsWith('var(--')).toBe(true);
			expect(tint.startsWith('var(--')).toBe(true);
		}
	});

	it('gives every state a note and a drawing', () => {
		for (const state of ERROR_STATES) {
			expect(NOTES[state.code]).toBeTruthy();
			expect(artworkFor(state.code)).toBe(`${ARTWORK_DIR}/${state.code}.webp`);
		}
	});

	// The drawings are files rather than transcribed path data now, so a missing
	// export is a blank square on a screen nobody visits on purpose. Checking the
	// file is on disk is the only thing that catches that before someone hits it.
	it('ships the drawing every state points at', () => {
		for (const state of ERROR_STATES) {
			const file = path.resolve('static', artworkFor(state.code).replace(/^\//, ''));
			expect(existsSync(file), state.code).toBe(true);
		}
	});

	it('sends everybody somewhere they can get to', () => {
		for (const state of ERROR_STATES) {
			expect(state.primary.href.startsWith('/')).toBe(true);
			expect(state.secondary?.href.startsWith('/') ?? true).toBe(true);
		}
	});
});
