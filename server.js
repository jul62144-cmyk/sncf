require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const { Redis } = require("@upstash/redis");

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

    const norm = v => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    const nq = norm(q);
    const operational = [
      { id: "op:LSA", name: "Lille Saint-Sauveur", label: "LSA — Lille Saint-Sauveur", keys: ["LSA","LILLE SAINT SAUVEUR"] },
      { id: "op:LE-RT", name: "Garages TER", label: "LE-RT — Garages TER", keys: ["LE RT","LERT","GARAGES TER"] },
      { id: "stop_area:OCE87286005", name: "Lille Flandres", label: "LE — Lille Flandres", keys: ["LE","LILLE FLANDRES"] },
      { id: "op:LNS-TR", name: "Lens Triage", label: "LNS-TR — Lens Triage", keys: ["LNS TR","LNS-TR","LENS TRIAGE"] },
      { id: "op:LNS-DT", name: "Lens Dépôt", label: "LNS-DT — Lens Dépôt", keys: ["LNS DT","LNS-DT","LENS DEPOT"] },
      { id: "op:LNS-DP", name: "Lens Dépôt", label: "LNS-DP — Lens Dépôt", keys: ["LNS DP","LNS-DP","LENS DEPOT"] }
    ].filter(s => s.keys.some(k => norm(k) === nq || norm(k).startsWith(nq)));

    // Operational chantier codes do not necessarily exist as SNCF stop_areas.
    // Return them directly when the query is an exact operational abbreviation.
    if (["LSA","LE RT","LERT","GARAGES TER","LNS TR","LNS DT","LNS DP"].includes(nq)) return res.json(operational);

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

    if (!places.length) {
      const fallback = (data.places || [])
        .filter(p => p.embedded_type === "stop_area" && p.stop_area)
        .slice(0, 8)
        .map(p => ({
          id: p.stop_area.id,
          name: p.stop_area.name,
          label: p.stop_area.label || p.stop_area.name
        }));
      return res.json(fallback);
    }

    res.json([...operational, ...places].filter((s,i,a)=>a.findIndex(x=>x.id===s.id)===i).slice(0, 10));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/journeys", async (req, res) => {
  try {
    const { from, to, datetime, fromName, toName } = req.query;
    if (!from || !to) return res.status(400).json({ error: "Départ et arrivée obligatoires." });

    // LSA / LE-RT are operational points used for technical/W movements.
    // They are not guaranteed to be Navitia stop_area IDs.
    if (String(from).startsWith("op:") || String(to).startsWith("op:")) {
      return res.json([]);
    }

    // Train journeys from SNCF API.
    const data = await sncfGet("/journeys", {
      from,
      to,
      datetime,
      datetime_represents: "departure",
      count: 8,
      "allowed_id[]": "physical_mode:Train"
    });

    const journeys = (data.journeys || []).map(j => ({
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

    for (const journey of journeys) {
      for (const section of journey.sections) {
        if (section.type !== "public_transport" || !section.display) continue;

        const trainNumber = normalizeTrainNumberTchoo(
          section.display.train_number ||
          section.display.headsign ||
          section.display.label
        );

        section.display.train_number = trainNumber || section.display.headsign || section.display.label || "";

        // V2.9.5 : les anciens helpers Gares & Connexions avaient été retirés,
        // mais l'endpoint /api/journeys les appelait encore, ce qui faisait
        // échouer toute la recherche de trajets.
        // On utilise désormais Carto Tchoo si possible, sans jamais bloquer
        // le trajet si la voie n'est pas disponible.
        if (journey.transportType !== "bus" && trainNumber) {
          try {
            const [depRows, arrRows] = await Promise.all([
              section.from_id ? fetchTchooStation(section.from_id, "departures") : Promise.resolve([]),
              section.to_id ? fetchTchooStation(section.to_id, "arrivals") : Promise.resolve([])
            ]);

            const dep = depRows.find(r => r.trainNumber === trainNumber);
            const arr = arrRows.find(r => r.trainNumber === trainNumber);

            section.departure_platform = dep?.platform || null;
            section.departure_platform_active = Boolean(dep?.platform && !dep?.platformEstimated);
            section.departure_platform_estimated = Boolean(dep?.platformEstimated);
            section.departure_platform_confidence = dep?.platformConfidence || null;

            section.arrival_platform = arr?.platform || null;
            section.arrival_platform_active = Boolean(arr?.platform && !arr?.platformEstimated);
            section.arrival_platform_estimated = Boolean(arr?.platformEstimated);
            section.arrival_platform_confidence = arr?.platformConfidence || null;
          } catch (trackError) {
            console.warn("Voies trajet indisponibles:", trackError.message);
            section.departure_platform = null;
            section.arrival_platform = null;
          }
        }
      }
    }

    let wJourneys = [];
    if (fromName && toName) {
      try {
        const tchooRows = await fetchTchooStation(from, "departures");
        wJourneys = buildWJourneys(tchooRows, fromName, toName, datetime);
      } catch (e) {
        console.warn("Trains W Tchoo indisponibles:", e.message);
      }
    }

    const merged = [...journeys, ...wJourneys]
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
      duration: 7200,
      count: 30,
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

    res.json(await enrichWithTchoo(items, stopArea, "departures", datetime));
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
      duration: 7200,
      count: 30,
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

    res.json(await enrichWithTchoo(items, stopArea, "arrivals", datetime));
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
// Carto Tchoo - voies publiques / estimées
// Frontend observé:
// - tableau gare: /api/carto.php?action=deparr&uic=<UIC>
// - voie estimée: /api/guess_my_platform.php?uic=<UIC>&num=<TRAIN>
// -----------------------
const TCHOO_API = "https://api.tchoo.net";
const tchooCache = new Map();
const tchooGuessCache = new Map();
const TCHOO_TTL = 30 * 1000;
const TCHOO_GUESS_TTL = 10 * 60 * 1000;
const TCHOO_MIN_CONFIDENCE = 50;

function stopAreaToOceUic(stopArea) {
  const m = String(stopArea || "").match(/OCE(\d{8})/i);
  return m ? m[1] : null;
}

function normalizeTrainNumberTchoo(v) {
  const s = String(v ?? "").trim();
  const m = s.match(/\b(\d{4,6})\b/);
  return m ? m[1] : "";
}

function isWTrainNumber(v, fromName = "", toName = "", fromRaw = "", toRaw = "") {
  const n = Number(normalizeTrainNumberTchoo(v));
  if (!Number.isInteger(n)) return false;

  const norm = x => String(x || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

  const fromN = norm(fromName), toN = norm(toName);
  const fromR = norm(fromRaw), toR = norm(toRaw);

  const isLE = v => v === "LE" || v.startsWith("LE ") || v.includes("LILLE FLANDRES") || v === "LILLE";
  const isLSA = v => v === "LSA" || v.startsWith("LSA ") || v.includes("LILLE SAINT SAUVEUR");
  const isLERT = v => v === "LE RT" || v.startsWith("LE RT ") || v.includes("GARAGES TER");

  if (n >= 700000 && n <= 799999) return true;

  if (n >= 900000 && n <= 999999 &&
      (((isLSA(fromR) || isLSA(fromN)) && (isLE(toR) || isLE(toN))) ||
       ((isLSA(toR) || isLSA(toN)) && (isLE(fromR) || isLE(fromN))))) return true;

  if (n >= 600000 && n <= 699999 &&
      (((isLERT(fromR) || isLERT(fromN)) && (isLE(toR) || isLE(toN))) ||
       ((isLERT(toR) || isLERT(toN)) && (isLE(fromR) || isLE(fromN))))) return true;

  return false;
}

function normalizePlaceName(v) {
  return String(v || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tchooStepName(step) {
  return String(
    step?.localite || step?.gare || step?.station || step?.name || step?.libelle || ""
  ).trim();
}

function tchooStepTime(step) {
  return String(
    step?.fin || step?.debut || step?.heure || step?.time ||
    step?.arrival || step?.departure || ""
  ).trim();
}

function referenceYmd(referenceDateTime) {
  const ref = String(referenceDateTime || "");
  let m = ref.match(/^(\d{8})T/);
  if (m) return m[1];
  m = ref.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}

function combineDateAndClock(referenceDateTime, clock) {
  if (!clock) return referenceDateTime || null;
  const s = String(clock).trim();

  if (/^\d{8}T\d{6}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;

  const hm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!hm) return referenceDateTime || null;

  return `${referenceYmd(referenceDateTime)}T${String(hm[1]).padStart(2,"0")}${hm[2]}${hm[3] || "00"}`;
}

function sncfDateTimeToEpoch(s) {
  const v = String(s || "");
  let m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (m) return Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]);
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +(m[6] || 0));
  return NaN;
}

function wTiming(referenceDateTime, clock) {
  const dt = combineDateAndClock(referenceDateTime, clock);
  const t = sncfDateTimeToEpoch(dt);
  if (!Number.isFinite(t)) return { datetime: dt, minutesAhead: null, future: null };
  const now = Date.now();
  const minutesAhead = Math.round((t - now) / 60000);
  return {
    datetime: dt,
    minutesAhead,
    future: minutesAhead > 0
  };
}

function tchooWToBoardItem(row, board, referenceDateTime) {
  const timing = wTiming(referenceDateTime, row.time);
  return {
    type: board === "arrivals" ? "arrival" : "departure",
    source: "carto-tchoo",
    transportType: "train",
    datetime: timing.datetime,
    baseDatetime: timing.datetime,
    stop: "",
    origin: row.origin || "",
    direction: row.destination || "",
    headsign: row.destination || row.origin || "",
    label: row.trainNumber,
    trainNumber: row.trainNumber,
    commercialMode: "W",
    network: "Acheminement",
    status: null,
    platform: row.platform || null,
    platformEstimated: Boolean(row.platformEstimated),
    platformConfidence: row.platformConfidence || null,
    platformSource: row.platformSource || null,
    platformObservations: row.platformObservations || null,
    tchoo: Boolean(row.platform),
    isW: true,
    wFuture: timing.future,
    wMinutesAhead: timing.minutesAhead
  };
}

async function tchooGetJson(url) {
  const r = await fetch(url, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (compatible; Trajets-HDF/2.9.5)",
      "Referer": "https://carto.tchoo.net/"
    }
  });
  if (!r.ok) throw new Error(`Carto Tchoo HTTP ${r.status}`);
  return await r.json();
}

async function fetchTchooGuess(uic, trainNumber) {
  const key = `${uic}:${trainNumber}`;
  const cached = tchooGuessCache.get(key);
  if (cached && Date.now() - cached.at < TCHOO_GUESS_TTL) return cached.value;

  try {
    const data = await tchooGetJson(
      `${TCHOO_API}/api/guess_my_platform.php?uic=${encodeURIComponent(uic)}&num=${encodeURIComponent(trainNumber)}`
    );

    const first = Array.isArray(data) ? data[0] : null;
    const value = first && first.platform && Number(first.percentage) >= TCHOO_MIN_CONFIDENCE
      ? {
          platform: String(first.platform),
          percentage: Number(first.percentage)
        }
      : null;

    tchooGuessCache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    return null;
  }
}

function normalizeTchooTrain(item, board) {
  const trainNumber = normalizeTrainNumberTchoo(item?.num);
  if (!trainNumber) return null;

  const rawSteps = Array.isArray(item.etapes) ? item.etapes : [];
  const steps = rawSteps.map(s => ({
    name: tchooStepName(s),
    time: tchooStepTime(s)
  })).filter(s => s.name);

  let origin = "";
  let destination = "";

  if (board === "departures") {
    origin = String(item.origine_localite || item.gare_origine || "").trim();
    destination =
      steps[steps.length - 1]?.name ||
      String(item.localite || item.destination || "").trim();
  } else {
    origin =
      steps[0]?.name ||
      String(item.localite || item.origine_localite || "").trim();
    destination = String(item.destination || "").trim();
  }

  return {
    trainNumber,
    platform: item.platform ? String(item.platform) : null,
    platformEstimated: false,
    platformConfidence: item.platform ? 100 : null,
    platformSource: item.platform ? "tchoo-official" : null,
    origin,
    destination,
    time: board === "departures"
      ? (item.fin || item.debut || null)
      : (item.debut || item.fin || null),
    bus: Number(item.bus || 0) === 1,
    mode: item.origine || "",
    steps,
    isW: isWTrainNumber(trainNumber)
  };
}

async function fetchTchooStation(stopArea, board) {
  const uic = stopAreaToOceUic(stopArea) || String(stopArea || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(uic)) return [];

  const cacheKey = `${uic}:${board}`;
  const cached = tchooCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TCHOO_TTL) return cached.rows;

  const data = await tchooGetJson(
    `${TCHOO_API}/api/carto.php?action=deparr&uic=${encodeURIComponent(uic)}`
  );

  const src = board === "arrivals"
    ? (Array.isArray(data?.arrivals) ? data.arrivals : [])
    : (Array.isArray(data?.departures) ? data.departures : []);

  let rows = src.map(x => normalizeTchooTrain(x, board)).filter(Boolean);

  // Apprentissage: uniquement les voies officielles publiées dans train.platform.
  // Sur Vercel elles sont persistées dans Redis.
  await Promise.all(
    rows
      .filter(r => r.platform && !r.platformEstimated && !r.bus)
      .map(r => rememberOfficialPlatform(uic, r.trainNumber, r.platform))
  );

  // Carto Tchoo lui-même appelle guess_my_platform.php lorsqu'item.platform est absent.
  // On reproduit ce comportement, mais en marquant explicitement la donnée comme ESTIMÉE.
  const missing = rows.filter(r => !r.platform && !r.bus);
  const guesses = await Promise.all(
    missing.map(r => fetchTchooGuess(uic, r.trainNumber))
  );

  let gi = 0;
  rows = rows.map(r => {
    if (r.platform || r.bus) return r;
    const g = guesses[gi++];
    if (!g) return r;
    return {
      ...r,
      platform: g.platform,
      platformEstimated: true,
      platformConfidence: g.percentage,
      platformSource: "tchoo-estimate"
    };
  });

  // Dernier recours: historique local. Il faut au moins 2 jours d'observation
  // et 60 % de concordance pour afficher une estimation.
  rows = await Promise.all(rows.map(async r => {
    if (r.platform || r.bus) return r;
    const h = await getHistoricalPlatform(uic, r.trainNumber);
    if (!h) return r;
    return {
      ...r,
      platform: h.platform,
      platformEstimated: true,
      platformConfidence: h.confidence,
      platformObservations: h.observations,
      platformSource: "persistent-history"
    };
  }));

  tchooCache.set(cacheKey, { at: Date.now(), rows });
  return rows;
}


async function collectStationHistory(station) {
  let official = 0;
  let errors = 0;

  for (const board of ["departures", "arrivals"]) {
    try {
      const rows = await fetchTchooStation(`stop_area:OCE${station.uic}`, board);
      official += rows.filter(r => r.platform && !r.platformEstimated && !r.bus).length;
    } catch (e) {
      errors++;
      console.warn(`Collecte ${station.name}/${board}:`, e.message);
    }
  }

  return { official, errors };
}

async function runPlatformCollection() {
  const stats = {
    startedAt: new Date().toISOString(),
    stations: 0,
    officialPlatformsSeen: 0,
    errors: 0
  };

  for (const station of AUTO_COLLECTION_STATIONS) {
    const r = await collectStationHistory(station);
    stats.stations++;
    stats.officialPlatformsSeen += r.official;
    stats.errors += r.errors;

    // Limite la pression sur Carto Tchoo.
    await new Promise(resolve => setTimeout(resolve, 350));
  }

  stats.finishedAt = new Date().toISOString();
  lastCollectionStats = stats;
  return stats;
}

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // pratique en local
  return req.headers.authorization === `Bearer ${secret}`;
}

