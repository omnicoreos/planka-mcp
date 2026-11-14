# planka-mcp

Manejá un tablero Planka 2.x desde Claude Code mediante 41 tools MCP.
Las escrituras se releen y verifican: un éxito informado coincide con el board.
Un flujo opcional convierte ese board en memoria durable para el trabajo con agentes.

[Read in English](README.md)

```text
Vos hablás con Claude Code
          │
          ▼
  planka-mcp (stdio) ─── HTTPS + JSON ───▶ Planka 2.x
          │                                  │
          └──── vuelve a leer el resultado ◀─┘
```

> [!WARNING]
> El paquete viejo `@gogogadgetbytes/planka-mcp` puede informar éxito sin haber
> hecho nada en Planka 2.x. Leé [los cinco fallos silenciosos](docs/planka-2x-gotchas.md)
> antes de reemplazar una instalación existente.

## ¿Es tu primer MCP? Leé esto primero

MCP es un estándar que permite que Claude Code llame tools provistas por otro programa.
Este repo ejecuta un programa local pequeño que traduce esas llamadas a pedidos a la API de Planka.
Necesita credenciales de Planka porque actúa como un usuario dedicado de Planka, no como Claude.
Las credenciales quedan en tu máquina y nunca se escriben en el archivo de proyecto `.mcp.json`.
Claude Code carga los servidores MCP al iniciar una sesión, así que reinicialo después del setup o de cambiar la configuración.

## Requisitos

- Node.js 18 o posterior y `npx`
- Una instancia Planka 2.x accesible
- Un usuario dedicado de Planka que pueda ver el proyecto y board elegidos
- Un cliente MCP: Claude Code, Codex CLI, Cursor o VS Code
- Rol de project manager sólo si el setup debe crear un board

Funciona en Linux y macOS. Bun no es un requisito.

## Instalación

Un comando por cliente. Todos corren el paquete publicado con `npx`: no hay que
clonar nada ni compilar nada.

