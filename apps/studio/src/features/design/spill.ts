import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";

type PageLayout = ResumeData["metadata"]["layout"]["pages"][number];

/** Sections to move onto a new page, grouped by the column they keep. */
export type SpillingSections = { main: string[]; sidebar: string[] };

/**
 * The pinned upstream spill rule: sections on the last authored page whose first rendered page is
 * beyond the authored page count move. If none start beyond it, move the last section that runs
 * across the break, first in the main column and otherwise the sidebar, only when that column holds
 * another section. A section keeps its column; null means nothing can move safely.
 */
export function spillingSections(
	pages: readonly PageLayout[],
	pageMap: PageMap | null | undefined,
): SpillingSections | null {
	const last = pages.at(-1);
	if (!last || !pageMap) return null;

	const authored = pages.length;
	const starts = new Map<string, number>();
	const spills = new Set<string>();

	for (const node of pageMap.nodes) {
		if (node.kind !== "section") continue;
		starts.set(node.sectionId, Math.min(starts.get(node.sectionId) ?? node.page, node.page));
		if (node.page >= authored) spills.add(node.sectionId);
	}

	const starting = (id: string): boolean => (starts.get(id) ?? -1) >= authored;
	const crossing = (ids: readonly string[]): string[] => {
		const id = ids.findLast((sectionId) => spills.has(sectionId));
		return id && ids.length > 1 ? [id] : [];
	};

	let main = last.main.filter(starting);
	let sidebar = last.sidebar.filter(starting);
	if (main.length === 0 && sidebar.length === 0) {
		main = crossing(last.main);
		if (main.length === 0) sidebar = crossing(last.sidebar);
	}

	return main.length + sidebar.length > 0 ? { main, sidebar } : null;
}
