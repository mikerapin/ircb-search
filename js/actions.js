// @ts-check
// Runtime behavior: running searches, toggling embeds, and the navigation /
// filter handlers wired to UI controls via data-action event delegation.

import { state } from "./state.js";
import { esc, safeUrl, secsToSimplecastT, parsePeople, isGuestEp } from "./format.js";
import { panelistNames } from "./panelists.js";
import {
    setResults, emptyState, noResultsState, sectionLabel,
    renderComicCard, renderEpisodeCard, panelistFilterHtml, renderPanelistPage,
} from "./render.js";

/** Run the current query/mode/filters and render the results. */
export function runSearch() {
    if (!state.fuseComics) return;
    if (!state.query.trim()) { setResults(emptyState()); return; }

    let comicHits   = [];
    let episodeHits = [];

    if (state.mode !== "topics") {
        comicHits = state.fuseComics.search(state.query, { limit: 100 }).map(r => r.item);
    }

    if (state.mode !== "comics") {
        const seen = new Set();
        episodeHits = state.fuseEpisodes.search(state.query, { limit: 100 })
            .map(r => r.item)
            .filter(ep => {
                if (seen.has(ep.show_id)) return false;
                seen.add(ep.show_id);
                return true;
            });
    }

    // Apply panelist filter
    if (state.panelist) {
        const pNames = panelistNames(state.panelist);
        comicHits   = comicHits.filter(m => parsePeople((state.epMap[m.show_id] || {}).people).some(n => pNames.includes(n)));
        episodeHits = episodeHits.filter(ep => parsePeople(ep.people).some(n => pNames.includes(n)));
    }

    // Apply guest filter
    if (state.guestOnly) {
        comicHits   = comicHits.filter(m => isGuestEp(state.epMap[m.show_id] || {}));
        episodeHits = episodeHits.filter(ep => isGuestEp(ep));
    }

    if (!comicHits.length && !episodeHits.length) {
        /** @type {HTMLElement} */ (document.getElementById("sort-row")).style.display = "none";
        setResults(noResultsState());
        return;
    }

    /** @type {HTMLElement} */ (document.getElementById("sort-row")).style.display = "";

    // Apply sort
    if (state.sort === "recent") {
        comicHits.sort((a, b) => +new Date((state.epMap[b.show_id] || {}).date || 0) - +new Date((state.epMap[a.show_id] || {}).date || 0));
        episodeHits.sort((a, b) => +new Date(b.date || 0) - +new Date(a.date || 0));
    }

    let html = panelistFilterHtml();

    if (comicHits.length) {
        html += sectionLabel("Comic Mentions", comicHits.length);
        html += comicHits.map(renderComicCard).join("");
    }

    if (episodeHits.length) {
        html += sectionLabel("Episodes by Topic", episodeHits.length);
        html += episodeHits.map(renderEpisodeCard).join("");
    }

    setResults(html);
}

/** Reset all search state and return to the empty/landing view. */
export function clearSearch() {
    state.query = "";
    state.panelist = null;
    state.guestOnly = false;
    state.sort = "relevance";
    state.openEmbed = null;
    /** @type {HTMLInputElement} */ (document.getElementById("search-input")).value = "";
    /** @type {HTMLElement} */ (document.getElementById("clear-btn")).style.display = "none";
    /** @type {HTMLElement} */ (document.getElementById("sort-row")).style.display = "none";
    document.querySelectorAll(".sort-btn").forEach(b => {
        const active = /** @type {HTMLElement} */ (b).dataset.sort === "relevance";
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", String(active));
    });
    history.replaceState(null, "", location.pathname);
    setResults(emptyState());
}

/** @param {string} val */
export function setSearch(val) {
    state.query = val;
    /** @type {HTMLInputElement} */ (document.getElementById("search-input")).value = val;
    /** @type {HTMLElement} */ (document.getElementById("clear-btn")).style.display = "block";
    const params = new URLSearchParams(location.search);
    params.set("q", val);
    history.replaceState(null, "", "?" + params);
    runSearch();
}

