# Contribuir a OpenBulkAds

¡Gracias por tu interés! OpenBulkAds es un proyecto open source para la comunidad
de *paid media*. Toda contribución —código, documentación, reportes de bugs o
ideas— es bienvenida.

## Antes de empezar

- Leé el [Código de Conducta](CODE_OF_CONDUCT.md). Al participar aceptás respetarlo.
- Para cambios grandes, abrí primero un *issue* para discutir el enfoque antes de
  escribir código. Así evitamos trabajo duplicado o que no encaje con el diseño.

## Preparar el entorno

Requisitos: Node.js >= 22.13, Docker + Docker Compose.

```bash
npm install
cp .env.example .env            # completar valores
sudo -n docker compose -f compose.dev.yaml up -d postgres
npm run db:migrate
npm run dev
```

Más detalle en el [README](README.md) y en
[docs/architecture/self-hosted.md](docs/architecture/self-hosted.md).

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
