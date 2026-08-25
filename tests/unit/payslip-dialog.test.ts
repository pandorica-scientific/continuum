// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import PayslipDialog from '$lib/components/PayslipDialog.svelte';

const props = {
	people: [
		{ id: 'p1', name: 'Robert' },
		{ id: 'p2', name: 'Kseniya' }
	],
	currencies: ['CZK', 'EUR', 'USD'],
	baseCurrency: 'EUR',
	onclose: () => {}
};

describe('the payslip dialog', () => {
	it('is a dialog, the way the tax statement form is', () => {
		const { body } = render(PayslipDialog, { props });
		expect(body).toContain('role="dialog"');
		expect(body).toContain('Add payslip');
	});

	it('asks for the three figures a payslip states', () => {
		const { body } = render(PayslipDialog, { props });
		expect(body).toContain('Gross');
		expect(body).toContain('Net');
		expect(body).toContain('Bonus');
		expect(body).toContain('Payslip PDF');
	});

	it('offers every person to file it against', () => {
		const { body } = render(PayslipDialog, { props });
		expect(body).toContain('Robert');
		expect(body).toContain('Kseniya');
	});

	it('keeps the model explainer behind an ⓘ', () => {
		const { body } = render(PayslipDialog, { props });
		expect(body).toContain('How these figures are read');
		expect(body).not.toContain('means a base of 75 000');
	});

	it('holds its draft rather than resetting the form on a refusal', () => {
		// The refusal path runs through `use:enhance`, which SSR never executes,
		// so the wiring is asserted at the source. Without `reset: false` the
		// dialog would clear the very figures the refusal is about.
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain('update({ reset: false })');
	});

	it('adopts the figures the entry refused, including ones it read itself', () => {
		// "Net pay cannot be more than gross" is unanswerable without seeing which
		// two numbers it meant — and a slip read from a PDF put nothing in these
		// fields to begin with.
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain('result.data?.values');
		expect(source).toContain('gross = values.gross');
		expect(source).toContain('net = values.net');
	});

	it('shows the refusal in the dialog rather than behind it', () => {
		// Page-level action data sits behind a modal's inert backdrop, so the
		// message has to be rendered locally.
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain('messageFromActionResult');
		expect(source).toContain('<ActionError message={actionError} />');
	});

	it('says the file must be chosen again after a refusal', () => {
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain('Choose the file again');
		// Only when one was actually picked — otherwise it is a warning about
		// nothing.
		expect(source).toContain('actionError && fileWasChosen');
	});

	it('replaces the form with the news once a slip has been filed', () => {
		// Held open so the news is read — but held open AS A FORM it said nothing
		// about whether the slip had landed: the fields were still full and Add
		// was still there, so the only way to find out was to press Add again, on
		// a screen where a second press files a second payslip.
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain('const settled = $derived(alsoFiled !== null || sameSlip !== null)');
		expect(source).toContain('{#if settled}');
		expect(source).toContain('if (shouldCloseAfterAction(result.type) && !settled) onclose();');
		// Nothing left to submit, and a way to file the next slip without leaving.
		expect(source).toContain('>Done</button>');
		expect(source).toContain('onclick={addAnother}');
	});

	it('says when an upload corrected a slip rather than adding one', () => {
		// The opposite news from "this month now has two", and just as invisible
		// without saying it: an upload that changed nothing on the table looks
		// exactly like an upload that failed.
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain('result.data?.sameSlip');
		expect(source).toContain('Nothing was added.');
	});

	it('reads the chosen file so the figures can be checked before anything is written', () => {
		// Filing blind and correcting afterwards is what this replaces — and a
		// correction teaches the reader a label, so a wrong one taught it the
		// wrong thing.
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain("fetch('/salary/read'");
		expect(source).toContain('void readChosen(picked)');
	});

	it('does not let a read overwrite a figure already typed', () => {
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain("if (!touched.includes('gross')) gross =");
		expect(source).toContain("if (!touched.includes('net')) net =");
	});

	it('tells the server which fields were actually edited', () => {
		// A prefilled figure is the reader's answer, not a decision. Sent as a
		// decision it would be stored as a hand-correction — immune to later
		// re-reads — and would teach the reader a label nobody chose.
		const { body } = render(PayslipDialog, { props });
		expect(body).toContain('name="touched"');
	});

	it('puts the explainer beside the title, not among the buttons', () => {
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain('{#snippet titleAside()}');
	});

	it('stacks each label over its own field', () => {
		// Without a local rule the labels fell back to the page default and laid
		// out inline, so "Whose" sat beside its select while "Month" sat above.
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toMatch(/\tlabel \{\n\t\tdisplay: flex;\n\t\tflex-direction: column;/);
	});
});

describe('which currency the slip was paid in', () => {
	// The v0.4.4 defect: the currency was silently the household's base, so six
	// Czech payslips were filed as 135 887 EUR.
	it('asks, rather than assuming the household reports in what it was paid in', () => {
		const { body } = render(PayslipDialog, { props });
		expect(body).toContain('Currency');
		expect(body).toContain('Which currency?');
	});

	it('offers every currency the instance can convert', () => {
		const { body } = render(PayslipDialog, { props });
		expect(body).toContain('CZK');
		expect(body).toContain('USD');
	});

	// A select that opens on the base currency is one nobody reads.
	it('starts on no currency at all, not on the base currency', () => {
		const { body } = render(PayslipDialog, { props });
		expect(body).not.toMatch(/<option[^>]*value="EUR"[^>]*selected/);
		expect(body).toMatch(/<option[^>]*value=""[^>]*(disabled|selected)/);
	});

	it('will not submit without one', () => {
		const { body } = render(PayslipDialog, { props });
		expect(body).toMatch(/<select[^>]*name="currency"[^>]*required|required[^>]*name="currency"/);
	});

	it('adopts the currency the slip named, and the one a refusal hands back', () => {
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain('currency = read.currency');
		expect(source).toContain('currency = values.currency');
	});

	// A remembered currency is a good guess about a job that has not changed,
	// not a fact printed on the paper. Saying the second in the words of the
	// first is the same quiet assumption this field exists to remove.
	it('does not call a remembered currency something the slip said', () => {
		const source = readFileSync(resolve('src/lib/components/PayslipDialog.svelte'), 'utf8');
		expect(source).toContain("currencyFrom === 'slip'");
		expect(source).toContain("currencyFrom === 'learned'");
		expect(source).toContain('what was stated last time');
	});
});
