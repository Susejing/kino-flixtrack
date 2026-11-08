// FlixTrack — registra películas y series en Trakt y SIMKL desde Kino · github.com/Susejing/kino-flixtrack
// Copyright (C) 2026 Susejing
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// FlixTrack 0.2.2 — LOS CLIENT ID DEL AUTOR VAN DE FÁBRICA: nadie que
// instale esto tiene que registrar una app. El OAuth de Trakt usa el
// host nuevo auth.trakt.tv (lo exige su API en la era PKCE) y va sin
// client_secret, que Trakt ya no emite. Sin más cambios de lógica.
//
// FlixTrack 0.2.0 — SIN PEGAR NADA Y LA IDENTIFICACIÓN DE VERDAD.
// La modernización al nivel de AniTrack:
//
// 1) PANTALLA PROPIA (capability "screen", apiVersion 14). En Inicio ▸
//    FlixTrack hay una tarjeta por cuenta (Trakt y SIMKL) con su estado
//    y un solo botón. El método manual de Ajustes queda de respaldo.
//
// 2) LA VENTANITA (visualBrowser, apiVersion 20 vía enhancements).
//    Tocar «Conectar» pide el código de dispositivo (RFC 8628), abre la
//    página de activación CON EL CÓDIGO YA ESCRITO (trakt.tv/activate/
//    <código> y simkl.com/pin?user_code=<código>), la persona autoriza,
//    toca Listo y el plugin canjea los tokens solo. Sin copiar ni pegar.
//    Si el aparato no abre ventanitas, el código queda en grande en la
//    pantalla con su QR para autorizar desde cualquier lado.
//
// 3) LA IDENTIFICACIÓN DE VERDAD. Antes, un evento sin ids imdb/tmdb/tvdb
//    se omitía en silencio. Ahora: primero el MAPA QUE APRENDE (título
//    normalizado → ids, TTL de 6 meses, tope 300, como el de AniTrack),
//    y si no está, BÚSQUEDA por título en Trakt (o SIMKL si es lo único
//    configurado) con verificación honesta: título normalizado igual y
//    año a ±1. Solo entonces se registra y el par queda aprendido. Un
//    episodio sin ids busca la SERIE por su título y marca temporada y
//    número; una película se busca a sí misma. Si la búsqueda no calza,
//    no se inventa nada: el evento se omite (como siempre).

const VERSION = "0.2.2";
const UA = "FlixTrack/" + VERSION;

// Client ids del AUTOR, para que nadie más tenga que registrar una app.
// Van de fábrica desde la 0.2.2: si alguien pega el suyo en Ajustes ▸
// FlixTrack, el suyo manda (el ajuste gana al defecto).
const CLIENT_ID_TRAKT_DEFECTO = "_ZSfudWvGJa-tjp3PGVRurzoP7XFTUNGIksyfpDhW7I";
const CLIENT_ID_SIMKL_DEFECTO = "f40b1a5ca4ad817dd02b962dd5ec89a5984f967fc8438fdb799c3b321e0de1f3";

// ---------- helpers ----------

