// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { redirect } from '@sveltejs/kit';

export const load = () => {
	redirect(307, '/overview');
};
