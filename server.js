require("dotenv").config();
const express = require("express");
const path = require("path");
const AdmZip = require("adm-zip");

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

    res.json(places.slice(0, 10));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/journeys", async (req, res) => {
  try {
    const { from, to, datetime } = req.query;
    if (!from || !to) return res.status(400).json({ error: "Départ et arrivée obligatoires." });

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

        const trainNumber = normalizeTrainNumber(
          section.display.train_number ||
          section.display.headsign ||
          section.display.label
        );

        section.display.train_number = trainNumber || section.display.headsign || section.display.label || "";

        if (journey.transportType !== "bus" && trainNumber) {
          const [depTrack, arrTrack] = await Promise.all([
            findTrackForTrain(section.from_id, "Departures", trainNumber),
            findTrackForTrain(section.to_id, "Arrivals", trainNumber)
          ]);
          section.departure_platform = depTrack?.track || null;
          section.departure_platform_active = depTrack?.active || false;
          section.arrival_platform = arrTrack?.track || null;
          section.arrival_platform_active = arrTrack?.active || false;
        }
      }
    }

    res.json(journeys);
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

    res.json(await enrichWithTchoo(items, stopArea, "departures"));
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

    res.json(await enrichWithTchoo(items, stopArea, "arrivals"));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});


// -----------------------
// Historique local des voies
// Mémorise les voies OFFICIELLES observées par gare + numéro de train.
// Les prévisions historiques restent explicitement marquées "estimée".
// -----------------------
const PLATFORM_HISTORY_FILE = path.join(__dirname, "platform-history.json");
const PLATFORM_HISTORY_MAX_DAYS = 90;
const PLATFORM_HISTORY_MIN_OBS = 2;
const PLATFORM_HISTORY_MIN_CONFIDENCE = 60;

const AUTO_COLLECTION_INTERVAL_MS = 5 * 60 * 1000;

// Principales gares HDF suivies automatiquement.
// Format UIC OCE 8 chiffres.
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

let autoCollectionRunning = false;
let autoCollectionLastRun = null;
let autoCollectionStats = {
  stations: 0,
  officialPlatformsSeen: 0,
  errors: 0
};


let platformHistory = {};

function loadPlatformHistory() {
  try {
    if (fs.existsSync(PLATFORM_HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PLATFORM_HISTORY_FILE, "utf8"));
      if (parsed && typeof parsed === "object") platformHistory = parsed;
    }
  } catch (e) {
    console.warn("Historique voies illisible:", e.message);
    platformHistory = {};
  }
}
loadPlatformHistory();

function savePlatformHistory() {
  try {
    fs.writeFileSync(PLATFORM_HISTORY_FILE, JSON.stringify(platformHistory, null, 2), "utf8");
  } catch (e) {
    console.warn("Impossible d'enregistrer l'historique voies:", e.message);
  }
}

function historyKey(uic, trainNumber) {
  return `${uic}:${trainNumber}`;
}

function pruneHistoryEntry(entry) {
  if (!entry || !Array.isArray(entry.observations)) return entry;
  const cutoff = Date.now() - PLATFORM_HISTORY_MAX_DAYS * 86400000;
  entry.observations = entry.observations.filter(o => {
    const t = Date.parse(o.at || "");
    return Number.isFinite(t) && t >= cutoff;
  });
  return entry;
}

function rememberOfficialPlatform(uic, trainNumber, platform) {
  if (!uic || !trainNumber || !platform) return;
  const key = historyKey(uic, trainNumber);
  const now = new Date().toISOString();
  const entry = pruneHistoryEntry(platformHistory[key] || { observations: [] });
  const today = now.slice(0, 10);

  // Une observation par jour suffit: évite de surpondérer le cache 30 s.
  const sameDay = entry.observations.find(o => String(o.at || "").slice(0,10) === today);
  if (sameDay) {
    sameDay.platform = String(platform);
    sameDay.at = now;
  } else {
    entry.observations.push({ platform: String(platform), at: now });
  }

  platformHistory[key] = entry;
}

