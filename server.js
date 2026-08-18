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

  // Filtre principal par région, avec départements en secours.
  return text.includes("hauts-de-france") ||
         /\b(02|59|60|62|80)\b/.test(text);
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

    // Si l'API ne remonte pas le nom de région, garder les résultats SNCF
    // lorsque le filtre régional a tout éliminé, pour ne pas bloquer l'utilisateur.
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

    const data = await sncfGet("/journeys", {
      from,
      to,
      datetime,
      datetime_represents: "departure",
      count: 8,
      "allowed_id[]": "physical_mode:Train"
    });

    const journeys = (data.journeys || []).map(j => ({
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

app.get("/api/status", (req, res) => {
  res.json({ tokenConfigured: Boolean(TOKEN) });
});

app.listen(PORT, () => {
  console.log(`Application SNCF Hauts-de-France : http://localhost:${PORT}`);
});
