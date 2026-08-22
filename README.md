# Isaac Ranking

Ranking de jugadores de *The Binding of Isaac: Rebirth* (appid `250900`) por logros de Steam.
Sin login: cualquiera pega su nick y aparece.

## Cómo se ordena

1. **Cantidad de logros**, de mayor a menor.
2. **Rareza**, como desempate: entre dos que tienen la misma cantidad, gana el que tenga
   los logros que menos gente tiene.

La rareza de cada jugador es la suma de `log10(100 / % global)` de cada logro que tiene.
Con los porcentajes reales de Isaac (de 84,5% a 2,4%) eso da pesos de 0,07 a 1,62 por logro.
Se usa el logaritmo y no `1 - %` porque el rango está comprimido: no hay ningún logro
por debajo del 1%, así que la resta lineal casi no separa a nadie.

Los **641/641** empatan en cantidad y en rareza (tienen exactamente los mismos logros),
así que caen todos juntos en el puesto 1. Adentro de ese grupo se muestran ordenados
por quién lo cerró primero.

### Dead God no es lo mismo que 641/641

`Dead God` es un **logro de Steam de verdad** (apiname `637`, lo tiene el 3,4% de los
jugadores): lo da el juego al completar todas las marcas. Pero entre los 641 hay logros
que no son de completado, como `Win Online Daily` (2,4%), que pide ganar una daily
online. O sea que se puede ser Dead God sin tener los 641, y el sitio los muestra como
dos sellos separados: **dead god** (dorado) y **641/641** (rojo).

## De dónde salen los datos

No hace falta API key de Steam. Dos endpoints públicos alcanzan:

```bash
# logros de un jugador (nombre, descripción, ícono, si lo tiene, y cuándo lo sacó)
curl "https://steamcommunity.com/id/bisnap/stats/250900/?xml=1"

# % global de cada logro
curl "https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=250900"
```

El XML del jugador trae además `steamID64` y `customURL`, así que un mismo jugador cargado
por nick o por id termina en la misma fila.

Casos verificados contra respuestas reales (los XML están en `test/fixtures/`):

| caso | respuesta de Steam | qué hace el sitio |
|---|---|---|
| perfil público con logros | 641 logros, `closed` + `unlockTimestamp` | lo suma al ranking |
| perfil con Dead God | logro `637` en `closed="1"` | sello dorado + fecha en que lo sacó |
| perfil público sin logros | 641 logros, todos `closed="0"` | entra con 0/641, es válido |
| perfil privado | solo `<privacyState>private</privacyState>`, sin steamid64 | avisa y no guarda nada |
| vanity inexistente | `<response><error>` | avisa "no encontramos ese perfil" |
| steamid64 inventado | HTML de error, no XML | avisa "no encontramos ese perfil" |

## Arquitectura

```
web/            sitio estático (GitHub Pages), lee Supabase con la anon key
supabase/
  migrations/   esquema, scoring, RLS y los helpers de los jobs
  functions/
    add-players   alta manual, hasta 10 nicks por vez, rate limit por IP
    sync-global   cron diario: % globales + rescore de todos
    sync-players  cron: refresca por tanda (top diario, resto semanal)
test/           tests del parser contra XML real de Steam
```

Los logros de cada jugador se guardan como un **bitmask** de 641 bits (81 bytes por
jugador) en una columna `bit varying`. `unlocked_count`, `rarity_score` y `is_complete`
los deriva un trigger a partir del bitmask, así que nunca pueden quedar en desacuerdo.

El navegador no puede pegarle a `steamcommunity.com` (no manda headers CORS), por eso
todo el fetch pasa por las edge functions.

## Setup

**1. Supabase** (proyecto nuevo, free tier alcanza de sobra):

```bash
supabase link --project-ref TU_PROJECT_REF
supabase db push
```

**2. Edge functions:**

```bash
supabase functions deploy add-players --no-verify-jwt
supabase functions deploy sync-global
supabase functions deploy sync-players
supabase secrets set IP_SALT="algo-random-largo"
```

`add-players` va con `--no-verify-jwt` porque el sitio no tiene login.
Lo que la protege es el rate limit por IP, no un token.

