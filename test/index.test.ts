import { SELF } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { answerFor } from "../src/service.ts";

interface Sent {
	url: string;
	body: { chat_id: number; text: string; reply_markup?: unknown };
}

// Выдуманные города: широта нужна, чтобы подменённый прогноз знал, чья это погода
const CITIES: Record<string, { latitude: number; temperature: number; delay: number }> = {
	астана: { latitude: 51, temperature: -5, delay: 30 },
	лондон: { latitude: 52, temperature: 10, delay: 1 },
	токио: { latitude: 35, temperature: 30, delay: 60 },
	сломанск: { latitude: 99, temperature: 0, delay: 1 },
};

// Подменяем fetch: тесты не ходят в интернет, а запоминают, что бот отправил в Telegram
function stubApis(
	options: { apiDown?: boolean; erApiDown?: boolean; allRatesDown?: boolean } = {},
) {
	const sent: Sent[] = [];

	vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
		const url = new URL(input);

		if (url.host === "api.telegram.org") {
			sent.push({ url: input, body: JSON.parse(init?.body as string) });
			return Response.json({ ok: true });
		}
		if (options.apiDown) {
			return new Response("error", { status: 500 });
		}
		if (url.host === "geocoding-api.open-meteo.com") {
			const name = url.searchParams.get("name") ?? "";
			const city = CITIES[name];
			if (!city) {
				return Response.json({});
			}
			const title = name.charAt(0).toUpperCase() + name.slice(1);
			return Response.json({
				results: [{ name: title, country_code: "XX", latitude: city.latitude, longitude: 1 }],
			});
		}
		if (url.host === "api.open-meteo.com") {
			const latitude = Number(url.searchParams.get("latitude"));
			if (latitude === 99) {
				return new Response("error", { status: 500 });
			}
			const city = Object.values(CITIES).find((item) => item.latitude === latitude);
			await new Promise((resolve) => setTimeout(resolve, city?.delay ?? 0));
			return Response.json({
				current: { temperature_2m: city?.temperature ?? 4.6, wind_speed_10m: 2.7 },
			});
		}
		if (options.allRatesDown || (options.erApiDown && url.host === "open.er-api.com")) {
			return new Response("error", { status: 500 });
		}
		if (url.host === "open.er-api.com") {
			return Response.json({
				time_last_update_utc: "Fri, 20 Nov 2026 00:02:32 +0000",
				rates: { KZT: 450, EUR: 0.9, RUB: 90 },
			});
		}
		// Второй источник отвечает чуть позже, чтобы в обычном случае побеждал первый
		await new Promise((resolve) => setTimeout(resolve, 20));
		return Response.json({ date: "2026-11-27", usd: { kzt: 460, eur: 0.92, rub: 92 } });
	});

	return sent;
}

function post(body: string, secret: string | null = "test-secret") {
	const headers: Record<string, string> =
		secret === null ? {} : { "X-Telegram-Bot-Api-Secret-Token": secret };
	return SELF.fetch("https://example.com/telegram", { method: "POST", headers, body });
}

function message(text: string, type = "private") {
	return post(JSON.stringify({ update_id: 1, message: { chat: { id: 42, type }, text } }));
}

