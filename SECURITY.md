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

El despliegue **recomendado y soportado** es detrás de una VPN/red privada (por
ejemplo Tailscale). Las consideraciones de seguridad de este documento asumen ese
modelo.

Publicar la aplicación bajo un dominio en internet es una **opción avanzada, bajo
tu responsabilidad**. Si lo hacés, como mínimo:

- Completá el asistente `/setup` (o `npm run admin:create`) **antes** de exponerla:
  hasta que exista el primer usuario, cualquiera que llegue a la URL puede crear
  la cuenta administradora.
- Servila solo por HTTPS y con `BETTER_AUTH_URL` apuntando a esa URL `https://`.
- Mantené PostgreSQL y el puerto de la app fuera de internet; publicá solo el
  reverse proxy.
- Considerá una capa de acceso adicional delante (Cloudflare Access, autenticación
  del proxy, allowlist de IPs) y límites de tasa en el proxy.

Los reportes sobre despliegues públicos son bienvenidos, pero el endurecimiento de
ese entorno (ingress, rate limits, WAF) queda a cargo de quien lo opera.

## Buenas prácticas de despliegue

- Mantené la app y PostgreSQL en interfaces privadas; publicá solo el proxy
  interno en la interfaz de la VPN.
- Guardá los secretos (`TOKEN_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`,
  `DATABASE_URL`, etc.) en archivos root-only fuera del repositorio.
- Rotá las claves periódicamente y realizá backups verificados.

Más detalle en [deploy/README.md](deploy/README.md) y
[docs/architecture/self-hosted.md](docs/architecture/self-hosted.md).
