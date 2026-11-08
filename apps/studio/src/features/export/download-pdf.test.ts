import { describe, expect, it, vi } from "vitest";
import { downloadPdf } from "./download-pdf";

describe("downloadPdf", () => {
	it("archives the exact preview Blob and then saves the archived filename", async () => {
		const blob = new Blob(["%PDF-1.7 preview"], { type: "application/pdf" });
		const exportPdf = vi.fn(async () => ({ filename: "ada-lovelace-2026.pdf" }));
		const save = vi.fn();

		await expect(
			downloadPdf({
				client: { exportPdf },
				id: "ada-lovelace",
				blob,
				fallbackFilename: "ada-lovelace.pdf",
				save,
			}),
		).resolves.toBe("ada-lovelace-2026.pdf");

		expect(exportPdf).toHaveBeenCalledWith("ada-lovelace", blob);
		expect(save).toHaveBeenCalledWith("ada-lovelace-2026.pdf", blob);
		expect(exportPdf.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0] ?? 0);
	});

	it("falls back to the resume filename when the archive header is empty", async () => {
		const blob = new Blob(["%PDF"], { type: "application/pdf" });
		const save = vi.fn();

		await expect(
			downloadPdf({
				client: { exportPdf: async () => ({ filename: "  " }) },
				id: "ada",
				blob,
				fallbackFilename: "ada.pdf",
				save,
			}),
		).resolves.toBe("ada.pdf");

		expect(save).toHaveBeenCalledWith("ada.pdf", blob);
	});

	it("does not download when the archive request fails", async () => {
		const save = vi.fn();
		const error = new Error("archive failed");

		await expect(
			downloadPdf({
				client: {
					exportPdf: async () => {
						throw error;
					},
				},
				id: "ada",
				blob: new Blob(["%PDF"], { type: "application/pdf" }),
				fallbackFilename: "ada.pdf",
				save,
			}),
		).rejects.toBe(error);

		expect(save).not.toHaveBeenCalled();
	});
});
