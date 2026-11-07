import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidPdfError, InvalidResumeIdError } from "./errors";
import { MAX_PDF_BYTES, PdfExportStore } from "./pdf-export-store";

let rootDir: string;
let store: PdfExportStore;

const fixedDate = new Date("2026-01-02T03:04:05.678Z");
const pdfBytes = (): Uint8Array =>
	new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

beforeEach(async () => {
	rootDir = await mkdtemp(join(tmpdir(), "local-resume-exports-"));
	store = new PdfExportStore(rootDir);
});

afterEach(async () => {
	await rm(rootDir, { recursive: true, force: true });
});

describe("PdfExportStore", () => {
	it("archives valid PDF bytes atomically with a timestamped filename", async () => {
		const pdf = pdfBytes();

		const result = await store.save("Ada Resume", pdf, fixedDate);

		expect(result).toEqual({ filename: "ada-resume-2026-01-02T03-04-05-678Z.pdf" });
		await expect(readFile(join(rootDir, result.filename))).resolves.toEqual(Buffer.from(pdf));
		await expect(readdir(rootDir)).resolves.toEqual([result.filename]);
	});

	it("sanitizes unsafe resume slugs and never writes outside its root", async () => {
		const baseDir = await mkdtemp(join(tmpdir(), "local-resume-export-base-"));
		const exportRoot = join(baseDir, "exports");

		try {
			const safeStore = new PdfExportStore(exportRoot);
			const result = await safeStore.save("../../escape/resume", pdfBytes(), fixedDate);

			expect(result.filename).not.toContain("..");
			expect(result.filename).not.toContain("/");
			expect(result.filename).toBe("escape-resume-2026-01-02T03-04-05-678Z.pdf");
			await expect(readdir(exportRoot)).resolves.toEqual([result.filename]);
			await expect(readdir(baseDir)).resolves.toEqual(["exports"]);
		} finally {
			await rm(baseDir, { recursive: true, force: true });
		}
	});

	it("rejects a resume slug with no safe filename characters", async () => {
		await expect(store.save("***", pdfBytes(), fixedDate)).rejects.toBeInstanceOf(InvalidResumeIdError);
		await expect(readdir(rootDir)).resolves.toEqual([]);
	});

	it("rejects payloads that are not bounded Uint8Array PDF bytes", async () => {
		const invalidPayloads: unknown[] = [
			new Uint8Array(),
			new TextEncoder().encode("not a pdf"),
			new Uint8Array([0x25, 0x50, 0x44]),
			new ArrayBuffer(16),
			[0x25, 0x50, 0x44, 0x46],
			"%PDF-1.7",
		];

		for (const payload of invalidPayloads) {
			await expect(store.save("valid", payload as Uint8Array, fixedDate)).rejects.toBeInstanceOf(InvalidPdfError);
		}

		const oversized = new Uint8Array(MAX_PDF_BYTES + 1);
		oversized.set([0x25, 0x50, 0x44, 0x46]);
		await expect(store.save("valid", oversized, fixedDate)).rejects.toBeInstanceOf(InvalidPdfError);

		await expect(readdir(rootDir)).resolves.toEqual([]);
	});
});
