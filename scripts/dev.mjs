import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signalRunningChildren } from "./dev-processes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = new Map();
let shuttingDown = false;
let exitCode = 0;

const parsePort = (value, fallback, name) => {
	if (value === undefined || value === null || String(value).trim() === "") return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error(`${name} must be an integer between 1 and 65535, received ${JSON.stringify(value)}.`);
	}
	return parsed;
};

const cli = new Map();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
	const flag = args[index];
	const value = args[index + 1];
	if (!flag?.startsWith("--") || value === undefined) {
		throw new Error(`Expected --flag value pairs, received ${JSON.stringify(args)}.`);
	}
	cli.set(flag, value);
}

const uiPort = parsePort(cli.get("--ui-port") ?? process.env.STUDIO_UI_PORT, 3100, "UI port");
const apiPort = parsePort(cli.get("--api-port") ?? process.env.STUDIO_API_PORT, 3101, "API port");
if (uiPort === apiPort) throw new Error("UI and API ports must differ.");

const killChildren = (signal) => {
	signalRunningChildren(children.values(), signal);
};

const finish = () => {
	if (children.size === 0) process.exit(exitCode);
};

const shutdown = (signal = "SIGTERM", code = 0) => {
	if (shuttingDown) return;
	shuttingDown = true;
	exitCode = code;

	killChildren(signal);
	const force = setTimeout(() => {
		killChildren("SIGKILL");
		process.exit(exitCode || 1);
	}, 5000);
	force.unref();

	finish();
};

const start = (name, command, args, env = {}) => {
	const child = spawn(command, args, {
		cwd: root,
		env: { ...process.env, ...env },
		stdio: "inherit",
	});

	children.set(name, child);

	child.on("error", (error) => {
		console.error(`[dev] Could not start ${name}: ${error.message}`);
		shutdown("SIGTERM", 1);
	});

	child.on("exit", (code, signal) => {
		children.delete(name);

		if (shuttingDown) {
			finish();
			return;
		}

		console.error(`[dev] ${name} exited (${signal ?? code}). Stopping the other process.`);
		shutdown("SIGTERM", code ?? 1);
	});
};

process.on("SIGINT", () => shutdown("SIGTERM", 0));
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
process.on("exit", () => killChildren("SIGTERM"));

start("api", process.execPath, ["--import", "tsx", "apps/studio/server/index.ts"], {
	PORT: String(apiPort),
	STUDIO_API_ONLY: "1",
	STUDIO_ALLOWED_ORIGIN: `http://127.0.0.1:${uiPort}`,
});

start(
	"vite",
	process.execPath,
	[join(root, "node_modules/vite/bin/vite.js"), "--config", "apps/studio/vite.config.ts", "--port", String(uiPort)],
	{
		STUDIO_UI_PORT: String(uiPort),
		STUDIO_API_PORT: String(apiPort),
	},
);
