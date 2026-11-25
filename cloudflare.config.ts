import { bindings, defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "my-bot",
		compatibilityDate: "2026-11-23",
		entrypoint,
		// Наблюдение за Worker в панели Cloudflare
		observability: {
			// Логи: все запросы (1 = 100%), включая служебную запись о каждом вызове
			logs: {
				enabled: true,
				headSamplingRate: 1,
				invocationLogs: true,
				persist: true,
			},
			// Трассировка выключена
			traces: {
				enabled: false,
				headSamplingRate: 1,
				persist: true,
			},
			// Поиск проблем (в панели называется issue_detection) выключен
			issues: {
				enabled: false,
			},
		},
		env: {
			// Секрет: значение не хранится в коде.
			// Локально берётся из .dev.vars, в Cloudflare задаётся как secret.
			BOT_TOKEN: bindings.secret(),
			// Секрет webhook: по нему Worker отличает запросы Telegram от чужих
			WEBHOOK_SECRET: bindings.secret(),
		},
	},
});
