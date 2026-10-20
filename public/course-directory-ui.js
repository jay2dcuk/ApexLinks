// Remote requests are debounced; cancellation and sequence checks prevent stale results.
export function bindCourseDirectory(d, { api, path, esc, onAdd }) {
  const name = d.querySelector('[name="name"]'),
    country = d.querySelector('[name="country"]'),
    search = d.querySelector("#directory-search"),
    results = d.querySelector("#directory-results");
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  results.removeAttribute("role");
  results.before(status);
  let timer,
    controller,
    sequence = 0,
    mapTimer;
  name.autocomplete = "off";
  name.setAttribute("aria-describedby", "directory-hint");
  const hint = document.createElement("p");
  hint.id = "directory-hint";
  hint.textContent =
    "Type at least 3 characters for automatic suggestions. A country code helps narrow worldwide searches. Tab to a result to view its map.";
  name.after(hint);

  function showMap(venue) {
    clearTimeout(mapTimer);
    let panel = results.querySelector(".directory-map");
    if (!panel) {
      panel = document.createElement("section");
      panel.className = "directory-map";
      results.prepend(panel);
    }
    const lat = venue.latitude,
      lon = venue.longitude;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      panel.textContent = "This directory entry has no map coordinates.";
      return;
    }
    const link = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`;
    const bbox = [
      Math.max(-180, lon - 0.025),
      Math.max(-90, lat - 0.015),
      Math.min(180, lon + 0.025),
      Math.min(90, lat + 0.015),
    ].join(",");
    panel.innerHTML = `<h3>${esc(venue.name)} · Map</h3><p class="map-status" role="status">Loading map… If the map is blocked, use the link below.</p><iframe title="${esc(venue.name)} map" referrerpolicy="strict-origin-when-cross-origin" src="https://www.openstreetmap.org/export/embed.html?${esc(new URLSearchParams({ bbox, layer: "mapnik", marker: `${lat},${lon}` }))}"></iframe><p>© OpenStreetMap contributors · <a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open full map</a></p>`;
    const frame = panel.querySelector("iframe"),
      message = panel.querySelector(".map-status");
    frame.addEventListener("load", () => {
      clearTimeout(mapTimer);
      message.textContent =
        "Pan and zoom the map below. If it appears blank, open the full map.";
    });
    mapTimer = setTimeout(() => {
      message.textContent =
        "The map is taking longer than expected. Try Open full map.";
    }, 10000);
  }

  async function run() {
    clearTimeout(timer);
    clearTimeout(mapTimer);
    controller?.abort();
    search.textContent = "Search directory";
    const current = ++sequence;
    if (name.value.trim().length < 3) {
      status.textContent = "Enter at least three characters.";
      results.replaceChildren();
      return;
    }
    controller = new AbortController();
    const active = controller;
    const deadline = setTimeout(() => active.abort(), 12000);
    status.textContent = "Searching course locations…";
    search.textContent = "Search again";
    results.replaceChildren();
    try {
      const data = await api(
        path +
          "?" +
          new URLSearchParams({
            name: name.value.trim(),
            country: country.value.trim().toUpperCase(),
          }),
        "GET",
        undefined,
        { signal: active.signal },
      );
      if (current !== sequence || !d.isConnected) return;
      status.textContent = `${data.venues.length} matching locations. ${data.coverage}`;
      results.innerHTML =
        data.venues
          .map(
            (v, i) =>
              `<article class="notice"><h3>${esc(v.name)}</h3><p>${esc([v.location, v.country].filter(Boolean).join(", "))}</p><p>Slope and rating not supplied.</p><button type="button" class="outline" data-map="${i}">View map</button> <button type="button" class="outline" data-venue="${i}">Add tee data</button></article>`,
          )
          .join("") ||
        "<p>No matching courses found. Try a different name or add course data manually.</p>";
      results
        .querySelectorAll("[data-map]")
        .forEach(
          (b) =>
            (b.onclick = () => showMap(data.venues[Number(b.dataset.map)])),
        );
      results
        .querySelectorAll("[data-venue]")
        .forEach(
          (b) =>
            (b.onclick = () => onAdd(data.venues[Number(b.dataset.venue)])),
        );
      if (data.venues.length) showMap(data.venues[0]);
    } catch (error) {
      if (current !== sequence || !d.isConnected) return;
      status.textContent = active.signal.aborted
        ? "Search timed out. Try a country code and Search directory again, or import course data."
        : error.message;
    } finally {
      clearTimeout(deadline);
      if (current === sequence) search.textContent = "Search directory";
    }
  }
  function suggest() {
    search.textContent = "Search directory";
    clearTimeout(timer);
    controller?.abort();
    ++sequence;
    results.replaceChildren();
    clearTimeout(mapTimer);
    status.textContent =
      name.value.trim().length < 3
        ? "Enter at least three characters."
        : "Suggestions will appear after you finish typing…";
    if (name.value.trim().length >= 3) timer = setTimeout(run, 1700);
  }
  name.addEventListener("input", suggest);
  country.addEventListener("input", suggest);
  for (const field of [name, country])
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        run();
      }
    });
  search.onclick = run;
  d.addEventListener(
    "close",
    () => {
      ++sequence;
      clearTimeout(timer);
      clearTimeout(mapTimer);
      controller?.abort();
    },
    { once: true },
  );
}
