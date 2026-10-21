# Instalar OpenBulkAds en un comando

Esta guía te lleva de cero a tener OpenBulkAds andando en tu PC, en un servidor o en un VPS. No hace falta saber de programación: solo copiar y pegar.

## Qué necesitás

- Una máquina con **Linux, macOS o Windows (con WSL)**: tu PC, un servidor o un VPS.
- **Docker** con Docker Compose v2 (el comando `docker compose`). Es lo único que tenés que instalar: [docs.docker.com/get-docker](https://docs.docker.com/get-docker/).
- Un par de GB libres de disco y 1 GB de RAM libre como mínimo.

Para chequear Docker:

```bash
docker compose version
```

Tiene que mostrar una versión, por ejemplo `Docker Compose version v2.29.0`. Si dice "command not found" o "is not a docker command", instalá Docker primero.

## El comando

```bash
curl -fsSL https://raw.githubusercontent.com/matiads/openbulkads/main/install.sh | sh
```

Esto hace, en orden:

1. Revisa que Docker y Docker Compose estén instalados.
2. Crea la carpeta `~/openbulkads` y baja ahí la configuración.
3. Genera claves seguras en `~/openbulkads/.env` (solo la primera vez).
4. Descarga e inicia OpenBulkAds con su base de datos y espera a que esté listo.

Si te da un error de permisos con Docker, agregá tu usuario al grupo docker (`sudo usermod -aG docker $USER`), cerrá sesión y volvé a entrar (o corré `newgrp docker`) y repetí el comando **sin sudo**. No corras el instalador con `sudo`: usaría la carpeta de root en vez de la tuya y se perderían las variables que le pasás.

## Lo más importante: completá `/setup` ya

Cuando termina, el instalador te muestra una dirección parecida a `http://localhost:3000/setup`.

1. **Abrila ahora** en el navegador.
2. **Creá tu administrador y terminá el asistente enseguida.**

Hasta que exista el primer administrador, `/setup` está abierto para cualquiera que pueda llegar a esa dirección. Por eso, por defecto, OpenBulkAds solo escucha en tu propia máquina (`127.0.0.1`). No lo dejes a medias.

## Entrar desde otros dispositivos

Por defecto solo podés entrar desde la misma máquina donde lo instalaste. Si lo instalaste en un servidor o VPS, estas son las opciones:

### Opción recomendada: Tailscale (red privada)

[Tailscale](https://tailscale.com/) arma una red privada entre tus dispositivos. Nadie de internet puede llegar a tu OpenBulkAds.

1. Instalá Tailscale en el servidor y en tu compu/celu, con la misma cuenta.
2. Fijate el nombre o la IP del servidor en Tailscale (algo como `mi-server.tu-red.ts.net` o `100.x.y.z`).
3. Instalá indicando esa dirección:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/matiads/openbulkads/main/install.sh \
     | OPENBULKADS_BIND=100.x.y.z OPENBULKADS_URL=http://mi-server.tu-red.ts.net:3000 sh
   ```

   - `OPENBULKADS_BIND` es la IP de Tailscale del servidor: así solo se publica en tu red privada.
   - `OPENBULKADS_URL` es **exactamente** la dirección que vas a escribir en el navegador.

4. Entrá a `http://mi-server.tu-red.ts.net:3000/setup` desde cualquier dispositivo de tu Tailscale.

> **Importante:** el inicio de sesión solo funciona si entrás por la misma dirección que pusiste en `OPENBULKADS_URL`. Si entrás por otra (por ejemplo por la IP en vez del nombre), te va a rechazar. Usar `http://` es normal en una red privada como Tailscale o en `localhost`: el tráfico ya va cifrado por la red privada.

Si ya lo habías instalado y querés cambiar la dirección, editá `~/openbulkads/.env` (`OPENBULKADS_BIND` y `BETTER_AUTH_URL`) y corré `docker compose up -d` dentro de esa carpeta.

### Avanzado: dominio público

Podés ponerlo detrás de un dominio con HTTPS (Caddy, Nginx, Cloudflare Tunnel…), pero queda **bajo tu responsabilidad**: leé primero [SECURITY.md](../SECURITY.md#alcance). En ese caso `OPENBULKADS_URL` tiene que ser tu dominio (`https://ads.tudominio.com`) y el proxy tiene que apuntar a `127.0.0.1:3000`. Para un armado privado más completo con VPN y Caddy, mirá [deploy/README.md](../deploy/README.md) (en inglés).

## Opciones del instalador

Se pasan como variables delante de `sh`, por ejemplo `... | OPENBULKADS_PORT=3500 sh`. Si ya tenés una instalación, las opciones que pases se aplican al `.env` existente (las claves no se tocan) y el instalador te avisa qué cambió.

Una máquina, una instalación: el proyecto de Docker se llama siempre `openbulkads-quickstart`, así que una segunda instalación en otra carpeta chocaría con la primera.

| Variable | Qué hace | Por defecto |
| --- | --- | --- |
| `OPENBULKADS_DIR` | Carpeta de instalación | `~/openbulkads` |
| `OPENBULKADS_PORT` | Puerto en tu máquina | `3000` |
| `OPENBULKADS_BIND` | Dirección donde escucha | `127.0.0.1` (solo esta máquina) |
| `OPENBULKADS_URL` | Dirección que escribís en el navegador | `http://localhost:<puerto>` |
| `OPENBULKADS_VERSION` | Versión de la imagen (por ejemplo `1.2.3`) | `latest` |

El límite de 250 MB por archivo viene fijo en la imagen publicada. Si necesitás otro límite (`NEXT_PUBLIC_MEDIA_LIMIT_MB`), tenés que construir la imagen vos mismo desde el código (ver [deploy/README.md](../deploy/README.md)).

## Comandos del día a día

Corrélos dentro de la carpeta de instalación (`cd ~/openbulkads`):

```bash
docker compose logs -f                          # ver qué está pasando (Ctrl+C para salir)
docker compose ps                               # ver si está andando
docker compose pull && docker compose up -d     # actualizar a la última versión
docker compose down                             # detener (no borra tus datos)
docker compose up -d                            # volver a iniciar
```

Volver a correr el comando de instalación también sirve para actualizar: **conserva tu `.env`** y no cambia tus claves.

## Backup

Tu información está en dos lugares. Guardá copias de los dos:

1. **`~/openbulkads/.env`**: tus claves. Sin la `TOKEN_ENCRYPTION_KEY` no se pueden descifrar los tokens de Meta guardados. Guardalo en un lugar privado (por ejemplo un gestor de contraseñas).
2. **La base de datos**: usuarios, presets e historial.

   ```bash
   cd ~/openbulkads
   docker compose exec -T postgres pg_dump --clean --if-exists -U openbulkads openbulkads > backup-$(date +%F).sql
   ```

   Para restaurar (en la misma instalación o en una nueva hecha con el mismo comando), con el `.env` original en su lugar:

   ```bash
   cd ~/openbulkads
   docker compose stop app
   docker compose exec -T postgres psql -v ON_ERROR_STOP=1 --single-transaction -U openbulkads openbulkads < backup-2026-01-01.sql
   docker compose up -d
   ```

   El backup reemplaza las tablas que ya existen. Si algo falla, `--single-transaction` deshace todo y no queda a medias. En una instalación nueva usá el mismo `.env` (con las mismas claves) de la anterior.

Los archivos que subís para crear anuncios (imágenes y videos) viven en el volumen `media` de Docker. Son archivos de trabajo: una vez que el anuncio está creado, el creativo ya queda en Meta. Lo que sí los necesita son las cargas **pendientes o en revisión**: si restaurás solo la base, esas cargas no van a poder reanudarse y vas a tener que volver a subir esos archivos. Para un respaldo completo, guardá también los archivos (el `.tgz` queda a nombre de root: es normal), justo después del dump de la base:

```bash
cd ~/openbulkads
docker run --rm -v openbulkads-quickstart_media:/media:ro -v "$PWD":/backup postgres:16 \
  tar czf /backup/media-$(date +%F).tgz -C /media .
```

## Desinstalar

```bash
cd ~/openbulkads
docker compose down -v     # detiene y BORRA la base de datos y los archivos subidos
cd .. && rm -r ~/openbulkads   # borra la carpeta con tu .env
```

Esto es irreversible. Si querés conservar algo, hacé el backup antes. Con `docker compose down` (sin `-v`) solo se detiene y tus datos quedan guardados.

## ¿Y Vercel?

No está soportado. OpenBulkAds guarda los archivos que subís en un disco persistente (`MEDIA_ROOT`), acepta subidas de hasta 250 MB, necesita PostgreSQL y un servidor que quede prendido. Vercel y plataformas "serverless" similares tienen disco efímero, límites de tamaño de subida mucho menores y funciones de vida corta, así que no encajan. Un VPS, un servidor o tu PC con el comando de arriba sí.

## Si algo falla

- **"No encontré Docker" / "Falta Docker Compose v2":** instalá Docker (link arriba) y volvé a correr el comando.
- **"No puedo hablar con Docker":** Docker no está encendido o tu usuario no tiene permiso (ver la sección "El comando").
- **"OpenBulkAds no respondió en /api/ready":** mirá `docker compose logs --tail 100` dentro de `~/openbulkads`.
- **El puerto está ocupado:** instalá con otro puerto, por ejemplo `OPENBULKADS_PORT=3500`.
- **Me rechaza al iniciar sesión:** entrá por la misma dirección que pusiste en `OPENBULKADS_URL`.
