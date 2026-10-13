# Política de seguridad

OpenBulkAds maneja tokens y credenciales de la Meta Marketing API. La seguridad
es una prioridad del proyecto.

## Reportar una vulnerabilidad

**No** abras un issue público para reportar vulnerabilidades.

Reportá de forma privada usando los
[Security Advisories de GitHub](https://docs.github.com/es/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(pestaña **Security** del repositorio → *Report a vulnerability*), o por contacto
directo con el mantenedor.

Incluí, en lo posible:

- Una descripción de la vulnerabilidad y su impacto.
- Pasos para reproducirla.
- Versión/entorno afectado.

**Nunca** incluyas tokens reales, `App Secret`, cadenas de conexión ni datos de
cuentas de Meta en el reporte.

## Alcance

OpenBulkAds está diseñado para desplegarse **solo detrás de una VPN/red privada**,
nunca expuesto a internet. Las consideraciones de seguridad asumen ese modelo de
despliegue. Exponer la aplicación públicamente queda fuera del alcance soportado y
requiere una revisión de seguridad propia.

## Buenas prácticas de despliegue

- Mantené la app y PostgreSQL en interfaces privadas; publicá solo el proxy
  interno en la interfaz de la VPN.
- Guardá los secretos (`TOKEN_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`,
  `DATABASE_URL`, etc.) en archivos root-only fuera del repositorio.
- Rotá las claves periódicamente y realizá backups verificados.

Más detalle en [deploy/README.md](deploy/README.md) y
[docs/architecture/self-hosted.md](docs/architecture/self-hosted.md).
