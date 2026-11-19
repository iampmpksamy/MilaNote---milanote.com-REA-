# Map cards

A map card shows a place: a small map with a pin, the place's name (for example
"Eiffel Tower, Paris, France"), the "© OpenStreetMap contributors" credit and an
**Open in maps ↗** link to openstreetmap.org.

- **Add one:** *More* → *Map*. Type a place or address; results appear half a second after you
  stop typing (Enter searches at once, ↓ moves into the results). Pick one.
- **Edit (double-click, or tap again on a phone):** search again, zoom with **−** / **+**
  (zoom 2–18), and change the label. Esc or a click elsewhere finishes.
- **Saved data:** `{ query, label, lat, lng, zoom }` on the card, synced like every other card.
  No map pictures are stored in the boards.

## Everything goes through your own server

The app never talks to a map service. Searches and map pictures are requested from your Noteboard
server, which asks OpenStreetMap on your behalf:

| App asks your server | Your server asks | What leaves your server |
| --- | --- | --- |
| `GET /api/v1/geo/search?q=…` | Nominatim (`https://nominatim.openstreetmap.org/search`) | the search text |
| `GET /api/v1/geo/tile/z/x/y.png` | the OpenStreetMap tile server (`https://tile.openstreetmap.org/z/x/y.png`) | the tile coordinates (zoom, column, row) |

- Only these go out, from the server's address, with the user agent
  `Noteboard self-hosted (https://github.com/iampmpksamy/MilaNote---milanote.com-REA-)`.
  No account names, e-mail addresses, cookies, board contents or device addresses are sent.
- Tile coordinates reveal roughly which area is being looked at; the search text is whatever was
  typed. If that is too much for your setup, turn maps off or use your own provider (below).
- Both routes need a signed-in account. The page's Content-Security-Policy stays `'self'`
  (pictures are shown as `blob:` addresses made from the server's answers).
- The *Open in maps* link is an ordinary link: it opens openstreetmap.org in the browser only
  when someone clicks it.

### Caching and limits

- **Searches:** at most **one request per second** goes to Nominatim for the whole server (their
  usage policy). Searches wait for their turn for up to 3 seconds; beyond that the server answers
  `429` ("try again in a moment"). Answers are kept in memory for 24 hours (the last 1000
  searches), and the same search asked twice at the same time goes out once.
- **Map pictures:** kept on disk for 7 days in `uploads/.map-tiles/z/x/y.png` inside the data
  folder (change with `MAP_CACHE_DIR`). Backups skip this folder; it can be deleted at any time.
  At most two pictures are fetched at once; only real PNG pictures (≤ 1 MB) are kept and served.
  When OpenStreetMap can't be reached, an older kept picture is served instead. The app keeps
  the pictures it has shown for the rest of the session (answers carry
  `Cache-Control: private, max-age=86400`).
- Tile coordinates are checked (zoom 0–19, column and row inside the map); anything else is `400`.

## Offline and local mode

- **Offline:** cards keep their label and link; the map shows pictures already seen in this
  session, otherwise a quiet "Map not available offline". It fills in again when the connection
  comes back.
- **Local mode** (the app opened as plain files, boards in this browser): there is no server to
  ask, so the card says "Maps need a Noteboard server". Labels can still be edited, and map cards
  made on a server keep their name and *Open in maps* link.

## Settings (environment)

| Setting | Default | Meaning |
| --- | --- | --- |
| `MAP_PROVIDER` | `osm` | `osm` = maps on; `off` = both routes answer `404 maps_off` and discovery says `features.maps: false` |
| `MAP_SEARCH_URL` | `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&q={q}` | Place search; `{q}` is replaced by the search text (or `&q=` is added). Must answer Nominatim-style JSON (`display_name`, `lat`, `lon`, `type`, optional `name` and `address`). |
| `MAP_TILE_URL` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Map pictures; 256×256 PNG, `{z}/{x}/{y}` in the usual "slippy map" scheme |
| `MAP_CACHE_DIR` | `<uploads>/.map-tiles` | Where map pictures are kept |

**Turn maps off:** set `MAP_PROVIDER=off` and restart. Existing map cards keep their label and
link and show "Maps are turned off on this server" instead of the map.

**Use another provider:** point `MAP_SEARCH_URL` and `MAP_TILE_URL` at your own Nominatim and tile
server (for example a self-hosted `mediagis/nominatim` and an OpenStreetMap tile server), or at a
commercial provider that offers the same formats — put any API key in the address and check its
terms. Self-hosting both keeps searches and viewed areas entirely on your network.

## Licence and usage policy

- Map data © OpenStreetMap contributors, available under the
  [Open Database License](https://www.openstreetmap.org/copyright). The card shows the required
  credit on every map, linked to that page. Keep it when you change providers (and add theirs).
- The public OpenStreetMap services are run by volunteers and donations, for light use:
  - [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): at most one
    request per second, a user agent that identifies the application, cache results, no bulk
    geocoding. Noteboard does all of these.
  - [Tile usage policy](https://operations.osmfoundation.org/policies/tiles/): identify the
    application, cache tiles (Noteboard keeps them 7 days), no bulk downloading or pre-fetching,
    show the attribution. Heavy use can be blocked without notice.
- A server with many people using maps every day should use its own tile and search servers or a
  paid provider (`MAP_SEARCH_URL`, `MAP_TILE_URL`).

## Tests

- `apps/api/integration/geo.test.mjs` — the server routes against a fake map service on the same
  machine (never the internet): result shape, the one-per-second pace and "try again", the search
  cache, tile proxy and disk cache (including expiry after 7 days), sign-in required, bad
  coordinates, non-PNG answers, and `MAP_PROVIDER=off`.
- `packages/ui-workspace/src/lib/cards/map/geo.spec.ts` — tile maths, the link, the client.
- `apps/web-e2e/src/cards-map.spec.ts` — local mode (needs a server), touch, phone width.
- `apps/web-e2e/server/cards-map.spec.ts` with `playwright.map.config.mts` — a real server
  (`tools/dev-stack.mjs` on port 4348, data in `tmp/e2e-map`) with a fake map service
  (`server/fake-geo.mjs`): search, pick, map pictures, zoom, the link, dark theme, touch on a phone,
  offline, and a check that the page only ever talks to its own server.

```sh
NX_DAEMON=false npx nx build api && node --test --test-concurrency=1 apps/api/integration/geo.test.mjs
NX_DAEMON=false npx nx build web && NB_CHANNEL=chrome npx playwright test -c apps/web-e2e/playwright.map.config.mts
```