// Igual que en AniTrack: cuando el servidor rechaza, su respuesta viaja
// en el mensaje de error (el cuerpo dice la verdad).
async function fetchJson(url, options) {
  const r = await kino.fetch(url, options);
  if (!r.ok) {
    let detalle = "http " + r.status;
    try {
      const cuerpo = await r.text();
      if (cuerpo) detalle = detalle + " " + String(cuerpo).slice(0, 300);
    } catch (e2) { /* sin cuerpo legible */ }
    const e = new Error(detalle);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// Evita entregar dos veces el mismo evento (Kino reintenta; el id es la clave).
function yaEntregado(id) {
  try {
    let seen = kino.storage.get("seen");
    if (!Array.isArray(seen)) seen = [];
    if (seen.indexOf(id) >= 0) return true;
    seen.push(id);
    while (seen.length > 50) seen.shift();
    kino.storage.set("seen", seen, 2500000000);
  } catch (e) {
    kino.log("storage falló:", String(e));
    return false;
  }
  return false;
}

// El último resultado de cada servicio, para la línea de Conexión.
function guardarEstado(servicio, texto) {
  try { kino.storage.set(servicio + "Estado", texto, 2500000000); } catch (e) { /* cache */ }
}

// La misma normalización de AniTrack: minúsculas, sin acentos, solo
// letras y números, espacios colapsados. Así «Élite» calza con «elite».
function normTitulo(s) {
  const conA = "áàäâãéèëêíìïîóòöôõúùüûñç";
  const sinA = "aaaaaeeeeiiiiooooouuuunc";
  const t = String(s || "").toLowerCase();
  let out = "";
  for (let i = 0; i < t.length; i++) {
    const j = conA.indexOf(t[i]);
    out += j >= 0 ? sinA[j] : t[i];
  }
  return out.replace(/[^a-z0-9]+/g, " ").trim();
}

// Título calza solo si, normalizados, son iguales y no quedaron vacíos.
function calzaTitulo(fuente, resultado) {
  const a = normTitulo(fuente);
  const b = normTitulo(resultado);
  return a !== "" && a === b;
}

// Año calza si falta alguno o están a un año de distancia (fechas de
// estreno que se estiran entre diciembre y enero).
function calzaAnio(a, b) {
  if (!a || !b) return true;
  return Math.abs(Number(a) - Number(b)) <= 1;
}

function idsDeLista(o) {
  const limpio = {};
  if (o && o.imdb) limpio.imdb = String(o.imdb);
  if (o && o.tmdb) limpio.tmdb = Number(o.tmdb);
  if (o && o.tvdb) limpio.tvdb = Number(o.tvdb);
  return limpio;
}

function hayIds(o) {
  return !!(o && (o.imdb || o.tmdb || o.tvdb));
}

// ---------- Trakt: llaves y tokens ----------

function clientIdTrakt() {
  return String(kino.config.get("traktClientId") || CLIENT_ID_TRAKT_DEFECTO || "").trim();
}

function headersTrakt(token) {
  const h = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientIdTrakt()
  };
  if (token) h.Authorization = "Bearer " + token;
  return h;
}

// El access token de Trakt vence pronto: con el refresh token se renueva
// solo. El flujo de dispositivo no usa client_secret.
async function tokenTrakt() {
  await null;
  const guardado = kino.storage.get("traktAccessToken");
  if (guardado) return guardado;
  const refreshToken = kino.storage.get("traktRefreshToken");
  if (!refreshToken) {
    const e = new Error("sin conectar");
    e.status = "sin-conectar";
    throw e;
  }
  const r = await fetchJson("https://auth.trakt.tv/oauth/token", {
    method: "POST",
    headers: headersTrakt(),
    body: { json: {
      refresh_token: refreshToken,
      client_id: clientIdTrakt(),
      grant_type: "refresh_token",
      redirect_uri: "urn:ietf:wg:oauth:2.0:oob"
    } }
  });
  if (!r.access_token) throw new Error("Trakt no devolvió token");
  try {
    if (r.refresh_token) kino.storage.set("traktRefreshToken", r.refresh_token, 2500000000);
    kino.storage.set("traktAccessToken", r.access_token,
      Math.min(Math.max(Math.floor((r.expires_in || 604800) * 1000 / 2), 3600000), 2500000000));
  } catch (e2) { /* cache llena */ }
  return r.access_token;
}

// ---------- SIMKL: llaves y tokens ----------

function clientIdSimkl() {
  return String(kino.config.get("simklClientId") || CLIENT_ID_SIMKL_DEFECTO || "").trim();
}

// SIMKL pide tres parámetros en la URL de cada llamada más el User-Agent.
function paramsSimkl() {
  return "client_id=" + encodeURIComponent(clientIdSimkl()) +
    "&app-name=flixtrack&app-version=" + VERSION;
}

async function tokenSimkl() {
  await null;
  const guardado = kino.storage.get("simklAccessToken");
  if (guardado) return guardado;
  const refreshToken = kino.storage.get("simklRefreshToken");
  if (!refreshToken) {
    const e = new Error("sin conectar");
    e.status = "sin-conectar";
    throw e;
  }
  const r = await fetchJson("https://api.simkl.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: { form: {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientIdSimkl()
    } }
  });
  if (!r.access_token) throw new Error("SIMKL no devolvió token");
  try {
    if (r.refresh_token) kino.storage.set("simklRefreshToken", r.refresh_token, 2500000000);
    kino.storage.set("simklAccessToken", r.access_token,
      Math.min(Math.max(Math.floor((r.expires_in || 157680000) * 1000 / 2), 3600000), 2500000000));
  } catch (e2) { /* cache llena */ }
  return r.access_token;
}

// ---------- El mapa que aprende ----------

// Pares «tipo|título normalizado → ids», como el mapa de AniTrack: TTL de
// 6 meses, tope de 300 pares con poda de los más viejos. Se aprende de
// dos sitios: de los eventos que YA traen ids (para la próxima vez que
// la fuente no los traiga) y de las búsquedas verificadas por título.
function mapaLeer() {
  try {
    const m = kino.storage.get("mapaAprendido");
    return (m && typeof m === "object") ? m : {};
  } catch (e) { return {}; }
}

function mapaGuardar(m) {
  try { kino.storage.set("mapaAprendido", m, 15552000000); } catch (e) { /* almacén lleno */ }
}

function mapaAprender(tipo, titulo, anio, ids) {
  const q = normTitulo(titulo);
  if (!q || !hayIds(ids)) return false;
  const m = mapaLeer();
  m[tipo + "|" + q] = { ids: ids, anio: anio ? Number(anio) : null, ts: Date.now() };
  const llaves = Object.keys(m);
  if (llaves.length > 300) {
    llaves.sort(function (a, b) { return (m[a].ts || 0) - (m[b].ts || 0); });
    for (let i = 0; i < llaves.length - 300; i++) delete m[llaves[i]];
  }
  mapaGuardar(m);
  kino.log("flixtrack: aprendí «" + String(titulo).slice(0, 40) + "» (" + tipo + ", mapa: " + Object.keys(m).length + ")");
  return true;
}

