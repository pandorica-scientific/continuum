<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import '@fontsource-variable/inter';
	import '@fontsource/source-code-pro/400.css';
	import '@fontsource/source-code-pro/500.css';
	import '@fontsource/source-code-pro/600.css';
	import '$lib/styles/app.css';

	let { children } = $props();
</script>

{@render children()}
