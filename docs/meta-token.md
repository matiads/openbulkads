# Conectar Meta con un token de usuario

Esta guía te lleva desde tu app de Meta hasta una conexión lista en OpenBulkAds. Usamos un **token de usuario**, que se puede canjear por uno de larga duración (generalmente unos 60 días). No es un token permanente ni una renovación automática indefinida.

## Antes de empezar

Necesitás:

- Una cuenta de Facebook con acceso para administrar la cuenta publicitaria y los activos que vas a usar (Página e Instagram, si corresponde).
- Una cuenta de [Meta for Developers](https://developers.facebook.com/) y una app propia con acceso a Marketing API.
- OpenBulkAds instalado y acceso a su configuración.

El token autoriza acciones con los permisos de tu usuario: no da acceso a cuentas o activos que ese usuario no pueda administrar.

## 1. Prepará tu app de Meta

1. Entrá a [Mis apps](https://developers.facebook.com/apps/) y creá una app o elegí la que ya usás.
2. Configurá el caso de uso o producto que permita trabajar con **Marketing API**. Los nombres y pantallas pueden variar según el tipo de app y los cambios de Meta; seguí su [guía de inicio](https://developers.facebook.com/docs/marketing-api/get-started/).
3. En la configuración básica de esa app, ubicá su **App ID** y **App Secret** (clave secreta). Los vas a usar dentro de OpenBulkAds, no en esta guía ni en un chat.

Para pruebas con una app en modo desarrollo, usá un usuario con un rol habilitado en esa app y acceso a los activos publicitarios. Para otros usuarios, Meta puede exigir acceso avanzado, revisión de permisos o verificación del negocio: crear un token no evita esos requisitos.

## 2. Generá un token de usuario

1. Abrí [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Seleccioná **tu propia app**. El token, el App ID y el App Secret deben pertenecer a la misma app.
3. Elegí la opción para obtener un **token de acceso de usuario** (User Access Token), no uno de Página ni de usuario del sistema.
4. Solicitá los permisos `ads_management` y `ads_read`.
5. Generá el token, iniciá sesión con el usuario que administra tus anuncios y aceptá los permisos solicitados. Si Meta te permite elegir activos, incluí los que vas a usar.
6. Copiá el token sin espacios ni saltos de línea. Tratá ese valor como una contraseña.

Estos son los permisos base para el flujo publicitario documentado por OpenBulkAds. Algunas operaciones sobre Páginas, Instagram o formularios pueden requerir permisos o habilitaciones adicionales según el activo y la configuración de Meta. No agregues permisos indiscriminadamente: revisá el error concreto y los requisitos de esa operación.

## 3. Conectalo en OpenBulkAds

### Si estás en el asistente inicial

1. En **Conexión con Meta**, pegá el token de usuario y completá la conexión.
2. En el paso siguiente, ingresá el **App ID** y la **clave secreta** de la misma app y elegí tus cuentas publicitarias.
3. Una vez dentro del workspace, abrí **Configuración** y usá **Extender token actual** si conectaste el token antes de guardar las credenciales.

### Si ya terminaste la instalación

1. Abrí **Configuración** e ingresá el **App ID** y la **Clave secreta de la app**.
2. Presioná **Guardar clave**.
3. Abrí el diálogo **Conectá tu cuenta de Meta**, pegá el token en **Token de usuario** y presioná **Conectar y validar permisos**.

**Con las credenciales de la app ya configuradas, OpenBulkAds intenta canjear el token al conectarlo por uno de larga duración.** Si conectaste primero el token y después guardaste las credenciales, usá **Extender token** o **Extender token actual**.

El canje se hace desde el servidor. El token y la clave secreta se guardan cifrados; no necesitás construir una URL con secretos ni ejecutar comandos manuales.

## 4. Comprobá la conexión y el vencimiento

- Verificá que aparezcan las cuentas publicitarias esperadas y seleccioná las que vas a usar en el workspace.
- En el diálogo de conexión, presioná **Consultar vencimiento**. Esta acción requiere App ID y clave secreta configurados.
- Revisá las fechas de **Token** y **Acceso a datos**, cuando Meta las informe. OpenBulkAds usa la más próxima para mostrar el vencimiento.
- Confirmá que podés consultar la campaña o el conjunto de anuncios que necesitás antes de preparar una carga.

Que el token sea válido no garantiza acceso a todos los activos: también cuentan los permisos del usuario, la app y el negocio.

## 5. Qué hacer cuando está por vencer

**Extender no significa renovar para siempre.** Meta determina la duración y puede conservar la misma fecha después de un canje. OpenBulkAds informa si la fecha cambió o si Meta la mantuvo; no hay una renovación periódica garantizada en segundo plano.

1. Mientras siga válido, podés usar **Extender token** y volver a consultar las fechas.
2. Si Meta mantiene la fecha y necesitás recuperar vigencia, generá un nuevo token de usuario con la misma app y reconectalo.
3. Si ya venció o fue invalidado, generá uno nuevo siguiendo el paso 2 de esta guía. Un token vencido no sirve para pedir uno de larga duración.

La revocación de permisos o cambios de seguridad también pueden invalidarlo antes de la fecha indicada.

## Problemas frecuentes

| Qué ves | Qué revisar |
| --- | --- |
| `El token pertenece a otra app de Meta. Revisá el App ID.` | Volvé al Explorer y seleccioná la app cuyo App ID y clave guardaste en OpenBulkAds; generá un token de esa app. |
| `Usá un token de usuario para este flujo.` | Generá un User Access Token, no un token de Página ni de usuario del sistema. |
| `El token necesita ads_management.` | Volvé a generar el token y otorgá ese permiso. Incluí también `ads_read` para el flujo documentado. |
| No podés consultar o extender el token | Guardá el App ID y la clave secreta correctos; verificá que el token siga válido. |
| El canje conserva el mismo vencimiento | No implica una extensión fallida: Meta puede mantener la fecha. Generá un nuevo token cuando sea necesario. |
| No aparece una cuenta publicitaria, Página o Instagram | Revisá el acceso del usuario a ese activo, los permisos concedidos y las restricciones de la app o del negocio. |
| Token vencido o inválido | Generá uno nuevo y reconectá Meta; no intentes recuperar uno vencido con el botón de extensión. |

## Seguridad y videos

- No subas tokens ni App Secrets al repositorio, issues, chats o capturas.
- Al grabar, ocultá esos campos y evitá mostrar el token en Graph API Explorer o en herramientas de depuración. Usá una cuenta de prueba y revisá la grabación antes de publicarla.
- Si se filtra un token, revocalo en Meta y generá uno nuevo. Si se filtra el App Secret, restablecelo desde Meta y actualizalo en OpenBulkAds.
- **Desconectar y eliminar token** borra la conexión guardada en OpenBulkAds; no equivale a revocar el token en Meta.

## Referencias oficiales

- [Primeros pasos con Marketing API](https://developers.facebook.com/docs/marketing-api/get-started/).
- [Tokens de usuario de larga duración y sus límites](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/).
- [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
- [Depurador de tokens de acceso](https://developers.facebook.com/tools/debug/accesstoken/).
