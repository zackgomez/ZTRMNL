# ZTRMNL

On-demand BYOS (bring-your-own-server) replacement for [Terminus](https://github.com/usetrmnl/byos_hanami)
driving a TRMNL OG e-ink display (800x480, 2-bit, MAC `94:A9:90:8F:48:D4`).

Two things Terminus does that this doesn't: run a headless Chromium per
render (ferrum/Shoter cold-starting `browser.new` -> `quit` on every
screenshot), and require Ruby. Screens here are rendered on demand, in
process, from an HTML string -- no browser.

Full device API contract this implements:
`~/Documents/Primer/Homelab/TRMNL On-Demand Server Spec.md`.

## Architecture

```
device (wakes every refresh_rate seconds)
  |
  |  GET /api/display   (headers: ID=MAC, Battery-Voltage, RSSI, ...)
  v
src/routes/display.ts
  1. parse telemetry from headers, fire-and-forget log (src/telemetry.ts)
  2. build a RenderContext (panel dims + device identity from the sqlite
     row, an injected clock, request.log, and an html() helper) and call
     resolveScreen(device.screen).render(ctx)  -- ON DEMAND, 3s timeout
       screens/nas.ts: query InfluxDB fresh (src/sources/nasMetrics.ts,
       same Flux queries as the retired Python collector) -> interpolate
       into HTML string -> ctx.html() -> render.ts: satori-html -> satori
       -> resvg -> sharp
  3. success: write PNG to data/uploads/<sha256[:12]>.png, remember as
     "last-good"
     failure: fall back to serving the last-good PNG (device never sees
     a blank/broken poll)
  4. respond with the 12-field Display payload (filename/image_url/
     refresh_rate/...)
  |
  |  GET /uploads/<hash>.png   (served by @fastify/static)
  v
device paints the panel

GET /api/setup   -- pairing/reset, find-or-create device, returns {api_key, friendly_id, image_url}
POST /api/log    -- device crash/error logs, appended to data/device.log
```

State is a small SQLite device registry (`data/ztrmnl.db`, WAL) + a JSON
config file + a directory of PNGs + a log file. No headless browser
anywhere in the pipeline.

## Devices & auth

A device is identified by its MAC, sent in the `ID` header (Fastify
lowercases it to `headers["id"]`). The registry lives in
`data/ztrmnl.db` (`src/store.ts`, `better-sqlite3`, WAL mode; created on
first boot). Routes touch it only through the `DeviceStore` interface --
never raw SQL.

**find-or-create** (`/api/setup`): the device calls `/api/setup` only when
it has no stored token (fresh pairing or factory reset). We look the MAC up
and, if new, mint an `api_key` (32 hex chars) and a `friendly_id`
(`ZT-` + 6 uppercase alphanumerics). A repeat call for a known MAC returns
the **same** stored `api_key` -- idempotent, matching Terminus'
find-or-create semantics, so a factory reset re-lands cleanly.
`allowNewDevices: false` makes `/api/setup` refuse an unseen MAC with a
`404` (lock the fleet once every device is paired). `/api/display` never
auto-registers: an unknown MAC is a `404` there regardless.

**authMode** -- a three-notch dial for the `Access-Token` header (the
`api_key` the device stored from setup) on `/api/display`:

| `authMode`  | behavior on token mismatch/absence                          |
|-------------|-------------------------------------------------------------|
| `"off"`     | ignore the token entirely                                   |
| `"warn"`    | log a warning, **serve the poll anyway** (default)          |
| `"enforce"` | `401` -- refuse the poll                                    |

Tokens are recorded-but-ignored by default because **Terminus itself never
validates the Access-Token** -- the device's identity is its MAC, and the
token is a soft secret. `"warn"` gives you the audit trail (mismatches show
up in the logs) without risking a paired device getting locked out by a
stale token; `"enforce"` is available if you want hard rejection.

**TOFU adoption**: a device's stored `api_key` starts *unconfirmed*. Until
confirmed, `/api/display` adopts whatever non-empty `Access-Token` the device
actually presents (replacing our minted key, marking it confirmed) instead of
warning. This makes migration self-healing: a device coming over from
Terminus/cloud holds a token we never issued (Terminus BYOS mints none at
all), and its first poll here adopts it. A matching token also confirms; once
confirmed, mismatches warn/enforce per `authMode`.

Every `/api/display` poll also `store.touch()`es the device: `last_seen`
plus the latest `fw_version`/`width`/`height`/`model` from the telemetry
headers (fire-and-forget -- never blocks or fails the poll).

Per-device screen assignment: if a device row has a non-null `screen`, that
screen is rendered for its polls; otherwise it falls back to the global
`activeScreen` config (`src/screens/index.ts` `resolveScreen()`).

## Screens (plugin API)

A screen is anything implementing `Screen` (`src/screens/types.ts`):

```ts
interface Screen {
  name: string;
  render(ctx: RenderContext): Promise<Buffer>; // finished, quantized PNG
}
```

`RenderContext` is built fresh per poll in `src/routes/display.ts` and
carries everything a screen needs: `width`/`height` (from the device's
sqlite row, falling back to the 800x480 default), `device` (`{mac,
friendlyId}`), an injected `now: Date`, the request's `log`, and an
`html(markup)` helper that minifies the markup and runs it through
`render.ts`'s satori -> resvg -> sharp pipeline at the context's
dimensions.

Implementing raw `Screen` directly is for non-HTML output -- e.g. a
plugin that proxies or otherwise produces a pre-made PNG. The normal
authoring path is `htmlScreen()` (`src/screens/html.ts`), which wraps a
`renderHTML(ctx): string | Promise<string>` function:

```ts
export const myScreen = htmlScreen({
  name: "my-screen",
  async renderHTML(ctx) {
    return `<div style="width:${ctx.width}px;height:${ctx.height}px;...">...</div>`;
  },
});
```

### Status bar chrome

`src/screens/chrome.ts` exports `statusBar(ctx)`, a slim (32px,
`STATUS_BAR_HEIGHT`) on-glass bar that screens prepend to their markup:
friendly name + MAC on the left; on the right, in order, `every <Xm>` ·
wifi · battery (battery rightmost). The bar's background is `#ccc` --
chosen so the device's 2-bit quantizer (thresholds `<43`→black,
`<128`→dark-gray(85), `<213`→light-gray(170), else white) buckets it to
light-gray rather than snapping to white (`#ddd`/`#eee` would). Wifi is a
drawn 4-bar signal icon (filled bars `#000`, empty bars `#fff` for contrast
against the grey background) sized off RSSI (`≥-55`→4 bars, `≥-65`→3,
`≥-75`→2, else 1; no RSSI → all empty), followed by a network label
(`config.wifiName` when set, else the telemetry-reported band `2.4G`/`5G`
when present, else nothing), plus a bold "weak" tag and a small drawn
warning box when RSSI is present and below `-75`. Battery is a drawn
24x14px icon (2px border + a fill div sized to the charge % + a small nub)
followed by `NN%` text -- `?` with an empty icon when neither
`percent-charged` nor a voltage reading is available. Because renders
happen on demand inside the poll itself, all of this comes straight from
`ctx.telemetry` -- the headers of the poll currently being served, not a
stale sqlite snapshot -- so the readings are always as fresh as possible.
`nas.ts` is the reference integration: the outer container becomes a flex
column of `[statusBar(ctx), content]`, with the content wrapper's height
reduced by `STATUS_BAR_HEIGHT` (imported from `chrome.ts`, not
re-hardcoded).

