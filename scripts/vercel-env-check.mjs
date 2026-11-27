#!/usr/bin/env node
/**
 * Prints which relevant environment variables are defined.
 * Never prints values. Reads .env.local first, then merges process.env on top
 * so that values injected by Vercel take precedence over local files.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env.local");

function readEnvFile(path) {
  const values = {};
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    return values;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const fileValues = readEnvFile(envPath);
const isDefined = (name) => {
  const fromProcess = process.env[name];
  if (typeof fromProcess === "string" && fromProcess.trim() !== "") return true;
  const fromFile = fileValues[name];
  return typeof fromFile === "string" && fromFile.trim() !== "";
};

const checks = [
  { name: "DATABASE_URL", section: "Base de datos", required: true },
  { name: "CREDENTIALS_ENCRYPTION_KEY", section: "Seguridad", required: true },
  { name: "NEXT_PUBLIC_APP_URL", section: "Aplicación", required: false },
  { name: "OPENAI_API_KEY", section: "Motor conversacional", required: false },
  { name: "TELEGRAM_BOT_TOKEN", section: "Telegram", required: false },
  { name: "WHATSAPP_PHONE_NUMBER_ID", section: "WhatsApp", required: false },
  { name: "WHATSAPP_ACCESS_TOKEN", section: "WhatsApp", required: false },
  { name: "WHATSAPP_BUSINESS_ACCOUNT_ID", section: "WhatsApp", required: false },
  { name: "WHATSAPP_VERIFY_TOKEN", section: "WhatsApp", required: false },
];

const width = Math.max(...checks.map((check) => check.name.length));
let lastSection = null;

console.log("Conversa CRM — comprobación de variables de entorno");
console.log(`Fuentes: ${envPath} (si existe) + process.env`);
console.log("");

for (const check of checks) {
  if (check.section !== lastSection) {
    console.log(`[${check.section}]`);
    lastSection = check.section;
  }
  const name = check.name.padEnd(width, ".");
  console.log(`${name}  ${isDefined(check.name) ? "SI" : "NO"}`);
}

const missing = checks.filter((check) => check.required && !isDefined(check.name));
console.log("");
console.log("Obligatorias en Vercel: DATABASE_URL, CREDENTIALS_ENCRYPTION_KEY");
console.log("Recomendada en Vercel: NEXT_PUBLIC_APP_URL (URL pública, sin barra final)");
console.log("El resto depende de los canales y del motor que actives.");
if (missing.length > 0) {
  console.log(`Faltan obligatorias: ${missing.map((check) => check.name).join(", ")}`);
} else {
  console.log("Obligatorias presentes: SI");
}
console.log("");
console.log("Este script nunca muestra valores. No pegues secretos en el chat ni en los logs.");