function mapaConsultar(tipo, titulo, anio) {
  const q = normTitulo(titulo);
  if (!q) return null;
  const m = mapaLeer();
  const e = m[tipo + "|" + q];
  if (!e || !hayIds(e.ids)) return null;
  const edad = Date.now() - (e.ts || 0);
  if (edad > 15552000000) return null;          // TTL: 6 meses
  if (e.anio && anio && Math.abs(Number(e.anio) - Number(anio)) > 1) return null;  // remake: no es la misma
  return e.ids;
}

// ---------- La identificación por título ----------

// Los resultados de Trakt traen { movie|show: { title, year, ids } }; los
// de SIMKL traen el título y los ids arriba. Este extractor tolera ambos.
function tituloDeResultado(x, tipo) {
  const n = (x && (x[tipo] || x)) || {};
  return String(n.title || n.name || "");
}

function anioDeResultado(x, tipo) {
  const n = (x && (x[tipo] || x)) || {};
  return n.year ? Number(n.year) : null;
}

function idsDeResultado(x, tipo) {
  const n = (x && (x[tipo] || x)) || {};
  return idsDeLista(n.ids || {});
}

// Busca y VERIFICA. Devuelve los ids solo si algún candidato calza por
// título normalizado y año a ±1; si calza, el par queda aprendido.
async function identificar(tipo, titulo, anio) {
  if (!normTitulo(titulo)) return null;

  // 1) El mapa primero (lo aprendido resuelve sin tocar la red).
  const delMapa = mapaConsultar(tipo, titulo, anio);
  if (delMapa) {
    kino.log("flixtrack: «" + String(titulo).slice(0, 40) + "» salió del mapa aprendido");
    return delMapa;
  }

  // 2) Búsqueda en Trakt (solo necesita el client_id, sin sesión).
  let lista = null;
  if (clientIdTrakt()) {
    try {
      lista = await fetchJson(
        "https://api.trakt.tv/search/" + tipo + "?query=" + encodeURIComponent(String(titulo).slice(0, 200)) + "&limit=10",
        { headers: headersTrakt() });
    } catch (e) { lista = null; }
    if (lista && lista.length) {
      for (let i = 0; i < lista.length; i++) {
        if (calzaTitulo(titulo, tituloDeResultado(lista[i], tipo)) &&
            calzaAnio(anio, anioDeResultado(lista[i], tipo))) {
          const ids = idsDeResultado(lista[i], tipo);
          if (hayIds(ids)) {
            mapaAprender(tipo, titulo, anio, ids);
            return ids;
          }
        }
      }
    }
  }

  // 3) Respaldo: búsqueda en SIMKL. Las apps V2 nuevas piden token de
  // usuario en cada llamada: con sesión va con Bearer; sin sesión se
  // intenta igual y si la app no lo permite, simplemente no hay lista.
  if (clientIdSimkl()) {
    try {
      const cabSimkl = { "User-Agent": UA };
      try { cabSimkl.Authorization = "Bearer " + await tokenSimkl(); } catch (e3) { /* sin sesión */ }
      lista = await fetchJson(
        "https://api.simkl.com/search?q=" + encodeURIComponent(String(titulo).slice(0, 200)) +
          "&type=" + (tipo === "movie" ? "movie" : "tv") + "&" + paramsSimkl(),
        { headers: cabSimkl });
    } catch (e) { lista = null; }
    if (lista && lista.length) {
      const tipoSimkl = tipo === "movie" ? "movie" : "tv";
      for (let i = 0; i < lista.length; i++) {
        if (calzaTitulo(titulo, tituloDeResultado(lista[i], tipoSimkl)) &&
            calzaAnio(anio, anioDeResultado(lista[i], tipoSimkl))) {
          const ids = idsDeResultado(lista[i], tipoSimkl);
          if (hayIds(ids)) {
            mapaAprender(tipo, titulo, anio, ids);
            return ids;
          }
        }
      }
    }
  }

  return null;   // honesto: sin calza no se registra nada
}

// ---------- El evento → el payload (con ids de verdad) ----------

// Los ids que el evento ya trae se aprenden también: si la próxima fuente
// no los trae, saldrán del mapa sin buscar nada.
function aprenderDeEvento(event) {
  try {
    if (event.kind === "movie" && event.title && hayIds(idsDeLista(event.ids))) {
      mapaAprender("movie", event.title, event.year, idsDeLista(event.ids));
    }
    if (event.kind === "episode" && event.show && event.show.title && hayIds(idsDeLista(event.show.ids))) {
      mapaAprender("show", event.show.title, event.show.year, idsDeLista(event.show.ids));
    }
  } catch (e) { /* aprender es un lujo, nunca un error */ }
}

// Película → movies[]; episodio → shows[] con temporada y número. Sin
// ids a mano, se identifica por título (mapa → búsqueda → aprender).
async function resolverPayload(event) {
  if (event.kind === "movie") {
    let ids = idsDeLista(event.ids || {});
    if (!hayIds(ids)) {
      ids = await identificar("movie", String(event.title || ""), event.year || null);
      if (!ids) return null;
    }
    aprenderDeEvento(event);
    return { movies: [{ ids: ids }] };
  }
  // episodio: sin temporada y número no hay nada que marcar.
  if (!event.season || !event.episode) { aprenderDeEvento(event); return null; }
  let showIds = idsDeLista((event.show && event.show.ids) || {});
  if (!hayIds(showIds)) {
    showIds = await identificar("show", String((event.show && event.show.title) || ""), (event.show && event.show.year) || null);
    if (!showIds) return null;
  }
  aprenderDeEvento(event);
  return { shows: [{
    ids: showIds,
    seasons: [{ number: Number(event.season), episodes: [{ number: Number(event.episode) }] }]
  }] };
}

