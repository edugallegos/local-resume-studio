import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	InvalidResumeIdError,
	ResumeConflictError,
	ResumeExistsError,
	ResumeNotFoundError,
	ResumeValidationError,
} from "./errors";
import { FileResumeStore } from "./file-store";
import type { StoredResume } from "./types";

let rootDir: string;
let store: FileResumeStore;

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "local-resume-store-"));
	store = new FileResumeStore(rootDir);
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

/** A synthetic v6.1.0 document with no personal data. */
const syntheticResume = (name = "Ada Lovelace"): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = name;
	data.basics.headline = "Analytical Engine Programmer";
	data.basics.email = "ada@example.test";
	data.summary.content = "<p>Synthetic summary for storage tests.</p>";
	return data;
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const resumePath = (id: string): string => join(rootDir, `${id}.json`);

const readBytes = (id: string): Promise<Buffer> => readFile(resumePath(id));

describe("FileResumeStore", () => {
	it("creates, lists, reads, and removes a resume", async () => {
		const data = syntheticResume();

		const created = await store.create("Ada Resume", data);

		expect(created).toMatchObject({
			id: "ada-resume",
			label: "ada-resume",
			fullName: "Ada Lovelace",
		});
		expect(created.etag).toBe(sha256(await readBytes("ada-resume")));
		expect(Number.isNaN(Date.parse(created.updatedAt))).toBe(false);
		expect(created.data).toEqual(data);

		await expect(store.list()).resolves.toEqual([
			{
				id: "ada-resume",
				label: "ada-resume",
				fullName: "Ada Lovelace",
				updatedAt: created.updatedAt,
			},
		]);
		await expect(store.read("ada-resume")).resolves.toEqual(created);

		await store.remove("ada-resume", created.etag);

		await expect(store.list()).resolves.toEqual([]);
		await expect(store.read("ada-resume")).rejects.toBeInstanceOf(ResumeNotFoundError);
	});

	it("rejects invalid resume data without writing or changing existing bytes", async () => {
		await expect(store.create("Broken", { basics: { name: 42 } })).rejects.toBeInstanceOf(ResumeValidationError);
		await expect(readdir(rootDir)).resolves.toEqual([]);

		const created = await store.create("Valid", syntheticResume());
		const before = await readBytes(created.id);
		const invalid = syntheticResume();
		(invalid.basics as unknown as Record<string, unknown>).name = 42;

		await expect(store.save(created.id, invalid, created.etag)).rejects.toBeInstanceOf(ResumeValidationError);
		await expect(readBytes(created.id)).resolves.toEqual(before);
	});

	it("rejects malformed JSON on disk instead of returning partial data", async () => {
		await writeFile(resumePath("broken"), "{ not json");

		await expect(store.read("broken")).rejects.toBeInstanceOf(ResumeValidationError);
	});

	it("validates but persists the caller's original object and preserves unknown fields", async () => {
		const data = syntheticResume() as ResumeData & { customTopLevel: unknown };
		data.customTopLevel = { keep: true };
		(data.basics as unknown as Record<string, unknown>).pronouns = "she/her";
		// parseResumeData fills this default in its parsed copy; the raw file must stay untouched.
		delete (data.summary as { showHeading?: boolean }).showHeading;
		expect(data.summary).not.toHaveProperty("showHeading");

		const created = await store.create("Unknown Fields", data);

		const onDisk = JSON.parse((await readBytes("unknown-fields")).toString("utf8")) as {
			customTopLevel: unknown;
			basics: Record<string, unknown>;
			summary: Record<string, unknown>;
		};
		expect(onDisk.customTopLevel).toEqual({ keep: true });
		expect(onDisk.basics.pronouns).toBe("she/her");
		expect(onDisk.summary).not.toHaveProperty("showHeading");
		expect(created.data).toEqual(data);

		const edited = structuredClone(data);
		edited.summary.content = "<p>Edited without dropping unknown fields.</p>";
		const saved = await store.save(created.id, edited, created.etag);

		expect(saved.data.summary.content).toBe("<p>Edited without dropping unknown fields.</p>");
		const editedOnDisk = JSON.parse((await readBytes("unknown-fields")).toString("utf8")) as {
			customTopLevel: unknown;
			basics: Record<string, unknown>;
		};
		expect(editedOnDisk.customTopLevel).toEqual({ keep: true });
		expect(editedOnDisk.basics.pronouns).toBe("she/her");
	});

	it("rejects normalized label and slug collisions", async () => {
		const first = await store.create("Ada Resume", syntheticResume());

		await expect(store.create("ada resume", syntheticResume())).rejects.toBeInstanceOf(ResumeExistsError);
		await expect(store.create("Ada / Resume", syntheticResume())).rejects.toMatchObject({ code: "EXISTS" });
		await expect(store.create("Ada Resume", syntheticResume())).rejects.toMatchObject({ code: "EXISTS" });
		await expect(store.duplicate(first.id, "Ada Resume")).rejects.toBeInstanceOf(ResumeExistsError);
	});

	it("rejects traversal IDs and symlinked resume files", async () => {
		const outsideDir = await mkdtemp(join(tmpdir(), "local-resume-outside-"));
		const outsidePath = join(outsideDir, "outside.json");
		const outsideData = syntheticResume("Outside");
		await writeFile(outsidePath, JSON.stringify(outsideData));

		try {
			for (const id of ["../outside", "a/b", "..", "", "UPPER", "with space", ".hidden", "a..b", "a\\b"]) {
				await expect(store.read(id)).rejects.toBeInstanceOf(InvalidResumeIdError);
			}

			await symlink(outsidePath, resumePath("linked"));

			await expect(store.read("linked")).rejects.toMatchObject({ code: "UNSAFE_PATH" });
			await expect(store.save("linked", syntheticResume(), "etag")).rejects.toMatchObject({
				code: "UNSAFE_PATH",
			});
			await expect(store.remove("linked", "etag")).rejects.toMatchObject({ code: "UNSAFE_PATH" });

			const untouched = JSON.parse((await readFile(outsidePath)).toString("utf8")) as ResumeData;
			expect(untouched).toEqual(outsideData);
		} finally {
			await rm(outsideDir, { recursive: true, force: true });
		}
	});

	it("rejects stale ETags and preserves the current bytes", async () => {
		const created = await store.create("Versioned", syntheticResume());
		const originalBytes = await readBytes(created.id);

		await expect(store.save(created.id, syntheticResume("Changed"), "stale-etag")).rejects.toBeInstanceOf(
			ResumeConflictError,
		);
		await expect(readBytes(created.id)).resolves.toEqual(originalBytes);

		await expect(store.remove(created.id, "stale-etag")).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(readBytes(created.id)).resolves.toEqual(originalBytes);

		await expect(store.rename(created.id, "Renamed", "stale-etag")).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(readBytes(created.id)).resolves.toEqual(originalBytes);
		await expect(store.read("renamed")).rejects.toBeInstanceOf(ResumeNotFoundError);

		const external = syntheticResume("External Edit");
		await writeFile(resumePath(created.id), JSON.stringify(external));
		const externalBytes = await readBytes(created.id);

		await expect(store.save(created.id, syntheticResume("Mine"), created.etag)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expect(readBytes(created.id)).resolves.toEqual(externalBytes);
	});

	it("duplicates a resume into a new slug without touching the source", async () => {
		const source = await store.create("Original", syntheticResume());

		const copy = await store.duplicate(source.id, "Copy Resume");

		expect(copy).toMatchObject({ id: "copy-resume", label: "copy-resume", fullName: "Ada Lovelace" });
		expect(copy.data).toEqual(source.data);
		expect(copy.etag).toBe(sha256(await readBytes("copy-resume")));
		expect(await store.list()).toHaveLength(2);
		await expect(store.read(source.id)).resolves.toEqual(source);

		await expect(store.duplicate(source.id, "Original")).rejects.toBeInstanceOf(ResumeExistsError);
		await expect(store.duplicate("missing", "Copy")).rejects.toBeInstanceOf(ResumeNotFoundError);
	});

	it("renames the underlying file and rejects an existing target", async () => {
		const source = await store.create("Before", syntheticResume());
		const sourceBytes = await readBytes("before");

		const renamed = await store.rename(source.id, "After Rename", source.etag);

		expect(renamed).toMatchObject({ id: "after-rename", label: "after-rename" });
		expect(renamed.data).toEqual(source.data);
		expect(renamed.etag).toBe(source.etag);
		await expect(readBytes("after-rename")).resolves.toEqual(sourceBytes);
		await expect(lstat(resumePath("before"))).rejects.toMatchObject({ code: "ENOENT" });

		const other = await store.create("Other", syntheticResume("Grace Hopper"));
		await expect(store.rename("after-rename", "Other", renamed.etag)).rejects.toBeInstanceOf(ResumeExistsError);

		await expect(store.read("after-rename")).resolves.toEqual(renamed);
		await expect(store.read("other")).resolves.toEqual(other);
	});

	it("serializes concurrent saves from separate store instances so exactly one wins", async () => {
		const created = await store.create("Concurrent", syntheticResume("Initial"));
		const firstStore = new FileResumeStore(rootDir);
		const secondStore = new FileResumeStore(rootDir);
		const firstData = syntheticResume("Writer One");
		const secondData = syntheticResume("Writer Two");

		const results = await Promise.allSettled([
			firstStore.save(created.id, firstData, created.etag),
			secondStore.save(created.id, secondData, created.etag),
		]);

		const successes = results.filter(
			(result): result is PromiseFulfilledResult<StoredResume> => result.status === "fulfilled",
		);
		const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

		expect(successes).toHaveLength(1);
		expect(failures).toHaveLength(1);
		expect(failures[0]?.reason).toBeInstanceOf(ResumeConflictError);
		expect(failures[0]?.reason).toMatchObject({ code: "CONFLICT" });

		const winner = successes[0]?.value;
		if (!winner) throw new Error("Expected one successful save.");

		const onDisk = await store.read(created.id);
		expect(onDisk.etag).toBe(winner.etag);
		expect(onDisk.data).toEqual(winner.data);
		expect([firstData.basics.name, secondData.basics.name]).toContain(onDisk.data.basics.name);
		expect(onDisk.data.basics.name).toBe(winner.data.basics.name);
	});
});
