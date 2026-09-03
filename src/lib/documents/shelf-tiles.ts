// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The three figures at the top of a shelf, chosen by its ENGINE.
 *
 * `banner.ts` chose them by shelf key, through a switch with a branch per
 * seeded shelf — so a shelf the household made fell to a default, and the
 * "planned" shelves in the registry had branches nothing could reach. Keying on
 * the engine means the four layouts each answer their own question and every
 * shelf drawing that layout gets the answer, whoever made it.
 *
 * A figure takes a colour only when it is a task. `0 gaps` is the state the
 * archive is for, and a red nought is an alarm about nothing.
 */
import type { Tile } from '$lib/components/tiles';
import type { ShelfEngine } from './templates';

export interface ShelfFacts {
	/** Everything on the shelf the viewer may see. */
	documents: number;
	/** Cards drawn: people on a wallet, accounts on a ribbon, cards on a dossier. */
	cards: number;
	/** Documents whose expiry has passed inside the red window. */
	expired: number;
	/** Documents inside their type's reminder window. */
	inReminderWindow: number;
	/** Cells that should be filled and are not, across the shelf. */
	missing: number;
	/** The soonest expiry still ahead, or null. */
	nextDate: string | null;
	/** Queue only: how many are waiting, and how long the oldest has waited. */
	waiting: number;
	oldestDays: number | null;
	/** Queue only: unfiled documents a lane rule would claim. */
	proposed: number;
}

export const EMPTY_FACTS: ShelfFacts = {
	documents: 0,
	cards: 0,
	expired: 0,
	inReminderWindow: 0,
	missing: 0,
	nextDate: null,
	waiting: 0,
	oldestDays: null,
	proposed: 0
};

/** `2027-01-31` → `31 Jan 2027`, the way a row's expiry pill reads it. */
export function formatDay(iso: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(`${iso}T00:00:00Z`));
}

const count = (n: number, label: string, note?: string): Tile => ({
	label,
	value: String(n),
	note
});
const alert = (n: number, label: string, note?: string): Tile => ({
	...count(n, label, note),
	color: n > 0 ? 'var(--red)' : undefined
});
const warn = (n: number, label: string, note?: string): Tile => ({
	...count(n, label, note),
	color: n > 0 ? 'var(--yellow)' : undefined
});

export function shelfTiles(engine: ShelfEngine, f: ShelfFacts): [Tile, Tile, Tile] {
	switch (engine) {
		case 'queue':
			return [
				warn(f.waiting, 'waiting', 'documents nobody has filed'),
				{
					label: 'oldest',
					value: f.oldestDays === null ? '—' : String(f.oldestDays),
					note: 'days in the queue'
				},
				count(f.proposed, 'proposed', 'a rule matched, one click to file')
			];
		case 'wallet':
			return [
				count(f.cards, 'people', 'named on this shelf'),
				alert(f.expired, 'expired', '30-day window running'),
				warn(f.inReminderWindow, 'inside reminder window')
			];
		case 'completeness':
			return [
				count(f.cards, 'accounts', 'on the ribbon'),
				count(f.documents, 'statements'),
				alert(f.missing, 'gaps', 'all years')
			];
		case 'dossier':
			return [
				count(f.cards, 'cards'),
				alert(f.missing, 'missing', 'cells that should be filled'),
				{
					label: 'next due',
					value: f.nextDate ? formatDay(f.nextDate) : '—',
					note: f.nextDate ? undefined : 'nothing dated'
				}
			];
	}
}

/** Everything, which has no one engine: the archive's own three figures. */
export function archiveTiles(f: {
	documents: number;
	shelves: number;
	nextDate: string | null;
}): [Tile, Tile, Tile] {
	return [
		count(f.documents, 'documents'),
		count(f.shelves, 'shelves'),
		{
			label: 'next expiry',
			value: f.nextDate ? formatDay(f.nextDate) : '—',
			note: f.nextDate ? undefined : 'nothing dated'
		}
	];
}