// ---------- Historial en cada servicio ----------

// Historial de Trakt. Un rechazo 401 renueva el token y reintenta una vez.
async function enTrakt(payload) {
  await null;
  const enviar = async (token) => kino.fetch("https://api.trakt.tv/sync/history", {
    method: "POST",
    headers: headersTrakt(token),
    body: { json: payload }
  });
  let r = await enviar(await tokenTrakt());
  if (r.status === 401) {
    kino.storage.remove("traktAccessToken");
    r = await enviar(await tokenTrakt());
  }
  if (!r.ok) {
    let detalle = "";
    try { detalle = (r.text() || "").slice(0, 80); } catch (e2) { /* sin cuerpo */ }
    const e = new Error("Trakt respondió " + r.status + " " + detalle);
    e.status = "lista " + r.status + " " + detalle.slice(0, 40);
    throw e;
  }
}

// Historial de SIMKL (V2): misma forma de payload que Trakt.
async function enSimkl(payload) {
  await null;
  const enviar = async (token) => kino.fetch("https://api.simkl.com/sync/history?" + paramsSimkl(), {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", "User-Agent": UA },
    body: { json: payload }
  });
  let r = await enviar(await tokenSimkl());
  if (r.status === 401) {
    kino.storage.remove("simklAccessToken");
    r = await enviar(await tokenSimkl());
  }
  if (!r.ok) {
    let detalle = "";
    try { detalle = (r.text() || "").slice(0, 80); } catch (e2) { /* sin cuerpo */ }
    const e = new Error("SIMKL respondió " + r.status + " " + detalle);
    e.status = "lista " + r.status + " " + detalle.slice(0, 40);
    throw e;
  }
}

// ---------- El flujo de dispositivo (RFC 8628), por servicio ----------

// Cada servicio declara sus formas: cómo pide el código, cómo lo canjea,
// cuándo un rechazo significa «aún pendiente» y cómo se llama la cuenta.
const SERV = {
  trakt: {
    nombre: "Trakt",
    tieneSesion: function () { return !!kino.storage.get("traktRefreshToken"); },
    pedirCodigo: function (cli) {
      return fetchJson("https://auth.trakt.tv/oauth/device/code", {
        method: "POST", headers: headersTrakt(), body: { json: { client_id: cli } }
      });
    },
    // La página de activación de Trakt acepta el código en la ruta:
    // auth.trakt.tv/activate/5055CC52 lo deja ya escrito.
    urlActivacion: function (d) {
      const base = String((d && d.verification_url) || "https://auth.trakt.tv/activate").replace(/\/+$/, "");
      return (d && d.user_code) ? base + "/" + d.user_code : base;
    },
    canjear: function (cli, code) {
      return fetchJson("https://auth.trakt.tv/oauth/device/token", {
        method: "POST", headers: headersTrakt(), body: { json: { code: code, client_id: cli } }
      });
    },
    pendiente: function (e) { return e && (e.status === 400 || e.status === 418 || e.status === 429); },
    expirado: function (e) { return e && (e.status === 404 || e.status === 410); },
    guardarTokens: function (r) {
      try {
        if (r.refresh_token) kino.storage.set("traktRefreshToken", r.refresh_token, 2500000000);
        kino.storage.set("traktAccessToken", r.access_token,
          Math.min(Math.max(Math.floor((r.expires_in || 604800) * 1000 / 2), 3600000), 2500000000));
      } catch (e2) { /* cache llena */ }
    },
    miNombre: async function () {
      const r = await fetchJson("https://api.trakt.tv/users/settings", { headers: headersTrakt(await tokenTrakt()) });
      return String((r && r.user && (r.user.name || (r.user.ids && r.user.ids.slug))) || "tu usuario");
    }
  },
  simkl: {
    nombre: "SIMKL",
    tieneSesion: function () { return !!kino.storage.get("simklRefreshToken"); },
    pedirCodigo: function (cli) {
      return fetchJson("https://api.simkl.com/oauth2/device", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: { form: { client_id: cli, scope: "media:read media:write" } }
      });
    },
    // SIMKL entrega la URL completa con el código prellenado.
    urlActivacion: function (d) {
      return String((d && (d.verification_uri_complete || d.verification_uri)) || "https://simkl.com/pin");
    },
    canjear: function (cli, code) {
      return fetchJson("https://api.simkl.com/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: { form: {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: code,
          client_id: cli
        } }
      });
    },
    pendiente: function (e) { return e && (e.status === 400 || e.status === 428); },
    expirado: function (e) {
      return e && (e.status === 404 || e.status === 410 || String(e.message || "").indexOf("expired") >= 0);
    },
    guardarTokens: function (r) {
      try {
        if (r.refresh_token) kino.storage.set("simklRefreshToken", r.refresh_token, 2500000000);
        kino.storage.set("simklAccessToken", r.access_token,
          Math.min(Math.max(Math.floor((r.expires_in || 157680000) * 1000 / 2), 3600000), 2500000000));
      } catch (e2) { /* cache llena */ }
    },
    miNombre: async function () {
      const r = await fetchJson("https://api.simkl.com/users/settings?" + paramsSimkl(), {
        headers: { Authorization: "Bearer " + await tokenSimkl(), "User-Agent": UA }
      });
      return String((r && r.user && (r.user.name || r.user.account)) || "tu usuario");
    }
  }
};

