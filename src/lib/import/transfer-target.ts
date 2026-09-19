// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * What the "moved to / came from" picker posts when the far account is not one
 * this household keeps — closed, or at a bank never added here.
 *
 * A word rather than a uuid, so it can never collide with a real account id and
 * is rejected out of hand by `asRowId`. Shared by the markup that offers it and
 * the action that reads it, so the two cannot disagree about its spelling.
 */
export const UNTRACKED_ACCOUNT = 'untracked';