**3. Sembrar el catálogo** (la primera corrida trae los 641 logros con nombre e ícono):

```bash
curl -X POST "https://TU_PROJECT_REF.supabase.co/functions/v1/sync-global" -H "Authorization: Bearer TU_SERVICE_ROLE_KEY"
```

**4. Cron:** copiar `supabase/migrations/0002_cron.sql.example` a un `.sql` sin el
`.example`, completar la service role key y correrlo en el SQL editor. El `.gitignore`
ya excluye `*cron*.sql` justamente para que esa copia no termine en el repo.

En PowerShell `curl` es un alias de `Invoke-WebRequest` y no acepta `-H`: para
cualquier comando de estos hay que escribir `curl.exe`.

**5. GitHub Pages:** en Settings > Pages poner source *GitHub Actions*, y en
Settings > Secrets and variables > Actions > Variables cargar `SUPABASE_URL` y
`SUPABASE_ANON_KEY`. El workflow escribe `web/config.js` en cada deploy.

Para probar local, copiar `web/config.example.js` a `web/config.js` y completar.
`config.js` está en el `.gitignore`: el repo no lleva ninguna credencial escrita.
Sin ese archivo el sitio arranca en modo demo en vez de romperse.

## Verlo andar sin desplegar nada

Con `web/config.js` sin tocar (los valores `TU_PROJECT_REF`), el sitio arranca en
**modo demo**: en vez de Supabase lee `web/demo.json` y muestra un cartel avisando.

```bash
node --experimental-strip-types --no-warnings test/demo.mts
python -m http.server 5173 --directory web
```

Y abrir <http://localhost:5173>.

`demo.mts` baja en vivo los perfiles reales que estén públicos y les agrega unos
sintéticos, marcados con el sello `demo`, para que se vea el desempate por rareza
con el ranking todavía vacío. El alta de jugadores no funciona en este modo: eso
sí necesita las edge functions.

## Tests

```bash
node --experimental-strip-types --no-warnings test/parse.test.mts
```

Corren offline contra los XML guardados en `test/fixtures/`. Requiere Node 22+.

Para consultar un perfil en vivo sin tocar Supabase (sirve para probar antes de
desplegar, o para revisar un caso raro):

```bash
node --experimental-strip-types --no-warnings test/perfil.mts 3ezee
```

```
steamid64 : 76561198079938482
logros    : 410/641
rareza    : 260.7 de 510.7 posibles
primero   : 2014-11-04
ultimo    : 2026-08-17

sus logros mas raros:
    5.6%  Dedication
    5.9%  Broken Modem
    8.9%  Apollyon Baby
```

## Números del free tier

| recurso | uso estimado | límite free |
|---|---|---|
| base de datos | ~100 bytes por jugador, 10.000 jugadores = ~1 MB | 500 MB |
| edge functions | 1 invocación por alta + 72 de cron por día | 500.000 / mes |
| egress | el ranking son unos pocos KB por visita | 5 GB / mes |

Cada consulta a Steam baja 320 KB, pero eso lo baja la edge function, no el visitante.

## Política de refresco

- **Dead God (641/641): congelado.** No se vuelve a consultar nunca, no puede subir más.
- **Top 50:** una vez por día, automático.
- **El resto:** una vez por semana, automático.
- **Manual:** el botón de agregar también refresca, con un tope de una vez por hora
  por jugador. Esa es la razón para volver al sitio.
- **Alta:** 30 por día por IP, 10 por request.

## Límites conocidos

- El nombre visible de Steam no es único ni resoluble. Hace falta la URL personalizada,
  el steamid64, o el link del perfil pegado. El sitio acepta las tres formas.
- Hay que tener **los detalles de juego en público**, no alcanza con el perfil público.
- Alguien que no tenga Repentance no puede llegar a 641 aunque haya hecho todo lo suyo:
  los logros del DLC están en el mismo appid y le quedan siempre en 0.
- El XML de la comunidad no es una API con contrato. Si Steam corta por volumen
  (`429`), las funciones frenan la tanda solas y siguen en la corrida siguiente.
