# Motor conversacional de Conversa CRM

El motor (`src/engine/`) genera respuestas sugeridas para las conversaciones entrantes. Es **opcional y seguro**: sin `OPENAI_API_KEY` funciona únicamente con reglas y búsqueda local, sin hacer llamadas de red. Nunca se ejecuta código al importar los módulos.

## 1. Flujo de decisión

`generateReply(context, options?)` aplica esta cadena, parando en el primer paso que produce una respuesta:

| Paso | Origen | Qué hace |
| --- | --- | --- |
| 1 | `rule` | Evalúa reglas ordenadas por `priority` (menor primero). La primera que coincide genera la respuesta y sus efectos (`addLabel`, `setPriority`, `handoff`). |
| 2 | `rag` | Recupera artículos publicados con TF-IDF y, si no hay LLM, devuelve un fragmento del mejor artículo citando su ID. |
| 3 | `llm` | Si hay clave configurada, llama a un modelo compatible con OpenAI usando un prompt con instrucciones estrictas de no inventar datos y citar IDs. |
| 4 | `fallback` | Si nada responde (o el LLM falla), devuelve un texto genérico, con baja confianza y entrega a humano. |

Después se calcula `shouldHandoff` final y se devuelve un `BotReply`:

```ts
interface BotReply {
  body: string;
  confidence: number;               // 0..1
  source: "rule" | "rag" | "llm" | "fallback";
  articleIds?: string[];
  shouldHandoff: boolean;
}
```

`handleInboundMessage(inbound, store, workspaceId, options?)` es la capa de entrada: hace upsert de contacto, conversación y mensaje (con idempotencia por `externalMessageId`), genera la sugerencia, aplica los efectos de las reglas a la conversación y **solo envía** un mensaje saliente del bot si `BOT_AUTO_REPLY` está activo. Con el valor por defecto (`false`), la sugerencia queda disponible para que el agente la revise desde la UI.

> El motor solo *describe* los efectos en el resultado. Quién persiste y envía es el llamador; así `generateReply` es puro y se puede usar desde tests o desde la bandeja de agentes.

## 2. Configuración

Variables en `.env.local` (ver `.env.example`). Se leen en el momento de cada llamada, nunca al importar.

```bash
OPENAI_API_KEY=                       # Vacía => modo solo reglas/RAG, sin red
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
BOT_AUTO_REPLY=false                  # true => el bot publica la respuesta por él mismo
BOT_CONFIDENCE_THRESHOLD=0.75         # por debajo de esto => entrega a humano
```

Opcionales (para ajustar costes/latencia):

```bash
LLM_TIMEOUT_MS=8000
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=500
BOT_MAX_ARTICLES=3
BOT_FALLBACK_REPLY="Gracias, revisaremos tu consulta..."
```

### OpenAI

No se usa SDK: se hace `POST ${OPENAI_BASE_URL}/chat/completions` con `fetch`, cabecera `Authorization: Bearer <key>` y un único mensaje de usuario con el prompt construido. Timeouts, errores HTTP, respuestas vacías y JSON malformado devuelven `null`; nunca lanzan excepciones hacia el webhook.

### Ollama (compatible con OpenAI)

Ollama no exige clave real, pero el motor solo activa el LLM si `OPENAI_API_KEY` no está vacía. Usa cualquier valor no vacío como marcador:

```bash
OPENAI_API_KEY=ollama
OPENAI_BASE_URL=http://localhost:11434/v1
OPENAI_MODEL=llama3.2
```

En producción, sustituye la URL por la de tu servicio (por ejemplo un endpoint interno con el mismo contrato). Cualquier proveedor compatible con `/chat/completions` funciona sin cambios.

## 3. Cómo se mide la confianza

La confianza no es una probabilidad calibrada, sino una señal ordenada para decidir entrega a humano y para mostrar al agente:

| Origen | Cálculo | Rango típico |
| --- | --- | --- |
| Regla | `rule.confidence` o `0.95` por defecto; la regla de humano usa `0.99`. | 0.90 – 0.99 |
| RAG extractivo | `0.5 + 0.42 × similitud`, tope `0.92`. La similitud es coseno TF-IDF entre pregunta y título+contenido (el título pesa el doble). | 0.55 – 0.92 |
| LLM | `0.70` base `+0.08` si había artículos `+0.08` si citó IDs válidos; `-0.08` si el texto reconoce no saber la respuesta. Tope `0.95`. | 0.62 – 0.95 |
| Fallback | Valor fijo `0.25`. | 0.25 |

La similitud TF-IDF se implementa a mano: tokenización insensible a acentos, eliminación de stopwords, peso `tf × idf` y normalize por la norma Euclidiana. Si el artículo trae `embedding` se aplica una señal adicional: con `questionEmbedding` se funde `80% léxico + 20% coseno semántico`; sin él, los artículos indexados reciben un pequeño prior de `+0.02` (no es similitud semántica, solo indica contenido curado).

## 4. Cuándo se entrega a humano

`shouldHandoff = true` si se cumple cualquiera de estas condiciones:

1. El usuario pide explícitamente una persona, agente u operador (regla `handoff-human` o detectores en español, inglés y portugués).
2. Una regla ejecuta la acción `handoff`.
3. La confianza final es menor que `BOT_CONFIDENCE_THRESHOLD` (0.75 por defecto). Esto incluye siempre el `fallback`.
4. La conversación ya tiene la etiqueta `handoff` o está en estado `pending`.