app.get("/api/collect-platforms", async (req, res) => {
  if (!cronAuthorized(req)) {
    return res.status(401).json({ error: "Non autorisé." });
  }

  try {
    const stats = await runPlatformCollection();
    const history = await getHistoryStats();
    res.json({ ok: true, stats, history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function enrichWithTchoo(items, stopArea, board, referenceDateTime = null) {
  try {
    const rows = await fetchTchooStation(stopArea, board);
    const byTrain = new Map(rows.map(r => [r.trainNumber, r]));

    const enriched = items.map(item => {
      if (item.transportType === "bus") return item;

      const n = normalizeTrainNumberTchoo(item.trainNumber || item.label || item.headsign);
      const t = byTrain.get(n);
      if (!t) return item;

      return {
        ...item,
        trainNumber: n || item.trainNumber,
        platform: t.platform || item.platform || null,
        platformEstimated: Boolean(t.platformEstimated),
        platformConfidence: t.platformConfidence,
        platformSource: t.platformSource || null,
        platformObservations: t.platformObservations || null,
        origin: board === "arrivals" ? (t.origin || item.origin || "") : (item.origin || ""),
        direction: board === "departures" ? (t.destination || item.direction || "") : item.direction,
        tchoo: Boolean(t.platform),
        isW: isWTrainNumber(n)
      };
    });

    const existing = new Set(
      enriched
        .map(x => normalizeTrainNumberTchoo(x.trainNumber || x.label || x.headsign))
        .filter(Boolean)
    );

    const wOnly = rows
      .filter(r => isWTrainNumber(r.trainNumber) && !r.bus && !existing.has(r.trainNumber))
      .map(r => tchooWToBoardItem(r, board, referenceDateTime));

    return [...enriched, ...wOnly]
      .sort((a,b) => String(a.datetime || "").localeCompare(String(b.datetime || "")));
  } catch (e) {
    console.warn("Carto Tchoo indisponible:", e.message);
    return items;
  }
}

function buildWJourneys(rows, fromName, toName, referenceDateTime) {
  const target = normalizePlaceName(toName);
  const from = String(fromName || "").trim();

  return rows
    .filter(r => isWTrainNumber(
      r.trainNumber,
      fromName,
      toName,
      r.origin || "",
      r.destination || ""
    ) && !r.bus)
    .map(r => {
      const steps = Array.isArray(r.steps) ? r.steps : [];
      let targetStep = steps.find(s => normalizePlaceName(s.name) === target);

      if (!targetStep && target) {
        targetStep = steps.find(s => {
          const n = normalizePlaceName(s.name);
          return n && (n.includes(target) || target.includes(n));
        });
      }

      const destinationMatches = normalizePlaceName(r.destination) === target;
      if (!targetStep && !destinationMatches) return null;

      const depTiming = wTiming(referenceDateTime, r.time);
      const arrClock = targetStep?.time || (destinationMatches ? r.time : null);
      const arr = combineDateAndClock(referenceDateTime, arrClock) || depTiming.datetime;

      let duration = 0;
      const depMs = sncfDateTimeToEpoch(depTiming.datetime);
      const arrMs = sncfDateTimeToEpoch(arr);
      if (Number.isFinite(depMs) && Number.isFinite(arrMs)) {
        duration = Math.max(0, Math.round((arrMs - depMs) / 1000));
      }

      return {
        source: "carto-tchoo",
        transportType: "w",
        isW: true,
        wFuture: depTiming.future,
        wMinutesAhead: depTiming.minutesAhead,
        departure: depTiming.datetime,
        arrival: arr,
        duration,
        transfers: 0,
        status: null,
        sections: [{
          type: "public_transport",
          mode: "train",
          from,
          to: targetStep?.name || toName,
          departure: depTiming.datetime,
          arrival: arr,
          departure_platform: r.platform || null,
          departure_platform_active: Boolean(r.platform && !r.platformEstimated),
          departure_platform_estimated: Boolean(r.platformEstimated),
          departure_platform_confidence: r.platformConfidence || null,
          display: {
            commercial_mode: "W",
            network: "Acheminement",
            label: r.trainNumber,
            direction: r.destination || toName,
            headsign: r.trainNumber,
            train_number: r.trainNumber
          }
        }]
      };
    })
    .filter(Boolean);
}


app.get("/api/w-scan", async (req, res) => {
  try {
    const stopArea = String(req.query.stopArea || "").trim();
    const hours = Math.max(1, Math.min(24, Number(req.query.hours || 12)));
    const reference = String(req.query.datetime || "").trim() || null;

    if (!stopArea) return res.status(400).json({ error: "stopArea obligatoire." });

    const rows = await fetchTchooStation(stopArea, "departures");
    const allW = rows
      .filter(r => isWTrainNumber(r.trainNumber) && !r.bus)
      .map(r => {
        const timing = wTiming(reference, r.time);
        return {
          trainNumber: r.trainNumber,
          origin: r.origin || "",
          destination: r.destination || "",
          time: r.time || null,
          datetime: timing.datetime,
          minutesAhead: timing.minutesAhead,
          future: timing.future,
          platform: r.platform || null,
          platformEstimated: Boolean(r.platformEstimated),
          platformConfidence: r.platformConfidence || null,
          steps: r.steps || []
        };
      });

    const futureW = allW.filter(r =>
      Number.isFinite(r.minutesAhead) &&
      r.minutesAhead >= 0 &&
      r.minutesAhead <= hours * 60
    );

    res.json({
      countAllW: allW.length,
      countFutureW: futureW.length,
      horizonHours: hours,
      futureW,
      allW
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/tchoo-test", async (req, res) => {
  try {
    const stopArea = String(req.query.stopArea || "");
    const board = String(req.query.board || "departures") === "arrivals" ? "arrivals" : "departures";
    const rows = await fetchTchooStation(stopArea, board);

    res.json({
      count: rows.length,
      officialPlatforms: rows.filter(r => r.platform && !r.platformEstimated).length,
      estimatedPlatforms: rows.filter(r => r.platformEstimated).length,
      tchooEstimatedPlatforms: rows.filter(r => r.platformSource === "tchoo-estimate").length,
      historicalPlatforms: rows.filter(r => r.platformSource === "local-history").length,
      withPlatform: rows.filter(r => r.platform).length,
      wTrains: rows.filter(r => isWTrainNumber(r.trainNumber)).length,
      wSample: rows.filter(r => isWTrainNumber(r.trainNumber)).slice(0, 15),
      sample: rows.filter(r => r.platform).slice(0, 15)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// -----------------------
// TER Hauts-de-France GTFS (cars)
// -----------------------
const GTFS_URL = "https://geocatalogue.hautsdefrance.fr/gtfs/HDF_TER_GTFS_J___90_jours.zip";
let gtfsCache = null;
let gtfsLoadedAt = 0;
const GTFS_TTL = 6 * 60 * 60 * 1000;

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
        count: 8,
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
        if (dep < minSecs - 60) continue;

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
    res.json(deduped.slice(0, 16));
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
      if (eventSecs < minSecs - 60) continue;

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
    res.json(out.slice(0, 30));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



app.get("/api/platform-history-status", async (req, res) => {
  const history = await getHistoryStats();
  res.json({
    ...history,
    vercel: Boolean(process.env.VERCEL),
    cronRecommended: true,
    cronPath: "/api/collect-platforms",
    cronScheduleUTC: "0 16 * * *",
    lastCollectionStats,
    stations: AUTO_COLLECTION_STATIONS
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
