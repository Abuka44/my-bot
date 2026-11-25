import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig({
	plugins: [
		cloudflareTest({
			config: true,
			// Фальшивые секреты только для тестов
			miniflare: { bindings: { BOT_TOKEN: "test-token", WEBHOOK_SECRET: "test-secret" } },
		}),
	],
});