En `handleInboundMessage`, la entrega además añade la etiqueta `handoff` y cambia el estado a `pending`. El mensaje de confirmación se envía igualmente si el auto-reply está activo, para que el cliente no quede sin respuesta.

## 5. Reglas

Las reglas son JSON puro (sin funciones ni expresiones regulares seriadas como objetos). `parseRulesConfig(input)` acepta un array o `{ rules: [...] }` e ignora las entradas inválidas, de modo que una regla mal escrita nunca rompe la recepción de mensajes.

```json
{
  "rules": [
    {
      "id": "solo-whatsapp",
      "name": "Consultas por WhatsApp",
      "priority": 40,
      "enabled": true,
      "match": "all",
      "conditions": [
        { "type": "channel", "value": "whatsapp" },
        { "type": "contains", "value": "pedido" },
        { "type": "language", "value": ["es", "pt"] }
      ],
      "actions": [
        { "type": "reply", "body": "Hola {{contactName}}, reviso tu pedido." },
        { "type": "addLabel", "label": "pedidos" },
        { "type": "setPriority", "priority": "high" }
      ],
      "confidence": 0.93
    }
  ]
}
```

**Condiciones**

- `contains`, `equals`, `startsWith`: sobre `field` = `message` (por defecto, último mensaje entrante), `subject` o `contactName`. Comparación insensible a acentos y mayúsculas salvo `caseSensitive: true`.
- `regex`: `pattern` y `flags` (por defecto `i`). Un patrón inválido simplemente no coincide.
- `channel`: un `ChannelType` o array de ellos.
- `language`: código o array devuelto por `detectLanguage` (`es`, `en`, `pt`, `fr`, `it`, `de`; `es` por defecto si no hay señales).

Todas admiten `negate: true`. `match: "all"` (por defecto) exige todas las condiciones; `"any"` basta una. Se evalúan ordenadas por `priority` ascendente y, en empate, por orden de aparición. Solo gana la primera que coincide; sus acciones se ejecutan todas.

**Acciones**

- `reply`: texto de la respuesta. Admite plantillas `{{contactName}}`, `{{channel}}`, `{{language}}`, `{{workspaceId}}`.
- `addLabel`: añade una etiqueta a la conversación (sin duplicados).
- `setPriority`: `low`, `normal`, `high` u `urgent`.
- `handoff`: fuerza entrega a humano. Si no hay `reply`, se usa un texto de confirmación estándar.

Las tres reglas incluidas son `handoff-human` (prioridad 10), `hours-and-pricing` (20) y `greeting` (30). Las consultas sobre horarios/precios se evalúan antes que los saludos para que un "hola, ¿cuánto cuesta?" no se quede solo con el saludo. Se pueden reemplazar pasando `options.rules`.

## 6. RAG y artículos

`retrieveRelevantArticles(question, articles, maxResults)` devuelve artículos con `score`, ordenados de mayor a menor, descartando los que no tienen solapamiento con la pregunta. `buildRagPrompt(context, articles)` genera el prompt con: workspace, canal, contacto, asunto, últimos 8 mensajes, hasta 5 artículos (1.800 caracteres cada uno) y la pregunta actual. El prompt obliga a:

- no inventar horarios, precios, nombres ni datos de contacto;
- decir explícitamente que no se tiene la información si no está en los artículos;
- citar los IDs entre corchetes, p. ej. `[ART-123]`.

Si el modelo no cita ningún ID pero sí se recuperaron artículos, el handler añade automáticamente una línea `Fuentes: [id] ...` para mantener la trazabilidad. `generateReplyDetailed` **solo pasa artículos** con `published: true` y `showInSearch: true`, por lo que un borrador nunca se filtra al cliente.

Cuando no hay LLM, `buildExtractiveReply` usa las frases del artículo que más se solapan con la pregunta y añade `Fuente: [ID] Título`.

## 7. Uso desde la aplicación

```ts
import { generateReply, handleInboundMessage } from "@/engine/handler";
import { getStore } from "@/lib/db"; // ejemplo: la implementación real de Store

const reply = await generateReply({
  workspaceId,
  conversation,
  contact,
  messages,
  articles,
});

if (reply.shouldHandoff) {
  conversation.status = "pending";
}

const result = await handleInboundMessage(inbound, getStore(), workspaceId);
// result.reply  => sugerencia para el agente
// result.outboundMessage => solo existe si BOT_AUTO_REPLY=true
```

También está disponible `generateReplyDetailed`, que devuelve además `effects`, `matchedRule`, `rankedArticles` y `autoReplyEnabled` para auditoría. `isAutoReplyEnabled(options)` y `isHumanHandoffRequest(text)` se exportan para la UI.

Si un webhook se reenvía con el mismo `externalMessageId`, `handleInboundMessage` no añade un segundo mensaje: reutiliza el existente y devuelve una sugerencia nueva basada en el estado actual.

## 8. Seguridad y límites

- Sin dependencias nuevas: solo `fetch` y utilidades propias; `zod`, `pg`, etc. no se usan en este módulo.
- Las reglas con regex inválidas y las respuestas vacías del modelo se ignoran, nunca lanzan.
- El LLM tiene timeout (8 s por defecto) y `max_tokens` acotado; cualquier error cae al siguiente paso de la cadena.
- El prompt pide no inventar datos, pero el contenido de los artículos es confianza del workspace: mantén los artículos publicados revisados.
- `BOT_AUTO_REPLY=false` por defecto: el modo recomendado es sugerencia humana hasta confirmar la calidad de la base de conocimiento.
