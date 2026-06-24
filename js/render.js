// @ts-check
// HTML builders, card renderers, and state templates. These produce markup and
// write it to the DOM; runtime behavior (search, embeds, navigation) lives in
// actions.js via data-action event delegation wired in app.js.

/** @typedef {import("./types").Comic} Comic */
/** @typedef {import("./types").Episode} Episode */

import { state } from "./state.js";
import { esc, safeUrl, fmtDate, fmtTs, tsToSeconds, parsePeople, isGuestEp, KEYWORD_NOISE } from "./format.js";
import { PANELIST_MAP, panelistNames } from "./panelists.js";

/** @param {string} html */
export function setResults(html) {
    /** @type {HTMLElement} */ (document.getElementById("results")).innerHTML = html;
}

/** @type {Record<string, string>} */
const SECTION_SUBTITLES = {
    "Comic Mentions": "specific moments a comic was discussed — click ⏱ to jump to that point",
    "Episodes by Topic": "full episodes matching your search",
};

/**
 * @param {string} label
 * @param {number} count
 */
export function sectionLabel(label, count) {
    const sub = SECTION_SUBTITLES[label] ? `<span class="section-subtitle">${SECTION_SUBTITLES[label]}</span>` : "";
    return `<div class="section-label">
        <div class="section-label-row">${label} <span class="result-count">${count} result${count !== 1 ? "s" : ""}</span></div>
        ${sub}
    </div>`;
}

/**
 * Find up to `limit` episodes related to `ep` by shared keywords/comics.
 * @param {Episode} ep
 * @param {number} [limit]
 * @returns {Episode[]}
 */