function clientIdDe(serv) {
  return serv === "trakt" ? clientIdTrakt() : clientIdSimkl();
}

// El flujo que ya corría en Ajustes, ahora también desde la pantalla:
// con sesión → prueba; con código pendiente → canjea; si no → pide código.
async function flujoDispositivo(serv) {
  const s = SERV[serv];
  const cli = clientIdDe(serv);
  if (!cli) {
    return { estado: "falta-id", mensaje: "Falta el Client ID de " + s.nombre + ": pégalo en Ajustes ▸ FlixTrack (de " + (serv === "trakt" ? "trakt.tv/oauth/applications" : "tu app V2 en simkl.com/settings/developer") + ") y guarda primero." };
  }

  // Ya conectado: probar con el usuario real.
  if (s.tieneSesion()) {
    try {
      const nombre = await s.miNombre();
      try { kino.storage.set(serv + "Nombre", nombre, 2500000000); } catch (e2) { /* cache */ }
      guardarEstado(serv, "ok");
      return { estado: "ok", nombre: nombre, mensaje: "✓ Conectado a " + s.nombre + " como: " + nombre };
    } catch (e) {
      try { kino.storage.remove(serv + "AccessToken"); kino.storage.remove(serv + "RefreshToken"); } catch (e2) { }
      return { estado: "fallo", mensaje: "La conexión no funcionó (" + String((e && (e.status || e.message)) || "sin detalle").slice(0, 70) + "). Toca de nuevo para empezar de cero." };
    }
  }

  // Flujo en curso: preguntar si ya aprobó.
  const pend = pendienteDe(serv);
  if (pend && pend.code) {
    try {
      const r = await s.canjear(cli, pend.code);
      const nombre = await trasConectar(serv, s, r);
      return { estado: "ok", nombre: nombre, mensaje: "✓ Conectado a " + s.nombre + " como: " + nombre };
    } catch (e) {
      if (s.pendiente(e)) {
        return { estado: "pendiente", userCode: pend.userCode, url: pend.url,
          mensaje: "Aún pendiente: autoriza en " + s.nombre + " (código " + (pend.userCode || "?") + ") y vuelve a tocar." };
      }
      try { kino.storage.remove(serv + "Device"); } catch (e2) { }
      if (s.expirado(e)) {
        return { estado: "fallo", mensaje: "El código de " + s.nombre + " venció: toca de nuevo para pedir otro." };
      }
    }
  }

  // Empezar el flujo: pedir el código de dispositivo.
  try {
    const d = await s.pedirCodigo(cli);
    if (!d || !d.device_code) return { estado: "fallo", mensaje: s.nombre + " no entregó código: revisa el Client ID." };
    const url = s.urlActivacion(d);
    try { kino.storage.set(serv + "Device", { code: d.device_code, userCode: d.user_code, url: url }, (d.expires_in || 600) * 1000); } catch (e2) { }
    return { estado: "codigo", userCode: d.user_code, url: url, mensaje: "" };
  } catch (e) {
    return { estado: "fallo", mensaje: s.nombre + " rechazó la solicitud: " + String((e && (e.status || e.message)) || e).slice(0, 120) };
  }
}

function pendienteDe(serv) {
  try { return kino.storage.get(serv + "Device") || null; } catch (e) { return null; }
}

// Canje aceptado: guardar tokens, limpiar el pendiente, preguntar nombre.
async function trasConectar(serv, s, r) {
  if (!r || !r.access_token) throw new Error("sin token");
  s.guardarTokens(r);
  try { kino.storage.remove(serv + "Device"); } catch (e2) { }
  guardarEstado(serv, "ok");
  let nombre = "tu usuario";
  try { nombre = await s.miNombre(); } catch (e) { /* el token sirve igual */ }
  try { kino.storage.set(serv + "Nombre", nombre, 2500000000); } catch (e2) { /* cache */ }
  return nombre;
}

