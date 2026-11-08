import { type FSWatcher, mkdirSync, watch } from "node:fs";
import { RESUME_ID_PATTERN, type FileResumeStore } from "@local-resume/store/file-store";

/** A minimal external-change event. It never contains resume content or filesystem paths. */
export type ResumeChangeEvent = {
	resumeId: string;
	etag: string;
};

export type ResumeChangeListener = (event: ResumeChangeEvent) => void;

export type ResumeChangeHubOptions = {
	/** Filesystem backends can emit several events for one atomic rename. */
	debounceMs?: number;
};

type ResumeStoreLike = Pick<FileResumeStore, "rootDir" | "read">;

const DEFAULT_DEBOUNCE_MS = 60;

const resumeIdOf = (filename: string): string | null => {
	if (!filename.endsWith(".json")) return null;
	const id = filename.slice(0, -".json".length);
	return RESUME_ID_PATTERN.test(id) ? id : null;
};

/**
 * Watches one resume directory while at least one editor stream is subscribed.
 *
 * Watching the directory, rather than an individual inode, survives the temp-file + rename pattern used by external
 * editors. Events are filtered by subscribed resume ID, debounced, re-read through the validated store, and de-duplicated
 * by content ETag so duplicate platform events cannot produce duplicate notifications.
 */
export class ResumeChangeHub {
	private readonly store: ResumeStoreLike;
	private readonly debounceMs: number;
	private readonly subscribers = new Map<string, Set<ResumeChangeListener>>();
	private readonly timers = new Map<string, NodeJS.Timeout>();
	private readonly lastEtags = new Map<string, string>();
	private readonly revisions = new Map<string, number>();
	private readonly streamCleanups = new Set<() => void>();
	private watcher: FSWatcher | null = null;
	private stopped = false;

	constructor(store: ResumeStoreLike, options: ResumeChangeHubOptions = {}) {
		this.store = store;
		this.debounceMs = Math.max(10, options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
	}

	subscribe(resumeId: string, listener: ResumeChangeListener): () => void {
		if (this.stopped || !RESUME_ID_PATTERN.test(resumeId)) return () => undefined;

		const listeners = this.subscribers.get(resumeId) ?? new Set<ResumeChangeListener>();
		listeners.add(listener);
		this.subscribers.set(resumeId, listeners);
		this.ensureWatcher();

		let active = true;
		return () => {
			if (!active) return;
			active = false;

			const current = this.subscribers.get(resumeId);
			current?.delete(listener);
			if (current && current.size === 0) {
				this.subscribers.delete(resumeId);
				this.clearTimer(resumeId);
				this.lastEtags.delete(resumeId);
				this.revisions.delete(resumeId);
			}

			if (this.subscribers.size === 0) this.stopWatcher();
		};
	}

	/** Registers an SSE stream teardown callback so `close()` can end response streams as well as the watcher. */
	registerStream(cleanup: () => void): () => void {
		if (this.stopped) {
			cleanup();
			return () => undefined;
		}

		this.streamCleanups.add(cleanup);
		return () => this.streamCleanups.delete(cleanup);
	}

	close(): void {
		if (this.stopped) return;
		this.stopped = true;
		this.stopWatcher();
		this.subscribers.clear();

		const cleanups = [...this.streamCleanups];
		this.streamCleanups.clear();
		for (const cleanup of cleanups) cleanup();
	}

	private ensureWatcher(): void {
		if (this.watcher || this.stopped) return;

		try {
			mkdirSync(this.store.rootDir, { recursive: true });
			this.watcher = watch(this.store.rootDir, { persistent: false }, (_eventType, filename) => {
				if (filename === null) return;
				const id = resumeIdOf(String(filename));
				if (id === null || !this.subscribers.has(id)) return;
				this.schedule(id);
			});
			this.watcher.on("error", () => this.stopWatcher());
		} catch {
			// A missing or unwatchable directory simply has no external changes to announce.
			this.watcher = null;
		}
	}

	private stopWatcher(): void {
		for (const timer of this.timers.values()) clearTimeout(timer);
		this.timers.clear();

		const watcher = this.watcher;
		this.watcher = null;
		try {
			watcher?.close();
		} catch {
			// Closing an already-closed watcher is harmless during teardown.
		}
	}

	private clearTimer(resumeId: string): void {
		const timer = this.timers.get(resumeId);
		if (timer === undefined) return;
		clearTimeout(timer);
		this.timers.delete(resumeId);
	}

	private schedule(resumeId: string): void {
		this.clearTimer(resumeId);
		const timer = setTimeout(() => {
			this.timers.delete(resumeId);
			void this.publish(resumeId);
		}, this.debounceMs);
		timer.unref();
		this.timers.set(resumeId, timer);
	}

	private async publish(resumeId: string): Promise<void> {
		const listeners = this.subscribers.get(resumeId);
		if (!listeners || listeners.size === 0 || this.stopped) return;

		const revision = (this.revisions.get(resumeId) ?? 0) + 1;
		this.revisions.set(resumeId, revision);

		let etag: string;
		try {
			// Reading through the store validates the complete v6.1.0 JSON object and computes the exact byte ETag.
			etag = (await this.store.read(resumeId)).etag;
		} catch {
			// A partial or invalid external write is ignored; a later valid event will notify.
			return;
		}

		// A newer filesystem event superseded this read.
		if (this.revisions.get(resumeId) !== revision || this.stopped) return;
		if (this.lastEtags.get(resumeId) === etag) return;
		this.lastEtags.set(resumeId, etag);

		const event: ResumeChangeEvent = { resumeId, etag };
		for (const listener of [...(this.subscribers.get(resumeId) ?? [])]) listener(event);
	}
}
