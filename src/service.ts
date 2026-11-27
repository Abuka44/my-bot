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

// Сколько ждём ответ от сервера, прежде чем сдаться
const TIMEOUT_MS = 5000;

// Ограничивает ожидание: возвращает результат promise, но не дольше ms миллисекунд
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | null = null;

	// new Promise - свой Promise "будильник": через ms миллисекунд он завершается ошибкой (reject)
	const alarm = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`Нет ответа за ${ms} мс`)), ms);
	});

	// Promise.race берёт того, кто закончит первым: ответ сервера или будильник.
	// finally выполняется в любом случае и выключает будильник
	return Promise.race([promise, alarm]).finally(() => clearTimeout(timer));
}

// Один запрос: проверяет статус ответа и превращает JSON в нужный тип T
async function requestJson<T>(url: string): Promise<T> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Ошибка запроса ${response.status}: ${url}`);
	}
	return (await response.json()) as T;
}

// Тот же запрос, но с ограничением по времени
function fetchJson<T>(url: string): Promise<T> {
	return withTimeout(requestJson<T>(url), TIMEOUT_MS);
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

// Берёт текст из завершившегося Promise, а если он завершился ошибкой - запасной текст
function textOr(result: PromiseSettledResult<string>, fallback: string): string {
	if (result.status === "fulfilled") {
		return result.value;
	}
	console.error(fallback, result.reason);
	return fallback;
}

// Погода и курс в одном сообщении
async function allText(): Promise<string> {
	// Оба запроса идут одновременно. Promise.allSettled ждёт оба, даже если один упал
	// (Promise.all в этом случае сразу выдал бы ошибку, и пользователь не получил бы ничего)
	const [weather, rates] = await Promise.allSettled([weatherText(), ratesText()]);

	return [
		textOr(weather, "Погода сейчас недоступна."),
		textOr(rates, "Курс валют сейчас недоступен."),
	].join("\n\n");
}

// ---------- Команды бота ----------

const HELP_TEXT = [
	"Мои команды:",
	"/weather - погода в Алматы",
	"/rates - курс валют",
	"/all - погода и курс вместе",
].join("\n");

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
		case "/all":
			return allText();
		default:
			return HELP_TEXT;
	}
}
