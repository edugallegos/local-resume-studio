import { templateSchema } from "@reactive-resume/schema/templates";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Separator } from "@reactive-resume/ui/components/separator";

const templateIds = templateSchema.options;

export function App() {
	return (
		<div className="min-h-screen bg-bg text-ink">
			<header className="border-b border-line bg-surface">
				<div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
					<div className="flex items-center gap-3">
						<span className="flex size-9 items-center justify-center rounded-md bg-accent font-display text-lg text-on-accent">
							LR
						</span>
						<div>
							<h1 className="font-display text-xl leading-tight">Local Resume Studio</h1>
							<p className="text-sm text-ink-2">
								Independent workspace with a pinned Reactive Resume vendor snapshot.
							</p>
						</div>
					</div>
					<Badge variant="accent">v6.1.0 baseline</Badge>
				</div>
			</header>

			<main className="mx-auto max-w-5xl px-6 py-10">
				<section className="rounded-lg border border-line bg-surface p-6 shadow-e1">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="max-w-xl">
							<h2 className="text-lg font-semibold">Workspace ready</h2>
							<p className="mt-2 text-sm leading-6 text-ink-2">
								This first task creates the independent Node, React, Vite, and pnpm workspace and pins the
								Reactive Resume source used by later tasks. Storage, the local API, editing workflows, and Check
								are intentionally not implemented yet.
							</p>
						</div>
						<Button variant="secondary" disabled>
							Editor arrives in a later task
						</Button>
					</div>

					<Separator className="my-6" />

					<div className="grid gap-6 sm:grid-cols-2">
						<div>
							<p className="text-sm font-medium text-ink-2">Vendored packages</p>
							<p className="mt-2 text-sm leading-6 text-ink-2">
								Schema, resume ATS/markdown, fonts, PDF/Forme templates, utilities, and the UI primitives used by
								this shell.
							</p>
						</div>
						<div>
							<p className="text-3xl font-semibold">{templateIds.length}</p>
							<p className="mt-1 text-sm text-ink-2">templates registered from the pinned snapshot</p>
						</div>
					</div>

					<div className="mt-6 flex flex-wrap gap-2">
						{templateIds.map((id) => (
							<Badge key={id} variant="outline">
								{id}
							</Badge>
						))}
					</div>
				</section>

				<p className="mt-6 text-xs text-ink-3">
					Pinned to Reactive Resume v6.1.0 at commit 77f5580a67d1e4379978e80410e0cd02ea3fd446.
				</p>
			</main>
		</div>
	);
}
