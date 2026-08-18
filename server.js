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
        departure: s.departure_date_time || null,
        arrival: s.arrival_date_time || null,
        display: s.display_informations ? {
          commercial_mode: s.display_informations.commercial_mode,
          network: s.display_informations.network,
          label: s.display_informations.label,
          direction: s.display_informations.direction,
          headsign: s.display_informations.headsign
        } : null
      }))
    }));

    res.json(journeys);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});


// -----------------------
// Tableaux Départs / Arrivées SNCF
// -----------------------
function mapStopDateTime(dt) {
  return dt || null;
}

app.get("/api/departures", async (req, res) => {
  try {
    const { stopArea, datetime } = req.query;
    if (!stopArea) return res.status(400).json({ error: "Gare obligatoire." });

    const data = await sncfGet(`/stop_areas/${encodeURIComponent(stopArea)}/departures`, {
      from_datetime: datetime,
      duration: 7200,
      count: 30
    });

    const items = (data.departures || []).map(d => ({
      type: "departure",
      transportType: "train",
      datetime: mapStopDateTime(d.stop_date_time?.departure_date_time),
      baseDatetime: mapStopDateTime(d.stop_date_time?.base_departure_date_time),
      stop: d.stop_point?.name || "",
      direction: d.display_informations?.direction || "",
      headsign: d.display_informations?.headsign || "",
      label: d.display_informations?.label || "",
      commercialMode: d.display_informations?.commercial_mode || "",
      network: d.display_informations?.network || "",
      status: d.stop_date_time?.data_freshness || null,
      platform: d.stop_point?.platform_code || d.stop_point?.platform || d.stop_point?.name?.match(/(?:voie|quai)\s*([A-Z0-9]+)/i)?.[1] || null
    }));
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
      duration: 7200,
      count: 30
    });

    const items = (data.arrivals || []).map(a => ({
      type: "arrival",
      transportType: "train",
      datetime: mapStopDateTime(a.stop_date_time?.arrival_date_time),
      baseDatetime: mapStopDateTime(a.stop_date_time?.base_arrival_date_time),
      stop: a.stop_point?.name || "",
      direction: a.display_informations?.direction || "",
      headsign: a.display_informations?.headsign || "",
      label: a.display_informations?.label || "",
      commercialMode: a.display_informations?.commercial_mode || "",
      network: a.display_informations?.network || "",
      status: a.stop_date_time?.data_freshness || null,
      platform: a.stop_point?.platform_code || a.stop_point?.platform || a.stop_point?.name?.match(/(?:voie|quai)\s*([A-Z0-9]+)/i)?.[1] || null
    }));
    res.json(items);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
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
    const nf = norm(fromName), nt = norm(toName);

    // OCECar stops are specifically the TER road coach stop points.
    const fromStops = gtfs.stops.filter(s =>
      /OCECar/i.test(s.stop_id) && (norm(s.stop_name) === nf || norm(s.stop_name).includes(nf) || nf.includes(norm(s.stop_name)))
    );
    const toStops = gtfs.stops.filter(s =>
      /OCECar/i.test(s.stop_id) && (norm(s.stop_name) === nt || norm(s.stop_name).includes(nt) || nt.includes(norm(s.stop_name)))
    );

    const fromIds = new Set(fromStops.map(s => s.stop_id));
    const toIds = new Set(toStops.map(s => s.stop_id));
    const minSecs = gtfsSecs(time + ":00");

    const found = [];
    for (const trip of gtfs.trips) {
      const route = gtfs.routeById.get(trip.route_id);
      // GTFS route_type 3 = bus. Some SNCF feeds may use coach-like extended types;
      // OCECar stop points are the additional safeguard.
      if (!route || !["3","700","701","702","704","705","710","712","715","717"].includes(route.route_type)) continue;
      if (!serviceRuns(gtfs, trip.service_id, date)) continue;

      const times = gtfs.timesByTrip.get(trip.trip_id) || [];
      let fromIdx = -1, toIdx = -1;
      for (let i = 0; i < times.length; i++) {
        if (fromIdx < 0 && fromIds.has(times[i].stop_id)) fromIdx = i;
        if (fromIdx >= 0 && i > fromIdx && toIds.has(times[i].stop_id)) { toIdx = i; break; }
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
            label: route.route_short_name || route.route_long_name || "",
            direction: trip.trip_headsign || "",
            headsign: trip.trip_headsign || ""
          }
        }]
      });
    }

    found.sort((a,b) => a.departure.localeCompare(b.departure));
    res.json(found.slice(0, 8));
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

app.get("/api/status", (req, res) => {
  res.json({
    tokenConfigured: Boolean(TOKEN),
    busSource: "GTFS TER Hauts-de-France"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Application SNCF Hauts-de-France : http://localhost:${PORT}`);
  console.log("Trains : API SNCF | Cars TER : GTFS officiel Hauts-de-France");
});
