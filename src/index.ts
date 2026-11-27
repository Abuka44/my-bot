// Telegram-бот в Cloudflare Worker.
// Telegram сам присылает каждое новое сообщение POST-запросом на адрес /telegram (webhook).

import { env } from "cloudflare:workers";
import { answerFor, answerForLocation, HELP_TEXT } from "./service.ts";

// Из всего события нам нужны только чат, текст и геолокация
interface Update {
	message?: {
		chat: { id: number; type?: string };
		text?: string;
		location?: { latitude: number; longitude: number };
	};
}

// Кнопки под полем ввода. Нажатие отправляет боту текст кнопки,
// а последняя кнопка отправляет геолокацию
const KEYBOARD = {
	keyboard: [
		[{ text: "🌤 Алматы" }, { text: "💱 Курс" }, { text: "📦 Всё сразу" }],
		[{ text: "🏁 Гонка" }, { text: "🪆 Матрёшка" }],
		[{ text: "📍 Погода рядом", request_location: true }],
	],
	resize_keyboard: true,
};

// Отправляет сообщение через Telegram Bot API
async function sendMessage(chatId: number, text: string, keyboard?: object): Promise<void> {
	const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ chat_id: chatId, text, reply_markup: keyboard }),
	});

	if (!response.ok) {
		// Адрес запроса в лог не пишем: в нём лежит токен
		console.error(`Telegram sendMessage: ${response.status} ${await response.text()}`);
	}
}

// Проверяет, что запрос пришёл от Telegram: он присылает в заголовке тот секрет,
// который мы передали ему при установке webhook (параметр secret_token)
async function isFromTelegram(request: Request): Promise<boolean> {
	const received = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
	// Если секрет не задан в настройках, не пропускаем никого
	if (!received || !env.WEBHOOK_SECRET) {
		return false;
	}

	// Сравниваем хеши: они одной длины, а время сравнения не зависит от совпавших символов
	const encoder = new TextEncoder();
	const [a, b] = await Promise.all(
		[received, env.WEBHOOK_SECRET].map((value) =>
			crypto.subtle.digest("SHA-256", encoder.encode(value)),
		),
	);
	return crypto.subtle.timingSafeEqual(a!, b!);
}

async function handleUpdate(update: Update | null): Promise<void> {
	const message = update?.message;
	if (!message || (!message.text && !message.location)) {
		return; // картинка, стикер и т.д. - пропускаем
	}

	const isPrivate = (message.chat.type ?? "private") === "private";
	// В группах отвечаем только на команды, иначе бот будет отвечать на каждую фразу
	if (!isPrivate && !message.text?.startsWith("/")) {
		return;
	}

	let reply: string;
	try {
		reply = message.location
			? await answerForLocation(message.location.latitude, message.location.longitude)
			: await answerFor(message.text ?? "");
	} catch (error) {
		console.error("Не удалось подготовить ответ:", error);
		reply = "Не удалось получить данные, попробуйте чуть позже.";
	}

	// Кнопки показываем вместе с подсказкой (в группах Telegram не разрешает кнопку геолокации)
	const keyboard = isPrivate && reply === HELP_TEXT ? KEYBOARD : undefined;
	await sendMessage(message.chat.id, reply, keyboard);
}

export default {
	async fetch(request) {
		if (new URL(request.url).pathname !== "/telegram") {
			return new Response("Not found", { status: 404 });
		}
		if (request.method !== "POST") {
			return new Response("Method not allowed", { status: 405 });
		}
		if (!(await isFromTelegram(request))) {
			return new Response("Unauthorized", { status: 401 });
		}

		let update: Update | null;
		try {
			update = await request.json();
		} catch {
			return new Response("Bad request", { status: 400 });
		}

		try {
			await handleUpdate(update);
		} catch (error) {
			// Всё равно отвечаем 200, иначе Telegram будет присылать это сообщение снова и снова
			console.error(
				"Не удалось обработать сообщение:",
				error instanceof Error ? error.name : error,
			);
		}

		return new Response("OK");
	},
} satisfies ExportedHandler;
