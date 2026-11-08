import { readFile, stat } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { FileResumeStore } from "@local-resume/store/file-store";
import { PdfExportStore } from "@local-resume/store/pdf-export-store";
import { createStudioRequestHandler } from "./api";
import { ResumeChangeHub } from "./file-events";

const HOST = "127.0.0.1";
const serverDir = fileURLToPath(new URL(".", import.meta.url));
const appDir = resolve(serverDir, "..");
const repoRoot = resolve(appDir, "../..");
const distDir = join(appDir, "dist");
const apiOnly = process.env.STUDIO_API_ONLY === "1";
const port = parsePort(process.env.PORT, apiOnly ? 3101 : 3100);
const allowedOrigin = process.env.STUDIO_ALLOWED_ORIGIN ?? `http://${HOST}:${apiOnly ? 3100 : port}`;

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".txt": "text/plain; charset=utf-8",
	".pdf": "application/pdf",
};

function parsePort(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim() === "") return fallback;

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error(`PORT must be an integer between 1 and 65535, received ${JSON.stringify(value)}.`);
	}

	return parsed;
}

const dataRoot = process.env.RESUME_DATA_DIR
	? resolve(process.env.RESUME_DATA_DIR)
	: join(repoRoot, "data");
const store = new FileResumeStore(join(dataRoot, "resumes"));
const exports = new PdfExportStore(join(dataRoot, "exports"));
const changes = new ResumeChangeHub(store);
const apiHandler = createStudioRequestHandler(store, exports, { allowedOrigin }, { changes });

const sendText = (response: ServerResponse, status: number, message: string): void => {
	if (response.writableEnded) return;
	if (response.headersSent) {
		response.destroy();
		return;
	}

	const payload = Buffer.from(`${message}\n`, "utf8");
	response.writeHead(status, {
		"Content-Type": "text/plain; charset=utf-8",
		"Content-Length": payload.byteLength,
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	});
	response.end(payload);
};

const serveStatic = async (
	request: IncomingMessage,
	response: ServerResponse,
	pathname: string,
): Promise<void> => {
	if (request.method !== "GET" && request.method !== "HEAD") {
		sendText(response, 405, "Method not allowed.");
		return;
	}

	let decodedPath: string;
	try {
		decodedPath = decodeURIComponent(pathname);
	} catch {
		sendText(response, 400, "Request path is not valid URL encoding.");
		return;
	}

	const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
	let filePath = resolve(distDir, relativePath);

	if (filePath !== distDir && !filePath.startsWith(`${distDir}${sep}`)) {
		sendText(response, 404, "Not found.");
		return;
	}

	try {
		const info = await stat(filePath);
		if (info.isDirectory()) filePath = join(filePath, "index.html");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;

		// Missing assets stay missing; client-side routes fall back to the app shell.
		if (decodedPath.startsWith("/assets/") || extname(decodedPath) !== "") {
			sendText(response, 404, "Not found.");
			return;
		}

		filePath = join(distDir, "index.html");
	}

	let data: Buffer;
	try {
		data = await readFile(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			sendText(response, 503, "The production UI has not been built. Run pnpm build first.");
			return;
		}
		throw error;
	}

	const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
	response.writeHead(200, {
		"Content-Type": contentType,
		"Content-Length": data.byteLength,
		"Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
		"X-Content-Type-Options": "nosniff",
	});

	if (request.method === "HEAD") {
		response.end();
		return;
	}

	response.end(data);
};

const isApiPath = (pathname: string): boolean => pathname === "/api" || pathname.startsWith("/api/");

const server = createServer((request, response) => {
	let pathname: string;
	try {
		pathname = new URL(request.url ?? "/", `http://${HOST}`).pathname;
	} catch {
		sendText(response, 400, "Request URL is invalid.");
		return;
	}

	if (apiOnly || isApiPath(pathname)) {
		void apiHandler(request, response);
		return;
	}

	void serveStatic(request, response, pathname).catch(() => {
		sendText(response, 500, "The local studio could not serve this request.");
	});
});

server.on("error", (error) => {
	console.error(`[studio] ${error.message}`);
	process.exitCode = 1;
});
server.on("close", () => changes.close());

server.listen(port, HOST, () => {
	console.log(`[studio] API listening on http://${HOST}:${port}`);
	console.log(`[studio] Data directory: ${dataRoot}`);
	if (!apiOnly) console.log(`[studio] Serving UI from ${distDir}`);
});

let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals): void => {
	if (shuttingDown) return;
	shuttingDown = true;
	console.log(`[studio] Received ${signal}; shutting down.`);

	changes.close();
	server.close(() => process.exit(0));
	server.closeAllConnections?.();

	setTimeout(() => process.exit(1), 5000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
