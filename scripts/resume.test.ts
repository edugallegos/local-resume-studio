import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { afterEach, describe, expect, it } from "vitest";
import { runResumeCli } from "./resume.mjs";

const tempRoots: string[] = [];

const makeTempRoot = async (): Promise<string> => {
	const root = await mkdtemp(join(tmpdir(), "local-resume-cli-"));
	tempRoots.push(root);
	return root;
};

const capture = () => {
	let stdout = "";
	let stderr = "";
	return {
		stdout: (text: string) => {
			stdout += text;
		},
		stderr: (text: string) => {
			stderr += text;
		},
		get stdoutText() {
			return stdout;
		},
		get stderrText() {
			return stderr;
		},
	};
};

const syntheticResume = () => {
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Ada Lovelace (Synthetic)";
	data.basics.email = "ada@example.test";
	data.summary.content = "<p>Synthetic CLI fixture.</p>";
	return data;
};

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resume CLI", () => {
	it("lists sorted JSON filenames from RESUME_DATA_DIR/resumes without printing contents", async () => {
		const dataRoot = await makeTempRoot();
		await mkdir(join(dataRoot, "resumes"), { recursive: true });
		await writeFile(join(dataRoot, "resumes", "zeta.json"), '{"secret":"synthetic"}');
		await writeFile(join(dataRoot, "resumes", "alpha.json"), '{"secret":"synthetic"}');
		await writeFile(join(dataRoot, "resumes", "notes.txt"), "not a resume");
		const io = capture();

		const code = await runResumeCli(["list"], {
			env: { RESUME_DATA_DIR: dataRoot },
			stdout: io.stdout,
			stderr: io.stderr,
		});

		expect(code).toBe(0);
		expect(io.stdoutText.trim().split("\n")).toEqual(["alpha.json", "zeta.json"]);
		expect(io.stdoutText).not.toContain("secret");
		expect(io.stderrText).toBe("");
	});

	it("treats a missing resumes directory as a successful empty listing", async () => {
		const dataRoot = await makeTempRoot();
		const io = capture();

		const code = await runResumeCli(["list"], {
			env: { RESUME_DATA_DIR: dataRoot },
			stdout: io.stdout,
			stderr: io.stderr,
		});

		expect(code).toBe(0);
		expect(io.stdoutText).toMatch(/No resume JSON files/i);
		expect(io.stderrText).toBe("");
	});

	it("validates a synthetic v6.1.0 file without modifying its bytes", async () => {
		const dataRoot = await makeTempRoot();
		const file = join(dataRoot, "synthetic-valid.json");
		const contents = `${JSON.stringify(syntheticResume(), null, 2)}\n`;
		await writeFile(file, contents, "utf8");
		const before = await readFile(file);
		const io = capture();

		const code = await runResumeCli(["validate", "--", file], {
			env: { RESUME_DATA_DIR: dataRoot },
			stdout: io.stdout,
			stderr: io.stderr,
		});

		expect(code).toBe(0);
		expect(io.stdoutText).toBe("Valid resume JSON.\n");
		expect(io.stdoutText).not.toContain("Ada Lovelace (Synthetic)");
		expect(io.stdoutText).not.toContain("ada@example.test");
		expect(io.stdoutText).not.toContain(file);
		expect(io.stderrText).toBe("");
		expect(await readFile(file)).toEqual(before);
	});

	it("reports invalid JSON against its path without modifying the file", async () => {
		const dataRoot = await makeTempRoot();
		const file = join(dataRoot, "broken.json");
		await writeFile(file, "{ definitely not JSON", "utf8");
		const before = await readFile(file);
		const io = capture();

		const code = await runResumeCli(["validate", file], {
			env: { RESUME_DATA_DIR: dataRoot },
			stdout: io.stdout,
			stderr: io.stderr,
		});

		expect(code).not.toBe(0);
		expect(io.stderrText).toContain(file);
		expect(io.stderrText).toMatch(/invalid JSON/i);
		expect(await readFile(file)).toEqual(before);
	});

	it("reports schema failures against their path without modifying the file", async () => {
		const dataRoot = await makeTempRoot();
		const file = join(dataRoot, "invalid-schema.json");
		await writeFile(file, '{"basics":{}}\n', "utf8");
		const before = await readFile(file);
		const io = capture();

		const code = await runResumeCli(["validate", file], {
			env: { RESUME_DATA_DIR: dataRoot },
			stdout: io.stdout,
			stderr: io.stderr,
		});

		expect(code).not.toBe(0);
		expect(io.stderrText).toContain(file);
		expect(io.stderrText).toMatch(/schema/i);
		expect(await readFile(file)).toEqual(before);
	});

	it("reports unreadable paths without throwing", async () => {
		const dataRoot = await makeTempRoot();
		const file = join(dataRoot, "missing.json");
		const io = capture();

		await expect(access(file)).rejects.toThrow();

		const code = await runResumeCli(["validate", file], {
			env: { RESUME_DATA_DIR: dataRoot },
			stdout: io.stdout,
			stderr: io.stderr,
		});

		expect(code).not.toBe(0);
		expect(io.stderrText).toContain(file);
		expect(io.stderrText).toMatch(/could not read/i);
	});
});
