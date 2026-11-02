require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const { Redis } = require("@upstash/redis");

let STATION_ABBREVIATIONS = {};
try {
  STATION_ABBREVIATIONS = JSON.parse(
    fs.readFileSync(path.join(__dirname, "public", "station-abbreviations.json"), "utf8")
  );
} catch (e) {
  console.warn("Lexique gares indisponible:", e.message);
}


const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.SNCF_API_TOKEN;

app.use(express.static(path.join(__dirname, "public")));

function sncfHeaders() {
  if (!TOKEN) return {};
  const basic = Buffer.from(`${TOKEN}:`).toString("base64");
  return { Authorization: `Basic ${basic}` };
}

async function sncfGet(endpoint, params = {}) {
  if (!TOKEN) {
    const err = new Error("Token SNCF manquant. Copie .env.example vers .env et ajoute SNCF_API_TOKEN.");
    err.status = 500;
    throw err;
  }

  const url = new URL(`https://api.sncf.com/v1/coverage/sncf${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.append(k, v);
  });

  const r = await fetch(url, { headers: sncfHeaders() });
  const body = await r.text();
  if (!r.ok) {
    const err = new Error(`API SNCF: ${r.status} ${body.slice(0, 400)}`);
    err.status = r.status;
    throw err;
  }
  return JSON.parse(body);
}

function isHautsDeFrance(place) {
  const sa = place.stop_area || place;
  const regions = sa.administrative_regions || [];
  const text = [
    sa.name,
    sa.label,
    ...regions.flatMap(r => [r.name, r.label, r.zip_code])
  ].filter(Boolean).join(" ").toLowerCase();

  return text.includes("hauts-de-france") || /\b(02|59|60|62|80)\b/.test(text);
}

app.get("/api/stations", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json([]);

    const norm = v => String(v || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const nq = norm(q);

    const operationalAll = [
      { id: "op:LSA", name: "Lille Saint-Sauveur", label: "LSA — Lille Saint-Sauveur", keys: ["LSA","LILLE SAINT SAUVEUR","LILLE ST SAUVEUR"] },
      { id: "op:LE-RT", name: "Garages TER", label: "LE-RT — Garages TER", keys: ["LE RT","LERT","GARAGES TER"] },
      { id: "stop_area:OCE87286005", name: "Lille Flandres", label: "LE — Lille Flandres", keys: ["LE","LILLE FLANDRES"] },
      { id: "op:LNS-TR", name: "Lens Triage", label: "LNS-TR — Lens Triage", keys: ["LNS TR","LENS TRIAGE"] },
      { id: "op:LNS-DT", name: "Lens Dépôt", label: "LNS-DT — Lens Dépôt", keys: ["LNS DT","LENS DEPOT"] },
      { id: "op:LNS-DP", name: "Lens Dépôt", label: "LNS-DP — Lens Dépôt", keys: ["LNS DP","LENS DEPOT"] }
    ];

    const operational = operationalAll.filter(s =>
      s.keys.some(k => {
        const nk = norm(k);
        return nk === nq || nk.startsWith(nq);
      })
    );

    const exactAbbr = Object.keys(STATION_ABBREVIATIONS)
      .find(ab => norm(ab) === nq);

    let abbreviationPlaces = [];

    if (exactAbbr) {
      const stationName = STATION_ABBREVIATIONS[exactAbbr];

      try {
        const adata = await sncfGet("/places", {
          q: stationName,
          "type[]": "stop_area",
          count: 20
        });

        abbreviationPlaces = (adata.places || [])
          .filter(p => p.embedded_type === "stop_area" && p.stop_area)
          .filter(isHautsDeFrance)
          .map(p => ({
            id: p.stop_area.id,
            name: p.stop_area.name,
            label: exactAbbr === "LNS"
              ? `LNS-BV — ${p.stop_area.name} (gare)`
              : `${exactAbbr} — ${p.stop_area.name}`,
            abbreviation: exactAbbr
          }));

        if (!abbreviationPlaces.length) {
          abbreviationPlaces = (adata.places || [])
            .filter(p => p.embedded_type === "stop_area" && p.stop_area)
            .slice(0, 4)
            .map(p => ({
              id: p.stop_area.id,
              name: p.stop_area.name,
              label: exactAbbr === "LNS"
                ? `LNS-BV — ${p.stop_area.name} (gare)`
                : `${exactAbbr} — ${p.stop_area.name}`,
              abbreviation: exactAbbr
            }));
        }
      } catch (e) {
        console.warn(`Résolution abréviation ${exactAbbr}:`, e.message);
      }
    }

    const exactOperational = operationalAll.filter(s =>
      s.keys.some(k => norm(k) === nq)
    );

    if (["LSA","LE RT","LERT","GARAGES TER","LNS TR","LNS DT","LNS DP"].includes(nq)) {
      return res.json(
        [...exactOperational, ...abbreviationPlaces]
          .filter((s,i,a) => a.findIndex(x => x.id === s.id) === i)
          .slice(0, 12)
      );
    }

    const data = await sncfGet("/places", {
      q,
      "type[]": "stop_area",
      count: 20
    });

    const places = (data.places || [])
      .filter(p => p.embedded_type === "stop_area" && p.stop_area)
      .filter(isHautsDeFrance)
      .map(p => ({
        id: p.stop_area.id,
        name: p.stop_area.name,
        label: p.stop_area.label || p.stop_area.name
      }));

    const fallback = places.length ? [] : (data.places || [])
      .filter(p => p.embedded_type === "stop_area" && p.stop_area)
      .slice(0, 8)
      .map(p => ({
        id: p.stop_area.id,
        name: p.stop_area.name,
        label: p.stop_area.label || p.stop_area.name
      }));

    res.json(
      [...operational, ...abbreviationPlaces, ...places, ...fallback]
        .filter((s,i,a) => a.findIndex(x => x.id === s.id) === i)
        .slice(0, 12)
    );
  } catch (e) {
    // Fallback local pour garder l'autocomplétion disponible sans jeton SNCF.
    // Les tableaux et itinéraires nécessitent toujours un jeton valide.
    // Codes UIC vérifiés dans les données ouvertes SNCF.
    const localStations = [
      ["Arras","87342014"],
      ["Douai","87345009"],
      ["Lille Flandres","87286005"],
      ["Amiens","87313874"],
      ["Dunkerque","87281006"]
    ];
    const normalize = v => String(v || "").normalize("NFD")
      .replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
    const matches = localStations
      .filter(([name]) => normalize(name).includes(normalize(q)))
      .map(([name,uic]) => ({id:`stop_area:OCE${uic}`,name,label:name,localFallback:true}));
    console.warn("Recherche locale des gares:", e.message);
    return res.json(matches.slice(0,12));
  }
});


function sncfDatePart(v) {
  const m = String(v || "").match(/^(\d{8})T/);
  return m ? m[1] : "";
}

function sncfTimeToSeconds(v) {
  const m = String(v || "").match(/^\d{8}T(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function secondsUntilEndOfDay(datetime) {
  const s = sncfTimeToSeconds(datetime);
  if (s == null) return 86400;
  return Math.max(60, 86400 - s);
}

function plusOneMinuteSncf(v) {
  const s = String(v || "");
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!m) return s;
  const d = new Date(Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6])
  ));
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}T${String(d.getUTCHours()).padStart(2,"0")}${String(d.getUTCMinutes()).padStart(2,"0")}${String(d.getUTCSeconds()).padStart(2,"0")}`;
}

async function fetchTrainJourneysUntilEndDay(from, to, datetime) {
  const targetDate = sncfDatePart(datetime);
  let cursor = datetime;
  const all = [];
  const seen = new Set();

  // Navitia can cap the number of returned journeys even when a larger count
  // is requested. Advance from the last departure until the end of the chosen day.
  for (let pass = 0; pass < 30; pass++) {
    if (sncfDatePart(cursor) !== targetDate) break;

    const data = await sncfGet("/journeys", {
      from,
      to,
      datetime: cursor,
      datetime_represents: "departure",
      count: 50,
      "allowed_id[]": "physical_mode:Train"
    });

    const rows = (data.journeys || [])
      .filter(j => sncfDatePart(j.departure_date_time) === targetDate)
      .sort((a,b) => String(a.departure_date_time || "").localeCompare(String(b.departure_date_time || "")));

    if (!rows.length) break;

    for (const j of rows) {
      const key = `${j.departure_date_time}|${j.arrival_date_time}|${j.duration}|${j.nb_transfers}`;
      if (!seen.has(key)) {
        seen.add(key);
        all.push(j);
      }
    }

    const lastDeparture = rows.at(-1)?.departure_date_time;
    if (!lastDeparture) break;

    const next = plusOneMinuteSncf(lastDeparture);
    if (!next || next <= cursor || sncfDatePart(next) !== targetDate) break;
    cursor = next;

    // Stop after the final minute of the selected date.
    const sec = sncfTimeToSeconds(cursor);
    if (sec == null || sec >= 86399) break;

    // If the API returned fewer than the requested batch, there is normally
    // nothing else; one extra pass would only duplicate the last results.
    if (rows.length < 50) break;
  }

  return all.sort((a,b) =>
    String(a.departure_date_time || "").localeCompare(String(b.departure_date_time || ""))
  );
}

app.get("/api/journeys", async (req, res) => {
  try {
    const { from, to, datetime, fromName, toName } = req.query;
    if (!from || !to) return res.status(400).json({ error: "Départ et arrivée obligatoires." });

    // LSA / LE-RT are operational points used for technical/W movements.
    // They are not guaranteed to be Navitia stop_area IDs.
    if (String(from).startsWith("op:") || String(to).startsWith("op:")) {
      return res.json([]);
    }

    // Train journeys from the selected time through 23:59 of the same day.
    const journeyRows = await fetchTrainJourneysUntilEndDay(from, to, datetime);

    const journeys = journeyRows.map(j => ({
      source: "sncf-api",
      transportType: "train",
      departure: j.departure_date_time,
      arrival: j.arrival_date_time,
      duration: j.duration,
      transfers: j.nb_transfers,
      status: j.status || null,
      sections: (j.sections || []).map(s => ({
        type: s.type,
        mode: s.mode || null,
        from: s.from?.name || s.from?.stop_point?.name || null,
        to: s.to?.name || s.to?.stop_point?.name || null,
        from_id: s.from?.id || s.from?.stop_point?.id || null,
        to_id: s.to?.id || s.to?.stop_point?.id || null,
        departure: s.departure_date_time || null,
        arrival: s.arrival_date_time || null,
        display: s.display_informations ? {
          commercial_mode: s.display_informations.commercial_mode,
          network: s.display_informations.network,
          label: s.display_informations.label,
          direction: s.display_informations.direction,
          headsign: s.display_informations.headsign,
          train_number: s.display_informations.headsign || s.display_informations.code || s.display_informations.label
        } : null
      }))
    }));

    const merged = [...journeys]
      .sort((a,b) => String(a.departure || "").localeCompare(String(b.departure || "")));

    res.json(merged);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});



// -----------------------
// Tableaux Départs / Arrivées SNCF (source publique)
// -----------------------
function mapStopDateTime(dt) {
  return dt || null;
}

function extractTrainNumber(info) {
  const s = String(info?.headsign || info?.code || info?.label || "");
  const m = s.match(/\b(\d{4,6})\b/);
  return m ? m[1] : s;
}

app.get("/api/departures", async (req, res) => {
  try {
    const { stopArea, datetime } = req.query;
    if (!stopArea) return res.status(400).json({ error: "Gare obligatoire." });

    const data = await sncfGet(`/stop_areas/${encodeURIComponent(stopArea)}/departures`, {
      from_datetime: datetime,
      duration: secondsUntilEndOfDay(datetime),
      count: 250,
      depth: 3
    });

    const items = (data.departures || []).map(d => {
      const info = d.display_informations || {};
      return {
        type: "departure",
        source: "api-sncf",
        transportType: "train",
        datetime: mapStopDateTime(d.stop_date_time?.departure_date_time),
        baseDatetime: mapStopDateTime(d.stop_date_time?.base_departure_date_time),
        stop: d.stop_point?.name || "",
        direction: info.direction || "",
        headsign: info.headsign || "",
        label: info.label || "",
        trainNumber: extractTrainNumber(info),
        commercialMode: info.commercial_mode || "",
        network: info.network || "",
        status: d.stop_date_time?.data_freshness || null,
        platform:
          d.stop_point?.platform_code ||
          d.stop_point?.platform ||
          d.stop_point?.codes?.find(c => /platform|track|quai|voie/i.test(c.type || c.name || ""))?.value ||
          null
      };
    });

    res.json(items);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/arrivals", async (req, res) => {
  try {
    const { stopArea, datetime } = req.query;
    if (!stopArea) return res.status(400).json({ error: "Gare obligatoire." });

    const data = await sncfGet(`/stop_areas/${encodeURIComponent(stopArea)}/arrivals`, {
      from_datetime: datetime,
      duration: secondsUntilEndOfDay(datetime),
      count: 250,
      depth: 3
    });

    const items = (data.arrivals || []).map(a => {
      const info = a.display_informations || {};
      return {
        type: "arrival",
        source: "api-sncf",
        transportType: "train",
        datetime: mapStopDateTime(a.stop_date_time?.arrival_date_time),
        baseDatetime: mapStopDateTime(a.stop_date_time?.base_arrival_date_time),
        stop: a.stop_point?.name || "",
        origin: info.direction || "",
        direction: info.direction || "",
        headsign: info.headsign || "",
        label: info.label || "",
        trainNumber: extractTrainNumber(info),
        commercialMode: info.commercial_mode || "",
        network: info.network || "",
        status: a.stop_date_time?.data_freshness || null,
        platform:
          a.stop_point?.platform_code ||
          a.stop_point?.platform ||
          a.stop_point?.codes?.find(c => /platform|track|quai|voie/i.test(c.type || c.name || ""))?.value ||
          null
      };
    });

    res.json(items);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});


// -----------------------
// Historique persistant des voies — V2.9.4 Vercel
//
// Sur Vercel : stockage Upstash Redis (persistant entre les exécutions).
// En local : repli sur platform-history.json si Redis n'est pas configuré.
// -----------------------
const PLATFORM_HISTORY_FILE = path.join(__dirname, "platform-history.json");
const PLATFORM_HISTORY_MAX_DAYS = 90;
const PLATFORM_HISTORY_MIN_OBS = 2;
const PLATFORM_HISTORY_MIN_CONFIDENCE = 60;
const PLATFORM_HISTORY_HASH = "trajets-hdf:platform-history:v1";

const AUTO_COLLECTION_STATIONS = [
  { name: "Arras", uic: "87342014" },
  { name: "Lens", uic: "87345009" },
  { name: "Douai", uic: "87345025" },
  { name: "Lille Flandres", uic: "87286005" },
  { name: "Béthune", uic: "87342055" },
  { name: "Hazebrouck", uic: "87286203" },
  { name: "Amiens", uic: "87313874" },
  { name: "Calais Ville", uic: "87281063" },
  { name: "Boulogne Ville", uic: "87317009" },
  { name: "Valenciennes", uic: "87343005" },
  { name: "Cambrai", uic: "87345504" },
  { name: "Saint-Quentin", uic: "87296004" }
];

const redisConfigured = Boolean(
  (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
  (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
);

let redis = null;
if (redisConfigured) {
  redis = new Redis({
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN
  });
}

let localPlatformHistory = {};
if (!redisConfigured) {
  try {
    if (fs.existsSync(PLATFORM_HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PLATFORM_HISTORY_FILE, "utf8"));
      if (parsed && typeof parsed === "object") localPlatformHistory = parsed;
    }
  } catch (e) {
    console.warn("Historique local voies illisible:", e.message);
  }
}

function historyKey(uic, trainNumber) {
  return `${uic}:${trainNumber}`;
}

function pruneHistoryEntry(entry) {
  if (!entry || !Array.isArray(entry.observations)) return { observations: [] };
  const cutoff = Date.now() - PLATFORM_HISTORY_MAX_DAYS * 86400000;
  entry.observations = entry.observations.filter(o => {
    const t = Date.parse(o.at || "");
    return Number.isFinite(t) && t >= cutoff;
  });
  return entry;
}

async function historyGetEntry(key) {
  if (redis) {
    try {
      const value = await redis.hget(PLATFORM_HISTORY_HASH, key);
      if (!value) return { observations: [] };
      if (typeof value === "string") return pruneHistoryEntry(JSON.parse(value));
      return pruneHistoryEntry(value);
    } catch (e) {
      console.warn("Lecture Redis historique voies:", e.message);
      return { observations: [] };
    }
  }
  return pruneHistoryEntry(localPlatformHistory[key] || { observations: [] });
}

async function historySetEntry(key, entry) {
  if (redis) {
    await redis.hset(PLATFORM_HISTORY_HASH, { [key]: JSON.stringify(entry) });
    return;
  }
  localPlatformHistory[key] = entry;
  try {
    fs.writeFileSync(PLATFORM_HISTORY_FILE, JSON.stringify(localPlatformHistory, null, 2), "utf8");
  } catch (e) {
    console.warn("Enregistrement historique local voies:", e.message);
  }
}

async function rememberOfficialPlatform(uic, trainNumber, platform) {
  if (!uic || !trainNumber || !platform) return;
  const key = historyKey(uic, trainNumber);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const entry = await historyGetEntry(key);

  // Une observation par jour et par train/gare pour ne pas surpondérer les rafraîchissements.
  const sameDay = entry.observations.find(o => String(o.at || "").slice(0, 10) === today);
  if (sameDay) {
    sameDay.platform = String(platform);
    sameDay.at = now;
  } else {
    entry.observations.push({ platform: String(platform), at: now });
  }

  await historySetEntry(key, pruneHistoryEntry(entry));
}

async function getHistoricalPlatform(uic, trainNumber) {
  const entry = await historyGetEntry(historyKey(uic, trainNumber));
  if (!entry || entry.observations.length < PLATFORM_HISTORY_MIN_OBS) return null;

  const counts = {};
  for (const o of entry.observations) {
    const p = String(o.platform || "").trim();
    if (p) counts[p] = (counts[p] || 0) + 1;
  }

  const ranked = Object.entries(counts).sort((a,b) => b[1] - a[1]);
  if (!ranked.length) return null;

  const [platform, hits] = ranked[0];
  const total = entry.observations.length;
  const confidence = Math.round((hits / total) * 100);

  if (confidence < PLATFORM_HISTORY_MIN_CONFIDENCE) return null;
  return { platform, confidence, observations: total };
}

async function getHistoryStats() {
  if (redis) {
    try {
      const entries = await redis.hlen(PLATFORM_HISTORY_HASH);
      return {
        storage: "upstash-redis",
        persistent: true,
        historyEntries: Number(entries || 0)
      };
    } catch (e) {
      return {
        storage: "upstash-redis",
        persistent: true,
        error: e.message
      };
    }
  }

  const entries = Object.keys(localPlatformHistory).length;
  const observations = Object.values(localPlatformHistory).reduce(
    (sum, e) => sum + (Array.isArray(e?.observations) ? e.observations.length : 0),
    0
  );
  return {
    storage: "local-json",
    persistent: false,
    historyEntries: entries,
    observations
  };
}

let lastCollectionStats = null;

// -----------------------
// Données GTFS TER Hauts-de-France
// -----------------------
function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i+1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cur); cur = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i+1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.replace(/^\uFEFF/, ""));
  return rows.slice(1).map(r => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

async function loadGtfs() {
  if (gtfsCache && Date.now() - gtfsLoadedAt < GTFS_TTL) return gtfsCache;

  const r = await fetch(GTFS_URL);
  if (!r.ok) throw new Error(`Impossible de télécharger le GTFS TER HDF (${r.status}).`);
  const buf = Buffer.from(await r.arrayBuffer());
  const zip = new AdmZip(buf);

  const read = name => {
    const entry = zip.getEntry(name);
    return entry ? parseCsv(entry.getData().toString("utf8")) : [];
  };

  const stops = read("stops.txt");
  const routes = read("routes.txt");
  const trips = read("trips.txt");
  const stopTimes = read("stop_times.txt");
  const calendar = read("calendar.txt");
  const calendarDates = read("calendar_dates.txt");

  const routeById = new Map(routes.map(r => [r.route_id, r]));
  const tripById = new Map(trips.map(t => [t.trip_id, t]));
  const stopById = new Map(stops.map(s => [s.stop_id, s]));

  const timesByTrip = new Map();
  for (const st of stopTimes) {
    if (!timesByTrip.has(st.trip_id)) timesByTrip.set(st.trip_id, []);
    timesByTrip.get(st.trip_id).push(st);
  }
  for (const arr of timesByTrip.values()) {
    arr.sort((a,b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  }

  gtfsCache = { stops, routes, trips, stopTimes, calendar, calendarDates, routeById, tripById, stopById, timesByTrip };
  gtfsLoadedAt = Date.now();
  return gtfsCache;
}

function norm(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(gare de|gare d'|gare du|gare)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function ymd(date) {
  return date.replaceAll("-", "");
}

function serviceRuns(gtfs, serviceId, dateStr) {
  const date = new Date(dateStr + "T12:00:00");
  const dayNames = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  const day = dayNames[date.getDay()];
  const d = ymd(dateStr);

  const exceptions = gtfs.calendarDates.filter(x => x.service_id === serviceId && x.date === d);
  if (exceptions.some(x => x.exception_type === "2")) return false;
  if (exceptions.some(x => x.exception_type === "1")) return true;

  const c = gtfs.calendar.find(x => x.service_id === serviceId);
  if (!c) return false;
  return c.start_date <= d && d <= c.end_date && c[day] === "1";
}

function gtfsSecs(t) {
  const [h,m,s] = String(t || "0:0:0").split(":").map(Number);
  return h*3600 + m*60 + (s || 0);
}

function secsToSncfDateTime(dateStr, secs) {
  let d = new Date(dateStr + "T00:00:00");
  d.setSeconds(d.getSeconds() + secs);
  const p = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}



function mapSncfJourney(j, forcedType = null) {
  const sections = (j.sections || []).map(s => ({
    type: s.type,
    mode: s.mode || null,
    from: s.from?.name || s.from?.stop_point?.name || null,
    to: s.to?.name || s.to?.stop_point?.name || null,
    from_id: s.from?.id || s.from?.stop_point?.id || null,
    to_id: s.to?.id || s.to?.stop_point?.id || null,
    departure: s.departure_date_time || null,
    arrival: s.arrival_date_time || null,
    display: s.display_informations ? {
      commercial_mode: s.display_informations.commercial_mode,
      network: s.display_informations.network,
      label: s.display_informations.label,
      direction: s.display_informations.direction,
      headsign: s.display_informations.headsign,
      train_number: s.display_informations.headsign || s.display_informations.code || s.display_informations.label
    } : null
  }));

  const publicSections = sections.filter(s => s.type === "public_transport");
  const looksBus = publicSections.some(s => {
    const d = s.display || {};
    const txt = `${s.mode || ""} ${d.commercial_mode || ""} ${d.network || ""}`.toLowerCase();
    return /\b(bus|car|coach|autocar)\b/.test(txt);
  });

  return {
    source: "sncf-api",
    transportType: forcedType || (looksBus ? "bus" : "train"),
    departure: j.departure_date_time,
    arrival: j.arrival_date_time,
    duration: j.duration,
    transfers: j.nb_transfers,
    status: j.status || null,
    sections
  };
}

async function fetchSncfCoachJourneys(from, to, datetime) {
  const modes = ["physical_mode:Coach", "physical_mode:Bus"];
  const all = [];

  for (const mode of modes) {
    try {
      const data = await sncfGet("/journeys", {
        from,
        to,
        datetime,
        datetime_represents: "departure",
        count: 100,
        "allowed_id[]": mode
      });
      for (const j of (data.journeys || [])) all.push(mapSncfJourney(j, "bus"));
    } catch (e) {
      // Certains couvertures ne connaissent pas un des physical_mode.
      console.warn(`SNCF coach fallback ${mode}:`, e.message);
    }
  }

  const seen = new Set();
  return all.filter(j => {
    const key = `${j.departure}|${j.arrival}|${j.sections?.[0]?.from || ""}|${j.sections?.at(-1)?.to || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

app.get("/api/bus-journeys", async (req, res) => {
  try {
    const fromName = String(req.query.fromName || "").trim();
    const toName = String(req.query.toName || "").trim();
    const fromId = String(req.query.fromId || "").trim();
    const toId = String(req.query.toId || "").trim();
    const date = String(req.query.date || "").trim();
    const time = String(req.query.time || "00:00").trim();

    if (!fromName || !toName || !date) {
      return res.status(400).json({ error: "Gares, date et heure obligatoires." });
    }

    let gtfsFound = [];
    let gtfsError = null;

    try {
      const gtfs = await loadGtfs();
      const fromStops = matchCarStops(gtfs.stops, fromName);
      const toStops = matchCarStops(gtfs.stops, toName);

      const fromIds = new Set(fromStops.map(s => s.stop_id));
      const toIds = new Set(toStops.map(s => s.stop_id));
      const minSecs = gtfsSecs(time + ":00");

      for (const trip of gtfs.trips) {
        if (!serviceRuns(gtfs, trip.service_id, date)) continue;

        const route = gtfs.routeById.get(trip.route_id);
        const times = gtfs.timesByTrip.get(trip.trip_id) || [];
        if (!times.length) continue;

        const routeType = String(route?.route_type || "");
        const isBusType = ["3","700","701","702","704","705","710","712","715","717"].includes(routeType);
        const hasCarStop = times.some(st => /OCECar/i.test(st.stop_id));
        if (!isBusType && !hasCarStop) continue;

        let fromIdx = -1;
        let toIdx = -1;

        for (let i = 0; i < times.length; i++) {
          if (fromIdx < 0 && fromIds.has(times[i].stop_id)) {
            fromIdx = i;
            continue;
          }
          if (fromIdx >= 0 && i > fromIdx && toIds.has(times[i].stop_id)) {
            toIdx = i;
            break;
          }
        }

        if (fromIdx < 0 || toIdx < 0) continue;

        const dep = gtfsSecs(times[fromIdx].departure_time);
        const arr = gtfsSecs(times[toIdx].arrival_time);
        if (dep < minSecs - 60 || dep >= 86400) continue;

        gtfsFound.push({
          source: "ter-hdf-gtfs",
          transportType: "bus",
          departure: secsToSncfDateTime(date, dep),
          arrival: secsToSncfDateTime(date, arr),
          duration: Math.max(0, arr - dep),
          transfers: 0,
          status: null,
          sections: [{
            type: "public_transport",
            mode: "bus",
            from: gtfs.stopById.get(times[fromIdx].stop_id)?.stop_name || fromName,
            to: gtfs.stopById.get(times[toIdx].stop_id)?.stop_name || toName,
            departure: secsToSncfDateTime(date, dep),
            arrival: secsToSncfDateTime(date, arr),
            display: {
              commercial_mode: "Car TER",
              network: "TER Hauts-de-France",
              label: route?.route_short_name || route?.route_long_name || trip.trip_short_name || "",
              direction: trip.trip_headsign || gtfs.stopById.get(times[toIdx].stop_id)?.stop_name || "",
              headsign: trip.trip_headsign || ""
            }
          }]
        });
      }
    } catch (e) {
      gtfsError = e.message;
      console.warn("GTFS cars indisponible:", e.message);
    }

    // Sur Vercel, le téléchargement/décompression du GTFS peut être plus lent
    // lors d'un cold start. On complète donc avec l'API SNCF Coach/Bus.
    let sncfFound = [];
    if (fromId && toId) {
      try {
        const dt = `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
        sncfFound = await fetchSncfCoachJourneys(fromId, toId, dt);
      } catch (e) {
        console.warn("Fallback cars SNCF indisponible:", e.message);
      }
    }

    const merged = [...gtfsFound, ...sncfFound]
      .sort((a,b) => (a.departure || "").localeCompare(b.departure || ""));

    const seen = new Set();
    const deduped = merged.filter(j => {
      const key = `${j.departure}|${j.arrival}|${j.sections?.[0]?.from || ""}|${j.sections?.at(-1)?.to || ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Compatibilité PWA / anciennes versions du frontend :
    // cette route renvoie toujours un TABLEAU, comme les versions où les cars
    // fonctionnaient correctement. Les diagnostics passent dans les headers.
    res.set("X-Bus-GTFS-Count", String(gtfsFound.length));
    res.set("X-Bus-SNCF-Count", String(sncfFound.length));
    if (gtfsError) res.set("X-Bus-GTFS-Error", encodeURIComponent(gtfsError).slice(0, 500));
    res.json(deduped);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


function gtfsDateTimeForBoard(dateStr, timeStr) {
  return secsToSncfDateTime(dateStr, gtfsSecs(timeStr));
}

function matchCarStops(stops, stationName) {
  const n = norm(stationName);
  return stops.filter(s =>
    /OCECar/i.test(s.stop_id) &&
    (norm(s.stop_name) === n || norm(s.stop_name).includes(n) || n.includes(norm(s.stop_name)))
  );
}

app.get("/api/bus-board", async (req, res) => {
  try {
    const stationName = String(req.query.stationName || "").trim();
    const date = String(req.query.date || "").trim();
    const time = String(req.query.time || "00:00").trim();
    const mode = String(req.query.mode || "departures");
    if (!stationName || !date) return res.status(400).json({ error: "Gare et date obligatoires." });

    const gtfs = await loadGtfs();
    const carStops = matchCarStops(gtfs.stops, stationName);
    const stopIds = new Set(carStops.map(s => s.stop_id));
    const minSecs = gtfsSecs(time + ":00");
    const out = [];

    for (const trip of gtfs.trips) {
      if (!serviceRuns(gtfs, trip.service_id, date)) continue;
      const route = gtfs.routeById.get(trip.route_id);
      const times = gtfs.timesByTrip.get(trip.trip_id) || [];
      const idx = times.findIndex(st => stopIds.has(st.stop_id));
      if (idx < 0) continue;

      const st = times[idx];
      const eventTime = mode === "arrivals" ? st.arrival_time : st.departure_time;
      const eventSecs = gtfsSecs(eventTime);
      if (eventSecs < minSecs - 60 || eventSecs >= 86400) continue;

      const first = times[0], last = times[times.length - 1];
      const origin = gtfs.stopById.get(first.stop_id)?.stop_name || "";
      const destination = gtfs.stopById.get(last.stop_id)?.stop_name || "";

      out.push({
        type: mode === "arrivals" ? "arrival" : "departure",
        transportType: "bus",
        datetime: gtfsDateTimeForBoard(date, eventTime),
        baseDatetime: gtfsDateTimeForBoard(date, eventTime),
        origin,
        direction: destination,
        headsign: trip.trip_headsign || destination,
        label: route?.route_short_name || route?.route_long_name || trip.trip_short_name || "",
        commercialMode: "Car TER",
        network: "TER Hauts-de-France",
        status: "base_schedule",
        platform: st.platform_code || null
      });
    }

    out.sort((a,b) => a.datetime.localeCompare(b.datetime));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



app.get("/api/platform-history-status", async (req, res) => {
  const history = await getHistoryStats();
  res.json({
    ...history,
    vercel: Boolean(process.env.VERCEL),
    collectionEnabled: false,
    message: "La collecte automatique des voies n'est pas active. Seules les voies communiquées officiellement par la SNCF sont affichées."
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    tokenConfigured: Boolean(TOKEN),
    busSource: "GTFS TER Hauts-de-France",
    platformSource: "API SNCF publique quand disponible"
  });
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Application SNCF Hauts-de-France : http://localhost:${PORT}`);
    console.log("Trains : API SNCF | Cars TER : GTFS officiel Hauts-de-France");
    console.log(`Historique voies : ${redisConfigured ? "Upstash Redis" : "JSON local"}`);
  });
}

module.exports = app;
