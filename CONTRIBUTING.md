# Contribuir a OpenBulkAds

¡Gracias por tu interés! OpenBulkAds es un proyecto open source para la comunidad
de *paid media*. Toda contribución —código, documentación, reportes de bugs o
ideas— es bienvenida.

## Antes de empezar

- Leé el [Código de Conducta](CODE_OF_CONDUCT.md). Al participar aceptás respetarlo.
- Para cambios grandes, abrí primero un *issue* para discutir el enfoque antes de
  escribir código. Así evitamos trabajo duplicado o que no encaje con el diseño.

## Preparar el entorno

### Requisitos

- Node.js >= 22.13
- PostgreSQL 16 (para desarrollo hay uno listo en Docker)
- Docker + Docker Compose
- Un token de usuario de Meta con permisos `ads_management` y `ads_read`. Seguí la
  [guía para generar, conectar y extender el token de Meta](docs/meta-token.md).

### Claves de seguridad

Generá las dos claves que necesita tu `.env`:

```bash
# TOKEN_ENCRYPTION_KEY (32 bytes en base64 para cifrar los tokens de Meta):
openssl rand -base64 32
# (o con Node: node -e "console.log(crypto.randomBytes(32).toString('base64'))")

# BETTER_AUTH_SECRET (secreto para sesiones de usuario):
openssl rand -hex 32
```

### Pasos

