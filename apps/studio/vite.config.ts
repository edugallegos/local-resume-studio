import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const uiPort = Number(process.env.STUDIO_UI_PORT ?? "3100");
const apiPort = Number(process.env.STUDIO_API_PORT ?? "3101");

export default defineConfig({
	root,
	plugins: [react(), tailwindcss()],
	server: {
		host: "127.0.0.1",
		port: uiPort,
		strictPort: true,
		proxy: {
			"/api": {
				target: `http://127.0.0.1:${apiPort}`,
				changeOrigin: false,
			},
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
