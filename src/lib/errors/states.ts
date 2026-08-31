// SPDX-License-Identifier: AGPL-3.0-or-later
// What each error screen says.
//
// Data rather than markup, so the same catalogue serves the error page, a test
// and the docs without being rewritten in each. One entry per state we can
// actually reach; anything else falls back by class (see `stateFor`).
//
// The titles have a temperament; the bodies do not. Someone reading these is
// already having a bad time, so the sentence that explains what happened and
// what to do about it is written plainly every time.

interface ErrorState {
	/** The HTTP status, as text. '000' is the browser being unable to reach us at all. */
	code: string;
	/** The status' own name, shown small beside the code. */
	name: string;
	/** A colour token name — 'grey' means --fg3, everything else is --<hue>. */
	hue: 'grey' | 'blue' | 'purple' | 'indigo' | 'yellow' | 'orange' | 'red' | 'teal' | 'green';
	title: string;
	body: string;
	primary: { label: string; href: string };
	secondary?: { label: string; href: string };
}

export const ERROR_STATES: ErrorState[] = [
	{
		code: '400',
		name: 'Bad request',
		hue: 'grey',
		title: 'That request did not make sense.',
		body: 'Something in what the browser sent was malformed, so the server stopped rather than guess at what you meant. Reloading usually settles it.',
		primary: { label: 'Back to Overview', href: '/overview' }
	},
	{
		code: '401',
		name: 'Unauthorised',
		hue: 'blue',
		title: 'Identify yourself.',
		body: 'Your session ended, either because you signed out or because it sat idle long enough to expire. Sign back in and you will land exactly where you were.',
		primary: { label: 'Sign in', href: '/login' },
		secondary: { label: 'Back to Overview', href: '/overview' }
	},
	{
		code: '403',
		name: 'Forbidden',
		hue: 'purple',
		title: 'This is above your clearance.',
		body: 'The page is really there. This account is not permitted to open it. Anyone with the admin role can change that under Settings → People.',
		primary: { label: 'Back to Overview', href: '/overview' },
		secondary: { label: 'Settings', href: '/settings' }
	},
	{
		code: '404',
		name: 'Not found',
		hue: 'indigo',
		title: 'This page is not in this timeline.',
		body: 'The address is valid; nothing lives at it. It may have moved somewhere else, or it may never have been written in the first place.',
		primary: { label: 'Back to Overview', href: '/overview' }
	},
	{
		code: '408',
		name: 'Request timeout',
		hue: 'yellow',
		title: 'Time ran out.',
		body: 'The server waited as long as it was willing to and then let go. Nothing was written, so nothing has been lost — try it again.',
		primary: { label: 'Back to Overview', href: '/overview' }
	},
	{
		code: '429',
		name: 'Too many requests',
		hue: 'orange',
		title: 'You are moving faster than the server can follow.',
		body: 'Too many requests arrived in too short a window, so the server is holding the rest back. It clears on its own in a moment — nothing is broken.',
		primary: { label: 'Back to Overview', href: '/overview' }
	},
	{
		code: '500',
		name: 'Server error',
		hue: 'red',
		title: 'Something came loose in the engine room.',
		body: 'The server hit an error it could not recover from. It has been written to the log with the reference below, which is worth quoting if you report it.',
		primary: { label: 'Back to Overview', href: '/overview' }
	},
	{
		code: '502',
		name: 'Bad gateway',
		hue: 'teal',
		title: 'Two halves of the system stopped talking.',
		body: 'The app is running, but the service behind it did not answer in time. This is usually brief and fixes itself without anyone doing anything.',
		primary: { label: 'Back to Overview', href: '/overview' }
	},
	{
		code: '503',
		name: 'Unavailable',
		hue: 'green',
		title: 'Out of service, briefly.',
		body: 'Continuum is updating itself and will be back on its own. Nothing is being lost while it is away — imports and rules pick up exactly where they stopped.',
		primary: { label: 'Back to Overview', href: '/overview' }
	},
	{
		code: '000',
		name: 'Offline',
		hue: 'grey',
		title: 'You have drifted out of contact.',
		body: 'The browser cannot reach your Continuum server at all. It may be off, or you may be on a different network from the machine it runs on.',
		primary: { label: 'Back to Overview', href: '/overview' }
	}
];

// One line per state, revealed by clicking the rings.
export const NOTES: Record<string, string> = {
	'400': 'The message arrived in the wrong order. Read it backwards and it still does not parse.',
	'401': 'Names are the first thing you lose and the last thing you get back.',
	'403': 'Locked from the other side. Someone thought that was the kinder way round.',
	'404': 'Try the same address on a different Tuesday.',
	'408': 'Nothing waits forever. Well. Almost nothing.',
	'429': 'Slow down. You arrive at the same moment either way.',
	'500': 'Held together with rather more sticky tape than anyone likes to admit.',
	'502': 'One of them is shouting down a corridor that is not there any more.',
	'503': 'Back in five minutes. It may be a different five minutes for you.',
	'000': 'If you are reading this, you are further away than you think.'
};

const BY_CODE = new Map(ERROR_STATES.map((s) => [s.code, s]));

/**
 * The screen for a status.
 *
 * A status with no entry of its own falls back to its class rather than to a
 * blank page: any other 5xx reads as a server error, any other 4xx as a bad
 * request. That fallback is the point of this function — `error(418)` from
 * somewhere unexpected must still render something a person can act on.
 */
export function stateFor(status: number): ErrorState {
	const exact = BY_CODE.get(String(status));
	if (exact) return exact;
	return BY_CODE.get(status >= 500 ? '500' : '400')!;
}

// SvelteKit fills in a generic message when the thrown error carried none.
// Showing "Not Found" as the explanation under "This page is not in this
// timeline" is worse than the catalogue's sentence, so these are ignored and
// anything else — a real message from an `error(400, '…')` call site — is
// shown instead, because it says what went wrong for THIS request.
const GENERIC = new Set(['not found', 'internal error', 'internal server error', 'error']);

export function isGenericMessage(message: string | undefined | null): boolean {
	return !message || GENERIC.has(message.trim().toLowerCase());
}

const HUE_VARS: Record<ErrorState['hue'], { hue: string; tint: string }> = {
	grey: { hue: 'var(--fg3)', tint: 'var(--grey-tint)' },
	blue: { hue: 'var(--blue)', tint: 'var(--blue-tint)' },
	purple: { hue: 'var(--purple)', tint: 'var(--purple-tint)' },
	indigo: { hue: 'var(--indigo)', tint: 'var(--indigo-tint)' },
	yellow: { hue: 'var(--yellow)', tint: 'var(--yellow-tint)' },
	orange: { hue: 'var(--orange)', tint: 'var(--orange-tint)' },
	red: { hue: 'var(--red)', tint: 'var(--red-tint)' },
	teal: { hue: 'var(--teal)', tint: 'var(--teal-tint)' },
	green: { hue: 'var(--green)', tint: 'var(--green-tint)' }
};

export function huesFor(state: ErrorState): { hue: string; tint: string } {
	return HUE_VARS[state.hue];
}
