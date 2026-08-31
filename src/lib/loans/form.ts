// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SecuredPropertyInput } from '$lib/server/loans/mutations';

/** Preserve blank shares as automatic allocation and every nonblank share for
 * domain validation. Form parsing must not turn invalid user input into a
 * materially different loan. */
export function securedPropertiesFromForm(
	form: FormData,
	propertyIds: string[]
): SecuredPropertyInput[] {
	return propertyIds.flatMap((propertyId) => {
		if (form.get(`secured_${propertyId}`) !== 'on') return [];
		const share = String(form.get(`share_${propertyId}`) ?? '')
			.replace(',', '.')
			.trim();
		return [{ propertyId, sharePct: share || null }];
	});
}
