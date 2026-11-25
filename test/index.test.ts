import { SELF } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vite-plus/test";

// Подменяем fetch: тесты не ходят в интернет, а запоминают, что бот отправил в Telegram
function stubApis(options: { apiDown?: boolean } = {}) {
	const sent: { url: string; body: { chat_id: number; text: string } }[] = [];

	vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
		if (input.startsWith("https://api.telegram.org/")) {
			sent.push({ url: input, body: JSON.parse(init?.body as string) });
			return Response.json({ ok: true });
		}
		if (options.apiDown) {
			return new Response("error", { status: 500 });
		}
		if (input.startsWith("https://api.open-meteo.com/")) {
			return Response.json({ current: { temperature_2m: 4.6, wind_speed_10m: 2.7 } });
		}
		return Response.json({
			time_last_update_utc: "Fri, 20 Nov 2026 00:02:32 +0000",
			rates: { KZT: 450, EUR: 0.9, RUB: 90 },
		});
	});

	return sent;
}

function post(body: string, secret: string | null = "test-secret") {
	const headers: Record<string, string> =
		secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret };
	return SELF.fetch("https://example.com/telegram", { method: "POST", headers, body });
}

function message(text: string) {
	return post(JSON.stringify({ update_id: 1, message: { chat: { id: 42 }, text } }));
}

afterEach(() => {
	vi.unstubAllGlobals();
});

it("/weather отправляет погоду в тот же чат", async () => {
	const sent = stubApis();
	const response = await message("/weather");

	expect(response.status).toBe(200);
	expect(sent).toEqual([
		{
			url: "https://api.telegram.org/bottest-token/sendMessage",
			body: { chat_id: 42, text: "Погода в Алматы:\nТемпература: 4.6 °C\nВетер: 2.7 км/ч" },
		},
	]);
});

it("/rates отправляет курсы с временем Алматы", async () => {
	const sent = stubApis();
	await message("/rates@my_bot");

	expect(sent[0]?.body.text).toBe(
		[
			"Курс валют (в тенге):",
			"1 USD = 450.00 KZT",
			"1 EUR = 500.00 KZT",
			"1 RUB = 5.00 KZT",
			"Курс обновлён: 20.11.2026, 05:02 (время Алматы)",
		].join("\n"),
	);
});

it("на другой текст подсказывает команды", async () => {
	const sent = stubApis();
	await message("привет");

	expect(sent[0]?.body.text).toContain("/weather");
	expect(sent[0]?.body.text).toContain("/rates");
});

it("сообщает, если сервис данных недоступен", async () => {
	const sent = stubApis({ apiDown: true });
	const response = await message("/weather");

	expect(response.status).toBe(200);
	expect(sent[0]?.body.text).toBe("Не удалось получить данные, попробуйте чуть позже.");
});

it("пропускает события без текста", async () => {
	const sent = stubApis();
	const response = await post(JSON.stringify({ update_id: 1 }));

	expect(response.status).toBe(200);
	expect(sent).toEqual([]);
});

it("не отвечает на запрос без секрета или с чужим секретом", async () => {
	const sent = stubApis();
	const body = JSON.stringify({ message: { chat: { id: 42 }, text: "/weather" } });

	for (const secret of [null, "", "wrong", "test-secre", "test-secret-1"]) {
		expect((await post(body, secret)).status).toBe(401);
	}
	expect(sent).toEqual([]);
});

it("отклоняет чужие адреса, методы и не-JSON", async () => {
	expect((await SELF.fetch("https://example.com/")).status).toBe(404);
	expect((await SELF.fetch("https://example.com/telegram")).status).toBe(405);
	expect((await post("не json")).status).toBe(400);
});
