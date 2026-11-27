// Функции бота: понимает сообщение, получает данные (api.ts) и готовит текст ответа.
// Подробное объяснение всех Promise - в файле PROMISES.md

import {
	findCity,
	type Forecast,
	getForecast,
	getRates,
	type Place,
	type Rates,
	UserError,
} from "./api.ts";

const DEFAULT_CITY = "Алматы";
const RACE_CITIES = ["Алматы", "Астана", "Шымкент"];
const MAX_CITIES = 5;

export const HELP_TEXT = [
	"Привет! Я знаю погоду в любом городе и курс валют.",
	"",
	"Можно писать обычными словами:",
	"🌤 Астана - погода в городе",
	"📍 отправьте геолокацию - погода рядом с вами",
	"💱 курс - курс валют",
	"📦 всё Астана - погода и курс вместе",
	"⚖️ Алматы vs Астана - сравнить города",
	"🏁 гонка Алматы, Лондон, Токио - чей ответ придёт первым",
	"🪆 матрёшка Шымкент - запросы внутри запросов",
	"",
	"Команды: /weather /rates /all /race /matryoshka /help",
].join("\n");

// ---------- Оформление текста ----------

function weatherLines(title: string, forecast: Forecast): string {
	return [
		title,
		`Температура: ${forecast.current.temperature_2m} °C`,
		`Ветер: ${forecast.current.wind_speed_10m} км/ч`,
	].join("\n");
}

function ratesLines(rates: Rates): string {
	// Курсы даны к доллару, поэтому тенге за 1 евро или 1 рубль = KZT / EUR (или RUB)
	return [
		"Курс валют (в тенге):",
		`1 USD = ${rates.KZT.toFixed(2)} KZT`,
		`1 EUR = ${(rates.KZT / rates.EUR).toFixed(2)} KZT`,
		`1 RUB = ${(rates.KZT / rates.RUB).toFixed(2)} KZT`,
		`Источник: ${rates.source}, дата: ${rates.date}`,
	].join("\n");
}

// ---------- Погода и курс ----------

// [async/await] - удобная запись цепочки: ждём город, потом по его координатам погоду
async function weatherText(city: string): Promise<string> {
	const place = await findCity(city);
	const forecast = await getForecast(place);
	return weatherLines(`Погода: ${place.name}, ${place.country}`, forecast);
}

export async function answerForLocation(latitude: number, longitude: number): Promise<string> {
	const forecast = await getForecast({ latitude, longitude });
	return weatherLines("📍 Погода рядом с вами:", forecast);
}

function ratesText(): Promise<string> {
	return getRates().then(ratesLines);
}

// Берёт текст из завершившегося Promise, а если он завершился ошибкой - запасной текст
function textOr(result: PromiseSettledResult<string>, fallback: string): string {
	if (result.status === "fulfilled") {
		return result.value;
	}
	if (result.reason instanceof UserError) {
		return result.reason.message;
	}
	console.error(fallback, result.reason);
	return fallback;
}

// [Promise.allSettled] ждёт ВСЕ запросы, даже если какой-то упал
async function allText(city: string): Promise<string> {
	const [weather, rates] = await Promise.allSettled([weatherText(city), ratesText()]);

	return [
		textOr(weather, "Погода сейчас недоступна."),
		textOr(rates, "Курс валют сейчас недоступен."),
	].join("\n\n");
}

// ---------- Сравнение городов ----------

// [Promise.all] ждёт все города сразу. Если хотя бы один упал, сравнивать нечего - ошибка
async function compareText(cities: string[]): Promise<string> {
	if (cities.length < 2) {
		throw new UserError("Для сравнения нужно два города, например: Алматы vs Астана");
	}

	const results = await Promise.all(
		cities.map(async (city) => {
			const place = await findCity(city);
			const forecast = await getForecast(place);
			return { name: place.name, temperature: forecast.current.temperature_2m };
		}),
	);

	const sorted = results.toSorted((a, b) => b.temperature - a.temperature);
	return [
		"⚖️ Сравнение (от тёплого к холодному):",
		...sorted.map((city, index) => `${index + 1}. ${city.name}: ${city.temperature} °C`),
	].join("\n");
}

// ---------- Гонка ----------

async function raceText(cities: string[]): Promise<string> {
	if (cities.length < 2) {
		throw new UserError("Для гонки нужно хотя бы два города: гонка Алматы, Астана");
	}

	// Сначала все выходят на старт (ищем координаты), чтобы старт был честным
	const lookups = await Promise.allSettled(cities.map((city) => findCity(city)));
	const racers: Place[] = [];
	const absent: string[] = [];
	lookups.forEach((lookup, index) => {
		if (lookup.status === "fulfilled") {
			racers.push(lookup.value);
		} else {
			absent.push(`🚧 ${cities[index]} - не вышел на старт`);
		}
	});

	if (racers.length === 0) {
		throw new UserError("Ни один город не вышел на старт. Проверьте названия.");
	}

	const start = Date.now();
	const runs = racers.map((place) =>
		getForecast(place).then((forecast) => ({
			name: place.name,
			temperature: forecast.current.temperature_2m,
			ms: Date.now() - start,
		})),
	);

	// [Promise.any] - победитель: первый, кто успешно добежал
	const winner = await Promise.any(runs);
	// [Promise.allSettled] - дожидаемся остальных для итоговой таблицы
	const finished = await Promise.allSettled(runs);

	const table = finished
		.flatMap((run) => (run.status === "fulfilled" ? [run.value] : []))
		.toSorted((a, b) => a.ms - b.ms);
	const medals = ["🥇", "🥈", "🥉"];
	const dropped = finished.flatMap((run, index) => {
		if (run.status === "fulfilled") {
			return [];
		}
		// Причину пишем в лог, пользователю - короткое сообщение
		console.error(`Гонка, ${racers[index]?.name}:`, run.reason);
		return [`🚧 ${racers[index]?.name} - сошёл с дистанции`];
	});

	return [
		`🏁 Гонка! Победитель: ${winner.name}`,
		"",
		...table.map(
			(run, index) => `${medals[index] ?? "▫️"} ${run.name}: ${run.ms} мс, ${run.temperature} °C`,
		),
		...dropped,
		...absent,
	].join("\n");
}

