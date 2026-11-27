# GitHub: repositorio, CI y colaboración

> Guía para la clase de GitHub de **Conversa CRM**. Refleja el estado real del
> repositorio y los comandos que usaremos en clase. Todo el flujo se hace con
> GitHub CLI (`gh`) o desde la web.

---

## 1. Estado actual del repositorio

| Dato | Valor |
|---|---|
| Repositorio | `https://github.com/jrsantiagop/conversa-crm` |
| Propietario | `jrsantiagop` |
| Visibilidad | **Privado** |
| Rama principal | `master` |
| Autenticación local | GitHub CLI (`gh`) como `jrsantiagop` |
| Integración continua | `.github/workflows/ci.yml` (typecheck + build) |
| Despliegue | Todavía no configurado en GitHub Actions (se verá más adelante) |

Comprueba la sesión y los datos del repositorio en cualquier momento:

```bash
gh auth status
gh repo view jrsantiagop/conversa-crm
gh repo view jrsantiagop/conversa-crm --web
```

`gh auth status` debe mostrar la cuenta `jrsantiagop` y el alcance de los tokens.
Si la sesión ha caducado:

```bash
gh auth login
gh auth setup-git   # configura Git para usar las credenciales de gh
```

---

## 2. Secretos: qué NO se sube a GitHub

**No hay secretos en el repositorio.** Ni GitHub Actions ni el código necesitan
claves para las comprobaciones actuales: el workflow solo instala dependencias,
comprueba tipos y compila.

- `.env.local` está en `.gitignore`, junto a `.env`, `.env.*.local`, `.data/`,
  `.next/` y `node_modules/`.
- Los valores reales de `.env.local` (claves de cifrado, tokens de canales,
  cadenas de conexión) se quedan en cada máquina o se configuran como variables
  de entorno en el entorno de despliegue cuando llegue el momento.
- Antes de cada commit: `git status` y `git diff --cached` para revisar qué se
  va a subir. Si aparece un archivo `.env*`, **no lo añadas**.
- Si alguna vez subiste una clave por error, revócala en el proveedor antes de
  borrarla del historial.

La plantilla `.env.example` solo contiene nombres de variables y valores de
ejemplo; se puede versionar sin problema.

---

## 3. Flujo commit → push → CI

### 3.1 Trabajar en una rama

```bash
git checkout master
git pull origin master
git checkout -b clase/github-ci
```

### 3.2 Commit

```bash
git status
git add .github/workflows/ci.yml docs/GITHUB.md
git commit -m "docs: guía de GitHub y workflow de CI"
```

> En Windows (PowerShell) también puedes usar `git status`, `git add` y
> `git commit` tal cual.

### 3.3 Push

```bash
git push -u origin clase/github-ci
```

### 3.4 Pull request y CI

```bash
gh pr create --base master --head clase/github-ci \
  --title "Añadir CI y guía de GitHub" \
  --body "Workflow de typecheck y build + guía para la clase"
```

El workflow `CI` se dispara automáticamente:

- en **push** a `master`, y
- en **pull_request** dirigidas a `master`.

Pasos del job `verify` en `ubuntu-latest`:

1. `actions/checkout@v4` — descarga el código.
2. `actions/setup-node@v4` con Node **24** y `cache: npm` — usa el
   `package-lock.json` para cachear las dependencias.
3. `npm ci` — instalación reproducible desde el lockfile.
4. `npm run typecheck` — `tsc --noEmit` (TypeScript estricto).
5. `npm run build` — build de producción de Next.js.

Para ver el resultado:

```bash
gh pr checks           # estado de los checks de la PR
gh run list --workflow=ci.yml
gh run view <run-id> --log
```

Si un paso falla, corrige el código localmente, haz un nuevo commit y vuelve a
hacer `git push`: la PR se actualiza y la CI se vuelve a ejecutar. Solo se
fusiona cuando los checks estén en verde:

```bash
gh pr merge --squash --delete-branch
```

