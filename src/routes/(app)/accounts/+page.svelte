<script lang="ts">
	import { enhance } from '$app/forms';
	import ScreenHeader from '$lib/components/ScreenHeader.svelte';
	import Eyebrow from '$lib/components/Eyebrow.svelte';

	let { data, form } = $props();

	let adding = $state(false);

	const donutGradient = $derived(
		data.donut.length
			? `conic-gradient(${data.donut.map((s) => `${s.color} ${s.from}% ${s.to}%`).join(', ')})`
			: 'conic-gradient(var(--card3) 0 100%)'
	);
</script>

<ScreenHeader
	title="Accounts"
	caption="Balances stay in their own currency. Only totals convert."
/>

{#if form?.message}
	<div class="error">{form.message}</div>
{/if}

<section class="grid-2">
	<div class="card list">
		<div class="eyebrow-row" style="padding-bottom: 10px;">
			<Eyebrow emoji="🏦" label="Accounts" />
			<span class="eyebrow-caption"
				>native currency · {data.cashTotalFormatted}
				{data.baseCurrencyDisplay} in total</span
			>
		</div>
		{#if data.accounts.length === 0}
			<p class="empty">
				No accounts yet. Add them here, or import a statement — accounts are created from statements
				automatically.
			</p>
		{/if}
		{#each data.accounts as a (a.id)}
			<div class="row">
				<span class="emoji">{a.emoji}</span>
				<div class="names">
					<span class="name">{a.name}</span>
					<span class="meta">{a.meta}</span>
				</div>
				<div class="balances">
					<span class="mono balance">{a.balance}</span>
					{#if a.baseEquivalent}
						<span class="mono equivalent">{a.baseEquivalent}</span>
					{/if}
				</div>
			</div>
		{/each}

		{#if adding}
			<form method="POST" action="?/addAccount" use:enhance class="add-form">
				<input name="name" placeholder="Name (e.g. Fio joint account)" />
				<select name="bank">
					<option value="fio">Fio banka</option>
					<option value="revolut">Revolut</option>
					<option value="mbank">mBank</option>
					<option value="rb">Raiffeisenbank</option>
					<option value="cs">Česká spořitelna</option>
					<option value="other">Other</option>
				</select>
				<select name="currency">
					{#each data.currencies as c (c)}<option>{c}</option>{/each}
				</select>
				<select name="kind">
					<option value="current">Current</option>
					<option value="savings">Savings</option>
					<option value="brokerage">Brokerage</option>
				</select>
				<input name="numbers" placeholder="Account number(s), comma separated" />
				<button type="submit" class="btn">Add</button>
			</form>
		{:else}
			<button type="button" class="btn add-btn" onclick={() => (adding = true)}
				>➕ Add account</button
			>
		{/if}
	</div>

	<div class="card sits">
		<Eyebrow emoji="🥧" label="Where the cash sits" />
		<div class="donut-wrap">
			<div class="donut" style:background={donutGradient}>
				<div class="hole"><span class="mono">{data.cashTotalFormatted}</span></div>
			</div>
			<div class="legend">
				{#each data.donut as s (s.label)}
					<div class="legend-row">
						<span class="dot" style:background={s.color}></span>
						<span class="legend-label">{s.label}</span>
						<span class="mono legend-pct">{s.pct.toFixed(1)}%</span>
					</div>
				{:else}
					<span class="empty">The split appears once balances are known.</span>
				{/each}
			</div>
		</div>
	</div>
</section>

<section class="card">
	<div class="eyebrow-row" style="padding-bottom: 4px;">
		<Eyebrow emoji="🔁" label="Transfers between your own accounts" />
		<span class="eyebrow-caption">matched automatically · never counted as income or expense</span>
	</div>
	{#each data.transfers as t (t.date + t.route)}
		<div class="transfer-row">
			<span class="mono t-date">{t.date}</span>
			<span class="t-route">{t.route}</span>
			<span class="mono">{t.amount}</span>
		</div>
	{:else}
		<p class="empty">Matched pairs from imported statements will appear here.</p>
	{/each}
</section>

<style>
	.error {
		border: 1px solid var(--red);
		background: var(--red-tint);
		color: var(--red);
		border-radius: 12px;
		padding: 9px 14px;
		font-size: 13px;
	}
	.grid-2 {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 16px;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}
	.row {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		padding: 11px 0;
		border-top: 1px solid var(--bd);
	}
	.emoji {
		font-size: 15px;
	}
	.names {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.name {
		font-size: 13.5px;
	}
	.meta {
		font-size: 11.5px;
		color: var(--fg3);
	}
	.balances {
		display: flex;
		flex-direction: column;
		gap: 1px;
		text-align: right;
	}
	.balance {
		font-size: 14.5px;
	}
	.equivalent {
		font-size: 11px;
		color: var(--fg3);
	}
	.empty {
		margin: 0;
		padding: 10px 0;
		font-size: 13px;
		color: var(--fg3);
	}
	.add-btn {
		margin-top: 11px;
		align-self: flex-start;
	}
	.add-form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto auto minmax(0, 1fr) auto;
		gap: 8px;
		padding-top: 11px;
		border-top: 1px solid var(--bd);
	}
	.add-form input,
	.add-form select {
		border: 1px solid var(--bd2);
		background: var(--card);
		color: var(--fg1);
		border-radius: 8px;
		padding: 8px 11px;
		font-size: 13px;
		min-width: 0;
	}
	.sits {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.donut-wrap {
		display: flex;
		align-items: center;
		gap: 22px;
		flex-wrap: wrap;
	}
	.donut {
		width: 148px;
		height: 148px;
		border-radius: 148px;
		flex: 0 0 148px;
		display: grid;
		place-items: center;
	}
	.hole {
		width: 88px;
		height: 88px;
		border-radius: 88px;
		background: var(--bg2);
		display: grid;
		place-items: center;
	}
	.hole .mono {
		font-size: 13.5px;
	}
	.legend {
		flex: 1 1 190px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.legend-row {
		display: grid;
		grid-template-columns: 11px minmax(0, 1fr) auto;
		gap: 9px;
		align-items: center;
		font-size: 12.5px;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 3px;
	}
	.legend-label {
		color: var(--fg2);
	}
	.legend-pct {
		color: var(--fg3);
	}
	.transfer-row {
		display: grid;
		grid-template-columns: 62px minmax(0, 1fr) auto;
		align-items: baseline;
		gap: 12px;
		padding: 9px 0;
		border-top: 1px solid var(--bd);
		font-size: 13.5px;
	}
	.t-date {
		font-size: 12px;
		color: var(--fg3);
	}
	.t-route {
		color: var(--fg2);
	}
	@media (max-width: 720px) {
		.add-form {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
	}
</style>
