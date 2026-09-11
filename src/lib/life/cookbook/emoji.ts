// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The twenty-four marks offered for a recipe or a shelf of them.
 *
 * `EmojiPicker`'s default set is what a household files PAPER under, which is
 * the wrong question for dinner. These are dishes and the things dinners are
 * made of; the picker's two-character field still covers anything not here.
 *
 * Twenty-four exactly: the grid is six across and any other number leaves a
 * ragged last row.
 */
export const DISH_EMOJI = [
	'🍽️',
	'🍲',
	'🍝',
	'🍜',
	'🍛',
	'🥘',
	'🥗',
	'🥣',
	'🍞',
	'🥐',
	'🥞',
	'🍳',
	'🐟',
	'🍗',
	'🥩',
	'🍆',
	'🥕',
	'🍄',
	'🧀',
	'🍋',
	'🌶️',
	'🍰',
	'🍪',
	'☕'
] as const;