Al fusionar en `master` se dispara de nuevo la CI sobre la rama principal.

---

## 4. Cambiar el repositorio a público

El repositorio es privado. Para abrirlo desde la CLI (el flag de confirmación
es obligatorio):

```bash
gh repo edit jrsantiagop/conversa-crm \
  --visibility public \
  --accept-visibility-change-consequences
```

Para volver a privado:

```bash
gh repo edit jrsantiagop/conversa-crm --visibility private
```

También se puede hacer en la web: **Settings → General → Danger Zone → Change
repository visibility**.

Antes de hacerlo público, comprueba dos veces que no hay claves ni datos
privados en el historial: `git status`, `.gitignore` y una búsqueda de patrones
como `api_key`, `token`, `password`, `DATABASE_URL=...` con valor real.

> Ojo: al hacer público, todo el historial y todos los forks existentes pasan a
> ser públicos. La visibilidad no afecta a los secretos de despliegue, que se
> gestionan aparte.

---

## 5. Invitar colaboradores

Desde la CLI (permiso `push`, equivalente a "write"):

```bash
gh api -X PUT \
  -H "Accept: application/vnd.github+json" \
  repos/jrsantiagop/conversa-crm/collaborators/NOMBRE_USUARIO \
  -F permission=push
```

Otros permisos posibles: `pull` (solo lectura), `push` (escritura),
`maintain`, `admin`.

Para listar los colaboradores:

```bash
gh api repos/jrsantiagop/conversa-crm/collaborators --jq '.[].login'
```

En la web: **Settings → Collaborators and teams → Add people**.

El invitado recibe un correo y debe aceptar la invitación. Si el repositorio
sigue privado, la persona **debe** tener acceso aunque haya hecho clone antes;
sin invitación no podrá hacer `fetch` ni `push`.

---

## 6. Clonar el proyecto en otro equipo

### 6.1 Con GitHub CLI (recomendado)

```bash
gh auth login
gh repo clone jrsantiagop/conversa-crm
cd conversa-crm
```

`gh repo clone` configura Git para usar la sesión de `gh`, así que funciona
también con repositorios privados sin crear tokens manualmente.

### 6.2 Con Git y HTTPS

```bash
git clone https://github.com/jrsantiagop/conversa-crm.git
cd conversa-crm
```

Si el repo está privado, Git pedirá credenciales. Usa un **Personal Access
Token** (PAT) como contraseña, o mejor `gh auth setup-git` para que Git reutilice
la sesión de `gh`. Nunca guardes el PAT en un archivo del proyecto.

### 6.3 Con SSH

```bash
ssh-keygen -t ed25519 -C "tu-email"
# añade la clave pública en GitHub → Settings → SSH and GPG keys
git clone git@github.com:jrsantiagop/conversa-crm.git
```

### 6.4 Después de clonar

```bash
node --version          # 24 recomendado (mínimo 20.9.0)
npm ci                  # instala exactamente lo del lockfile
cp .env.example .env.local   # en Windows: Copy-Item .env.example .env.local
# edita .env.local con tus valores LOCALES (nunca los subas)
npm run dev
```

Comprueba que `.env.local` no aparece en `git status`:

```bash
git status --short
git check-ignore -v .env.local
```

---

## 7. Resumen rápido para la clase

```bash
gh auth status                         # 1. quién soy
gh repo view jrsantiagop/conversa-crm   # 2. dónde estoy
git checkout -b clase/github-ci         # 3. rama de trabajo
git add <archivos> && git commit -m "..."  # 4. commit (sin secretos)
git push -u origin clase/github-ci      # 5. push
gh pr create --base master              # 6. PR → dispara la CI
gh pr checks                            # 7. verificar checks
gh pr merge --squash --delete-branch    # 8. fusionar en master
```

Referencias: `README.md`, `docs/DEPLOYMENT.md` y el workflow
`.github/workflows/ci.yml`.
