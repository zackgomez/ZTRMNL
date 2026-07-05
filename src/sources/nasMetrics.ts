// Direct-to-InfluxDB port of the reference `trmnl-collector` Python daemon
// (scratchpad/collector.py) -- same Flux queries, same derived fields, same
// string formatting, just queried in-process instead of via a polled HTTP
// collector. See src/screens/nas.ts for the consumer and src/config.ts for
// the influxUrl/influxOrg/influxToken fields.
import { Socket } from "node:net";

/** Flat JSON shape served by the legacy collector and now produced locally. */
export interface NasData {
  tank_pct: number;
  tank_used: string;
  tank_total: string;
  tank_health: string;
  tank_frag: string;
  fastpool_pct: number;
  fastpool_used: string;
  fastpool_total: string;
  fastpool_health: string;
  fastpool_frag: string;
  load1: string;
  load5: string;
  load15: string;
  load_pct: number;
  ncpus: number;
  mem_pct: number;
  uptime_d: string;
  cpu_w: string;
  cpu_w_avg: string;
  internet: string;
  updated: string;
}

export interface NasMetricsConfig {
  influxUrl: string;
  influxOrg: string;
  influxToken: string;
}

const HOST = "nas";
const BUCKET = "metrics";

function defaults(): NasData {
  return {
    tank_pct: -1,
    tank_used: "?",
    tank_total: "?",
    tank_health: "?",
    tank_frag: "?",
    fastpool_pct: -1,
    fastpool_used: "?",
    fastpool_total: "?",
    fastpool_health: "?",
    fastpool_frag: "?",
    load1: "?",
    load5: "?",
    load15: "?",
    load_pct: -1,
    ncpus: 0,
    mem_pct: -1,
    uptime_d: "?",
    cpu_w: "?",
    cpu_w_avg: "?",
    internet: "down",
    updated: "",
  };
}

