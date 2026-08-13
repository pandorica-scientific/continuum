import type { SessionPerson } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			person: SessionPerson | null;
		}
	}
}

export {};
