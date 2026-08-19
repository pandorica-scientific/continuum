<script lang="ts">
	// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
	import { page } from '$app/state';
	import ErrorScreen from '$lib/components/ErrorScreen.svelte';
</script>

<svelte:head>
	<title>{page.status} · Continuum</title>
</svelte:head>

<!-- One boundary at the root, so it catches errors from every route including
     the ones thrown before a layout has loaded — a failure in the app layout's
     own load cannot be rendered inside that layout. -->
<ErrorScreen
	status={page.status}
	message={page.error?.message}
	reference={page.error?.reference}
	path="{page.url.pathname}{page.url.search}"
/>
