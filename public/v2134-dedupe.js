/* Trajets HDF v2.13.4 — dédoublonnage des taxis de roulement. */
(() => {
  if (typeof rosterTaxiJourneys !== "function") return;
  const originalRosterTaxiJourneys = rosterTaxiJourneys;

  rosterTaxiJourneys = function(payload, fromName, toName, dateStr, timeStr) {
    const rows = originalRosterTaxiJourneys(payload, fromName, toName, dateStr, timeStr) || [];
    const seen = new Set();
    return rows.filter(j => {
      const section = Array.isArray(j.sections) ? j.sections[0] : null;
      const key = [
        j.taxiAgentType || "",
        j.rosterJS || "",
        j.departure || "",
        j.arrival || "",
        section?.from || "",
        section?.to || ""
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
})();