1. **Instalar dependencias y configurar variables:**
   ```bash
   npm install
   cp .env.example .env
   ```
   Completá las claves generadas (`TOKEN_ENCRYPTION_KEY`, etc.) en tu `.env`. Todas
   las variables están documentadas en [`.env.example`](.env.example) y en la
   [tabla de configuración del README](README.md#configuración).

   La subida de ads exige `MEDIA_ROOT`: una ruta absoluta a una carpeta privada, fuera del web root. Definila en `.env` o, si usás `.env.local`, en ese archivo. Por ejemplo:

   ```bash
   mkdir -p /tmp/openbulkads-media
   ```

   ```
   MEDIA_ROOT=/tmp/openbulkads-media
   ```

   Si la variable falta o está vacía, la subida responde `MEDIA_ROOT is required and must be an absolute path`. Si el valor no empieza con `/`, responde `MEDIA_ROOT must be an absolute path`. El servidor de desarrollo solo lee ese valor al arrancar; el reinicio está en [Servidores de desarrollo](#servidores-de-desarrollo).

2. **Iniciar la base de datos:**
   ```bash
   docker compose -f compose.dev.yaml up -d postgres
   ```
   > *Nota:* Si en Linux tu usuario no pertenece al grupo `docker`, anteponé `sudo`. Si ya tenés un PostgreSQL local corriendo en el puerto 5432, podés apuntar `DATABASE_URL` a tu base o cambiar el mapeo de puerto en `compose.dev.yaml`.

3. **Migrar las tablas:**
   ```bash
   npm run db:migrate              # crea las tablas en PostgreSQL (carga .env automáticamente)
   ```

4. **Iniciar el servidor de desarrollo:**
   - **Acceso local (misma máquina):**
     ```bash
     npm run dev                   # abre http://localhost:3000
     ```
   - **Acceso por red privada / Tailscale / LAN:**
     Si estás corriendo el devserver en un servidor, VM o homelab y entrás desde tu notebook por Tailscale o IP de red:
     ```bash
     npm run dev:network           # escucha en 0.0.0.0:3000
     ```
     En tu `.env`, asegurate de configurar `BETTER_AUTH_URL` con tu hostname (por ej. `http://mi-servidor.ts.net:3000`). OpenBulkAds deriva automáticamente los orígenes permitidos (`allowedDevOrigins`) desde allí para que Turbopack y las sesiones funcionen sin bloqueos.

### Asistente de configuración inicial (`/setup`)

Al ingresar por primera vez (`http://localhost:3000`), la aplicación detecta que la base de datos está vacía (0 usuarios) y te guía automáticamente al instalador en `/setup`:

- **Paso 1 · Cuenta Administrador:** Creá tu cuenta principal (nombre, email y contraseña).
- **Paso 2 · Conexión con Meta:** Pegá tu token de usuario de Meta con verificación en vivo de permisos requeridos (`ads_management`, `ads_read`). Podés omitirlo ("Omitir por ahora") si querés configurarlo después.
- **Paso 3 · App ID & Cuentas Publicitarias:** Opcional para ingresar tu App ID / Secret (canje de token largo) y elegir qué cuentas publicitarias vas a usar en el workspace.
- **Paso 4 · Listo:** La sesión se inicia automáticamente y entrás directo al Workspace con todo configurado.

> **Seguridad estricta (fail-closed):** En cuanto se registra el primer usuario, la ruta `/setup` y sus endpoints quedan permanentemente bloqueados (devuelven 404). El registro público queda deshabilitado para proteger tu servidor.
>
> *Alternativa por consola:* Si preferís dar de alta al administrador sin usar la interfaz web (ej. automatizaciones o entornos sin navegador), podés correr `npm run admin:create`.

### Servidores de desarrollo

`npm run dev` es el servidor de desarrollo. Al arrancar lee `.env` y `.env.local`; el log lo confirma con `Environments: .env.local`. Una variable agregada o cambiada no entra en un proceso que ya está corriendo: frená ese servidor y volvé a ejecutar `npm run dev`.

El proceso vigente queda en `.next/dev/lock`, con `pid`, `port` y `appUrl`. Para comprobar que ese proceso puede guardar archivos:

```bash
curl -sS http://127.0.0.1:3000/api/ready
```

| Respuesta | Qué significa |
| --- | --- |
| `{"ready":true,"database":true,"media":true}` | `MEDIA_ROOT` es absoluta y se puede escribir. |
| `media: false` | Falta, está vacía, no empieza con `/`, o el directorio no es escribible. |

Si lanzás otro `npm run dev` con ese proceso vivo, Next.js no lo reemplaza. Imprime `Another next dev server is already running`, el PID, el directorio y `.next/dev/logs/next-development.log`. Si el puerto 3000 está ocupado por otro proceso, prueba el 3001 y después falla igual.

Pueden quedar `next-server` viejos de `npm start` o de `scripts/container-start.mjs`, en otros puertos y sin proceso padre. Esos no son el dev server y no cargan `.env.local`. La subida se prueba contra el PID y el puerto del lock.

Mirar el entorno con el que arrancó el proceso no alcanza: Next.js carga `.env.local` después, así que `MEDIA_ROOT` puede no aparecer ahí aunque la app ya la tenga. La prueba es `/api/ready`.

`/tmp/openbulkads-media` se borra al reiniciar la máquina. Creala de nuevo antes de subir ads.

La arquitectura está en [docs/architecture/self-hosted.md](docs/architecture/self-hosted.md).

## Flujo de trabajo

1. Hacé un *fork* y creá una rama descriptiva (p. ej. `fix/drive-filename` o
   `feat/preset-export`).
2. Hacé cambios enfocados y pequeños. Una PR = un objetivo.
3. Asegurate de que todo esté en verde (ver [Verificación](#verificación)).
4. Abrí la PR completando la plantilla.

## Verificación

Antes de abrir una PR, corré:

```bash
npx tsc --noEmit        # tipos
npm run lint            # eslint
npm test                # suite empaquetada
npm run test:db         # requiere PostgreSQL en ejecución
npm run build           # build de producción
```

El CI corre lo mismo en cada PR. Las PRs deben quedar en verde.

## Estilo de código

- TypeScript en modo estricto; no introduzcas `any` nuevos.
- Seguí las convenciones existentes del repo (ESLint con `eslint-config-next`).
- Mensajes de commit en formato [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`...).

## Principios del proyecto

OpenBulkAds es deliberadamente conservador con las escrituras en Meta. Al
contribuir, respetá estas invariantes:

- No reintentar automáticamente escrituras ambiguas o ante cortes de red.
- Preservar el aislamiento por dueño y la validación de mismo origen.
- Mantener el cifrado de tokens y que nunca vuelvan al navegador.
- No romper la idempotencia de la creación de trabajos ni la recuperación del
  historial.
- El despliegue es **VPN-only**; no agregar superficies expuestas a internet sin
  una revisión de seguridad explícita.

## Reportar bugs y proponer features

Usá las plantillas de *issues*. Para bugs, incluí pasos de reproducción, lo
esperado vs. lo observado, y versión/entorno. **Nunca** incluyas tokens,
`App Secret`, cadenas de conexión ni datos de cuentas reales de Meta.

## Seguridad

Si encontrás una vulnerabilidad, **no** abras un issue público. Reportala de
forma privada al mantenedor (ver [SECURITY.md](SECURITY.md) si está disponible,
o por contacto directo).
