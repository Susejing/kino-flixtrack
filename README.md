# FlixTrack — Trakt y SIMKL para Kino

FlixTrack registra en tu historial de **Trakt** y de **SIMKL** las películas y episodios que terminas de ver en Kino, sin importar desde qué fuente (plugin) los estés reproduciendo.

## Qué hace

- **Tracking sin pensar**: cuando Kino marca algo como visto (quedan 3 minutos o menos y llevas el 90%), FlixTrack lo agrega a tu historial de Trakt y de SIMKL. Cada servicio va aislado: si uno falla, el otro sigue.
- **Pantalla propia**: en Inicio ▸ FlixTrack hay una tarjeta por cuenta con su estado. Conectar es tocar una vez.
- **Sin pegar nada**: la ventanita se abre con el código de activación ya escrito (auth.trakt.tv/activate/<código> o simkl.com/pin?user_code=<código>); autorizas, tocas Listo y el plugin canjea los tokens solo. Si tu aparato no abre ventanitas, el código queda en grande con su QR para autorizarlo desde cualquier navegador.
- **La identificación de verdad**: si una fuente no trae los identificadores (imdb/tmdb/tvdb), FlixTrack busca la película o serie por su título —con verificación: título normalizado igual y año a un año de distancia— y aprende el par «título → ids» para la próxima (hasta 300 pares, con 6 meses de vida). Si la búsqueda no calza, no inventa nada: el evento se omite.

## Instalar

En Kino: Ajustes ▸ Plugins ▸ Añadir plugin ▸ Susejing/kino-flixtrack

## Conectar tus cuentas

Nada de registrar apps: desde la 0.2.2 el plugin trae los **Client ID del autor de fábrica** (Trakt y SIMKL). Solo abre Inicio ▸ FlixTrack ▸ **Conectar**: la ventanita se abre con el código listo, autorizas y tocas Listo.

¿Prefieres tus propias apps? Pega tus Client ID en Ajustes ▸ FlixTrack y los tuyos mandan (Trakt: trakt.tv/oauth/applications; SIMKL: simkl.com/settings/developer, app V2 tipo TV).

Las sesiones se guardan solo en tu aparato. Para cambiar de cuenta, cierra la sesión en la pantalla y vuelve a conectar.

## Notas honestas

- Los Client ID van de fábrica; si algún día dejaran de servir, puedes registrar tus propias apps y pegarlas en Ajustes ▸ FlixTrack.
- En la ventanita, inicia sesión con usuario y contraseña de cada servicio; los accesos con Google u otros botones de terceros quedan fuera de las páginas que el plugin puede abrir.
- Lo que se registra es lo que Kino reporta como terminado; si un título no calza por nombre y año, no se registra (mejor omitir que registrar la cosa equivocada).

## Licencia

GPL-3.0. © 2026 Susejing.
