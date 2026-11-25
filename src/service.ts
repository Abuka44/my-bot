// Сервис: получает погоду и курсы валют и готовит текстовые ответы.

// ---------- Типы JSON-ответов ----------

// Ответ сервера погоды (open-meteo)
interface Weather {
	current: {
		temperature_2m: number; // температура, °C
		wind_speed_10m: number; // ветер, км/ч
	};
}

// Ответ сервера курсов (open.er-api.com): курсы даны относительно 1 доллара
interface ExchangeRates {
	time_last_update_utc: string;
	rates: {
		KZT: number;
		EUR: number;
		RUB: number;
	};
}

// ---------- Запросы к API ----------

// Один запрос: проверяет статус ответа и превращает JSON в нужный тип T
async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Ошибка запроса ${response.status}: ${url}`);
	}
	return (await response.json()) as T;
}

// ---------- Тексты ответов ----------

async function weatherText(): Promise<string> {
	const weather = await fetchJson<Weather>(
		"https://api.open-meteo.com/v1/forecast?latitude=43.24&longitude=76.89&current=temperature_2m,wind_speed_10m",
	);

	return [
		"Погода в Алматы:",
		`Температура: ${weather.current.temperature_2m} °C`,
		`Ветер: ${weather.current.wind_speed_10m} км/ч`,
	].join("\n");
}

// Переводит время сервера из UTC во время Алматы (UTC+5)
function toAlmatyTime(utcString: string): string {
	return new Date(utcString).toLocaleString("ru-RU", {
		timeZone: "Asia/Almaty",
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

async function ratesText(): Promise<string> {
	const data = await fetchJson<ExchangeRates>("https://open.er-api.com/v6/latest/USD");

	// Курсы даны к доллару, поэтому тенге за 1 евро или 1 рубль = KZT / EUR (или RUB)
	const usd = data.rates.KZT;
	const eur = data.rates.KZT / data.rates.EUR;
	const rub = data.rates.KZT / data.rates.RUB;

	return [
		"Курс валют (в тенге):",
		`1 USD = ${usd.toFixed(2)} KZT`,
		`1 EUR = ${eur.toFixed(2)} KZT`,
		`1 RUB = ${rub.toFixed(2)} KZT`,
		`Курс обновлён: ${toAlmatyTime(data.time_last_update_utc)} (время Алматы)`,
	].join("\n");
}

// ---------- Команды бота ----------

const HELP_TEXT = ["Мои команды:", "/weather - погода в Алматы", "/rates - курс валют"].join("\n");

// Принимает текст сообщения и возвращает текст ответа
export async function answerFor(text: string): Promise<string> {
	// Берём первое слово. В группах команда приходит как "/weather@имя_бота", отрезаем "@..."
	const firstWord = text.trim().split(/\s+/)[0] ?? "";
	const command = (firstWord.split("@")[0] ?? "").toLowerCase();

	switch (command) {
		case "/weather":
			return weatherText();
		case "/rates":
			return ratesText();
		default:
			return HELP_TEXT;
	}
}
