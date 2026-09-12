// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The one file a downstream replaces.
 *
 * Continuum's platform seams — boot steps, the database handle, file storage,
 * request gates, modules and navigation — are registries with defaults
 * registered by the core. A project built on this repository plugs into them
 * by overwriting THIS file with its own registrations, and touches nothing
 * else. That is the whole point: a fork that only adds files never fights a
 * merge, and a fork that edits core files fights the same one for ever.
 *
 * `src/hooks.server.ts` imports this first, before anything that reads a
 * registry, so a downstream registration is in place before the core's
 * defaults are consumed.
 *
 * In this repository it is deliberately empty and must stay that way. A core
 * default registered here would vanish the moment a downstream overwrote the
 * file.
 */
export {};
