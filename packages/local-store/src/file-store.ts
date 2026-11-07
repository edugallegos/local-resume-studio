import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { link, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { type ResumeData, parseResumeData } from "@reactive-resume/schema/resume/data";
import {
	InvalidResumeIdError,
	ResumeConflictError,
	ResumeExistsError,
	ResumeNotFoundError,
	ResumeStorageError,
	ResumeValidationError,
	StoreError,
	UnsafeResumePathError,
} from "./errors";
import type { ResumeListItem, StoredResume } from "./types";

/** Lowercase slugs only. This is checked before any path is resolved. */
export const RESUME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type RecordOnDisk = {
	bytes: Buffer;
	data: ResumeData;
	etag: string;
	stats: Stats;
};

const isStoreError = (error: unknown): error is StoreError => error instanceof StoreError;

const fileSystemCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code;

/**
 * Mutations are queued per resolved storage root so separate FileResumeStore instances pointing at the same directory
 * cannot read the same old bytes and then both write. Reads stay lock-free; only create/save/rename/remove take the queue.
 */
const mutationQueues = new Map<string, Promise<void>>();

const withRootMutationLock = async <T>(rootDir: string, mutation: () => Promise<T>): Promise<T> => {
	const previous = mutationQueues.get(rootDir) ?? Promise.resolve();
	const run = previous.then(mutation, mutation);
	const tail = run.then(
		() => undefined,
		() => undefined,
	);
	mutationQueues.set(rootDir, tail);

	try {
		return await run;
	} finally {
		if (mutationQueues.get(rootDir) === tail) {
			mutationQueues.delete(rootDir);
		}
	}
};

const mapFileSystemError = (error: unknown, path: string): StoreError => {
	if (isStoreError(error)) return error;

	switch (fileSystemCode(error)) {
		case "ENOENT":
			return new ResumeNotFoundError(`Resume file was not found: ${path}`, { cause: error });
		case "EEXIST":
			return new ResumeExistsError(`A resume already exists at ${path}.`, { cause: error });
		case "ELOOP":
			return new UnsafeResumePathError(`Refusing to follow a symlink at ${path}.`, { cause: error });
		default:
			return new ResumeStorageError(`Could not access resume storage at ${path}.`, { cause: error });
	}
};

/**
 * Turn a display label into the filename slug. Labels that differ only by case, whitespace, punctuation, or accents
 * therefore resolve to the same ID and collide instead of silently creating a second file.
 */
export const normalizeResumeLabel = (label: string): string => {
	if (typeof label !== "string") throw new InvalidResumeIdError("Resume label must be a string.");

	const slug = label
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	if (!RESUME_ID_PATTERN.test(slug)) {
		throw new InvalidResumeIdError(`Resume label "${label}" does not produce a valid filename slug.`);
	}

	return slug;
};

const assertResumeId = (id: string): string => {
	if (typeof id !== "string" || !RESUME_ID_PATTERN.test(id)) {
		throw new InvalidResumeIdError(`Invalid resume ID: ${JSON.stringify(id)}.`);
	}

	return id;
};

const validateResume = (data: unknown): void => {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new ResumeValidationError("Resume data must be a JSON object.");
	}

	try {
		// Validation only: the parsed/migrated object is deliberately not persisted.
		parseResumeData(data);
	} catch (error) {
		throw new ResumeValidationError("Resume data does not match the pinned Reactive Resume schema.", {
			cause: error,
		});
	}
};

const serializeResume = (data: unknown): Buffer => {
	validateResume(data);

	let json: string | undefined;
	try {
		json = JSON.stringify(data, null, 2);
	} catch (error) {
		throw new ResumeValidationError("Resume data must be JSON-serializable.", { cause: error });
	}

	if (typeof json !== "string") {
		throw new ResumeValidationError("Resume data must serialize to a JSON object.");
	}

	return Buffer.from(`${json}\n`, "utf8");
};

const parseStoredResume = (bytes: Buffer, path: string): ResumeData => {
	let raw: unknown;
	try {
		raw = JSON.parse(bytes.toString("utf8"));
	} catch (error) {
		throw new ResumeValidationError(`Resume file is not valid JSON: ${path}`, { cause: error });
	}

	validateResume(raw);
	return raw as ResumeData;
};

const hashBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const closeQuietly = async (handle: FileHandle | undefined): Promise<void> => {
	if (!handle) return;
	await handle.close().catch(() => undefined);
};

const readRecord = async (path: string): Promise<RecordOnDisk> => {
	let linkInfo: Stats;
	try {
		linkInfo = await lstat(path);
	} catch (error) {
		throw mapFileSystemError(error, path);
	}

	if (linkInfo.isSymbolicLink()) {
		throw new UnsafeResumePathError(`Refusing to access a symlinked resume file: ${path}`);
	}

	if (!linkInfo.isFile()) {
		throw new ResumeStorageError(`Resume path is not a regular file: ${path}`);
	}

	let handle: FileHandle | undefined;
	try {
		// O_NOFOLLOW closes the race between lstat and open on platforms that support it.
		handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
		const stats = await handle.stat();
		if (!stats.isFile()) {
			throw new ResumeStorageError(`Resume path is not a regular file: ${path}`);
		}

		const bytes = await handle.readFile();
		const data = parseStoredResume(bytes, path);

		return { bytes, data, etag: hashBytes(bytes), stats };
	} catch (error) {
		throw mapFileSystemError(error, path);
	} finally {
		await closeQuietly(handle);
	}
};

const ensureRoot = async (rootDir: string): Promise<void> => {
	try {
		await mkdir(rootDir, { recursive: true });
	} catch (error) {
		throw new ResumeStorageError(`Could not create resume storage directory: ${rootDir}`, { cause: error });
	}
};

const writeTempFile = async (rootDir: string, prefix: string, bytes: Buffer): Promise<string> => {
	const tempPath = join(rootDir, `.${prefix}.${process.pid}.${randomUUID()}.tmp`);
	let handle: FileHandle | undefined;

	try {
		handle = await open(tempPath, "wx", 0o600);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = undefined;
		return tempPath;
	} catch (error) {
		await closeQuietly(handle);
		await unlink(tempPath).catch(() => undefined);
		throw mapFileSystemError(error, tempPath);
	}
};

const assertTargetAbsent = async (path: string): Promise<void> => {
	try {
		await lstat(path);
	} catch (error) {
		if (fileSystemCode(error) === "ENOENT") return;
		throw mapFileSystemError(error, path);
	}

	throw new ResumeExistsError(`A resume already exists at ${path}.`);
};

const assertUnchangedSince = async (path: string, record: RecordOnDisk): Promise<void> => {
	let latest: Stats;
	try {
		latest = await lstat(path);
	} catch (error) {
		throw mapFileSystemError(error, path);
	}

	if (latest.isSymbolicLink()) {
		throw new UnsafeResumePathError(`Refusing to access a symlinked resume file: ${path}`);
	}

	if (
		!latest.isFile() ||
		latest.ino !== record.stats.ino ||
		latest.size !== record.stats.size ||
		latest.mtimeMs !== record.stats.mtimeMs
	) {
		throw new ResumeConflictError("The resume changed on disk after it was read.");
	}
};

const toListItem = (id: string, data: ResumeData, stats: Stats): ResumeListItem => ({
	id,
	label: id,
	fullName: data.basics.name,
	updatedAt: stats.mtime.toISOString(),
});

/**
 * Stores raw Reactive Resume JSON documents as `<slug>.json` under a single directory.
 *
 * Every mutation validates the incoming document and checks the caller's ETag before touching the existing file. Writes
 * go through a same-directory temporary file and an atomic link/rename, so invalid data and stale writes cannot truncate
 * or replace the bytes that are already on disk.
 */
export class FileResumeStore {
	readonly rootDir: string;

	constructor(rootDir: string) {
		if (typeof rootDir !== "string" || rootDir.trim() === "") {
			throw new ResumeStorageError("Resume storage root must be a non-empty path.");
		}

		this.rootDir = resolve(rootDir);
	}

	private pathFor(id: string): string {
		const resumeId = assertResumeId(id);
		const path = resolve(this.rootDir, `${resumeId}.json`);

		if (dirname(path) !== this.rootDir) {
			throw new InvalidResumeIdError(`Resume ID escapes the storage root: ${JSON.stringify(id)}.`);
		}

		return path;
	}

