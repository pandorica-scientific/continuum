<script lang="ts">
	let { message }: { message: string | null } = $props();
</script>

{#if message}
	<p class="action-error" role="alert">{message}</p>
{/if}

<style>
	.action-error {
		margin: 0;
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 10px;
		padding: 9px 12px;
		font-size: 13px;
	}
</style>