function getHistoricalPlatform(uic, trainNumber) {
  const key = historyKey(uic, trainNumber);
  const entry = pruneHistoryEntry(platformHistory[key]);
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

async function tchooGetJson(url) {
  const r = await fetch(url, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (compatible; Trajets-HDF/2.9.1)",
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

  const steps = Array.isArray(item.etapes) ? item.etapes : [];
  let origin = "";
  let destination = "";

  if (board === "departures") {
    origin = item.localite || "";
    destination = steps.length ? (steps[steps.length - 1]?.localite || "") : (item.localite || "");
  } else {
    origin = item.localite || "";
    destination = "";
  }

  return {
    trainNumber,
    platform: item.platform ? String(item.platform) : null,
    platformEstimated: false,
    platformConfidence: item.platform ? 100 : null,
    platformSource: item.platform ? "tchoo-official" : null,
    origin,
    destination,
    time: board === "departures" ? (item.fin || null) : (item.debut || null),
    bus: Number(item.bus || 0) === 1,
    mode: item.origine || ""
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
  let learned = false;
  for (const r of rows) {
    if (r.platform && !r.platformEstimated && !r.bus) {
      rememberOfficialPlatform(uic, r.trainNumber, r.platform);
      learned = true;
    }
  }
  if (learned) savePlatformHistory();

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
  rows = rows.map(r => {
    if (r.platform || r.bus) return r;
    const h = getHistoricalPlatform(uic, r.trainNumber);
    if (!h) return r;
    return {
      ...r,
      platform: h.platform,
      platformEstimated: true,
      platformConfidence: h.confidence,
      platformObservations: h.observations,
      platformSource: "local-history"
    };
  });

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
      console.warn(`Collecte auto ${station.name}/${board}:`, e.message);
    }
  }

  return { official, errors };
}

async function runAutoPlatformCollection() {
  if (autoCollectionRunning) return;
  autoCollectionRunning = true;

  const stats = { stations: 0, officialPlatformsSeen: 0, errors: 0 };

  try {
    for (const station of AUTO_COLLECTION_STATIONS) {
      const r = await collectStationHistory(station);
      stats.stations++;
      stats.officialPlatformsSeen += r.official;
      stats.errors += r.errors;

      // Petite pause entre gares pour rester raisonnable avec la source publique.
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } finally {
    autoCollectionLastRun = new Date().toISOString();
    autoCollectionStats = stats;
    autoCollectionRunning = false;
    console.log(
      `[Historique voies] collecte auto terminée: ${stats.stations} gares, ` +
      `${stats.officialPlatformsSeen} voies officielles vues, ${stats.errors} erreur(s)`
    );
  }
}

function startAutoPlatformCollection() {
  // Premier passage peu après le démarrage.
  setTimeout(() => runAutoPlatformCollection().catch(() => {}), 3000);

  // Puis toutes les 5 minutes tant que le serveur tourne.
  setInterval(() => runAutoPlatformCollection().catch(() => {}), AUTO_COLLECTION_INTERVAL_MS);
}

async function enrichWithTchoo(items, stopArea, board) {
  try {
    const rows = await fetchTchooStation(stopArea, board);
    const byTrain = new Map(rows.map(r => [r.trainNumber, r]));

    return items.map(item => {
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
        tchoo: Boolean(t.platform)
      };
    });
  } catch (e) {
    console.warn("Carto Tchoo indisponible:", e.message);
    return items;
  }
}

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


app.get("/api/bus-journeys", async (req, res) => {
  try {
    const fromName = String(req.query.fromName || "").trim();
    const toName = String(req.query.toName || "").trim();
    const date = String(req.query.date || "").trim();
    const time = String(req.query.time || "00:00").trim();

    if (!fromName || !toName || !date) {
      return res.status(400).json({ error: "Gares, date et heure obligatoires." });
    }

    const gtfs = await loadGtfs();
    const fromStops = matchCarStops(gtfs.stops, fromName);
    const toStops = matchCarStops(gtfs.stops, toName);

    const fromIds = new Set(fromStops.map(s => s.stop_id));
    const toIds = new Set(toStops.map(s => s.stop_id));
    const minSecs = gtfsSecs(time + ":00");

    const found = [];

    for (const trip of gtfs.trips) {
      if (!serviceRuns(gtfs, trip.service_id, date)) continue;

      const route = gtfs.routeById.get(trip.route_id);
      const times = gtfs.timesByTrip.get(trip.trip_id) || [];
      if (!times.length) continue;

      // Recognize coach journeys by route type OR OCECar stop points.
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

      found.push({
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

    found.sort((a,b) => a.departure.localeCompare(b.departure));
    res.json(found.slice(0, 12));
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



app.get("/api/platform-history-status", (req, res) => {
  const entries = Object.keys(platformHistory).length;
  const observations = Object.values(platformHistory).reduce(
    (sum, e) => sum + (Array.isArray(e?.observations) ? e.observations.length : 0),
    0
  );

  res.json({
    autoCollectionRunning,
    autoCollectionLastRun,
    intervalMinutes: AUTO_COLLECTION_INTERVAL_MS / 60000,
    stations: AUTO_COLLECTION_STATIONS,
    stats: autoCollectionStats,
    historyEntries: entries,
    observations
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    tokenConfigured: Boolean(TOKEN),
    busSource: "GTFS TER Hauts-de-France",
    platformSource: "API SNCF publique quand disponible"
  });
});

startAutoPlatformCollection();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Application SNCF Hauts-de-France : http://localhost:${PORT}`);
  console.log("Trains : API SNCF | Cars TER : GTFS officiel Hauts-de-France");
});