`htmlScreen` just calls `ctx.html(await renderHTML(ctx))` -- screen
authors never call `minify()` or `renderScreen()` themselves. New
screens are registered in `src/screens/index.ts`'s `screens` map.

## Satori HTML dialect rules

Satori (used via `satori-html` to parse an HTML string) is not a browser --
it implements a flexbox-only subset of CSS via Yoga layout. Screens must
follow these rules (see `src/screens/nas.ts` and `src/render.ts` for where
they're applied):

1. **Every element with more than one child needs explicit `display:flex`.**
   Satori has no block layout; there's no implicit stacking.
2. **`flex-direction` defaults to `row`.** Column stacks need explicit
   `flex-direction:column`.
3. **Empty `<div>`s also need `display:flex`** -- `satori-html` gives every
   element `children: []`, and satori requires an explicit `display` for
   any element with array children, including empty ones (e.g. bar-fill
   divs with no text inside).
4. **Whitespace between tags must be stripped before parsing.** Text nodes
   (including pure-whitespace ones) count as children, which trips rule 1.
   `render.ts` exports `minify()` (`.replace(/>\s+</g, '><').trim()`) for
   this -- screens should minify their markup before calling
   `renderScreen()`.
5. **No HTML entities.** Satori doesn't decode `&middot;`, `&#9679;`, etc.
   Use literal UTF-8 characters (`·`, `●`, `○`) in the template string
   instead.

## Admin UI

A second, separate Fastify instance (`src/admin.ts`, started alongside the
device app in `src/server.ts`) serves a read-only status page: service
info (uptime, node/package version, render engine), the effective config
(`influxToken` and other secret-shaped fields shown as `set`/`unset` only,
never the value), the device registry, registered screens, and the current
last-good image. It listens on `adminPort` (default **2401**) -- a distinct
port from the device app's `port` (2400), so the admin UI is structurally
unreachable from the device-facing listener and vice versa. In production
it's fronted by Caddy, reverse-proxying `https://ztrmnl.zoumez.net` to
`adminPort`; the admin listener itself stays plain HTTP internally, and the
device port carries no admin surface at all.

## Dev quickstart

```bash
pnpm install
pnpm dev          # tsx watch src/server.ts, listens on :2400

# setup first -- registers the MAC and hands back its api_key (display
# 404s on an unregistered MAC, mirroring the real device's pairing flow).
curl -s -H "ID: 94:A9:90:8F:48:D4" http://localhost:2400/api/setup
curl -s -H "ID: 94:A9:90:8F:48:D4" -H "Access-Token: <api_key from setup>" http://localhost:2400/api/display
```

Config: copy `config.example.json` (auto-regenerated from defaults on every
boot) to `config.json` and edit. Notable fields: `port` defaults to **2400**
(not 2300 -- production Terminus owns 2300 today; only swap ports/DNS
during the planned migration window). `fixtureData: true` makes the `nas`
screen read `reference/nas.json` instead of querying InfluxDB -- useful if
the NAS's Influx instance (`192.168.1.49:8086`) is unreachable.
`authMode` (`off`/`warn`/`enforce`, default `warn`) and `allowNewDevices`
(default `true`) control the device auth described under **Devices &
auth**. The device registry is a SQLite file at `data/ztrmnl.db`.

### nas screen data source

`src/screens/nas.ts` fetches its data in priority order:

1. `fixtureData: true` -- reads the static `reference/nas.json` fixture.
2. `influxUrl` set (non-empty) -- `src/sources/nasMetrics.ts` queries
   InfluxDB directly over Flux (`POST {influxUrl}/api/v2/query?org={influxOrg}`,
   `Authorization: Token {influxToken}`), running the same queries the
   retired `trmnl-collector` Python daemon used against the `metrics`
   bucket (host tag `nas`): zpool health/capacity/fragmentation for
   `tank`/`fastpool`, system load/cpu-count/uptime, `cpu_power` gauge +
   1h mean, `mem` used-percent, plus a local TCP-connect check against
   `1.1.1.1:443`/`8.8.8.8:53` for the `internet` field. The independent
   Flux queries and the internet check run concurrently.
3. Otherwise -- **legacy fallback**: fetches the flat JSON blob from
   `collectorUrl` (the standalone Python collector, if still running).
   Kept only for the transition; `influxUrl` is the intended path going
   forward and `collectorUrl` is deprecated in `src/config.ts`.

Config fields for the Influx path:

- `influxUrl` -- Influx base URL, e.g. `http://192.168.1.49:8086`. Empty
  string (the default) disables this path.
- `influxOrg` -- Influx org name, e.g. `zoumez`.
- `influxToken` -- **read-only** API token scoped to the `metrics` bucket.

**This repo is public.** None of these three fields ever have a real
value in `config.example.json` or anywhere else tracked by git -- the
token (and URL/org, treated the same way for caution) live only in the
gitignored local `config.json`.

`pnpm build && pnpm start` compiles to `dist/` and runs the compiled
server.

## Verification (2026-07-05, edhar, Node v24.14.0)

- Collector at `192.168.1.43:8088/nas.json` was reachable during dev, so
  `fixtureData` stayed at its default `false` -- the verification run below
  hit the live collector, not the `reference/nas.json` fixture.
- `curl -H "ID: 94:A9:90:8F:48:D4" .../api/display` -> 12-field JSON
  payload, `filename`/`image_url` present, first (cold) render ~265ms
  end-to-end over curl.
- `curl .../uploads/<filename>` -> `PNG image data, 800 x 480, 2-bit
  colormap, non-interlaced`, 6986 bytes (spec's Terminus reference: ~6.5KB
  -- like-for-like).
- Second and third `/api/display` calls: server-side render time (per
  request log) **124-126ms**, well under the 500ms target and the 3s
  timeout.
- Missing `ID` header -> `400`.
- `POST /api/log` -> `204`, body appended to `data/device.log`.
- `GET /api/setup` -> returns the just-rendered image's URL as `image_url`.

## Open items

- **Font is DejaVu Sans (system TTFs), not the TRMNL framework's Inter.**
  Satori cannot parse variable fonts (hard parser failure on any `fvar`
  table), and TRMNL ships Inter only as a variable font, so it was removed
  from `assets/fonts/`. If pixel-parity with the Terminus look is ever
  wanted: download static Inter weights (rsms ships them) into
  `assets/fonts/`, or use the static TRMNL pixel fonts
  (`assets/fonts/TRMNL{12,16,21}-{Regular,Bold}.ttf`) per screen/size.
- **On-glass format test still pending.** PNG is 2-bit palette / 4-gray,
  matching the spec's `bit_depth: 2` description and Terminus's reference
  byte size, but it hasn't been painted on the actual device yet (spec's
  migration step 3). Verify accepted encoding (palette vs raw 2-bit
  grayscale) against a known-good Terminus upload with `pngcheck`/sharp
  metadata before cutover.