	async list(): Promise<ResumeListItem[]> {
		let entries: Dirent[];
		try {
			entries = await readdir(this.rootDir, { withFileTypes: true });
		} catch (error) {
			if (fileSystemCode(error) === "ENOENT") return [];
			throw mapFileSystemError(error, this.rootDir);
		}

		const items: ResumeListItem[] = [];
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

			const id = entry.name.slice(0, -".json".length);
			if (!RESUME_ID_PATTERN.test(id)) continue;

			const record = await readRecord(this.pathFor(id));
			items.push(toListItem(id, record.data, record.stats));
		}

		items.sort((left, right) => left.id.localeCompare(right.id));
		return items;
	}

	async read(id: string): Promise<StoredResume> {
		const resumeId = assertResumeId(id);
		const record = await readRecord(this.pathFor(resumeId));

		return {
			...toListItem(resumeId, record.data, record.stats),
			data: record.data,
			etag: record.etag,
		};
	}

	async create(label: string, data: unknown): Promise<StoredResume> {
		const id = normalizeResumeLabel(label);
		const bytes = serializeResume(data);

		return withRootMutationLock(this.rootDir, async () => {
			await ensureRoot(this.rootDir);
			const path = this.pathFor(id);
			await assertTargetAbsent(path);

			const tempPath = await writeTempFile(this.rootDir, id, bytes);
			try {
				// A hard link creates the final name atomically and fails rather than overwriting a collision.
				await link(tempPath, path);
			} catch (error) {
				throw mapFileSystemError(error, path);
			} finally {
				await unlink(tempPath).catch(() => undefined);
			}

			return this.read(id);
		});
	}

	async save(id: string, data: unknown, expectedEtag: string): Promise<StoredResume> {
		const resumeId = assertResumeId(id);
		const bytes = serializeResume(data);

		return withRootMutationLock(this.rootDir, async () => {
			const path = this.pathFor(resumeId);
			const current = await readRecord(path);

			if (current.etag !== expectedEtag) {
				throw new ResumeConflictError("The resume changed on disk since it was read.");
			}

			await assertUnchangedSince(path, current);

			const tempPath = await writeTempFile(this.rootDir, resumeId, bytes);
			try {
				await rename(tempPath, path);
			} catch (error) {
				throw mapFileSystemError(error, path);
			} finally {
				await unlink(tempPath).catch(() => undefined);
			}

			return this.read(resumeId);
		});
	}

	async duplicate(id: string, label: string): Promise<StoredResume> {
		const source = await this.read(id);
		return this.create(label, source.data);
	}

	async rename(id: string, label: string, expectedEtag: string): Promise<StoredResume> {
		const sourceId = assertResumeId(id);
		const targetId = normalizeResumeLabel(label);

		return withRootMutationLock(this.rootDir, async () => {
			const sourcePath = this.pathFor(sourceId);
			const current = await readRecord(sourcePath);

			if (current.etag !== expectedEtag) {
				throw new ResumeConflictError("The resume changed on disk since it was read.");
			}

			if (targetId === sourceId) {
				return this.read(sourceId);
			}

			const targetPath = this.pathFor(targetId);
			await assertTargetAbsent(targetPath);
			await assertUnchangedSince(sourcePath, current);

			try {
				// Linking first and unlinking second avoids overwriting a target created by another process.
				await link(sourcePath, targetPath);
			} catch (error) {
				throw mapFileSystemError(error, targetPath);
			}

			try {
				await unlink(sourcePath);
			} catch (error) {
				await unlink(targetPath).catch(() => undefined);
				throw mapFileSystemError(error, sourcePath);
			}

			return this.read(targetId);
		});
	}

	async remove(id: string, expectedEtag: string): Promise<void> {
		const resumeId = assertResumeId(id);

		return withRootMutationLock(this.rootDir, async () => {
			const path = this.pathFor(resumeId);
			const current = await readRecord(path);

			if (current.etag !== expectedEtag) {
				throw new ResumeConflictError("The resume changed on disk since it was read.");
			}

			await assertUnchangedSince(path, current);

			try {
				await unlink(path);
			} catch (error) {
				throw mapFileSystemError(error, path);
			}
		});
	}
}
