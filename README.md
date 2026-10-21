<p align="center">
  <img src="docs/banner.jpg" alt="OpenBulkAds" width="100%">
</p>

<p align="center">
  <strong>Carga masiva de anuncios en Meta, en tu propia infraestructura.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href=".github/workflows/ci.yml"><img alt="CI" src="https://github.com/matiads/openbulkads/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Self-hosted" src="https://img.shields.io/badge/deploy-self--hosted-6b4fbb.svg">
</p>

<p align="center">
  <a href="#in-english">English summary below</a>
</p>

---

## ¿Qué es OpenBulkAds?

OpenBulkAds es una herramienta **gratuita y de código abierto** para **crear muchos anuncios de Meta a la vez**, sin planillas ni trabajo repetitivo. Conectás tu cuenta de Meta y la herramienta arma los anuncios por vos — siempre **en pausa**, para que los revises antes de activar.

Lo que la hace distinta: **corre en tu propia infraestructura**. Tu token de Meta y tus archivos nunca salen de tus servidores. No hay un tercero en el medio.

> **Proyecto independiente.** OpenBulkAds no está afiliado ni respaldado por Meta. Lo usás bajo tu responsabilidad y respetando las políticas de Meta.

## ¿Para quién es?

Para gente de *paid media* —media buyers, agencias, freelancers— que:

- Sube muchos anuncios por día y está cansado de hacerlo uno por uno.
- Quiere tener el control de sus datos y no depender de un servicio externo.