// Encuesta al endpoint de canje: hasta N intentos separados por el
// intervalo del RFC (5 s). Devuelve ok o pendiente; nunca inventa.
async function encuestaDispositivo(serv, intentos) {
  const s = SERV[serv];
  const pend = pendienteDe(serv);
  if (!pend || !pend.code) return { estado: "fallo", mensaje: "No quedó código pendiente: toca de nuevo." };
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await s.canjear(clientIdDe(serv), pend.code);
      const nombre = await trasConectar(serv, s, r);
      return { estado: "ok", nombre: nombre, mensaje: "✓ Conectado a " + s.nombre + " como: " + nombre };
    } catch (e) {
      if (s.pendiente(e)) {
        if (i < intentos - 1) { try { await kino.sleep(5000); } catch (e3) { /* sin sleep */ } }
        continue;
      }
      try { kino.storage.remove(serv + "Device"); } catch (e2) { }
      if (s.expirado(e)) return { estado: "fallo", mensaje: "El código de " + s.nombre + " venció: toca de nuevo para pedir otro." };
      return { estado: "fallo", mensaje: s.nombre + " rechazó el canje (" + String((e && (e.status || e.message)) || "sin detalle").slice(0, 80) + "): quedó sin sesión." };
    }
  }
  return { estado: "pendiente", userCode: pend.userCode, url: pend.url,
    mensaje: "Aún pendiente: termina de autorizar en " + s.nombre + " (código " + (pend.userCode || "?") + ") y vuelve a tocar para comprobar." };
}

// Conectar con la VENTANITA: pedir código → abrir la página con el código
// ya prellenado → canjear al cerrarse. Solo desde el toque de la persona.
async function conectarConVentana(serv) {
  const s = SERV[serv];
  const r = await flujoDispositivo(serv);
  if (r.estado !== "codigo") return r;   // ok, pendiente, fallo o falta-id ya traen mensaje

  if (!kino.visualBrowser || !kino.visualBrowser.available) {
    return { estado: "sin-ventana", userCode: r.userCode, url: r.url,
      mensaje: "Este aparato no abre la ventanita: abre " + r.url + " en cualquier navegador, autoriza con el código " + (r.userCode || "?") + " y vuelve a tocar para comprobar." };
  }
  let w = null;
  try {
    w = await kino.visualBrowser.open({
      url: r.url,
      title: s.nombre,
      timeoutMs: 600000,
      userAgent: "browser"
    });
  } catch (e) {
    return { estado: "sin-ventana", userCode: r.userCode, url: r.url,
      mensaje: "La ventanita no se pudo abrir (" + String((e && e.code) || "fallo") + "): abre " + r.url + " en cualquier navegador y vuelve a tocar para comprobar." };
  }
  // La persona tocó Listo (o la ventana esperó y se cerró): a canjear.
  const intentos = (w && w.status === "closed") ? 1 : 2;
  const res = await encuestaDispositivo(serv, intentos);
  if (res.estado === "pendiente" && w && w.status === "timeout") {
    res.mensaje = "La ventanita esperó 10 minutos y se cerró: si ya autorizaste, toca de nuevo para comprobar.";
  }
  return res;
}

// Volver a abrir la ventanita con el código que ya está pendiente (o
// empezar de cero si ya no hay pendiente).
async function abrirVentanaServ(serv) {
  const s = SERV[serv];
  const pend = pendienteDe(serv);
  if (!pend || !pend.code || s.tieneSesion()) return conectarConVentana(serv);
  if (!kino.visualBrowser || !kino.visualBrowser.available) {
    return { estado: "sin-ventana", userCode: pend.userCode, url: pend.url,
      mensaje: "Este aparato no abre la ventanita: abre " + pend.url + " en cualquier navegador, autoriza con el código " + (pend.userCode || "?") + " y vuelve a tocar para comprobar." };
  }
  let w = null;
  try {
    w = await kino.visualBrowser.open({ url: pend.url, title: s.nombre, timeoutMs: 600000, userAgent: "browser" });
  } catch (e) {
    return { estado: "sin-ventana", userCode: pend.userCode, url: pend.url,
      mensaje: "La ventanita no se pudo abrir (" + String((e && e.code) || "fallo") + "): abre " + pend.url + " en cualquier navegador y vuelve a tocar para comprobar." };
  }
  const intentos = (w && w.status === "closed") ? 1 : 2;
  return encuestaDispositivo(serv, intentos);
}

function borrarSesion(serv) {
  const claves = ["AccessToken", "RefreshToken", "Nombre", "Estado", "Device"];
  for (let i = 0; i < claves.length; i++) {
    try { kino.storage.remove(serv + claves[i]); } catch (e) { /* cache */ }
  }
}

// ---------- track (la capability "tracking") ----------

// Solo se actúa en "watched": el episodio o película terminado (se dispara
// una sola vez, con 3 minutos o menos y al menos 90% visto). Cada servicio
// va aislado en su propio try: si uno falla, el otro sigue.
export async function track(event) {
  await null;
  if (event.type !== "watched") return { ok: true };
  if (yaEntregado(event.id)) return { ok: true };

  let payload = null;
  try {
    payload = await resolverPayload(event);
  } catch (e) {
    kino.log("identificar falló (" + String((e && (e.status || e.message)) || e).slice(0, 60) + "):", String(event.title || ""));
    return { ok: true };
  }
  if (!payload) {
    kino.log("sin ids y el título no calzó, omitido:", String(event.title || (event.show && event.show.title) || ""));
    return { ok: true };
  }

  if (clientIdTrakt() && kino.storage.get("traktRefreshToken")) {
    try {
      await enTrakt(payload);
      guardarEstado("trakt", "ok");
      kino.log("trakt: historial actualizado ✓");
    } catch (e) {
      const porque = String((e && (e.status || e.code || e.message)) || "").slice(0, 60);
      guardarEstado("trakt", "error " + porque);
      kino.log("trakt falló:", porque);
    }
  }

  if (clientIdSimkl() && kino.storage.get("simklRefreshToken")) {
    try {
      await enSimkl(payload);
      guardarEstado("simkl", "ok");
      kino.log("simkl: historial actualizado ✓");
    } catch (e) {
      const porque = String((e && (e.status || e.code || e.message)) || "").slice(0, 60);
      guardarEstado("simkl", "error " + porque);
      kino.log("simkl falló:", porque);
    }
  }

  return { ok: true };
}

