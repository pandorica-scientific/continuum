// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SessionPerson } from '$lib/server/auth';
import type { ApiGrant } from '$lib/server/api/areas';

declare global {
	namespace App {
		interface Locals {
			person: SessionPerson | null;

			/** Under /api only: what the bearer token may do and where, set by the boundary. */
			apiToken?: ApiGrant;

			/**
			 * Unused by the core.
			 *
			 * A project built on this repository puts its request-scoped context
			 * here — the tenant, the subscription — so it does not have to
			 * redeclare this interface, which would be an edit to a file it would
			 * otherwise never touch. `unknown` rather than a placeholder shape,
			 * because this repository makes no claim about something it does not
			 * define; the downstream narrows it at its own boundary.
			 */
			extension?: unknown;
		}

		// The reference is what the error screen shows and what someone quotes
		// when they report a fault; handleError() writes the same string to the
		// log beside the stack, so the two can be matched up afterwards.
		interface Error {
			message: string;
			reference?: string;
		}
	}
}

export {};
