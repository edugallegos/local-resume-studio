import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	root,
	plugins: [react(), tailwindcss()],
	server: {
		host: "127.0.0.1",
		port: 3100,
		strictPort: true,
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