// Отправляет боту текст и возвращает текст его ответа
async function ask(text: string, options?: Parameters<typeof stubApis>[0]) {
	const sent = stubApis(options);
	await message(text);
	return sent[0]?.body.text ?? "";
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

it("/weather отправляет погоду Алматы в тот же чат", async () => {
	const sent = stubApis();
	const response = await message("/weather");

	expect(response.status).toBe(200);
	expect(sent).toEqual([
		{
			url: "https://api.telegram.org/bottest-token/sendMessage",
			body: { chat_id: 42, text: "Погода: Алматы, KZ\nТемпература: 4.6 °C\nВетер: 2.7 км/ч" },
		},
	]);
});

it("понимает название города обычным текстом", async () => {
	for (const text of ["Астана", "погода Астана", "/weather@my_bot Астана", "астана?"]) {
		expect(await ask(text)).toContain("Погода: Астана, XX\nТемпература: -5 °C");
	}
});

it("сообщает, что город не найден", async () => {
	expect(await ask("Абракадабра")).toContain("Не нашёл город «Абракадабра»");
});

it("отвечает погодой на геолокацию", async () => {
	const sent = stubApis();
	await post(
		JSON.stringify({
			message: { chat: { id: 42, type: "private" }, location: { latitude: 52, longitude: 1 } },
		}),
	);

	expect(sent[0]?.body.text).toContain("Погода рядом с вами");
	expect(sent[0]?.body.text).toContain("10 °C");
});

it("/rates берёт курс из первого ответившего источника", async () => {
	const text = await ask("/rates@my_bot");

	expect(text).toContain("1 USD = 450.00 KZT");
	expect(text).toContain("1 EUR = 500.00 KZT");
	expect(text).toContain("1 RUB = 5.00 KZT");
	expect(text).toContain("Источник: open.er-api.com, дата: 20.11.2026");
});

it("берёт курс из второго источника, если первый сломан", async () => {
	const text = await ask("💱 Курс", { erApiDown: true });

	expect(text).toContain("1 USD = 460.00 KZT");
	expect(text).toContain("Источник: currency-api, дата: 27.11.2026");
});

it("сообщает об ошибке, если сломаны оба источника курса", async () => {
	expect(await ask("курс", { allRatesDown: true })).toBe(
		"Не удалось получить данные, попробуйте чуть позже.",
	);
});

it("кнопка «Всё сразу» отправляет погоду и курс одним сообщением", async () => {
	const text = await ask("📦 Всё сразу");

	expect(text).toContain("Температура: 4.6 °C");
	expect(text).toContain("1 USD = 450.00 KZT");
});

it("всё сразу: погода приходит, даже если курсы недоступны", async () => {
	const text = await ask("всё Астана", { allRatesDown: true });

	expect(text).toContain("Погода: Астана");
	expect(text).toContain("Курс валют сейчас недоступен.");
});

it("сравнивает города от тёплого к холодному", async () => {
	for (const text of ["Астана vs Токио", "сравни Астана, Токио", "/compare Астана и Токио"]) {
		expect(await ask(text)).toContain("1. Токио: 30 °C\n2. Астана: -5 °C");
	}
});

it("сравнение не получается, если один город не найден", async () => {
	const text = await ask("Астана vs Абракадабра");

	expect(text).toContain("Не нашёл город «Абракадабра»");
	expect(text).not.toContain("-5 °C");
});

it("гонка называет победителя и сортирует участников", async () => {
	const text = await ask("гонка Астана, Токио, Лондон");

	expect(text).toContain("Победитель: Лондон");
	expect(text).toMatch(/🥇 Лондон[\s\S]*🥈 Астана[\s\S]*🥉 Токио/);
});

it("в гонке выбывшие не мешают остальным", async () => {
	const text = await ask("гонка Астана, Сломанск, Абракадабра");

	expect(text).toContain("Победитель: Астана");
	expect(text).toContain("Сломанск - сошёл с дистанции");
	expect(text).toContain("Абракадабра - не вышел на старт");
});

it("проверяет количество городов", async () => {
	expect(await ask("гонка Астана")).toContain("хотя бы два города");
	expect(await ask("сравни Астана")).toContain("нужно два города");
	expect(await ask("гонка а, б, в, г, д, е")).toContain("не больше 5");
});

it("матрёшка проходит три слоя", async () => {
	const text = await ask("🪆 Матрёшка");

	expect(text).toContain("1️⃣ Большая");
	expect(text).toContain("2️⃣ Средняя");
	expect(text).toContain("3️⃣ Маленькая (adviceFor): по температуре совет: прохладно");
});

it("на приветствие показывает подсказку и кнопки", async () => {
	const sent = stubApis();
	for (const text of ["/start", "привет", "/неизвестная"]) {
		await message(text);
	}

	expect(sent).toHaveLength(3);
	for (const item of sent) {
		expect(item.body.text).toContain("/weather");
		expect(item.body.reply_markup).toBeDefined();
	}
});

it("в группе отвечает только на команды и без кнопок", async () => {
	const sent = stubApis();
	await message("Астана", "group");
	await message("/help", "group");

	expect(sent).toHaveLength(1);
	expect(sent[0]?.body.reply_markup).toBeUndefined();
});

it("сообщает, если сервис данных недоступен", async () => {
	const sent = stubApis({ apiDown: true });
	const response = await message("/weather");

	expect(response.status).toBe(200);
	expect(sent[0]?.body.text).toBe("Не удалось получить данные, попробуйте чуть позже.");
});

it("не ждёт зависший сервис дольше 5 секунд", async () => {
	vi.useFakeTimers();
	// Promise, который никогда не завершается: так ведёт себя зависший сервер
	vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));

	const failure = expect(answerFor("/weather")).rejects.toThrow("Нет ответа за 5000 мс");
	await vi.advanceTimersByTimeAsync(5000);
	await failure;
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
