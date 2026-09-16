<script lang="ts">
	// SPDX-License-Identifier: AGPL-3.0-or-later
	import { page } from '$app/state';
	import ErrorScreen from '$lib/components/ErrorScreen.svelte';
</script>

<svelte:head>
	<title>{page.status} · Continuum</title>
</svelte:head>

<!-- One boundary at the root — catches errors thrown before a layout has loaded too. -->
<ErrorScreen
	status={page.status}
	message={page.error?.message}
	reference={page.error?.reference}
	path="{page.url.pathname}{page.url.search}"
/>
