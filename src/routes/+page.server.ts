// SPDX-License-Identifier: AGPL-3.0-or-later
import { redirect } from '@sveltejs/kit';

export const load = () => {
	redirect(307, '/overview');
};
