// SPDX-License-Identifier: AGPL-3.0-or-later
import type { IconName } from '$lib/icons';

/**
 * A stroke icon per category group, for the tile before a group's name.
 *
 * Keyed by the seeded group keys in `$lib/categories`. A group the household
 * added has no icon of its own and takes the tag, which is what it is.
 */
const GROUP_ICON: Record<string, IconName> = {
	income: 'wallet',
	taxes: 'bank',
	bills: 'bolt',
	subscriptions: 'calendar',
	health: 'people',
	transport: 'compass',
	living: 'receipt',
	housing: 'house',
	savings: 'coins'
};

export function groupIcon(key: string): IconName {
	return GROUP_ICON[key] ?? 'tag';
}