// La línea "Conexión" de Ajustes: estado de cada servicio y, si falló el
// último envío, el motivo exacto.
export async function settingsStatus() {
  await null;
  const linea = function (serv, etiqueta) {
    const estado = kino.storage.get(serv + "Estado");
    if (estado && String(estado).indexOf("error") === 0) return etiqueta + " ⚠ " + String(estado).slice(6, 45);
    if (SERV[serv].tieneSesion()) return etiqueta + " ✓";
    if (clientIdDe(serv)) return etiqueta + " · toca Conectar";
    return etiqueta + " · falta Client ID";
  };
  return { estado: linea("trakt", "Trakt") + "  ·  " + linea("simkl", "SIMKL") };
}

// Los botones de Ajustes: conectar (o probar) cada cuenta. También abren
// la ventanita — desde Ajustes vale igual que desde la pantalla.
export async function action(key) {
  await null;
  if (key === "conectarTrakt") { const r = await conectarConVentana("trakt"); return { message: r.mensaje }; }
  if (key === "conectarSimkl") { const r = await conectarConVentana("simkl"); return { message: r.mensaje }; }
  return null;
}

// ---------- La pantalla propia (capability "screen") ----------

// La estructura es la de AniTrack: un Scaffold con la barra fusionada y
// una tarjeta por cuenta. La tarjeta de código en GRANDE solo aparece
// mientras hay un flujo pendiente; el QR sirve para autorizar desde otro
// aparato (o desde la TV, escaneando).
export async function screen(arg) {
  const state = (arg && arg.state) || arg || {};
  let traktNombre = "";
  let simklNombre = "";
  let traktPend = null;
  let simklPend = null;
  try { traktNombre = String(kino.storage.get("traktNombre") || ""); } catch (e) { traktNombre = ""; }
  try { simklNombre = String(kino.storage.get("simklNombre") || ""); } catch (e) { simklNombre = ""; }
  const traktSesion = SERV.trakt.tieneSesion() || (state.traktNombre ? true : false);
  const simklSesion = SERV.simkl.tieneSesion() || (state.simklNombre ? true : false);
  try { traktPend = pendienteDe("trakt"); } catch (e) { traktPend = null; }
  try { simklPend = pendienteDe("simkl"); } catch (e) { simklPend = null; }

  const tarjeta = function (titulo, sesion, nombreCuenta, loginEvent, logoutEvent) {
    return { type: "Card", padding: 16, gap: 8, children: [
      { type: "Text", text: titulo, textEn: titulo, style: "h4" },
      { type: "Text",
        text: sesion ? "✓ sesión como " + (nombreCuenta || "tu usuario") : "— sin conectar todavía",
        textEn: sesion ? "✓ signed in as " + (nombreCuenta || "your user") : "— not connected yet",
        style: "p", color: sesion ? "primary" : "muted" }
    ].concat(sesion ? [{ type: "TextButton", icon: "delete",
        labelText: "Cerrar sesión", labelTextEn: "Sign out",
        confirm: "¿Cerrar la sesión de " + titulo + " en este aparato?",
        confirmEn: "Sign out of " + titulo + " on this device?",
        onPressed: logoutEvent }] : [{ type: "ElevatedButton", icon: "person", fill: true,
        labelText: "Conectar " + titulo, labelTextEn: "Connect " + titulo,
        onPressed: loginEvent }]) };
  };

  const tarjetaPend = function (titulo, pend, checkEvent, ventanaEvent) {
    return { type: "Card", key: "pend" + titulo, padding: 16, gap: 8, children: [
      { type: "Text", text: "Código de " + titulo, textEn: titulo + " code", style: "caption", color: "muted" },
      { type: "Text", text: String((pend && pend.userCode) || "?"), textEn: String((pend && pend.userCode) || "?"), style: "h1", bold: true },
      { type: "Text",
        text: "Si la ventanita no salió, ábrelo en cualquier navegador y autoriza:",
        textEn: "If the window did not open, visit this in any browser and allow:",
        style: "caption", color: "muted" },
      { type: "Text", text: String((pend && pend.url) || ""), textEn: String((pend && pend.url) || ""), style: "caption" },
      { type: "QrImage", value: String((pend && pend.url) || "https://trakt.tv"), size: "medium" },
      { type: "ElevatedButton", icon: "check", fill: true,
        labelText: "Ya autoricé — comprobar", labelTextEn: "I allowed it — check",
        onPressed: checkEvent },
      { type: "TextButton", icon: "refresh",
        labelText: "Abrir la ventanita de nuevo", labelTextEn: "Open the window again",
        onPressed: ventanaEvent },
      { type: "Text",
        text: "El código vale unos minutos; si vence, «Conectar» pide otro.",
        textEn: "The code lasts a few minutes; if it expires, Connect asks for another.",
        style: "caption", color: "muted" }
    ] };
  };

  const children = [
    { type: "Text", text: "Tus cuentas", textEn: "Your accounts", style: "h3" },
    { type: "Text",
      text: "Conectas tocando una vez: la ventanita se abre con el código ya escrito, autorizas, tocas Listo y listo. Nada de copiar ni pegar.",
      textEn: "Connect with one tap: the window opens with the code typed in, you allow it, tap Done and done. No copying, no pasting.",
      style: "p", color: "muted" },
    tarjeta("Trakt", traktSesion, traktNombre, "conectarTrakt", "traktLogout")
  ];
  if (traktPend && traktPend.userCode && !traktSesion) {
    children.push(tarjetaPend("Trakt", traktPend, "conectarTrakt", "ventanaTrakt"));
  }
  children.push(tarjeta("SIMKL", simklSesion, simklNombre, "conectarSimkl", "simklLogout"));
  if (simklPend && simklPend.userCode && !simklSesion) {
    children.push(tarjetaPend("SIMKL", simklPend, "conectarSimkl", "ventanaSimkl"));
  }
  children.push({ type: "Divider" });
  children.push({ type: "Text",
    text: "Lo que termines de ver en Kino se registra solo en Trakt y SIMKL, venga de la fuente que venga. Si una fuente no trae identificadores, FlixTrack busca la película o serie por su título y aprende el par para la próxima.",
    textEn: "What you finish watching in Kino is logged in Trakt and SIMKL automatically, whatever the source. If a source brings no ids, FlixTrack searches the movie or show by title and learns the pair for next time.",
    style: "caption", color: "muted" });
  children.push({ type: "Text",
    text: "¿No abre la ventanita? El método manual de siempre sigue en Ajustes ▸ FlixTrack.",
    textEn: "No window? The manual method is still in Settings ▸ FlixTrack.",
    style: "caption", color: "muted" });

  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar", mergeWithKinoBar: true,
      title: "FlixTrack", titleEn: "FlixTrack",
      leading: { type: "IconButton", icon: "close", labelText: "Cerrar", labelTextEn: "Close", onPressed: { close: true } }
    },
    body: { type: "SingleChildScrollView", children: [{ type: "Column", padding: 16, gap: 16, crossAxisAlignment: "start", children: children }] }
  };
}