| Cliente | One-liner |
|---|---|
| **Claude Code** (plugin: MCP + skills + preflight) | `/plugin marketplace add omnicoreos/planka-mcp` y después `/plugin install planka@planka-mcp` |
| **Claude Code** (sólo el server) | `claude mcp add --scope user --transport stdio planka --env PLANKA_BASE_URL=https://planka.example.com --env PLANKA_API_KEY=<key> -- npx -y @omnicoreos/planka-mcp` |
| **Codex CLI** | `codex mcp add planka -- npx -y @omnicoreos/planka-mcp` (después el bloque `env`, más abajo) |
| **Cursor** | [![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=planka&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBvbW5pY29yZW9zL3BsYW5rYS1tY3AiXSwiZW52Ijp7IlBMQU5LQV9CQVNFX1VSTCI6Imh0dHBzOi8vcGxhbmthLmV4YW1wbGUuY29tIiwiUExBTktBX0FQSV9LRVkiOiI8eW91ci1wbGFua2EtYXBpLWtleT4ifX0=) |
| **VS Code** | [![Add to VS Code](https://img.shields.io/badge/VS_Code-Add_planka-0098FF)](https://insiders.vscode.dev/redirect/mcp/install?name=planka&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40omnicoreos%2Fplanka-mcp%22%5D%2C%22env%22%3A%7B%22PLANKA_BASE_URL%22%3A%22https%3A%2F%2Fplanka.example.com%22%2C%22PLANKA_API_KEY%22%3A%22%3Cyour-planka-api-key%3E%22%7D%2C%22type%22%3A%22stdio%22%7D) |
| **Cualquiera, guiado** | `npx @omnicoreos/planka-mcp init --client claude\|codex\|cursor\|vscode\|print` |

Los links de Cursor y VS Code llevan una key de ejemplo, nunca una real: un
deeplink queda en el historial del navegador. Los dos clientes piden la
credencial ellos mismos — VS Code con un input `promptString`, así el
`.vscode/mcp.json` commiteado no tiene ningún secreto.

### `planka-mcp init`

```bash
npx @omnicoreos/planka-mcp init --client claude     # claude mcp add, scope user
npx @omnicoreos/planka-mcp init --client codex      # agrega el bloque a ~/.codex/config.toml
npx @omnicoreos/planka-mcp init --client cursor     # mergea ~/.cursor/mcp.json (0600) + imprime el deeplink
npx @omnicoreos/planka-mcp init --client vscode     # escribe .vscode/mcp.json pidiendo el secreto
npx @omnicoreos/planka-mcp init --client print      # imprime todos los snippets, no escribe nada
```

Con terminal pregunta lo que le falta; `--base-url`, `--api-key`, `--board`,
`--email` y `--password` lo vuelven no interactivo. Antes de escribir nada hace
un `GET /api/users/me` autenticado: eso es lo que detecta una base URL que
apunta al SPA en vez de a la API, o una credencial que nunca funcionó.
`--dry-run` imprime el cambio exacto y no toca nada.

Todos los emisores mergean: si ya existe una entrada `planka` la reporta y la
deja como está, y conserva los demás servers del mismo archivo. Lo que escribe
en tu home queda con modo `0600`.

`./scripts/setup.sh` es un alias de `init --client claude`. El instalador
guiado viejo — el que además elige o crea un board y corre el smoke completo de
create/label/comment/delete — sigue siendo `node scripts/setup.mjs`.

### El plugin de Claude Code

El plugin instala el MCP server, las dos skills del workflow y un preflight de
`SessionStart` que detecta una credencial faltante o una base URL `http://`
antes de la primera tool call:

```text
/plugin marketplace add omnicoreos/planka-mcp
/plugin install planka@planka-mcp
```

Claude Code pide la base URL y la API key al habilitar el plugin y guarda la
key en el keychain del sistema, no en `settings.json`. Codex lee el mismo
repositorio vía `.codex-plugin/plugin.json` y `.agents/plugins/marketplace.json`.

Los plugins no pueden traer reglas de permisos, y eso es lo único que no viaja:
usá `PLANKA_READ_ONLY` y `PLANKA_DISABLED_TOOLS` (más abajo) en vez de una deny
list del cliente — funcionan en todos los runtimes y no cuestan contexto.

### Bloque `env` de Codex

`codex mcp add` no toma credenciales, así que van en `~/.codex/config.toml` (o
dejá que lo haga `init --client codex`):

```toml
[mcp_servers.planka]
command = "npx"
args = ["-y", "@omnicoreos/planka-mcp"]
env = { PLANKA_BASE_URL = "https://planka.example.com", PLANKA_API_KEY = "<key>" }
```

## Verificá que funciona

Primero, inspeccioná la configuración de Claude Code:

```bash
claude mcp list
claude mcp get planka
```

Después cerrá y volvé a abrir Claude Code por completo — los MCP se cargan al
arrancar la sesión. Si configuraste el server en el `.mcp.json` de un proyecto,
abrí Claude Code dentro de ese proyecto y aprobá el servidor cuando lo pida. Si
instalaste el plugin, `/plugin` lo muestra, y su pestaña **Errors** muestra un
server que no arrancó.

Pedile a Claude Code:

```text
Mostrame mis proyectos y boards de Planka. En la lista Pending, creá una card llamada
"MCP está funcionando" con la descripción "Creada desde Claude Code" y volvé a leerla.
```

Si Claude no ve las tools, reinicialo primero y después seguí
[Solución de problemas](docs/troubleshooting.md).

## Autenticación

Hay dos formas de autenticarse, y son mutuamente excluyentes: setear las dos es
un error de configuración, porque Planka lee `Authorization` primero e ignora en
silencio el `x-api-key` cuando llegan juntos.

| | `PLANKA_API_KEY` (recomendada) | `PLANKA_AGENT_EMAIL` + `PLANKA_AGENT_PASSWORD` |
|---|---|---|
| Se manda como | `X-Api-Key: <prefijo>_<secreto>` en cada request | `POST /api/access-tokens` y después `Authorization: Bearer` |
| Vuelta de login | ninguna | una por sesión, refrescada cada 25 minutos |
| Rate limit de sign-in | no le aplica | 10 logins por identidad cada 60 s — se toca rápido cuando arrancan varios agentes a la vez |
| Password en disco | no hay | sí, en el archivo de configuración del cliente |
| Descarga de adjuntos | funciona | funciona |

### Receta: usuario agente acotado con API key

Cuatro pasos, los corre un **admin** de Planka. El resultado es un usuario que
sólo puede ver los boards que vos nombres — lo enforcea Planka, no este server.

1. **Crear el usuario con el rol global más bajo.** En la UI de Planka:
   *Administración → Usuarios → Agregar usuario*, rol **`boardUser`**. Un
   `boardUser` no puede crear proyectos ni darse membresías a sí mismo.

2. **Darle membresía en los boards donde debe trabajar**, y sólo en esos:

   ```bash
   curl -X POST "$PLANKA_URL/api/boards/<BOARD_ID>/board-memberships" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"userId":"<USER_ID>","role":"editor"}'
   ```

   Usá `"role":"viewer"` para un agente que tiene que leer y comentar pero nunca
   crear ni mover cards. Después de eso, `GET /api/projects` devuelve sólo los
   proyectos derivados de esas membresías; cualquier otro board responde 404.

3. **Emitir la API key** (endpoint admin-only). La key se muestra **una sola
   vez**, en `included.apiKey`; Planka guarda sólo su hash y su prefijo:

   ```bash
   curl -X POST "$PLANKA_URL/api/users/<USER_ID>/api-key" \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

4. **Configurar el server con la key y nada más.** Sacar `PLANKA_AGENT_EMAIL` y
   `PLANKA_AGENT_PASSWORD`:

   ```json
   {
     "mcpServers": {
       "planka": {
         "command": "npx",
         "args": ["-y", "@omnicoreos/planka-mcp"],
         "env": {
           "PLANKA_BASE_URL": "https://planka.example.com",
           "PLANKA_API_KEY": "abcd1234_0123456789abcdef0123456789abcdef"
         }
       }
     }
   }
   ```

Rotar una key es repetir el paso 3: emitir una nueva invalida la anterior.

## Acotar el server

Una API key hereda los permisos de su usuario — no tiene scopes propios. Por eso
el acotado se hace en tres capas, y cada una cubre algo que las otras no.

```
Capa 1 · PLANKA           la única que el agente no puede esquivar hablando
  boardUser + board memberships + la API key de arriba
  ⇒ todo lo que esté fuera de los boards permitidos es 404/403 en la API

Capa 2 · ESTE SERVER      ergonomía, y defensa contra el propio agente
  las variables de entorno de abajo; viajan con el paquete,
  así que Claude Code, Codex y Cursor reciben las mismas reglas

Capa 3 · EL CLIENTE       sobrevive a un downgrade de este paquete
  reglas deny/ask de .claude/settings.json, enabled_tools/disabled_tools de Codex
```

La capa 1 es la única con enforcement real, pero no puede expresar "no llames a
`planka_get_board`, cuesta cuarenta veces más contexto". La capa 2 sí, y llega a
todos los runtimes. La capa 3 sigue valiendo aunque este paquete quede pineado en
una versión vieja.

### Capa 2: las variables de entorno

| Variable | Valor | Qué hace |
|---|---|---|
| `PLANKA_DEFAULT_BOARD_ID` | un board id | `boardId` pasa a ser opcional en todas las tools que lo toman, y cae en este board. Ahorra el `planka_get_structure` que el agente hace sólo para recuperar un id que nunca cambia |
| `PLANKA_ALLOWED_BOARD_IDS` | board ids separados por coma | Los boards fuera de la lista se filtran de `planka_get_structure`, y cualquier llamada que nombre uno se rechaza antes de que el request salga del proceso |
| `PLANKA_ALLOWED_PROJECT_IDS` | project ids separados por coma | Lo mismo, un nivel más arriba |
| `PLANKA_READ_ONLY` | `true` o `1` | Las veintisiete tools de escritura desaparecen del `tools/list` y se rechazan si igual las llaman |
| `PLANKA_HIDE_DEPRECATED` | `true` o `1` | Saca del `tools/list` las siete tools deprecadas (`manage_labels`, `manage_lists`, `manage_comment`, `add_comment`, `get_board`, `list_cards`, `list_lists`) y ahorra ~6,8 kB de contexto. Siguen siendo llamables, así que un tool list cacheado sigue funcionando |
| `PLANKA_DISABLED_TOOLS` | nombres de tool separados por coma | Apaga tools puntuales. El prefijo `planka_` es opcional: `get_board` y `planka_get_board` son lo mismo |
| `PLANKA_PROTECTED_LIST_IDS` | list ids separados por coma | Rechaza crear o mover cards **hacia** esas listas, editar o borrar las listas mismas, y mover, archivar o borrar las cards **hacia afuera** de ellas |
| `PLANKA_SUMMARY_DECISION_LISTS` | nombres o ids de columna separados por coma | De qué columnas trae cards `planka_board_summary` cuando la llamada no lo dice. Sin setear: no devuelve cards, sólo la forma del board |
| `PLANKA_SUMMARY_HIGHLIGHT_LABEL` | un nombre de label | El label que marca una card como desbloqueada en `planka_board_summary`. Sin setear: no se resalta nada |
| `PLANKA_GET_CARD_COMMENTS` | `all` o un número | Qué lee `planka_get_card` cuando la llamada no pasa `withComments`: todos los comentarios, o los N más recientes. Un `withComments` explícito (incluido `0`) sigue ganando. Sin setear: sin comentarios salvo que se pidan. Sirve cuando tus agentes deben leer los comentarios de una card antes de actuar: convierte una regla que se puede olvidar en el default |
| `PLANKA_MCP_PREFLIGHT` | `full` | La lee sólo el hook SessionStart del plugin: además levanta el binario del server y espera su banner de stdio. Apagado por default, porque con caché fría cuesta una descarga de `npx` |
| `PLANKA_MCP_COMMAND` | un comando | La lee el mismo hook: el comando a levantar en lugar de `npx -y @omnicoreos/planka-mcp` (un checkout local, un binario pineado) |

**El server no trae vocabulario de board propio.** Los nombres de columna y el
label de "listo" son tuyos, en tu idioma: esas dos variables son cómo un deploy
le cuenta al resumen cómo es su board. Un hint que no matchea nada vuelve en
`warnings`, nunca como respuesta vacía.

```json
"PLANKA_SUMMARY_DECISION_LISTS": "decision,probalo,miralo",
"PLANKA_SUMMARY_HIGHLIGHT_LABEL": "decidido"
```

**Las allowlists son por id, nunca por nombre.** Cualquier editor del board puede
renombrarlo, así que una allowlist por nombre se saltea con una edición. Los ids
de Planka son estables.

Dos aclaraciones sobre qué son y qué no:

- `PLANKA_READ_ONLY` esconde tools; no vuelve read-only a la cuenta. Combinalo con
  `"role":"viewer"` en el paso 2 de arriba si eso es lo que realmente necesitás.
- `PLANKA_PROTECTED_LIST_IDS` es un guard-rail, no un permiso: Planka no tiene
  derechos por lista. Es la herramienta correcta para "no muevas cards a
  *Mergeado* sola", y la equivocada para cualquier cosa crítica de seguridad.

Ejemplo — un agente que lee un board y comenta, y nada más:

```json
"env": {
  "PLANKA_BASE_URL": "https://planka.example.com",
  "PLANKA_API_KEY": "abcd1234_0123456789abcdef0123456789abcdef",
  "PLANKA_DEFAULT_BOARD_ID": "1234567890123456789",
  "PLANKA_ALLOWED_BOARD_IDS": "1234567890123456789",
  "PLANKA_DISABLED_TOOLS": "get_board",
  "PLANKA_PROTECTED_LIST_IDS": "9876543210987654321"
}
```

## Las 41 tools

Los IDs son strings. Empezá con `planka_get_structure` y usá los IDs que devuelve
Planka; no los adivines.

| Tool | Qué hace |
|---|---|
| `planka_get_structure` | Lista proyectos, boards y listas visibles |
| `planka_get_board` | **Deprecada.** Lee el board entero, hasta `limit` cards |
| `planka_board_summary` | Resumen en una llamada: columnas con conteos, labels con ids y, si se piden, las cards de las columnas nombradas |
| `planka_find_cards` | La única lectura de cards: una columna (`listId`), o un board buscado por texto, label o miembro |
| `planka_list_lists` | **Deprecada.** Alias de `planka_board_summary` con `cardsFrom: []` |
| `planka_list_cards` | **Deprecada.** Alias de `planka_find_cards` con `listId` |
| `planka_create_card` | Crea una card y puede agregar tareas y labels |
| `planka_get_card` | Digest de una card; `detail: "full"` y `withComments` a pedido |
| `planka_update_card` | Actualiza título, descripción, vencimiento o estado de completado |
| `planka_move_card` | Mueve una card a otra lista o posición |
| `planka_delete_card` | Borra una card permanentemente |
| `planka_create_tasks` | Agrega tareas de checklist a una card |
| `planka_update_task` | Renombra o completa una tarea |
| `planka_delete_task` | Borra una tarea |
| `planka_create_label` | Crea un label en el board |
| `planka_update_label` | Renombra un label o le cambia el color |
| `planka_delete_label` | Borra un label del board y de todas las cards que lo tenían |
| `planka_manage_labels` | **Deprecada.** Alias que rutea `action` a las tres de arriba |
| `planka_set_card_labels` | Agrega o quita labels y verifica el estado final |
| `planka_create_comment` | Agrega un comentario por el endpoint dedicado de Planka 2.x |
| `planka_get_comments` | Comentarios paginados (`limit`, `beforeId`, `all`) |
| `planka_update_comment` | Reescribe un comentario existente |
| `planka_delete_comment` | Borra un comentario |
| `planka_add_comment` | **Deprecada.** Alias de `planka_create_comment` |
| `planka_manage_comment` | **Deprecada.** Alias que rutea `action` a update/delete |
| `planka_create_list` | Crea una lista (columna) en un board |
| `planka_update_list` | Renombra, reubica o reclasifica una columna |
| `planka_delete_list` | Borra una columna **y todas sus cards** |
| `planka_manage_lists` | **Deprecada.** Alias que rutea `action` a las tres de arriba |
| `planka_add_attachment` | Sube un archivo local a una card y verifica que quedó |
| `planka_get_attachments` | Lista los adjuntos de una card con tipo, tamaño y URL de descarga |
| `planka_view_attachment` | Devuelve el contenido de un adjunto; las imágenes vuelven visibles |
| `planka_delete_attachment` | Borra un adjunto |
| `planka_card_history` | El historial de una card en líneas legibles: creada, movida, asignada, tareas completadas |
| `planka_board_activity` | Qué se movió en un board desde una fecha, agrupado por card |
| `planka_set_card_members` | Asigna o desasigna personas y verifica la membresía final |
| `planka_list_users` | Quiénes pueden ser asignados, con fallback al board |
| `planka_whoami` | La cuenta del servidor, su rol en el board, la versión de Planka y la policy |
| `planka_duplicate_card` | Copia una card con sus tareas, labels y miembros |
| `planka_archive_card` | Archiva una card en el archivo oculto del board, o la restaura |
| `planka_move_list_cards` | Mueve todas las cards de una columna a otra, con conteos |

Las lecturas siguen un principio: **digest chico por defecto, el detalle por
parámetros**. `planka_board_summary` abre una sesión en una llamada;
`planka_find_cards` con `listId` lee una columna entera en UNA request contra
`GET /api/lists/:id`, así que `total` es el tamaño real de la columna y la
respuesta trae `truncated: false`; la misma tool sin `listId` busca en el board.
Medido sobre el board de referencia de 185 cards, la deprecada
`planka_get_board` pasó de 56.112 a 17.215 caracteres y `planka_get_structure`
(`withLists: false`) de 696 a 203, y una columna de 159 cards pasó de cinco
requests a dos. Toda lectura informa `total`, `returned` y `hasMore`, así que
una respuesta recortada nunca parece completa, y toda lectura derivada del board
trae `excludesArchived: true` porque Planka deja archive y trash afuera del
board show.

Todos los campos y un payload completo por tool están en la
[referencia de tools](docs/tools.md).

## Qué aprende el cliente al conectarse

El handshake `initialize` devuelve un texto corto de instrucciones del servidor:
cómo abrir una sesión, de dónde salen los IDs, por qué importan todos los
comentarios de una card, y que Planka contesta `404` donde quiere decir `403`.
Claude Code las mete en el system prompt de la sesión y Codex CLI las lee junto
con la lista de tools, así que la guía compartida se dice una vez en vez de
repetirse en 41 descripciones. Cada tool además publica un título de display y
los cuatro hints de comportamiento del MCP escritos explícitamente, en lugar de
heredar los defaults pesimistas de la spec, más las dos claves `_meta` que
Claude Code sí usa: confirmación forzada en las tools que borran datos y un tope
de salida más alto en `planka_view_attachment`. Detalle en
[Server instructions and annotations](docs/tools.md#server-instructions-and-annotations).

## Resources y prompts

Dos superficies más, y las dos cuestan cero hasta que alguien las pide: por eso
la guía larga vive acá y no en las instructions, que se pagan en cada sesión.
Claude Code lee las dos; Cursor también; Codex no soporta ninguna, así que nada
de esto es imprescindible.

**Resources** sirven las guías que viajan dentro del paquete. En Claude Code se
traen con `@`, en Cursor desde el selector de resources:

| URI | Qué es |
|---|---|
| `planka://workflow/readme` | El workflow opcional del board: columnas, labels, quién mueve qué |
| `planka://workflow/board-template` | Las columnas y labels para crear en un board nuevo |
| `planka://workflow/skills/orchestrator` | La skill de director, tal cual |
| `planka://workflow/skills/close-card` | La skill de cierre, tal cual |
| `planka://gotchas/planka-2x` | Cómo se comporta Planka 2.x cuando una llamada contesta algo sin sentido |
| `planka://labels/colors` | Todos los colores que aceptan `planka_create_label` y `planka_update_label`, generados del schema |

**Prompts** son tres formas de arrancar; Claude Code las expone como
`/mcp__planka__<nombre>`:

| Prompt | Argumentos | Qué hace |
|---|---|---|
| `planka-open-session` | `boardId?`, `since?` | Summary, después lo que se movió, después las columnas que importan — en ese orden |
| `planka-close-card` | `cardId`, `listId?` | Leer el hilo entero, escribir un cierre honesto, mover la card y chequear `verified` |
| `planka-board-triage` | `boardId?`, `lists?` | Recorrer las columnas que esperan a una persona y volver cada card una pregunta |

## Flujo de agentes opcional

El servidor MCP funciona por sí solo. El método opcional resuelve otro problema:
preservar por qué existe un trabajo, qué cambió y qué sigue siendo cierto entre
sesiones de agentes.

Adoptalo por capas:

1. Usá sólo las tools MCP.
2. Sumá los estados del board, la plantilla de card y los handshakes humanos.
3. Sumá un worktree por card con un director que coordina obreros.

Empezá por [Un board que sobrevive a la sesión](workflow/README.md). La
[plantilla del board](workflow/board-template.md), las
[skills copiables de Claude Code](workflow/skills/) y el
[helper opcional de worktrees](workflow/worktrees/README.md) son piezas independientes.

## Solución de problemas

- [Síntomas, causas y fixes exactos](docs/troubleshooting.md)
- [Por qué Planka 2.x rompe MCP viejos en silencio](docs/planka-2x-gotchas.md)
- [Payloads completos de las tools](docs/tools.md)

Al reportar un bug, incluí la versión de Planka, la de Node, el nombre de la tool
y el texto del error. Nunca pegues credenciales ni access tokens.

## Créditos y licencia

Este es un fork con licencia MIT de
[`gogogadgetbytes/planka-mcp`](https://github.com/gogogadgetbytes/planka-mcp),
no una implementación original desde cero. [CREDITS.md](CREDITS.md) documenta
la atribución del upstream, los fixes mantenidos y los pull requests sin respuesta.

[LICENSE](LICENSE) conserva los avisos del autor original y de los contribuidores actuales.

## Desarrollo

```bash
npm ci
npm run build
npm test
```

El smoke real es opt-in porque modifica un board escribible y después limpia lo
creado. Ejercita las 41 tools por stdio y contrasta cada escritura contra la API
cruda de Planka: más de 90 checks con nombre.

```bash
export PLANKA_BASE_URL="https://planka.example.com"
export PLANKA_AGENT_EMAIL="agent@example.com"
export PLANKA_AGENT_PASSWORD="<TU_PASSWORD>"
export PLANKA_SMOKE_BOARD_ID="1234567890123456789"
npm run test:smoke
```

`npm run test:smoke` compila primero, así que no puede testear un `dist/` viejo.
Cuatro variables opcionales lo ajustan:

| Variable | Qué hace |
|---|---|
| `PLANKA_SMOKE_LIST_ID` | Columna donde se crea la card descartable. Sin esto elige una columna que parezca de descarte y, si no la hay, la primera |
| `PLANKA_SMOKE_FAIL_AFTER` | Inyecta un fallo después del check `<n>`, para probar que la limpieza igual corre |
| `PLANKA_MCP_ENTRY` | Punto de entrada del servidor. Por defecto `dist/index.js` |
| `VERBOSE` | Poné `1` para imprimir el payload de cada check |

Leé [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un cambio. La identidad de
release está centralizada en [project.identity.json](project.identity.json):
actualizala y ejecutá `npm run sync:identity` antes de publicar con tu namespace.
