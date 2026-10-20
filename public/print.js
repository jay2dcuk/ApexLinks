import { reportRows, reportDatasets } from "./operations.js";
const root = document.querySelector("#report");
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const moneyColumns = new Set(["amount", "fee"]);
const label = (key) =>
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
try {
  const params = new URLSearchParams(location.search);
  const response = await fetch(
    `/api/orgs/${encodeURIComponent(params.get("org") || "")}/state`,
    { cache: "no-store" },
  );
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in to ApexLinks, then reopen this report."
        : "You do not have access to this report.",
    );
  const { state, organisation } = await response.json();
  if (!["admin", "manager"].includes(organisation.role))
    throw new Error("Only club organisers can print reports.");
  const view = state.reportViews.find((v) => v.id === params.get("view"));
  if (
    !view ||
    !Object.hasOwn(reportDatasets, view.dataset) ||
    view.columns.some((c) => !reportDatasets[view.dataset].includes(c))
  )
    throw new Error("This report layout is unavailable.");
  const rows = reportRows(state, view);
  const currencies = new Set(rows.map((r) => r.currency).filter(Boolean));
  // Each organisation currently records GBP. Never sum unlike currencies.
  const format = (value, column) =>
    moneyColumns.has(column) && typeof value === "number"
      ? (value / 100).toFixed(2)
      : value;
  document.documentElement.className =
    view.orientation === "landscape" ? "landscape" : "portrait";
  document.title = `${view.name} · ApexLinks`;
  root.innerHTML = `<header>${view.showOrgName !== false ? `<p class="club">${esc(organisation.name)}</p>` : ""}<h1>${esc(view.name)}</h1>${view.subtitle ? `<p>${esc(view.subtitle)}</p>` : ""}<p class="metadata">${esc(new Date().toLocaleString())} · ${rows.length} records${view.status ? ` · Status: ${esc(view.status)}` : ""}</p></header><table><thead><tr>${view.columns.map((c) => `<th scope="col">${esc(label(c))}${moneyColumns.has(c) ? " (GBP)" : ""}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${view.columns.map((c) => `<td>${esc(format(r[c], c))}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${view.columns.length}">No matching records.</td></tr>`}</tbody>${
    view.showTotals &&
    currencies.size <= 1 &&
    (!currencies.size || currencies.has("GBP"))
      ? `<tfoot><tr>${view.columns
          .map(
            (c, i) =>
              `<td>${
                moneyColumns.has(c)
                  ? esc(
                      format(
                        rows.reduce(
                          (sum, r) =>
                            sum + (typeof r[c] === "number" ? r[c] : 0),
                          0,
                        ),
                        c,
                      ),
                    )
                  : i === 0
                    ? "Total"
                    : ""
              }</td>`,
          )
          .join("")}</tr></tfoot>`
      : ""
  }</table>${view.footer ? `<footer>${esc(view.footer)}</footer>` : ""}`;
  document.querySelector("#print").disabled = false;
  document.querySelector("#print").onclick = () => window.print();
} catch (error) {
  root.textContent = error.message;
}
