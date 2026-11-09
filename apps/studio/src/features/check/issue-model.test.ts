import type { AtsFinding } from "@reactive-resume/resume/ats";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it } from "vitest";
import { toCheckIssue } from "./issue-model";

/** Synthetic v6.1.0 fixture. Never use a real person's resume here. */
const syntheticResume = (): ResumeData => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "";
	data.basics.email = "ada@example.test";
	data.basics.phone = "+1 555 0100";
	data.basics.location = "London";
	data.basics.website.url = "not a url";
	data.summary.content = "<p>Synthetic summary.</p>";
	data.sections.experience.items = [
		{
			id: "exp-1",
			hidden: false,
			company: "Analytical Engine Works",
			position: "Programmer",
			location: "London",
			period: "2019 - 2022",
			dates: { start: "2019", end: "2022", present: false },
			website: { url: "", label: "", inlineLink: false },
			description: "<p>Wrote an algorithm.</p>",
			roles: [],
		},
	];
	data.sections.certifications.items = [
		{
			id: "cert-1",
			hidden: false,
			title: "Certified Analyst",
			issuer: "Synthetic Institute",
			date: "sometime soon",
			dates: { start: null, end: null, present: false, raw: "sometime soon" },
			website: { url: "", label: "", inlineLink: false },
			description: "<p>Synthetic certification.</p>",
		},
	];
	return data;
};

const finding = (overrides: Partial<AtsFinding> & Pick<AtsFinding, "code" | "pointer">): AtsFinding => ({
	severity: "warning",
	key: `${overrides.code}:${overrides.pointer}`,
	...overrides,
});

describe("toCheckIssue", () => {
	it("maps name and contact findings to readable Write fields and the header overlay", () => {
		const data = syntheticResume();

		const missingName = toCheckIssue(finding({ code: "MISSING_NAME", severity: "error", pointer: "/basics/name" }), data);
		expect(missingName).toMatchObject({
			title: "Your name is missing",
			category: "contact",
			categoryLabel: "Contact details",
			severity: "error",
			editTarget: { fieldId: "write-basics-name", label: "Basics · Full name" },
			pageTarget: { kind: "header" },
		});

		const malformed = toCheckIssue(
			finding({ code: "MALFORMED_URL", pointer: "/basics/website/url", params: { value: "not a url" } }),
			data,
		);
		expect(malformed.title).toBe("A link isn't a full address");
		expect(malformed.params).toEqual({ value: "not a url" });
		expect(malformed.editTarget).toEqual({
			fieldId: "write-basics-website-url",
			label: "Basics · Website URL",
		});
		expect(malformed.pageTarget).toEqual({ kind: "header" });
	});

	it("maps an item date finding to the item field and item page target", () => {
		const issue = toCheckIssue(
			finding({
				code: "UNPARSEABLE_DATE",
				pointer: "/sections/certifications/items/0/date",
				params: { value: "sometime soon" },
			}),
			syntheticResume(),
		);

		expect(issue.title).toBe("A date won't be read");
		expect(issue.params).toEqual({ value: "sometime soon" });
		expect(issue.categoryLabel).toBe("Dates");
		expect(issue.editTarget).toEqual({
			fieldId: "write-certifications-cert-1-date",
			label: "Certifications 1 · Date",
		});
		expect(issue.pageTarget).toEqual({
			kind: "item",
			sectionId: "certifications",
			itemId: "cert-1",
		});
	});

	it("maps the summary title to the real Write heading control", () => {
		const issue = toCheckIssue(
			finding({
				code: "NON_STANDARD_SECTION_TITLE",
				severity: "info",
				pointer: "/summary/title",
				params: { title: "Profile" },
			}),
			syntheticResume(),
		);

		expect(issue.editTarget).toEqual({
			fieldId: "write-summary-heading",
			label: "Summary · Summary title",
		});
		expect(issue.pageTarget).toEqual({ kind: "section", sectionId: "summary" });
	});

	it("maps layout metadata without inventing a Write field", () => {
		const issue = toCheckIssue(
			finding({ code: "SMALL_BODY_FONT", pointer: "/metadata/typography/body/fontSize", params: { fontSize: 8 } }),
			syntheticResume(),
		);

		expect(issue.title).toBe("Body text is very small");
		expect(issue.categoryLabel).toBe("Layout");
		expect(issue.editTarget).toBeNull();
		expect(issue.pageTarget).toBeNull();
	});

	it("keeps a custom-section page target while leaving its unexposed fields without a Write action", () => {
		const data = syntheticResume();
		data.customSections = [
			{
				id: "custom-archive",
				type: "projects",
				title: "Archive",
				icon: "",
				columns: 1,
				hidden: false,
				showHeading: true,
				keepTogether: false,
				startOnNewPage: false,
				items: [],
			},
		];

		const issue = toCheckIssue(
			finding({ code: "SECTION_MISSING_FROM_LAYOUT", severity: "error", pointer: "/customSections/0" }),
			data,
		);

		expect(issue.editTarget).toBeNull();
		expect(issue.pageTarget).toEqual({ kind: "section", sectionId: "custom-archive" });
	});
});
