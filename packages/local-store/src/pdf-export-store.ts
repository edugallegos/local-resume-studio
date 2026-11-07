import { randomUUID } from "node:crypto";
import { link, mkdir, open, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
	InvalidPdfError,
	InvalidResumeIdError,
	ResumeExistsError,
	ResumeStorageError,
	ResumeValidationError,
	StoreError,
} from "./errors";
import type { PdfExportResult } from "./types";

/** The API also caps uploads at 50 MiB, so the archive never accepts more than that. */
export const MAX_PDF_BYTES = 50 * 1024 * 1024;

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46] as const;
const PDF_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TARGET_ATTEMPTS = 1000;

const fileSystemCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code;

const mapFileSystemError = (error: unknown, path: string): StoreError => {
	if (error instanceof StoreError) return error;

	switch (fileSystemCode(error)) {
		case "EEXIST":
			return new ResumeExistsError(`A PDF export already exists at ${path}.`, { cause: error });
		default:
			return new ResumeStorageError(`Could not archive the PDF export at ${path}.`, { cause: error });
	}
};

const closeQuietly = async (handle: FileHandle | undefined): Promise<void> => {
	if (!handle) return;
	await handle.close().catch(() => undefined);
};

const sanitizeResumeSlug = (resumeId: string): string => {
	if (typeof resumeId !== "string") {
		throw new InvalidResumeIdError("Resume ID must be a string.");
	}

	const slug = resumeId
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	if (!PDF_SLUG_PATTERN.test(slug)) {
		throw new InvalidResumeIdError("Resume ID does not contain safe filename characters.");
	}

	return slug;
};

const timestampFor = (createdAt: Date): string => {
	if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
		throw new ResumeValidationError("PDF export timestamp must be a valid Date.");
	}

	return createdAt.toISOString().replace(/[:.]/g, "-");
};

const validatePdf = (pdf: unknown): Uint8Array => {
	if (!(pdf instanceof Uint8Array)) {
		throw new InvalidPdfError("PDF export must be a Uint8Array.");
	}

	if (pdf.byteLength === 0 || pdf.byteLength > MAX_PDF_BYTES) {
		throw new InvalidPdfError(`PDF export must be between 1 and ${MAX_PDF_BYTES} bytes.`);
	}

	const hasHeader =
		pdf.byteLength >= PDF_HEADER.length && PDF_HEADER.every((byte, index) => pdf[index] === byte);
	if (!hasHeader) {
		throw new InvalidPdfError("PDF export must begin with the %PDF header.");
	}

	return pdf;
};

const writeTempFile = async (rootDir: string, prefix: string, bytes: Uint8Array): Promise<string> => {
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

/**
 * Archives validated PDF bytes under a single export directory.
 *
 * The resume ID is reduced to a filename-safe slug and the final name is created with a hard link, so a traversal attempt
 * cannot escape the root and an existing archive is never overwritten.
 */
export class PdfExportStore {
	readonly rootDir: string;

	constructor(rootDir: string) {
		if (typeof rootDir !== "string" || rootDir.trim() === "") {
			throw new ResumeStorageError("PDF export root must be a non-empty path.");
		}

		this.rootDir = resolve(rootDir);
	}

	async save(resumeId: string, pdf: Uint8Array, createdAt: Date = new Date()): Promise<PdfExportResult> {
		const bytes = validatePdf(pdf);
		const slug = sanitizeResumeSlug(resumeId);
		const timestamp = timestampFor(createdAt);
		const baseName = `${slug}-${timestamp}`;

		try {
			await mkdir(this.rootDir, { recursive: true });
		} catch (error) {
			throw new ResumeStorageError(`Could not create PDF export directory: ${this.rootDir}`, { cause: error });
		}

		const tempPath = await writeTempFile(this.rootDir, baseName, bytes);
		try {
			for (let index = 0; index < MAX_TARGET_ATTEMPTS; index += 1) {
				const filename = index === 0 ? `${baseName}.pdf` : `${baseName}-${index}.pdf`;
				const targetPath = resolve(this.rootDir, filename);

				if (dirname(targetPath) !== this.rootDir) {
					throw new InvalidResumeIdError("PDF export filename escapes the export root.");
				}

				try {
					await link(tempPath, targetPath);
					return { filename };
				} catch (error) {
					if (fileSystemCode(error) === "EEXIST") continue;
					throw mapFileSystemError(error, targetPath);
				}
			}

			throw new ResumeExistsError(`Could not find a free PDF export filename for ${baseName}.`);
		} finally {
			await unlink(tempPath).catch(() => undefined);
		}
	}
}