/** POST a Flux query, return the raw annotated-CSV response body. */
async function flux(cfg: NasMetricsConfig, query: string): Promise<string> {
  const url = `${cfg.influxUrl}/api/v2/query?org=${encodeURIComponent(cfg.influxOrg)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${cfg.influxToken}`,
      "Content-Type": "application/vnd.flux",
      Accept: "application/csv",
    },
    body: query,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`flux query failed: ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

/** Minimal CSV line splitter matching Python's csv.reader default dialect
 * (comma-delimited, double-quote quoting, "" as an escaped quote). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Parse Influx annotated CSV into row objects, matching collector.py's
 * rows(): strip comment/blank lines, then treat any row whose second column
 * is "result" (and which contains "_value") as a new header, yielding a
 * dict per subsequent row of matching width. Handles multi-table responses
 * (Flux emits a fresh header whenever the table's column set changes). */
function rows(csvText: string): Record<string, string>[] {
  const lines = csvText.split(/\r?\n/).filter((ln) => ln.length > 0 && !ln.startsWith("#"));
  let header: string[] | null = null;
  const out: Record<string, string>[] = [];
  for (const ln of lines) {
    const row = parseCsvLine(ln);
    if (row.length === 0) continue;
    if (row.length > 1 && row[1] === "result" && row.includes("_value")) {
      header = row;
      continue;
    }
    if (header && row.length === header.length) {
      const obj: Record<string, string> = {};
      header.forEach((h, i) => {
        obj[h] = row[i] as string;
      });
      out.push(obj);
    }
  }
  return out;
}

function humanBytes(n: number): string {
  let v = n;
  const units = ["B", "K", "M", "G", "T", "P"] as const;
  for (const unit of units) {
    if (Math.abs(v) < 1024.0) {
      return unit === "B" || unit === "K" || unit === "M" ? `${v.toFixed(0)}${unit}` : `${v.toFixed(1)}${unit}`;
    }
    v /= 1024.0;
  }
  return `${v.toFixed(1)}E`;
}

function tryConnect(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function internetUp(): Promise<boolean> {
  for (const [host, port] of [
    ["1.1.1.1", 443],
    ["8.8.8.8", 53],
  ] as const) {
    if (await tryConnect(host, port)) return true;
  }
  return false;
}

function gaugesQuery(): string {
  return (
    `from(bucket:"${BUCKET}") |> range(start:-10m)` +
    ` |> filter(fn:(r)=> r.host=="${HOST}")` +
    ` |> filter(fn:(r)=>` +
    `   (r._measurement=="system" and (r._field=="load1" or r._field=="load5"` +
    `     or r._field=="load15" or r._field=="n_cpus" or r._field=="uptime")) or` +
    `   (r._measurement=="cpu_power" and r._field=="power_watts") or` +
    `   (r._measurement=="mem" and r._field=="used_percent") or` +
    `   (r._measurement=="zpool_health" and (r.pool=="tank" or r.pool=="fastpool")` +
    `     and (r._field=="capacity" or r._field=="health" or r._field=="alloc"` +
    `       or r._field=="size" or r._field=="frag")))` +
    ` |> last() |> keep(columns:["_measurement","_field","pool","_value"])`
  );
}

function avgQuery(): string {
  return (
    `from(bucket:"${BUCKET}") |> range(start:-1h)` +
    ` |> filter(fn:(r)=> r.host=="${HOST}" and r._measurement=="cpu_power"` +
    ` and r._field=="power_watts") |> mean()`
  );
}

/** Mirrors collector.py's `try: ... cpu_w_avg = ... except Exception: pass`
 * -- any failure (network, parse, empty result) just leaves cpu_w_avg at "?". */
async function fetchAvgCpuW(cfg: NasMetricsConfig): Promise<string | null> {
  try {
    const csv = await flux(cfg, avgQuery());
    for (const r of rows(csv)) {
      const fv = Number(r["_value"]);
      if (!Number.isNaN(fv)) return fv.toFixed(0);
    }
    return null;
  } catch {
    return null;
  }
}

/** "4:04 AM" in America/New_York, matching Python's local strftime("%-I:%M %p")
 * (the reference collector ran on the NAS box, which is US/Eastern). Recent
 * ICU/Node Intl formats insert a narrow no-break space (U+202F) before AM/PM
 * instead of a regular space -- normalize it away for byte-identical output. */
function formatUpdated(now: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return fmt.format(now).replace(/ /gi, " ");
}

export async function fetchNasMetrics(cfg: NasMetricsConfig): Promise<NasData> {
  const out: Record<string, string | number> = { ...defaults() };

  const [gaugesCsv, avgCpuW, up] = await Promise.all([
    flux(cfg, gaugesQuery()),
    fetchAvgCpuW(cfg),
    internetUp(),
  ]);

  const pools: Record<string, Record<string, number>> = {};
  for (const r of rows(gaugesCsv)) {
    const m = r["_measurement"];
    const f = r["_field"];
    const fv = Number(r["_value"]);
    if (r["_value"] === undefined || Number.isNaN(fv)) continue;

    if (m === "system") {
      if (f === "load1") out.load1 = fv.toFixed(2);
      else if (f === "load5") out.load5 = fv.toFixed(2);
      else if (f === "load15") out.load15 = fv.toFixed(2);
      else if (f === "n_cpus") out.ncpus = Math.trunc(fv);
      else if (f === "uptime") out.uptime_d = `${(fv / 86400).toFixed(0)}d`;
    } else if (m === "cpu_power" && f === "power_watts") {
      out.cpu_w = fv.toFixed(0);
    } else if (m === "mem" && f === "used_percent") {
      out.mem_pct = Math.round(fv);
    } else if (m === "zpool_health") {
      const pool = r["pool"] as string;
      if (!pools[pool]) pools[pool] = {};
      if (f !== undefined) pools[pool][f] = fv;
    }
  }

  for (const name of ["tank", "fastpool"] as const) {
    const d = pools[name] ?? {};
    if ("capacity" in d) out[`${name}_pct`] = Math.round(d.capacity as number);
    if ("alloc" in d) out[`${name}_used`] = humanBytes(d.alloc as number);
    if ("size" in d) out[`${name}_total`] = humanBytes(d.size as number);
    if ("frag" in d) out[`${name}_frag`] = `${Math.round(d.frag as number)}%`;
    if ("health" in d) out[`${name}_health`] = d.health === 0 ? "ONLINE" : "DEGRADED";
  }

  if (out.ncpus && out.load1 !== "?") {
    out.load_pct = Math.min(100, Math.round((parseFloat(out.load1 as string) / (out.ncpus as number)) * 100));
  }

  if (avgCpuW !== null) out.cpu_w_avg = avgCpuW;

  out.internet = up ? "up" : "down";
  out.updated = formatUpdated(new Date());

  return out as unknown as NasData;
}
