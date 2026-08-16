import type { SessionPerson } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			person: SessionPerson | null;
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