No hace falta ser técnico para **usarlo**. Para **instalarlo** sí conviene una mano técnica (o tu equipo de IT); una vez montado, el día a día es simple. Ver la [parte técnica](#instalación-y-despliegue-parte-técnica).

## ¿Qué podés hacer?

- 📦 **Cargar anuncios en lote** — hasta 20 por vez, reutilizando un creativo o subiendo imágenes (JPG/PNG) y videos (MP4/MOV).
- 📋 **Copiar una campaña** con sus conjuntos (sin los anuncios), todo en pausa, revisando presupuesto y audiencia antes.
- 🆕 **Crear una campaña nueva desde un modelo** — tomás la configuración de un conjunto que ya funciona y armás una campaña desde cero.
- 🎬 **Subir videos pesados** (hasta 250 MB) desde tu compu o un link público de Google Drive.
- 💾 **Guardar presets** por cuenta: campaña, conjunto, identidad, textos y distribución, listos para reusar.
- 📜 **Historial completo** con los IDs y errores de Meta, para que nunca cargues algo dos veces por error.

## ¿Cómo funciona? (en 3 pasos)

1. **Conectás tu token de Meta** una vez (necesita permisos `ads_management` y `ads_read`).
2. **Elegís los archivos o links** y a qué campaña o conjunto van.
3. **OpenBulkAds crea los anuncios en pausa.** Vos los revisás y activás desde Ads Manager cuando quieras.

<p align="center"><img src="docs/demo.gif" alt="OpenBulkAds creando anuncios de Meta en lote, en pausa" width="100%"></p>

<p align="center"><sub>Demo con datos ficticios: 3 anuncios creados en pausa en pocos clics.</sub></p>

## Pensado para no romper nada

OpenBulkAds es deliberadamente cuidadoso con tu cuenta:

- **Nunca** activa, borra ni modifica anuncios que ya existen.
- Si una operación queda dudosa (se cortó internet, Meta respondió raro), **no la reintenta sola**: te avisa para que revises y evites duplicados.
- Respeta los límites que marca Meta y pausa cuando hace falta.

Creativos nuevos soportados hoy: **sitio web, WhatsApp e Instagram Direct**. Carruseles, formularios, catálogos y creativos dinámicos requieren adaptación.

## In English

OpenBulkAds is a **free, open-source, self-hosted tool to create Meta (Facebook/Instagram) ads in bulk**. Connect a Meta user token with `ads_management` and `ads_read`, pick your files or public Google Drive links and the target campaign or ad set, and OpenBulkAds creates the ads, always **paused**, so you can review them in Ads Manager before going live.

- **Bulk ad creation:** up to 20 ads per run, reusing a creative or uploading images (JPG/PNG) and videos (MP4/MOV, up to 250 MB).
- **Campaign copy and campaign-from-template:** duplicate a campaign with its ad sets (without the ads), or build a new one from an ad set that already works.
- **Presets and full history:** reusable presets per ad account and a run history with Meta IDs and errors.
- **Safe by design:** it never activates, deletes, or edits existing ads, and it never auto-retries an uncertain operation, to avoid duplicates.
- **Your infrastructure:** your Meta token (encrypted at rest) and your media never leave your servers. Recommended deployment is a private network or VPN such as Tailscale.

**Install in one command** (needs Docker; runs on a PC, server or VPS, listens on `127.0.0.1` by default; open `/setup` right away to create the first admin):

```bash
curl -fsSL https://raw.githubusercontent.com/matiads/openbulkads/main/install.sh | sh
```

See [docs/deploy.md](docs/deploy.md) (Spanish) or, for AI agents, [INSTALL-AGENT.md](INSTALL-AGENT.md).

The UI and the setup guide below are in Spanish; the commands are the same in any language. Production deployment is documented in English in [deploy/README.md](deploy/README.md). OpenBulkAds is an independent project and is not affiliated with or endorsed by Meta.

---

## Instalación y despliegue (parte técnica)

### Instalación en un comando

Con [Docker](https://docs.docker.com/get-docker/) instalado (en tu PC, un servidor o un VPS):

```bash
curl -fsSL https://raw.githubusercontent.com/matiads/openbulkads/main/install.sh | sh
```

- Baja la imagen publicada y arma la app con su base de datos PostgreSQL, en `~/openbulkads`.
- Genera claves seguras en un `.env` (solo la primera vez; volver a correrlo no las cambia).
- Espera a que esté lista y te muestra la dirección: **abrí `/setup` y completalo enseguida**, porque hasta crear el primer administrador está abierto a cualquiera que llegue a esa dirección.

Por defecto solo escucha en tu propia máquina (`127.0.0.1`). La guía paso a paso (acceso con Tailscale, actualizar, backup, desinstalar) está en [docs/deploy.md](docs/deploy.md).

### ¿Querés que un agente lo instale?

Pegale esto a tu agente de IA (Claude Code, Codex, etc.):

```text
Instalá OpenBulkAds siguiendo las instrucciones de https://raw.githubusercontent.com/matiads/openbulkads/main/INSTALL-AGENT.md y avisame cuando tenga que completar /setup.
```

Las instrucciones para agentes están en [INSTALL-AGENT.md](INSTALL-AGENT.md): el agente verifica cada paso, nunca muestra tus claves y te deja el `/setup` a vos.

### Ponerlo en producción

Hay dos modalidades:

1. **Red privada / VPN (recomendado):** la app y tus datos quedan aislados de internet (por ejemplo con [Tailscale](https://tailscale.com/)). Un solo `docker compose` levanta la app y un proxy interno (Caddy con HTTPS y certificados privados) en la IP de tu VPN.
2. **Dominio público con reverse proxy (avanzado, bajo tu responsabilidad):** detrás de Caddy, Nginx, Traefik o Cloudflare Tunnel. Antes de exponerla, leé los requisitos mínimos en [SECURITY.md](SECURITY.md#alcance) y completá `/setup` **antes** de publicarla: hasta que exista el primer usuario, cualquiera que llegue a la URL puede crear la cuenta administradora. Servila solo por HTTPS, mantené PostgreSQL y el puerto de la app fuera de internet, y configurá `APP_DOMAIN=ads.mi-dominio.com` y `BETTER_AUTH_URL=https://ads.mi-dominio.com`.

La guía completa —secretos, certificados, proxies externos y límite de subida de archivos, **backups**, actualizaciones y rollback— está en **[deploy/README.md](deploy/README.md)** (en inglés).

### Requisitos

- [Docker](https://docs.docker.com/get-docker/) para instalar o desplegar.
- Un token de usuario de Meta con permisos `ads_management` y `ads_read`. Seguí la [guía para generar, conectar y extender el token de Meta](docs/meta-token.md).
- Para desarrollar: Node.js >= 22.13 y PostgreSQL 16 (hay uno listo en Docker).

### Configuración

Las variables están documentadas en [`.env.example`](.env.example). Las principales:

| Variable | Requerida | Para qué sirve |
| --- | --- | --- |
| `TOKEN_ENCRYPTION_KEY` | sí | Clave AES (exactamente 32 bytes en base64) para cifrar los tokens. Generar con `openssl rand -base64 32`. |
| `DATABASE_URL` | sí | Conexión a PostgreSQL de la app. |
| `MIGRATION_DATABASE_URL` | sí (prod) | Credenciales solo para migraciones; la app en marcha nunca migra. |
| `BETTER_AUTH_SECRET` | sí (prod) | Secreto aleatorio de 32+ caracteres para las sesiones. Generar con `openssl rand -hex 32`. |
| `BETTER_AUTH_URL` | sí (prod) | URL pública/interna de la app (p. ej. `http://servidor.ts.net:3000` o `https://ads.midominio.com`). |
| `ALLOWED_DEV_ORIGINS` | no | Hostnames adicionales permitidos en `next dev` (opcional; el host de `BETTER_AUTH_URL` se incluye automáticamente). |
| `MEDIA_ROOT` | sí | Carpeta privada donde se guardan los archivos, fuera del web root. |
| `NEXT_PUBLIC_MEDIA_LIMIT_MB` | no | Límite de tamaño por archivo en MB (default 250). Cambiarlo requiere reconstruir. |

### Desarrollo local

```bash
npm install
cp .env.example .env            # completar claves y MEDIA_ROOT
docker compose -f compose.dev.yaml up -d postgres
npm run db:migrate
npm run dev                     # http://localhost:3000 → /setup
```

La guía completa —claves de seguridad, `MEDIA_ROOT`, acceso por Tailscale/LAN, el asistente `/setup`, diagnóstico del servidor de desarrollo y verificación (tipos, lint, tests, build)— está en [CONTRIBUTING.md](CONTRIBUTING.md).

## Arquitectura

Next.js (runtime Node, *standalone*) + Better Auth (registro cerrado) + PostgreSQL/Drizzle + medios en disco local, detrás de un proxy interno en una VPN. Detalle completo en [docs/architecture/self-hosted.md](docs/architecture/self-hosted.md).

## Contribuir

Las contribuciones son bienvenidas. Leé [CONTRIBUTING.md](CONTRIBUTING.md) y el [Código de Conducta](CODE_OF_CONDUCT.md) antes de abrir un issue o PR.

## Seguridad

¿Encontraste una vulnerabilidad? No abras un issue público: seguí [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE) © 2026 Matias Aguirre
