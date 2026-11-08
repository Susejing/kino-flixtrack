# FlixTrack — Trakt y SIMKL para Kino

FlixTrack registra en tu historial de **Trakt** y de **SIMKL** las películas y episodios que terminas de ver en Kino, sin importar desde qué fuente (plugin) los estés reproduciendo.

## Qué hace

- **Tracking sin pensar**: cuando Kino marca algo como visto (quedan 3 minutos o menos y llevas el 90%), FlixTrack lo agrega a tu historial de Trakt y de SIMKL. Cada servicio va aislado: si uno falla, el otro sigue.
- **Pantalla propia**: en Inicio ▸ FlixTrack hay una tarjeta por cuenta con su estado y su botón de conectar.
- **Sin pegar nada**: Trakt conecta en la ventanita, con el código de activación ya escrito (auth.trakt.tv/activate/<código>): autorizas, tocas Listo y el plugin canjea los tokens solo. SIMKL autoriza en tu navegador: la tarjeta muestra el código y un botón que abre simkl.com/pin con el código listo; vuelves y tocas «Ya autoricé — comprobar». En cualquier caso el código queda en grande con su QR para autorizarlo desde otro aparato.
- **La identificación de verdad**: si una fuente no trae los identificadores (imdb/tmdb/tvdb), FlixTrack busca la película o serie por su título —con verificación: título normalizado igual y año a un año de distancia— y aprende el par «título → ids» para la próxima (hasta 300 pares, con 6 meses de vida). Si la búsqueda no calza, no inventa nada: el evento se omite.

## Instalar

En Kino: Ajustes ▸ Plugins ▸ Añadir plugin ▸ Susejing/kino-flixtrack

## Conectar tus cuentas

Nada de registrar apps: el plugin trae los **Client ID del autor de fábrica** (Trakt y SIMKL). Abre Inicio ▸ FlixTrack ▸ **Conectar**.

- **Trakt**: la ventanita se abre con el código listo; autorizas con usuario y contraseña, tocas Listo y queda conectado.
- **SIMKL**: su página no carga dentro de la ventanita de Kino, así que sale en tu navegador de verdad. Toca «Abrir en tu navegador» (Kino muestra su hojita de confirmación), autoriza el código en la página de SIMKL, vuelve a Kino y toca «Ya autoricé — comprobar».

¿Prefieres tus propias apps? Pega tus Client ID en Ajustes ▸ FlixTrack y los tuyos mandan (Trakt: trakt.tv/oauth/applications; SIMKL: simkl.com/settings/developer, app V2 tipo TV).

Las sesiones se guardan solo en tu aparato. Para cambiar de cuenta, cierra la sesión en la pantalla y vuelve a conectar.

## Notas honestas

- Los Client ID van de fábrica; si algún día dejaran de servir, puedes registrar tus propias apps y pegarlas en Ajustes ▸ FlixTrack.
- Inicia sesión con usuario y contraseña de cada servicio; los accesos con Google u otros botones de terceros quedan fuera de lo que el plugin abre.
- Lo que se registra es lo que Kino reporta como terminado; si un título no calza por nombre y año, no se registra (mejor omitir que registrar la cosa equivocada).

## Licencia

GPL-3.0. © 2026 Susejing.