// ---------- Матрёшка ----------

// [new Promise] - создаём Promise вручную: resolve - успех, reject - ошибка
function adviceFor(forecast: Forecast): Promise<string> {
	return new Promise((resolve, reject) => {
		const temperature = forecast.current.temperature_2m;

		if (!Number.isFinite(temperature)) {
			reject(new Error("В ответе нет температуры"));
		} else if (temperature < 0) {
			resolve("мороз, наденьте шапку и тёплую куртку 🧣");
		} else if (temperature < 15) {
			resolve("прохладно, возьмите куртку 🧥");
		} else if (temperature < 28) {
			resolve("комфортно, хорошее время для прогулки 🚶");
		} else {
			resolve("жарко, пейте воду 🥤");
		}
	});
}

// Матрёшка из then: каждый следующий Promise лежит ВНУТРИ предыдущего,
// потому что ему нужен результат предыдущего (и все внешние переменные видны внутри)
function matryoshkaText(city: string): Promise<string> {
	return findCity(city).then((place) =>
		getForecast(place).then((forecast) =>
			adviceFor(forecast).then((advice) =>
				[
					"🪆 Матрёшка Promise",
					"",
					`1️⃣ Большая (findCity): «${city}» это ${place.name}, координаты ${place.latitude}, ${place.longitude}`,
					`  2️⃣ Средняя (getForecast): по координатам ${forecast.current.temperature_2m} °C`,
					`    3️⃣ Маленькая (adviceFor): по температуре совет: ${advice}`,
					"",
					"Каждая кукла открывается только после предыдущей.",
				].join("\n"),
			),
		),
	);
}

// ---------- Разбор сообщения ----------

// "Алматы, Астана" или "Алматы vs Астана" -> ["Алматы", "Астана"]
function parseCities(text: string): string[] {
	const cities = text
		.split(/\s*[,;]\s*|\s+(?:vs|против|и)\s+/i)
		.map((city) => city.trim())
		.filter(Boolean);

	if (cities.length > MAX_CITIES) {
		throw new UserError(`Можно не больше ${MAX_CITIES} городов за раз.`);
	}
	return cities;
}

function normalize(word: string): string {
	return word.toLowerCase().replaceAll("ё", "е");
}

function route(text: string): Promise<string> | string {
	// Убираем эмодзи в начале (их присылают кнопки) и знаки в конце
	const clean = text
		.trim()
		.replace(/^[^\p{L}/]+/u, "")
		.replace(/[?!.]+$/, "")
		.trim();
	const [first = "", ...rest] = clean.split(/\s+/);
	// "/weather@имя_бота" -> "weather"
	const word = normalize((first.split("@")[0] ?? "").replace(/^\//, ""));
	const args = rest.join(" ");

	switch (word) {
		case "":
		case "start":
		case "help":
		case "помощь":
		case "меню":
		case "привет":
		case "салем":
		case "здравствуйте":
			return HELP_TEXT;
		case "weather":
		case "погода":
			return weatherText(args.replace(/^в\s+/i, "") || DEFAULT_CITY);
		case "rates":
		case "курс":
			return ratesText();
		case "all":
		case "все":
			return allText(args.replace(/^сразу\s*/i, "") || DEFAULT_CITY);
		case "race":
		case "гонка": {
			const cities = parseCities(args);
			return raceText(cities.length > 0 ? cities : RACE_CITIES);
		}
		case "matryoshka":
		case "матрешка":
			return matryoshkaText(args || DEFAULT_CITY);
		case "compare":
		case "сравни":
			return compareText(parseCities(args));
	}

	if (first.startsWith("/")) {
		return HELP_TEXT; // незнакомая команда
	}
	if (/\s(?:vs|против)\s/i.test(clean)) {
		return compareText(parseCities(clean));
	}
	// Короткий текст из букв считаем названием города
	if (/^\p{L}[\p{L}\s'’-]{1,40}$/u.test(clean) && rest.length < 3) {
		return weatherText(clean);
	}
	return HELP_TEXT;
}

// Принимает текст сообщения и возвращает текст ответа
export function answerFor(text: string): Promise<string> {
	// [Promise.try] запускает функцию и всегда даёт Promise: и обычная строка,
	// и ошибка через throw попадут в одну цепочку
	return Promise.try(() => route(text)).catch((error: unknown) => {
		// [.catch] - ошибки пользователя превращаем в понятный ответ, остальные передаём дальше
		if (error instanceof UserError) {
			return error.message;
		}
		throw error;
	});
}
