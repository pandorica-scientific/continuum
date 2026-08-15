import { describe, expect, it, vi } from 'vitest';
import { createSerializedAutosave } from '$lib/actions/autosave';

describe('createSerializedAutosave', () => {
	it('serializes in-app saves so a later snapshot cannot overtake an earlier write', async () => {
		let releaseFirst: (() => void) | undefined;
		const first = new Promise<void>((resolve) => (releaseFirst = resolve));
		const save = vi.fn((value: string) => (value === 'first' ? first : Promise.resolve()));
		const autosave = createSerializedAutosave(save, vi.fn());

		autosave.queue('first');
		const firstFlush = autosave.flush();
		autosave.queue('second');
		const secondFlush = autosave.flush();

		await vi.waitFor(() => expect(save).toHaveBeenCalledWith('first', 1));
		expect(save).toHaveBeenCalledTimes(1);
		releaseFirst?.();
		await firstFlush;
		await secondFlush;
		expect(save).toHaveBeenNthCalledWith(2, 'second', 2);
	});

	it('sends a pending snapshot immediately through the page-exit transport', () => {
		const exitSave = vi.fn();
		const autosave = createSerializedAutosave(
			vi.fn(async () => {}),
			exitSave
		);

		autosave.queue('latest');
		autosave.flushForPageExit();

		expect(exitSave).toHaveBeenCalledWith('latest', 1);
	});

	it('keeps an in-flight snapshot eligible for the page-exit transport until it succeeds', async () => {
		let releaseSave: (() => void) | undefined;
		const pendingSave = new Promise<void>((resolve) => (releaseSave = resolve));
		const exitSave = vi.fn();
		const save = vi.fn(() => pendingSave);
		const autosave = createSerializedAutosave(save, exitSave);

		autosave.queue('latest');
		const flush = autosave.flush();
		await vi.waitFor(() => expect(save).toHaveBeenCalledWith('latest', 1));

		autosave.flushForPageExit();
		expect(exitSave).toHaveBeenCalledWith('latest', 1);

		releaseSave?.();
		await flush;
		autosave.flushForPageExit();
		expect(exitSave).toHaveBeenCalledTimes(1);
	});

	it('keeps a failed latest save eligible for the page-exit transport', async () => {
		const exitSave = vi.fn();
		const autosave = createSerializedAutosave(
			vi.fn(async () => {
				throw new Error('offline');
			}),
			exitSave
		);

		autosave.queue('retry me');
		await autosave.flush();
		autosave.flushForPageExit();

		expect(exitSave).toHaveBeenCalledWith('retry me', 1);
	});

	it('gives an exit snapshot a newer revision than an in-flight save', async () => {
		let releaseFirst: (() => void) | undefined;
		const first = new Promise<void>((resolve) => (releaseFirst = resolve));
		const writes: Array<{ value: string; revision: number }> = [];
		const save = vi.fn(async (value: string, revision: number) => {
			await first;
			writes.push({ value, revision });
		});
		const exitSave = vi.fn((value: string, revision: number) => {
			writes.push({ value, revision });
		});
		const autosave = createSerializedAutosave(save, exitSave, 40);

		autosave.queue('older');
		const flush = autosave.flush();
		await vi.waitFor(() => expect(save).toHaveBeenCalledWith('older', 41));
		autosave.queue('latest');
		autosave.flushForPageExit();
		expect(exitSave).toHaveBeenCalledWith('latest', 42);

		releaseFirst?.();
		await flush;
		expect(writes).toEqual([
			{ value: 'latest', revision: 42 },
			{ value: 'older', revision: 41 }
		]);
	});
});
