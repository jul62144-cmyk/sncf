const $ = id => document.getElementById(id);
const state = { from: null, to: null };

function pad(n) { return String(n).padStart(2, "0"); }

function initDate() {
  const d = new Date();
  $("date").value = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  $("time").value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
initDate();

function apiDatetime() {
  return `${$("date").value.replaceAll("-", "")}T${$("time").value.replaceAll(":", "")}00`;
}

function fmt(dt) {
  if (!dt) return "";
  const m = dt.match(/T(\d{2})(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : dt;
}

function duration(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${pad(m)}` : `${m} min`;
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}

function setStatus(msg, error = false) {
  $("status").textContent = msg || "";
  $("status").className = "status" + (error ? " error" : "");
}

function setupAutocomplete(inputId, listId, key) {
  const input = $(inputId);
  const list = $(listId);

  const search = debounce(async () => {
    state[key] = null;
    const q = input.value.trim();
    if (q.length < 2) {
      list.innerHTML = "";
      return;
    }

    try {
      const r = await fetch(`/api/stations?q=${encodeURIComponent(q)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Erreur de recherche");
      list.innerHTML = data.map(s =>
        `<div class="suggestion" data-id="${s.id}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.label)}</div>`
      ).join("");
    } catch (e) {
      list.innerHTML = "";
      setStatus(e.message, true);
    }
  });

  input.addEventListener("input", search);

  list.addEventListener("click", e => {
    const item = e.target.closest(".suggestion");
    if (!item) return;

    state[key] = {
      id: item.dataset.id,
      name: item.dataset.name
    };
    input.value = item.dataset.name;
    list.innerHTML = "";
  });
}

setupAutocomplete("from", "from-list", "from");
setupAutocomplete("to", "to-list", "to");

$("swap").addEventListener("click", () => {
  [state.from, state.to] = [state.to, state.from];
  const a = $("from").value;
  $("from").value = $("to").value;
  $("to").value = a;
});

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem("hdfFavorites") || "[]");
  } catch {
    return [];
  }
}

function saveFavorites(items) {
  localStorage.setItem("hdfFavorites", JSON.stringify(items));
  renderFavorites();
}

function addFavorite(station) {
  if (!station?.id) return;
  const items = getFavorites();
  if (!items.some(x => x.id === station.id)) {
    items.push(station);
    saveFavorites(items);
  }
}

function removeFavorite(id) {
  saveFavorites(getFavorites().filter(x => x.id !== id));
}

function renderFavorites() {
  const items = getFavorites();
  $("favorites").innerHTML = items.map(x =>
    `<span class="favorite-chip">
      <button data-use="${x.id}" data-name="${escapeHtml(x.name)}">${escapeHtml(x.name)}</button>
      <button data-remove="${x.id}" title="Supprimer">×</button>
    </span>`
  ).join("");
}

$("fav-from").addEventListener("click", () => addFavorite(state.from));
$("fav-to").addEventListener("click", () => addFavorite(state.to));

$("favorites").addEventListener("click", e => {
  const remove = e.target.dataset.remove;
  if (remove) return removeFavorite(remove);

  const use = e.target.dataset.use;
  if (use) {
    const station = { id: use, name: e.target.dataset.name };
    if (!state.from) {
      state.from = station;
      $("from").value = station.name;
    } else {
      state.to = station;
      $("to").value = station.name;
    }
  }
});

renderFavorites();

$("search").addEventListener("click", async () => {
  if (!state.from || !state.to) {
    return setStatus("Choisis les deux gares dans les propositions affichées.", true);
  }

  setStatus("Recherche des trajets…");
  $("results").innerHTML = "";

  try {
    const qs = new URLSearchParams({
      from: state.from.id,
      to: state.to.id,
      datetime: apiDatetime()
    });
    const r = await fetch(`/api/journeys?${qs}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Erreur API SNCF");

    render(data);
    setStatus(data.length ? `${data.length} trajet(s) trouvé(s).` : "Aucun trajet trouvé.");
  } catch (e) {
    setStatus(e.message, true);
  }
});

function render(items) {
  $("results").innerHTML = items.map((j, i) => {
    const trainSections = j.sections.filter(s => s.type === "public_transport");

    const details = trainSections.map(s => {
      const d = s.display || {};
      const train = [d.commercial_mode, d.label || d.headsign].filter(Boolean).join(" ");
      return `<div class="section">
        <div class="train">${escapeHtml(train || "Train")}</div>
        <div>${escapeHtml(s.from || "")} ${fmt(s.departure)} → ${escapeHtml(s.to || "")} ${fmt(s.arrival)}</div>
        ${d.direction ? `<div class="meta">Direction : ${escapeHtml(d.direction)}</div>` : ""}
      </div>`;
    }).join("");

    return `<article class="journey" data-i="${i}">
      <div class="times">
        <span class="time">${fmt(j.departure)}</span>
        <span class="line"></span>
        <span class="time">${fmt(j.arrival)}</span>
      </div>
      <div class="meta">
        ${duration(j.duration)} • ${j.transfers === 0 ? "Direct" : `${j.transfers} correspondance(s)`}
      </div>
      <div class="details">${details || "Détails non disponibles."}</div>
    </article>`;
  }).join("");

  document.querySelectorAll(".journey").forEach(el => {
    el.addEventListener("click", () => el.classList.toggle("open"));
  });
}

fetch("/api/status")
  .then(r => r.json())
  .then(s => {
    if (!s.tokenConfigured) {
      setStatus("Configuration requise : ajoute ton token API SNCF dans le fichier .env.", true);
    }
  });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}
