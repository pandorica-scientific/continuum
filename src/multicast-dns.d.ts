// SPDX-License-Identifier: AGPL-3.0-or-later
// The one shape docker/mdns.mjs uses of multicast-dns, which ships no types.
declare module 'multicast-dns' {
	interface Responder {
		on(event: 'query', handler: (query: unknown, rinfo: { address?: string }) => void): void;
		on(event: 'error', handler: (error: Error) => void): void;
		respond(packet: { answers: unknown[] }): void;
	}
	export default function mdns(options?: { reuseAddr?: boolean }): Responder;
}
