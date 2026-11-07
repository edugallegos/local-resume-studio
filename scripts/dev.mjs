import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { signalRunningChildren } from "./dev-processes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = new Map();
let shuttingDown = false;
let exitCode = 0;

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
	PORT: "3101",
	STUDIO_API_ONLY: "1",
	STUDIO_ALLOWED_ORIGIN: "http://127.0.0.1:3100",
});

start("vite", process.execPath, [
	join(root, "node_modules/vite/bin/vite.js"),
	"--config",
	"apps/studio/vite.config.ts",
]);
