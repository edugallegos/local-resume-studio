import { readFile } from "node:fs/promises";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { templateSchema } from "@reactive-resume/schema/templates";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSafeRenderCopy } from "./safe-render-copy";
import { renderResumePdf } from "./render-resume-pdf";

const testFontUrl = "tests/fixtures/TestSerif.woff";
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

type FetchStubOptions = {
	/** Font URL fragments whose downloads fail, to exercise missing-font fallback. */
	failFontUrls?: string[];
};

const installFetchStub = async ({ failFontUrls = [] }: FetchStubOptions = {}) => {
	const font = await readFile(testFontUrl);
	const realFetch = globalThis.fetch;
	const calls: string[] = [];

	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			calls.push(url);

			if (url.startsWith("data:")) return realFetch(input, init);

			if (url.endsWith(".wasm")) {
				const bytes = await readFile(url.replace(/^\//, ""));
				return new Response(bytes, { headers: { "Content-Type": "application/wasm" } });
			}

			if (url.includes("gstatic") || url.includes("jsdelivr")) {
				if (failFontUrls.some((fragment) => url.toLowerCase().includes(fragment.toLowerCase()))) {
					return new Response("font unavailable", { status: 404 });
				}
				return new Response(font);
			}

			throw new Error(`Unexpected network request from the PDF renderer: ${url}`);
		}),
	);

	return { calls };
};

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace";
	data.basics.headline = "Analytical Engine Programmer";
	data.basics.email = "ada@example.test";
	data.summary.content = "<p>Synthetic summary for the PDF render matrix.</p>";
	data.sections.experience.title = "Experience";
	data.sections.experience.items = [
		{
			id: "experience-1",
			hidden: false,
			company: "Analytical Engine Works",
			position: "Programmer",
			location: "London",
			period: "1842 - 1843",
			dates: { start: null, end: null, present: false },
			website: { url: "", label: "", inlineLink: false },
			description: "<p>Wrote the first algorithm intended for a machine.</p>",
			roles: [],
		},
	];
	data.sections.skills.items = [
		{
			id: "skill-1",
			hidden: false,
			icon: "",
			iconColor: "",
			name: "Mathematics",
			proficiency: "Expert",
			level: 5,
			keywords: ["Analysis"],
		},
	];
	return data;
};

const unicodeResume = (): ResumeData => {
	const data = syntheticResume();
	data.basics.name = "José Álvarez";
	data.basics.headline = "Diseñador de máquinas analíticas";
	data.summary.content = "<p>Diseñó un motor analítico con precisión, ilusión y años de práctica.</p>";
	data.sections.experience.items[0] = {
		...data.sections.experience.items[0],
		company: "Compañía de Vapor",
		position: "Ingeniero",
		description: "<p>Pequeña historia de una máquina española: así avanzó la computación.</p>",
	};
	return data;
};