- **Telemetry doesn't reach InfluxDB yet.** `src/telemetry.ts` parses and
  logs each poll's headers but `recordTelemetry()` is a stub -- TODO push
  to the `metrics` bucket (tag `host=trmnl`) at `192.168.1.49:8086` so
  battery/RSSI/wake-time show up in Grafana.
- **No firmware OTA proxy.** The spec describes checking TRMNL Core's
  latest-firmware endpoint and offering `firmware_url`/`firmware_version`
  when the device's `FW-Version` is stale. Not implemented --
  `/api/display` always returns `update_firmware: false`. Low priority
  (kill-switch behavior, which is the safe default) until OTA is actually
  wanted.
- **First-render-ever failure with no cached image** returns a `503`
  rather than fabricating a placeholder image. Acceptable for now since a
  fresh install's first render succeeding is the common case, but worth a
  static "starting up" placeholder PNG if this becomes annoying in
  practice.
- **Review project tooling** (linter/formatter/test runner -- currently
  none beyond `tsc`).
- **Audit full TypeScript compliance** (strict flags,
  `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess`, stray `any`s/
  assertions).
- **`reactScreen`**: the planned authoring layer above `htmlScreen` --
  screens as JSX (`render(): ReactNode`) with a small library of
  ZTRMNL/satori components (bars, stat tiles, layout primitives) so screen
  authors don't hand-write inline-CSS strings. Satori consumes React
  elements natively (satori-html is the adapter, not the core path), so
  this is additive. Doesn't have to be React proper -- any JSX runtime
  producing element trees satori accepts.

## Deploy

Production runs on a dedicated LXC (`ztrmnl.zoumez.net`) as a systemd
service -- unit file in `deploy/ztrmnl.service` (expects the repo at
/opt/ztrmnl, a `ztrmnl` user, and `pnpm install --frozen-lockfile && pnpm build`
having produced `dist/`). Deploy = git pull, pnpm install --frozen-lockfile,
pnpm build, systemctl restart ztrmnl.
- **Light admin UI**: a small web page off the main routes -- connected
  devices (last_seen/battery/RSSI/fw from the registry) and a screen
  gallery. The gallery is nearly free thanks to on-demand rendering: it
  can invoke any registered screen's render() live rather than showing
  stale caches. Eventually playlist management; until then playlist/
  screen assignment stays a config-file concern.
- **Shader screen**: a Screen that raymarches/procedurally generates its
  PNG (fragment-shader-style, CPU or GPU) instead of going through HTML --
  the base Screen contract already permits it (render() -> Buffer).
  Dithered 4-gray procedural art on e-ink could look great.
