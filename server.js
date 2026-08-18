require("dotenv").config();
const express = require("express");
const path = require("path");

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
    const err = new Error("Token SNCF manquant.");
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
  const text = [sa.name, sa.label, ...regions.flatMap(r => [r.name, r.label, r.zip_code])]
    .filter(Boolean).join(" ").toLowerCase();
  return text.includes("hauts-de-france") || /\b(02|59|60|62|80)\b/.test(text);
}

app.get("/api/stations", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json([]);
    const data = await sncfGet("/places", { q, "type[]": "stop_area", count: 20 });
    const all = (data.places || []).filter(p => p.embedded_type === "stop_area" && p.stop_area);
    const filtered = all.filter(isHautsDeFrance);
    const source = filtered.length ? filtered : all.slice(0, 8);
    res.json(source.slice(0, 10).map(p => ({
      id: p.stop_area.id,
      name: p.stop_area.name,
      label: p.stop_area.label || p.stop_area.name
    })));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/journeys", async (req, res) => {
  try {
    const { from, to, datetime } = req.query;
    if (!from || !to) return res.status(400).json({ error: "Départ et arrivée obligatoires." });
    const data = await sncfGet("/journeys", {
      from, to, datetime, datetime_represents: "departure", count: 8,
      "allowed_id[]": "physical_mode:Train"
    });
    res.json((data.journeys || []).map(j => ({
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
    })));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/departures", async (req, res) => {
  try {
    const { station, datetime } = req.query;
    if (!station) return res.status(400).json({ error: "Gare obligatoire." });
    const endpoint = `/stop_areas/${encodeURIComponent(station)}/departures`;
    const data = await sncfGet(endpoint, {
      from_datetime: datetime,
      data_freshness: "realtime",
      count: 30,
      depth: 2
    });
    const departures = (data.departures || []).map(d => {
      const info = d.display_informations || {};
      const sdt = d.stop_date_time || {};
      const sp = d.stop_point || {};
      const props = sp.properties || {};
      const platform = sp.platform_code || props.platform_code || props.platform || sp.code || null;
      const planned = sdt.base_departure_date_time || null;
      const actual = sdt.departure_date_time || planned;
      let delay = 0;
      if (planned && actual) {
        const parse = x => new Date(`${x.slice(0,4)}-${x.slice(4,6)}-${x.slice(6,8)}T${x.slice(9,11)}:${x.slice(11,13)}:${x.slice(13,15)}`);
        delay = Math.max(0, Math.round((parse(actual) - parse(planned)) / 60000));
      }
      return {
        departure: actual,
        plannedDeparture: planned,
        trainNumber: info.headsign || info.code || "",
        mode: info.commercial_mode || "Train",
        direction: info.direction || info.label || "",
        platform,
        stopPointName: sp.name || "",
        realtime: sdt.data_freshness === "realtime",
        delay
      };
    });
    res.json(departures);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/status", (req, res) => res.json({ tokenConfigured: Boolean(TOKEN) }));

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => console.log(`Application SNCF Hauts-de-France : http://localhost:${PORT}`));
}
module.exports = app;
