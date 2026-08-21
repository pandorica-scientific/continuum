import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter(),

			// Turned off because src/lib/server/csrf.ts replaces it, NOT because the
			// protection is unwanted. SvelteKit's version compares Origin against
			// url.origin, which adapter-node pins to the ORIGIN environment variable —
			// one address — so every other address the server answers on had its form
			// posts refused. The check runs before the handle hook, so a hook cannot
			// soften it; disabling it here is the only place the replacement can live.
			// The replacement compares Origin against the request's own Host, which is
			// the same protection without the single-address assumption.
			csrf: { trustedOrigins: ['*'] }
		})
	],
	test: {
		include: [
			'src/**/*.test.ts',
			'tests/unit/**/*.test.ts',
			'tests/integration/**/*.test.ts',
			'tests/acceptance/**/*.test.ts'
		],
		environment: 'node'
	}
});
