// Слой запросов к API. Здесь получаем данные из интернета.
// Подробное объяснение всех Promise - в файле PROMISES.md

// Пользователь ошибся (нет такого города и т.п.): текст такой ошибки можно показать ему
export class UserError extends Error {}

export interface Place {
	name: string;
	country: string;
	latitude: number;
	longitude: number;
}

export interface Forecast {
	current: {
		temperature_2m: number; // температура, °C
		wind_speed_10m: number; // ветер, км/ч
	};
}

// Курсы относительно 1 доллара
export interface Rates {
	KZT: number;
	EUR: number;
	RUB: number;
	source: string;
	date: string;
}

// ---------- Ожидание с ограничением ----------

export const TIMEOUT_MS = 5000;

// [Promise.withResolvers] даёт Promise и "пульты" resolve/reject отдельно от него.
// [Promise.race] берёт того, кто закончил первым: сервер или будильник.
// [.finally] выполняется в любом случае и выключает будильник.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	const alarm = Promise.withResolvers<never>();
	const timer = setTimeout(() => alarm.reject(new Error(`Нет ответа за ${ms} мс`)), ms);

	return Promise.race([promise, alarm.promise]).finally(() => clearTimeout(timer));
}

// Один запрос: проверяет статус и превращает JSON в объект
function fetchJson<T>(url: string): Promise<T> {
	// [.then] выполнится, когда придёт ответ сервера
	const request = fetch(url).then((response) => {
		if (!response.ok) {
			// [Promise.reject] - готовый Promise с ошибкой
			return Promise.reject(new Error(`Ошибка запроса ${response.status}: ${url}`));
		}
		// Внутри then возвращаем ещё один Promise (матрёшка):
		// внешняя цепочка сама дождётся его и получит уже готовый объект
		return response.json<T>();
	});

	return withTimeout(request, TIMEOUT_MS);
}

// ---------- Города ----------

// Уже найденные города запоминаем, чтобы не искать повторно
const knownPlaces = new Map<string, Place>([
	["алматы", { name: "Алматы", country: "KZ", latitude: 43.24, longitude: 76.89 }],
]);

interface GeocodingResponse {
	results?: { name: string; country_code?: string; latitude: number; longitude: number }[];
}

// Название города -> координаты
export function findCity(query: string): Promise<Place> {
	const key = query.trim().toLowerCase();
	const known = knownPlaces.get(key);
	if (known) {
		// [Promise.resolve] - готовый успешный Promise: идти в интернет не нужно,
		// но функция всё равно возвращает Promise, как и в обычном случае
		return Promise.resolve(known);
	}

	const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=${encodeURIComponent(key)}`;
	return fetchJson<GeocodingResponse>(url).then((data) => {
		const found = data.results?.[0];
		if (!found) {
			// throw внутри then превращает Promise в отклонённый (rejected)
			throw new UserError(
				`Не нашёл город «${query.trim()}». Напишите название в именительном падеже, например: Астана\nПомощь: /help`,
			);
		}
		const place: Place = {
			name: found.name,
			country: found.country_code ?? "",
			latitude: found.latitude,
			longitude: found.longitude,
		};
		knownPlaces.set(key, place);
		return place;
	});
}

// Координаты -> погода
export function getForecast(point: { latitude: number; longitude: number }): Promise<Forecast> {
	return fetchJson<Forecast>(
		`https://api.open-meteo.com/v1/forecast?latitude=${point.latitude}&longitude=${point.longitude}&current=temperature_2m,wind_speed_10m`,
	);
}

// ---------- Курсы валют из двух источников ----------

async function ratesFromErApi(): Promise<Rates> {
	const data = await fetchJson<{
		time_last_update_utc: string;
		rates?: { KZT: number; EUR: number; RUB: number };
	}>("https://open.er-api.com/v6/latest/USD");

	if (!data.rates?.KZT) {
		throw new Error("open.er-api.com: в ответе нет курсов");
	}
	const { KZT, EUR, RUB } = data.rates;
	const date = new Date(data.time_last_update_utc).toLocaleDateString("ru-RU", {
		timeZone: "Asia/Almaty",
	});
	return { KZT, EUR, RUB, source: "open.er-api.com", date };
}

async function ratesFromCurrencyApi(): Promise<Rates> {
	const data = await fetchJson<{
		date: string;
		usd?: { kzt: number; eur: number; rub: number };
	}>("https://latest.currency-api.pages.dev/v1/currencies/usd.json");

	if (!data.usd?.kzt) {
		throw new Error("currency-api: в ответе нет курсов");
	}
	const { kzt, eur, rub } = data.usd;
	const date = data.date.split("-").reverse().join(".");
	return { KZT: kzt, EUR: eur, RUB: rub, source: "currency-api", date };
}

// [Promise.any] - первый УСПЕШНЫЙ ответ. Если один источник сломался, выручит второй.
// Ошибка будет, только если сломались оба
export function getRates(): Promise<Rates> {
	return Promise.any([ratesFromErApi(), ratesFromCurrencyApi()]);
}