// Los eventos de la pantalla. «open» rellena el nombre de la cuenta si
// falta (como AniTrack); los demás conectan, comprueban o cierran sesión.
export async function screenEvent(ev) {
  const nombre = String((ev && ev.name) || "");
  const state = (ev && ev.state) || {};

  if (nombre === "open") {
    const salida = {};
    for (let i = 0; i < 2; i++) {
      const serv = i === 0 ? "trakt" : "simkl";
      if (SERV[serv].tieneSesion()) {
        let nom = "";
        try { nom = String(kino.storage.get(serv + "Nombre") || ""); } catch (e2) { nom = ""; }
        if (!nom) {
          try {
            nom = await SERV[serv].miNombre();
            try { kino.storage.set(serv + "Nombre", nom, 2500000000); } catch (e3) { /* cache */ }
          } catch (e2) { nom = "tu usuario"; }
        }
        salida[serv + "Nombre"] = nom;
      } else {
        salida[serv + "Nombre"] = "";
      }
    }
    return { state: salida };
  }

  const responder = function (r, serv) {
    if (r.estado === "ok") {
      const parche = {};
      parche[serv + "Nombre"] = r.nombre || "tu usuario";
      parche[serv + "Pend"] = null;
      return { state: parche, toast: r.mensaje };
    }
    if (r.estado === "pendiente" || r.estado === "codigo" || r.estado === "sin-ventana") {
      const parche = {};
      parche[serv + "Pend"] = { userCode: r.userCode, url: r.url };
      const resp = { state: parche };
      if (r.mensaje) resp.toast = r.mensaje;
      return resp;
    }
    return { toast: r.mensaje };
  };

  if (nombre === "conectarTrakt") return responder(await conectarConVentana("trakt"), "trakt");
  if (nombre === "ventanaTrakt") return responder(await abrirVentanaServ("trakt"), "trakt");
  if (nombre === "conectarSimkl") return responder(await conectarConVentana("simkl"), "simkl");
  if (nombre === "ventanaSimkl") return responder(await abrirVentanaServ("simkl"), "simkl");

  if (nombre === "traktLogout") {
    borrarSesion("trakt");
    return { state: { traktNombre: "", traktPend: null },
      toast: "Sesión de Trakt cerrada en este aparato",
      toastEn: "Trakt session closed on this device" };
  }
  if (nombre === "simklLogout") {
    borrarSesion("simkl");
    return { state: { simklNombre: "", simklPend: null },
      toast: "Sesión de SIMKL cerrada en este aparato",
      toastEn: "SIMKL session closed on this device" };
  }

  return null;
}