const extractText = async (blob: Blob): Promise<{ text: string; pages: number }> => {
	// pdfjs transfers the input buffer to its worker, so hand it a private copy.
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const document = await pdfjs.getDocument({
		data: bytes.slice(),
		useWorkerFetch: false,
		isEvalSupported: false,
		disableFontFace: true,
	}).promise;

	let text = "";
	for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
		const page = await document.getPage(pageNumber);
		const content = await page.getTextContent();
		text += `${content.items.map((item) => ("str" in item ? item.str : "")).join(" ")}\n`;
	}
	const pages = document.numPages;
	await document.destroy();
	return { text, pages };
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("renderResumePdf", () => {
	it(
		"renders a valid PDF for all 18 pinned templates and keeps the synthetic content extractable",
		async () => {
			await installFetchStub();

			for (const template of templateSchema.options) {
				const data = syntheticResume();
				data.metadata.template = template;

				const result = await renderResumePdf(data);
				const bytes = new Uint8Array(await result.blob.arrayBuffer());
				const header = String.fromCharCode(...bytes.slice(0, 4));

				expect(header, template).toBe("%PDF");
				expect(bytes.length, template).toBeGreaterThan(1000);
				expect(result.missingFonts, template).toEqual([]);
				expect(result.lostCharacters, template).toEqual([]);
				expect(result.pageMap.pages.length, template).toBeGreaterThan(0);
				expect(result.pageMap.nodes.length, template).toBeGreaterThan(0);

				const extracted = await extractText(result.blob);
				const lower = extracted.text.toLowerCase();
				// Letter-spaced headings (porygon) extract with spaces between every glyph.
				const compact = lower.replace(/[^a-z0-9]/g, "");
				expect(extracted.pages, template).toBe(result.pageMap.pages.length);
				expect(lower, template).toContain("ada lovelace");
				expect(compact, template).toContain("experience");
				expect(lower, template).toContain("analytical engine works");
			}
		},
		240_000,
	);

	it(
		"preserves Spanish accents without reporting lost characters",
		async () => {
			await installFetchStub();
			const data = unicodeResume();

			const result = await renderResumePdf(data);
			const extracted = await extractText(result.blob);

			expect(extracted.text).toContain("José Álvarez");
			expect(extracted.text).toContain("Compañía de Vapor");
			expect(extracted.text).toContain("Pequeña historia");
			expect(result.lostCharacters).toEqual([]);
			expect(result.missingFonts).toEqual([]);
		},
		60_000,
	);

	it(
		"reports lost characters independently of missing font files",
		async () => {
			await installFetchStub();
			const data = syntheticResume();
			data.summary.content = "<p>Lab marker 🧪 for the synthetic engine.</p>";

			const result = await renderResumePdf(data);

			expect(result.missingFonts).toEqual([]);
			expect(result.lostCharacters.join(" ")).toContain("U+1F9EA");
		},
		60_000,
	);

	it(
		"uses Forme's fallback only when a missing font is explicitly allowed, and reports the face",
		async () => {
			await installFetchStub({ failFontUrls: ["merriweather"] });
			const data = syntheticResume();
			data.metadata.typography.body.fontFamily = "Merriweather";
			data.metadata.typography.heading.fontFamily = "Merriweather";

			const result = await renderResumePdf(data);
			const bytes = new Uint8Array(await result.blob.arrayBuffer());

			expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
			expect(result.missingFonts).toContain("Merriweather");
			expect(result.pageMap.pages.length).toBeGreaterThan(0);
		},
		60_000,
	);

	it(
		"still rejects missing fonts when the browser option is omitted",
		async () => {
			await installFetchStub({ failFontUrls: ["lora"] });
			const { createResumePdfBlob } = await import("@reactive-resume/pdf/browser");
			const data = syntheticResume();
			data.metadata.typography.body.fontFamily = "Lora";
			data.metadata.typography.heading.fontFamily = "Lora";

			await expect(createResumePdfBlob({ data })).rejects.toThrow(/Fonts could not be loaded: Lora/);
		},
		60_000,
	);
});

describe("createSafeRenderCopy", () => {
	it("removes script and remote-image rich text while leaving the saved JSON untouched", () => {
		const data = syntheticResume();
		data.summary.content =
			'<p>Safe text</p><script>window.parent.postMessage("stolen", "*")</script><img src="https://evil.test/tracker.png">';
		data.sections.experience.items[0] = {
			...data.sections.experience.items[0],
			description: '<p>Role</p><img src="http://evil.test/a.png"><script>alert(1)</script>',
		};
		const original = structuredClone(data);

		const safe = createSafeRenderCopy(data);

		expect(safe.data.summary.content).toContain("Safe text");
		expect(safe.data.summary.content).not.toContain("<script");
		expect(safe.data.summary.content).not.toContain("evil.test");
		expect(safe.data.sections.experience.items[0]?.description).not.toContain("<script");
		expect(safe.data.sections.experience.items[0]?.description).not.toContain("evil.test");
		expect(data).toEqual(original);
	});

	it("suppresses non-embedded picture URLs with a local warning", () => {
		const data = syntheticResume();
		data.picture.hidden = false;
		data.picture.url = "https://images.example.test/portrait.png";

		const safe = createSafeRenderCopy(data);

		expect(safe.data.picture.url).toBe("");
		expect(safe.warnings.join(" ")).toMatch(/picture URL/i);
		expect(safe.warnings.join(" ")).toContain("images.example.test");
		expect(data.picture.url).toBe("https://images.example.test/portrait.png");
	});

	it("keeps embedded picture and image data URIs", () => {
		const data = syntheticResume();
		data.picture.hidden = false;
		data.picture.url = "data:image/png;base64,iVBORw0KGgo=";
		data.summary.content =
			'<p>Embedded</p><img src="data:image/png;base64,iVBORw0KGgo=" srcset="https://evil.test/large.png 2x">';

		const safe = createSafeRenderCopy(data);

		expect(safe.data.picture.url).toBe(data.picture.url);
		expect(safe.data.summary.content).toContain("data:image/png;base64");
		expect(safe.data.summary.content).not.toContain("evil.test");
		expect(safe.warnings).toEqual([]);
	});

	it("does not let a remote picture or rich-text image reach the network during rendering", async () => {
		const { calls } = await installFetchStub();
		const data = syntheticResume();
		data.picture.hidden = false;
		data.picture.url = "https://images.example.test/portrait.png";
		data.summary.content =
			'<p>Safe summary</p><img src="https://images.example.test/inline.png"><script>alert(1)</script>';

		const result = await renderResumePdf(data);
		const extracted = await extractText(result.blob);

		expect(result.blob.size).toBeGreaterThan(1000);
		expect(extracted.text).toContain("Safe summary");
		expect(calls.some((url) => url.includes("images.example.test"))).toBe(false);
	}, 60_000);
});