export function findRelated(ep, limit = 3) {
    const myKws = new Set(
        (ep.keywords || "").split(",").map(s => s.trim().toLowerCase()).filter(k => k && !KEYWORD_NOISE.has(k))
    );
    const myComics = state.comicsByEp[ep.show_id] || new Set();
    return state.episodes
        .filter(e => e.show_id !== ep.show_id)
        .map(e => {
            const eKws = new Set(
                (e.keywords || "").split(",").map(s => s.trim().toLowerCase()).filter(k => k && !KEYWORD_NOISE.has(k))
            );
            const eComics = state.comicsByEp[e.show_id] || new Set();
            let score = 0;
            for (const kw of myKws) if (eKws.has(kw)) score += 1;
            for (const comic of myComics) if (eComics.has(comic)) score += 2;
            return { ep: e, score };
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(r => r.ep);
}

/**
 * @param {Comic} mention
 * @returns {string}
 */
export function renderComicCard(mention) {
    /** @type {Partial<Episode>} */
    const ep    = state.epMap[mention.show_id] || {};
    const ts    = fmtTs(mention.timestamp);
    const date  = fmtDate(ep.date);
    const people  = parsePeople(ep.people).join(", ");
    const isGuest = isGuestEp(ep);

    const slug = ep.player_id || null;
    const secs = tsToSeconds(mention.timestamp);
    const key  = mention.show_id + ":" + (mention.timestamp || "");
    const url  = mention.direct_url || ep.simplecast_url;

    let action = "";
    if (slug && ts) {
        const inner = `<span class="ts-badge">⏱ ${esc(ts)}</span> Jump to mention →`;
        const extLink = url ? `<a class="card-ext-link" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">Simplecast ↗</a>` : "";
        action = `<button class="play-btn card-action timestamp" data-key="${esc(key)}" data-orig="${esc(inner)}"
            data-action="embed" data-slug="${esc(slug)}" data-secs="${secs}">${inner}</button>${extLink ? " " + extLink : ""}`;
    } else if (url && !slug) {
        if (ts) {
            action = `<a class="card-action timestamp" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">
                <span class="ts-badge">⏱ ${esc(ts)}</span> Jump to mention →
            </a>`;
        } else {
            action = `<a class="card-action listen" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">
                ▶ Listen to episode →
            </a>`;
        }
    }

    let playBtn = "";
    if (slug && !ts) {
        const extLink = url ? `<a class="card-ext-link" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">Simplecast ↗</a>` : "";
        playBtn = `<button class="play-btn card-action listen" data-key="${esc(key)}" data-orig="▶ Play"
            data-action="embed" data-slug="${esc(slug)}" data-secs="0">▶ Play</button>${extLink ? " " + extLink : ""}`;
    }
    if (slug) playBtn += `<div class="embed-wrap" data-key="${esc(key)}"></div>`;

    return `<div class="card card-comic">
        <div class="card-band">
            <button class="comic-eyebrow" data-action="search" data-q="${esc(mention.comic)}">${esc(mention.comic)} →</button>
        </div>
        <div class="card-top">
            <div class="episode-title">${esc(ep.title || "")}</div>
            ${date ? `<span class="card-date">${date}</span>` : ""}
        </div>
        <div class="card-meta">
            ${people ? `<span class="meta-people">with ${esc(people)}</span>` : ""}
            ${mention.segment ? `<span class="pill pill-red">${esc(mention.segment)}</span>` : ""}
            ${isGuest ? `<span class="pill pill-orange">Guest</span>` : ""}
        </div>
        ${action}
        ${playBtn}
    </div>`;
}

/**
 * @param {Episode} ep
 * @returns {string}
 */
export function renderEpisodeCard(ep) {
    const date   = fmtDate(ep.date);
    const people  = parsePeople(ep.people).join(", ");
    const isGuest = isGuestEp(ep);
    const kwList = ep.keywords
        ? String(ep.keywords).split(",").map(s => s.trim()).filter(Boolean)
        : [];
    const qLow = state.query.toLowerCase();

    const kwHtml = kwList.length
        ? `<button class="tags-toggle" data-action="tags" data-id="${esc(ep.show_id)}">▾ Tags (${kwList.length})</button><div class="card-tags" id="card-tags-${esc(ep.show_id)}" hidden><div class="keywords">${kwList.map(k => {
                const hit = k.toLowerCase().includes(qLow) || qLow.includes(k.toLowerCase());
                return `<span class="kw${hit ? " match" : ""}">${esc(k)}</span>`;
            }).join("")}</div></div>`
        : "";

    const slug = ep.player_id || null;
    const key  = ep.show_id + ":";
    const extUrl = ep.simplecast_url ? safeUrl(ep.simplecast_url) : null;
    const action = (!slug && extUrl)
        ? `<a class="play-btn card-action listen" href="${esc(extUrl)}" target="_blank" rel="noopener noreferrer">▶ Play</a> <a class="card-ext-link" href="${esc(extUrl)}" target="_blank" rel="noopener noreferrer">Simplecast ↗</a>`
        : "";
    const extLink = (slug && extUrl)
        ? `<a class="card-ext-link" href="${esc(extUrl)}" target="_blank" rel="noopener noreferrer">Simplecast ↗</a>`
        : "";
    const playBtn = slug ? `<button class="play-btn card-action listen" data-key="${esc(key)}" data-orig="▶ Play"
        data-action="embed" data-slug="${esc(slug)}" data-secs="0">▶ Play</button>${extLink ? " " + extLink : ""}
        <div class="embed-wrap" data-key="${esc(key)}"></div>` : "";

    return `<div class="card card-episode"${ep.summary ? ` data-show-id="${esc(ep.show_id)}"` : ""}>
        <div class="card-top">
            <div class="episode-title">${esc(ep.title || "")}</div>
            ${date ? `<span class="card-date">${date}</span>` : ""}
        </div>
        <div class="card-meta">
            ${people ? `<span class="meta-people">with ${esc(people)}</span>` : ""}
            ${isGuest ? `<span class="pill pill-orange">Guest</span>` : ""}
        </div>
        ${action}
        ${playBtn}
        ${ep.summary ? (() => {
            const related = findRelated(ep);
            const relatedHtml = related.length
                ? `<div class="related-eps"><span class="related-label">Episodes you might also like</span>${
                    related.map(r => `<button class="related-chip" data-action="search" data-q="${esc(r.title || "")}">${esc(r.title)}</button>`).join("")
                }</div>`
                : "";
            return `<button class="summary-toggle" data-action="summary" data-id="${esc(ep.show_id)}">▾ Show notes</button><div class="card-summary" id="card-summary-${esc(ep.show_id)}" hidden><p class="summary-text">${esc(ep.summary)}</p>${relatedHtml}</div>`;
        })() : ""}
        ${kwHtml}
    </div>`;
}

/** Build the panelist/guest filter chip row shown above results. */
export function panelistFilterHtml() {
    if (!state.panelists.length) return "";
    const chips = state.panelists.map(name => {
        const p = PANELIST_MAP[name];
        const label = p ? p.display.split(" ")[0] : name.split(" ")[0];
        return `<button class="panelist-chip${state.panelist === name ? " active" : ""}"
            data-action="set-panelist" data-name="${esc(name)}">
            ${esc(label)}
        </button>`;
    }).join("");
    const guestDisabled = !!state.panelist;
    const guestChip = `<button class="panelist-chip guest-chip${state.guestOnly ? " active" : ""}${guestDisabled ? " disabled" : ""}"
        title="${guestDisabled ? "Clear the panelist filter to filter by outside guest episodes instead" : "Episodes featuring an outside guest (creator, industry guest, etc.)"}"
        ${guestDisabled ? "disabled" : `data-action="toggle-guest"`}>Guest Episodes</button>`;
    const overflowChip = (state.panelist && !state.panelists.includes(state.panelist))
        ? `<button class="panelist-chip active" data-action="set-panelist" data-name="${esc(state.panelist ?? "")}">
            ${esc(state.panelist)} ✕
          </button>`
        : "";
    const filterActive = !!(state.panelist || state.guestOnly);
    return `<div class="panelist-row${filterActive ? " filter-active" : ""}">
        <span class="sort-label">Filter:</span>
        <div class="panelist-chips">${overflowChip}${chips}${guestChip}</div>
    </div>`;
}

/**
 * Render the full single-panelist page (hero, stats, top comics, episodes).
 * @param {string} name
 */
export function renderPanelistPage(name) {
    // Hide search UI elements
    /** @type {HTMLElement} */ (document.getElementById("search-input")).style.display = "none";
    /** @type {HTMLElement} */ (document.getElementById("clear-btn")).style.display = "none";
    /** @type {HTMLElement} */ (document.querySelector(".tabs")).style.display = "none";

    const panelistEps = state.episodes
        .filter(ep => parsePeople(ep.people).some(n => panelistNames(name).includes(n)))
        .sort((a, b) => state.panelistSort === "oldest"
            ? +new Date(a.date || 0) - +new Date(b.date || 0)
            : +new Date(b.date || 0) - +new Date(a.date || 0));

    if (!panelistEps.length) {
        setResults(`<div class="state-box">
            <button class="back-link" data-action="home">← Back to search</button>
            <h2>No episodes found for ${esc(name)}</h2>
        </div>`);
        return;
    }

    // Aggregate top comics for this panelist
    const epIds = new Set(panelistEps.map(ep => ep.show_id));
    /** @type {Record<string, number>} */
    const panelistComicCounts = {};
    state.comics.forEach(m => {
        if (m.comic && epIds.has(m.show_id)) {
            panelistComicCounts[m.comic] = (panelistComicCounts[m.comic] || 0) + 1;
        }
    });
    const topPanelistComics = Object.entries(panelistComicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([comic, count]) => `<button class="trending-chip" data-action="panelist-search" data-name="${esc(name)}" data-q="${esc(comic)}">
            <span class="tc-name">${esc(comic)}</span>
            <span class="tc-count">${count} eps</span>
        </button>`).join("");

    const datedEps   = panelistEps.filter(ep => fmtDate(ep.date));
    const firstDate  = datedEps.length ? fmtDate(datedEps[datedEps.length - 1].date) : "";
    const latestDate = datedEps.length ? fmtDate(datedEps[0].date) : "";
    const dateRange  = (!firstDate && !latestDate) ? ""
        : (firstDate && latestDate && firstDate !== latestDate)
            ? `First: ${firstDate} · Latest: ${latestDate}`
            : (firstDate || latestDate);

    const pInfo = PANELIST_MAP[name];
    const photoHtml = pInfo
        ? `<img class="panelist-photo" src="${esc(pInfo.photo)}" alt="${esc(pInfo.display)}">`
        : "";
    const heroName = pInfo ? pInfo.display : name;

    const taglineHtml = pInfo?.tagline ? `<div class="panelist-tagline">${esc(pInfo.tagline)}</div>` : "";
    const html = `
        <button class="back-link" data-action="home">← Back to search</button>
        ${photoHtml}
        <div class="panelist-hero">${esc(heroName)}</div>
        ${taglineHtml}
        <div class="panelist-stats">${panelistEps.length} episode${panelistEps.length !== 1 ? "s" : ""}${dateRange ? ` · ${dateRange}` : ""}</div>
        ${topPanelistComics ? `<p class="trending-header">Most Discussed</p>
        <div class="trending-grid" style="margin-bottom:2rem">${topPanelistComics}</div>` : ""}
        <div class="panelist-sort-row">
            <span class="sort-label">Sort:</span>
            <button class="sort-btn${state.panelistSort === "newest" ? " active" : ""}" data-action="panelist-sort" data-sort="newest">Newest First</button>
            <button class="sort-btn${state.panelistSort === "oldest" ? " active" : ""}" data-action="panelist-sort" data-sort="oldest">Oldest First</button>
        </div>
        ${panelistEps.map(ep => renderEpisodeCard(ep)).join("")}
    `;
    setResults(html);
}

/** Empty/landing state: trending chips for all-time, last 12 months, this week. */
function renderRecentEpisodes() {
    if (!state.recentEpisodes.length) return "";
    return `<div class="recent-eps-section">
        ${sectionLabel("Recent Episodes", state.recentEpisodes.length)}
        ${state.recentEpisodes.map(ep => renderEpisodeCard(ep)).join("")}
    </div>`;
}

export function emptyState() {
    if (!state.topComics.length) {
        return `<div class="state-box">
            <div class="icon">🦸</div>
            <h2>Find Your Comics</h2>
            <p>Type a comic title, publisher, creator, or topic to find every episode that covers it.</p>
        </div>`;
    }
    /** @param {{name:string,count?:number}[]} arr */
    const renderChips = arr => arr.map(({ name, count }) =>
        `<button class="trending-chip" data-action="search" data-q="${esc(name)}">
            <span class="tc-name">${esc(name)}</span>
            <span class="tc-count">${count} eps</span>
        </button>`
    ).join("");
    const recentSection = state.topRecentComics.length
        ? `<p class="trending-header" style="margin-top:1.5rem">Last 12 Months</p>
           <div class="trending-grid">${renderChips(state.topRecentComics)}</div>`
        : "";
    const newThisWeek = (state.latestEpisodeInfo && state.latestEpisodeComics.length)
        ? `<div style="margin-bottom:2rem">
            <p class="trending-header">New This Week</p>
            <p class="new-this-week-ep">${esc(state.latestEpisodeInfo.title)} — ${fmtDate(state.latestEpisodeInfo.date)}</p>
            <div class="trending-grid">${state.latestEpisodeComics.map(name =>
                `<button class="trending-chip" data-action="search" data-q="${esc(name)}">
                    <span class="tc-name">${esc(name)}</span>
                </button>`
            ).join("")}</div>
          </div>`
        : "";
    return `<div class="empty-state-wrap">
        ${renderRecentEpisodes()}
        ${newThisWeek}
        <p class="trending-header">All Time</p>
        <div class="trending-grid">${renderChips(state.topComics)}</div>
        ${recentSection}
    </div>`;
}

export function noResultsState() {
    const filterActive = state.panelist || state.guestOnly;
    const filterLabel = state.guestOnly ? "Guest Episodes" : state.panelist;
    const clearAttrs = state.guestOnly
        ? `data-action="toggle-guest"`
        : `data-action="set-panelist" data-name="${esc(state.panelist ?? "")}"`;
    const msg = filterActive
        ? `Nothing found for "<strong>${esc(state.query)}</strong>" with the <strong>${esc(filterLabel)}</strong> filter active.
           <button class="clear-filter-btn" ${clearAttrs}>Clear filter →</button>`
        : `Nothing found for "<strong>${esc(state.query)}</strong>". Try a broader term or check the spelling.`;
    return `<div>
        ${filterActive ? panelistFilterHtml() : ""}
        <div class="state-box">
            <div class="icon">🔍</div>
            <h2>No Results</h2>
            <p>${msg}</p>
        </div>
    </div>`;
}

export function loadingState() {
    return `<div class="state-box loading">
        <div class="icon">⚙️</div>
        <h2>Loading…</h2>
        <p>Fetching episode data.</p>
    </div>`;
}

/** @param {boolean} notFound */
export function errorState(notFound) {
    return notFound
        ? `<div class="state-box error">
            <div class="icon">📂</div>
            <h2>Episode Data Unavailable</h2>
            <p>The episode data couldn't be loaded. Try refreshing the page.</p>
        </div>`
        : `<div class="state-box error">
            <div class="icon">⚠️</div>
            <h2>Something Went Wrong</h2>
            <p>Couldn't load episode data. Try refreshing — if it keeps happening, <a href="https://github.com/mikerapin/ircb-search/issues" target="_blank" rel="noopener noreferrer">let us know</a>.</p>
        </div>`;
}
