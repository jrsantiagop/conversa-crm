#!/usr/bin/env node
/**
 * Configura el webhook de un bot de Telegram para Conversa CRM.
 *
 * Uso:
 *   node scripts/telegram-setup.mjs https://tu-host/api/webhooks/telegram
 *   node --env-file=.env.local scripts/telegram-setup.mjs https://tu-host/api/webhooks/telegram
 *
 * Variables: TELEGRAM_BOT_TOKEN (obligatoria), TELEGRAM_WEBHOOK_URL (alternativa
 * al argumento) y TELEGRAM_WEBHOOK_SECRET (opcional).
 * NUNCA imprime el token ni el secreto.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HELP = `Uso:
  node [--env-file=.env.local] scripts/telegram-setup.mjs <URL_DEL_WEBHOOK>

Argumentos:
  <URL_DEL_WEBHOOK>   URL HTTPS pública, p. ej. https://ejemplo.ngrok-free.app/api/webhooks/telegram

Variables de entorno:
  TELEGRAM_BOT_TOKEN      Obligatoria. Token del bot (nunca se muestra).
  TELEGRAM_WEBHOOK_URL    Alternativa al argumento posicional.
  TELEGRAM_WEBHOOK_SECRET Opcional. Secret token enviado por Telegram en cada update.

Opciones:
  --env-file=<ruta>  Carga un archivo .env antes de leer las variables.
  -h, --help         Muestra esta ayuda.
`;

/** Carga un .env simple sin sobrescribir variables ya presentes en process.env. */
function loadEnvFile(path) {
  let content;
  try {
    content = readFileSync(resolve(path), "utf8");
  } catch (error) {
    throw new Error(`No se pudo leer el archivo de entorno "${path}": ${error.message}`);
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line
      .replace(/^export\s+/, "")
      .match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const result = { help: false, envFile: "", positionals: [], unknown: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      result.help = true;
    } else if (arg.startsWith("--env-file=")) {
      result.envFile = arg.slice("--env-file=".length);
    } else if (arg === "--env-file") {
      i += 1;
      result.envFile = argv[i] ?? "";
    } else if (arg.startsWith("-")) {
      result.unknown.push(arg);
    } else {
      result.positionals.push(arg);
    }
  }
  return result;
}

let secrets = [];

/** Sustituye token/secreto por *** en cualquier texto que vaya a imprimirse. */
function safe(value) {
  let out = String(value);
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  return out;
}

async function callTelegram(token, method, body) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`No se pudo conectar con Telegram: ${error.message}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Telegram devolvió una respuesta no válida (HTTP ${response.status})`);
  }

  const record = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  if (response.ok && record.ok === true) return record.result ?? {};

  const description = typeof record.description === "string" ? record.description : "";
  const code = typeof record.error_code === "number" ? ` (código ${record.error_code})` : "";
  throw new Error(`${description || `HTTP ${response.status}`}${code}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.envFile) loadEnvFile(args.envFile);

  const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  secrets = [token, secret].filter(Boolean);

  if (args.unknown.length) {
    throw new Error(`Opción no reconocida: ${safe(args.unknown[0])}. Usa --help.`);
  }
  if (args.positionals.length > 1) {
    throw new Error("Solo se acepta una URL de webhook como argumento.");
  }
  if (!token) {
    throw new Error(
      "Falta TELEGRAM_BOT_TOKEN. Defínela en el entorno o usa --env-file=.env.local.",
    );
  }

  const webhookUrl = (args.positionals[0] || process.env.TELEGRAM_WEBHOOK_URL || "").trim();
  if (!webhookUrl) {
    throw new Error("Falta la URL del webhook: pásala como argumento o define TELEGRAM_WEBHOOK_URL.");
  }

  let parsed;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error("La URL del webhook no es válida.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("La URL del webhook debe usar HTTPS (Telegram lo exige).");
  }

  console.log("Consultando datos del bot...");
  const me = await callTelegram(token, "getMe", {});
  const username = typeof me.username === "string" ? `@${me.username}` : "sin username";
  const id = typeof me.id === "number" ? ` (id ${me.id})` : "";
  console.log(`Bot verificado: ${username}${id}`);

  const payload = {
    url: webhookUrl,
    allowed_updates: ["message", "edited_message"],
  };
  if (secret) payload.secret_token = secret;

  console.log("Registrando el webhook...");
  await callTelegram(token, "setWebhook", payload);

  console.log("Webhook configurado correctamente.");
  console.log(`URL: ${safe(webhookUrl)}`);
  console.log(`Secret token: ${secret ? "configurado" : "no configurado"}`);
  console.log("Actualizaciones permitidas: message, edited_message");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${safe(message)}`);
  process.exitCode = 1;
});
