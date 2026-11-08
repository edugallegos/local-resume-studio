import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseResumeData } from "@reactive-resume/schema/resume/data";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const resumeDataRoot = (env = process.env) =>
	env.RESUME_DATA_DIR ? resolve(env.RESUME_DATA_DIR) : join(root, "data");

export const listResumeFiles = async (resumesDir) => {
	let entries;
	try {
		entries = await readdir(resumesDir, { withFileTypes: true });
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		throw new Error(`Could not read resume directory ${resumesDir}: ${error instanceof Error ? error.message : String(error)}`);
	}

	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));
};

const schemaDetails = (error) => {
	if (!Array.isArray(error?.issues)) return error instanceof Error ? error.message : String(error);
	return error.issues
		.map((issue) => {
			const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join(".") : "(root)";
			return `  - ${path}: ${issue.message}`;
		})
		.join("\n");
};

export const validateResumeFile = async (path) => {
	const displayPath = resolve(path);
	let bytes;
	try {
		bytes = await readFile(displayPath);
	} catch (error) {
		throw new Error(
			`Could not read ${displayPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	let raw;
	try {
		raw = JSON.parse(bytes.toString("utf8"));
	} catch (error) {
		throw new Error(
			`Invalid JSON at ${displayPath}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	try {
		return parseResumeData(raw);
	} catch (error) {
		throw new Error(`Invalid resume schema at ${displayPath}:\n${schemaDetails(error)}`);
	}
};

export const runResumeCli = async (argv, options = {}) => {
	const env = options.env ?? process.env;
	const stdout = options.stdout ?? ((text) => process.stdout.write(text));
	const stderr = options.stderr ?? ((text) => process.stderr.write(text));
	const args = argv.filter((argument) => argument !== "--");
	const [command, ...rest] = args;

	try {
		if (command === "list") {
			const resumesDir = join(resumeDataRoot(env), "resumes");
			const files = await listResumeFiles(resumesDir);
			if (files.length === 0) stdout(`No resume JSON files in ${resumesDir}.\n`);
			else stdout(files.map((file) => `${file}\n`).join(""));
			return 0;
		}

		if (command === "validate") {
			const path = rest[0];
			if (!path) {
				stderr("Usage: pnpm resume:validate -- <path>\n");
				return 1;
			}
			await validateResumeFile(path);
			// Keep shell/AI logs free of resume content and personal file paths.
			stdout("Valid resume JSON.\n");
			return 0;
		}

		stderr("Usage: pnpm resume:list | pnpm resume:validate -- <path>\n");
		return 1;
	} catch (error) {
		stderr(`${error instanceof Error ? error.message : String(error)}\n`);
		return 1;
	}
};

const invokedDirectly =
	process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
	process.exitCode = await runResumeCli(process.argv.slice(2));
}