/** @param {string} name */
export function setPanelist(name) {
    state.panelist = state.panelist === name ? null : name;
    const params = new URLSearchParams(location.search);
    state.panelist ? params.set("panelist", state.panelist) : params.delete("panelist");
    history.replaceState(null, "", params.toString() ? "?" + params : location.pathname);
    runSearch();
}

export function toggleGuestOnly() {
    state.guestOnly = !state.guestOnly;
    const params = new URLSearchParams(location.search);
    state.guestOnly ? params.set("guest", "1") : params.delete("guest");
    history.replaceState(null, "", params.toString() ? "?" + params : location.pathname);
    runSearch();
}

/** Close every open Simplecast embed and restore the play buttons. */
export function resetEmbeds() {
    document.querySelectorAll(".embed-wrap").forEach(el => el.innerHTML = "");
    document.querySelectorAll(".play-btn").forEach(b => {
        b.innerHTML = b.getAttribute("data-orig") || "▶ Play";
    });
}

/**
 * Toggle the inline Simplecast player for a given card.
 * @param {string} key
 * @param {string} slug
 * @param {number} startSecs
 */
export function toggleEmbed(key, slug, startSecs) {
    if (state.openEmbed === key) {
        state.openEmbed = null;
        resetEmbeds();
        return;
    }
    resetEmbeds();
    state.openEmbed = key;
    const wrap = document.querySelector(`.embed-wrap[data-key="${CSS.escape(key)}"]`);
    if (!wrap) return;
    const src = `https://player.simplecast.com/${slug}?dark=true${startSecs ? "&t=" + secsToSimplecastT(startSecs) : ""}`;
    wrap.innerHTML = `<iframe src="${esc(safeUrl(src))}" frameborder="0" scrolling="no"
        title="Episode player"
        allow="autoplay *; encrypted-media *; fullscreen *"
        style="width:100%;height:152px;border-radius:8px;margin-top:0.75rem;display:block;"></iframe>`;
    const btn = document.querySelector(`.play-btn[data-key="${CSS.escape(key)}"]`);
    if (btn) btn.innerHTML = "■ Stop";
}

/** @param {string} showId */
export function toggleCardSummary(showId) {
    const div = document.getElementById("card-summary-" + showId);
    const btn = div && div.previousElementSibling;
    if (!div) return;
    const opening = div.hidden;
    div.hidden = !opening;
    if (btn) btn.textContent = opening ? "▴ Hide notes" : "▾ Show notes";
}

export function togglePanelistMenu() {
    const dropdown = /** @type {HTMLElement} */ (document.getElementById("panelist-dropdown"));
    const btn = /** @type {HTMLElement} */ (document.getElementById("panelist-nav-btn"));
    if (!dropdown || !btn) return;
    const isOpen = dropdown.classList.toggle("open");
    btn.setAttribute("aria-expanded", String(isOpen));
}

export function closePanelistMenu() {
    const dropdown = /** @type {HTMLElement} */ (document.getElementById("panelist-dropdown"));
    const btn = /** @type {HTMLElement} */ (document.getElementById("panelist-nav-btn"));
    if (!dropdown || !btn) return;
    dropdown.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
}

/** @param {"newest"|"oldest"} sort */
export function setPanelistSort(sort) {
    state.panelistSort = sort;
    if (state.panelistView) renderPanelistPage(state.panelistView);
}

/** Leave a panelist page and restore the search UI. */
export function goHome() {
    state.panelistView = null;
    delete document.documentElement.dataset.view;
    /** @type {HTMLElement} */ (document.getElementById("search-input")).style.display = "";
    /** @type {HTMLElement} */ (document.getElementById("clear-btn")).style.display = "";
    /** @type {HTMLElement} */ (document.querySelector(".tabs")).style.display = "";
    clearSearch();
}
