// SPDX-License-Identifier: AGPL-3.0-or-later
// The account domain: what an account is, and how it may be corrected.
export {
	archiveAccount,
	deleteAccount,
	parseAccountNumbers,
	unarchiveAccount,
	updateAccount,
	type AccountMutationResult,
	type UpdateAccountInput
} from './mutations';
export { activeAccount } from './active';
