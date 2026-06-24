// @ts-check
// Entry point: load data, compute derived indexes, restore URL state, wire up
// events. Loaded as a deferred ES module, so the DOM is parsed before this runs.

import { state } from "./state.js";
import { normalizeSeries, esc } from "./format.js";
import { PANELISTS } from "./panelists.js";
import { setResults, renderPanelistPage, loadingState, errorState } from "./render.js";
import {
    runSearch, clearSearch, setSearch, setPanelist, toggleGuestOnly, goHome,
    toggleEmbed, toggleCardSummary, togglePanelistMenu, closePanelistMenu, setPanelistSort,
} from "./actions.js";


// ─── Boot ─────────────────────────────────────────────────────────────────────
async function init() {
    /** @type {HTMLElement} */ (document.getElementById("results")).setAttribute("aria-busy", "true");
    setResults(loadingState());
    try {
        const [cr, er] = await Promise.all([
            fetch("data/comics.json"),
            fetch("data/episodes.json")
        ]);
        if (!cr.ok || !er.ok) throw new Error("not-found");
        [state.comics, state.episodes] = await Promise.all([cr.json(), er.json()]);

        state.episodes.forEach(ep => { state.epMap[ep.show_id] = ep; });

        const epCount = state.episodes.length;
        /** @type {HTMLElement} */ (document.getElementById("tagline")).textContent =
            `Search every comic and topic discussed across ${epCount}+ episodes.`;
        /** @type {HTMLElement} */ (document.getElementById("meta-description")).setAttribute("content",
            `Search ${epCount}+ episodes of I Read Comic Books to find every time a comic or topic was discussed.`);

        /** @type {Record<string, Set<string>>} */
        const comicEpisodes = {};
        state.comics.forEach(m => {
            if (m.comic) {
                const series = normalizeSeries(m.comic);
                if (!comicEpisodes[series]) comicEpisodes[series] = new Set();
                comicEpisodes[series].add(m.show_id);
            }
        });
        /** @type {Record<string, number>} */
        const comicCounts = {};
        Object.entries(comicEpisodes).forEach(([comic, ids]) => {
            comicCounts[comic] = ids.size;
        });
        state.topComics = Object.entries(comicCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, count]) => ({ name, count }));

        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
        /** @type {Record<string, Set<string>>} */
        const recentEps = {};
        state.comics.forEach(m => {
            if (!m.comic) return;
            const ep = state.epMap[m.show_id];
            if (ep && ep.date && new Date(ep.date) >= twelveMonthsAgo) {
                const series = normalizeSeries(m.comic);
                if (!recentEps[series]) recentEps[series] = new Set();
                recentEps[series].add(m.show_id);
            }
        });
        state.topRecentComics = Object.entries(recentEps)
            .map(([name, ids]) => ({ name, count: ids.size }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        // Find most recent episode with comic mentions
        const sortedEps = [...state.episodes].sort((a, b) => +new Date(b.date || 0) - +new Date(a.date || 0));
        state.comics.forEach(m => { if (m.comic) (state.comicsByEp[m.show_id] ||= new Set()).add(normalizeSeries(m.comic)); });
        for (const ep of sortedEps) {
            const set = state.comicsByEp[ep.show_id];
            if (set && set.size) {
                // Only include series that appear in 2+ episodes — singletons are too ephemeral to feature
                state.latestEpisodeComics = [...set].filter(name => (comicEpisodes[name]?.size || 0) >= 2);
                state.latestEpisodeInfo = ep;
                break;
            }
        }
        state.recentEpisodes = sortedEps.slice(0, 3);

        // Expose for Playwright tests and debugging
        window.latestEpisodeComics = state.latestEpisodeComics;
        window.comicEpisodes = comicEpisodes;

        const episodeNames = new Set();
        state.episodes.forEach(ep => {
            if (ep.people) ep.people.split(",").map(s => s.trim()).filter(Boolean).forEach(n => episodeNames.add(n));
        });
        state.panelists = PANELISTS.filter(p => episodeNames.has(p.name)).map(p => p.name);

        // Populate the panelist dropdown menu
        const grid = document.getElementById("panelist-dropdown-grid");
        if (grid) {
            grid.innerHTML = PANELISTS.map(p =>
                `<button class="panelist-dropdown-item" role="menuitem"
                    data-action="open-panelist" data-href="?view=panelist&name=${esc(encodeURIComponent(p.name))}">
                    <img class="panelist-avatar" src="${esc(p.photo)}" alt="${esc(p.display)}" loading="lazy">
                    <span class="panelist-avatar-name">${esc(p.display.split(" ")[0])}</span>
                    ${p.tagline ? `<span class="panelist-avatar-tagline">${esc(p.tagline)}</span>` : ""}
                </button>`
            ).join("");
        }

        state.fuseComics = new Fuse(state.comics, {
            keys: ["comic"],
            threshold: 0.3,
            minMatchCharLength: 2,
            includeScore: true
        });

        state.fuseEpisodes = new Fuse(state.episodes, {
            keys: [
                { name: "keywords", weight: 1 },
                { name: "title",    weight: 1 },
                { name: "summary",  weight: 0.3 }
            ],
            threshold: 0.3,
            minMatchCharLength: 2,
            includeScore: true,
            ignoreLocation: true
        });

        // Recompute chip counts using fuzzy search so they match what clicking the chip shows
        const computeChipCount = name => {
            const ids = new Set();
            state.fuseComics.search(name).forEach(r => ids.add(r.item.show_id));
            state.fuseEpisodes.search(name).forEach(r => ids.add(r.item.show_id));
            return ids.size || 1;
        };
        state.topComics       = state.topComics.map(c => ({ ...c, count: computeChipCount(c.name) })).sort((a, b) => b.count - a.count);
        state.topRecentComics = state.topRecentComics.map(c => ({ ...c, count: computeChipCount(c.name) })).sort((a, b) => b.count - a.count);

        // Restore search state from URL
        const params = new URLSearchParams(location.search);
        const urlMode = params.get("mode");
        const urlSort = params.get("sort");
        const urlQ    = params.get("q");
        if (urlMode && ["all","comics","topics"].includes(urlMode)) {
            state.mode = urlMode;
            document.querySelectorAll(".tab").forEach(b => {
                const active = /** @type {HTMLElement} */ (b).dataset.mode === urlMode;
                b.classList.toggle("active", active);
                b.setAttribute("aria-selected", String(active));
            });
        }
        if (urlSort && ["relevance","recent"].includes(urlSort)) {
            state.sort = urlSort;
            document.querySelectorAll(".sort-btn").forEach(b => {
                const active = /** @type {HTMLElement} */ (b).dataset.sort === urlSort;
                b.classList.toggle("active", active);
                b.setAttribute("aria-pressed", String(active));
            });
        }
        const urlPanelist = params.get("panelist");
        if (urlPanelist) state.panelist = urlPanelist;
        if (params.get("guest") === "1") state.guestOnly = true;
        if (urlQ) {
            state.query = urlQ;
            /** @type {HTMLInputElement} */ (document.getElementById("search-input")).value = urlQ;
            /** @type {HTMLElement} */ (document.getElementById("clear-btn")).style.display = "block";
        }
        const urlView = params.get("view");
        const urlName = params.get("name");
        if (urlView === "panelist" && urlName) {
            state.panelistView = urlName;
        }
        /** @type {HTMLElement} */ (document.getElementById("results")).setAttribute("aria-busy", "false");
        if (state.panelistView) {
            renderPanelistPage(state.panelistView);
            return;
        }
        runSearch();
    } catch (e) {
        /** @type {HTMLElement} */ (document.getElementById("results")).setAttribute("aria-busy", "false");
        setResults(errorState(e.message === "not-found"));
    }
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
/** @type {HTMLElement} */ (document.getElementById("search-input")).addEventListener("input", function () {
    state.query = /** @type {HTMLInputElement} */ (this).value;
    /** @type {HTMLElement} */ (document.getElementById("clear-btn")).style.display = state.query ? "block" : "none";
    clearTimeout(state.searchDebounceTimer);
    state.searchDebounceTimer = setTimeout(() => {
        const params = new URLSearchParams(location.search);
        state.query ? params.set("q", state.query) : params.delete("q");
        history.replaceState(null, "", params.toString() ? "?" + params : location.pathname);
        runSearch();
    }, 150);
});

/** @type {HTMLElement} */ (document.getElementById("clear-btn")).addEventListener("click", clearSearch);
/** @type {HTMLElement} */ (document.querySelector(".logo-row")).addEventListener("click", goHome);

document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", function () {
        document.querySelectorAll(".tab").forEach(b => {
            b.classList.remove("active");
            b.setAttribute("aria-selected", "false");
        });
        this.classList.add("active");
        this.setAttribute("aria-selected", "true");
        state.mode = this.dataset.mode;
        const params = new URLSearchParams(location.search);
        state.mode !== "all" ? params.set("mode", state.mode) : params.delete("mode");
        history.replaceState(null, "", params.toString() ? "?" + params : location.pathname);
        runSearch();
    });
});

document.querySelectorAll(".sort-btn").forEach(btn => {
    btn.addEventListener("click", function () {
        document.querySelectorAll(".sort-btn").forEach(b => {
            b.classList.remove("active");
            b.setAttribute("aria-pressed", "false");
        });
        this.classList.add("active");
        this.setAttribute("aria-pressed", "true");
        state.sort = this.dataset.sort;
        const params = new URLSearchParams(location.search);
        state.sort !== "relevance" ? params.set("sort", state.sort) : params.delete("sort");
        history.replaceState(null, "", params.toString() ? "?" + params : location.pathname);
        runSearch();
    });
});

init();
window.addEventListener('popstate', () => location.reload());

const logoArt = /** @type {HTMLElement | null} */ (document.getElementById("logo-art"));
if (logoArt) logoArt.addEventListener("error", () => { logoArt.style.display = "none"; });

// Single delegated click handler for all data-action buttons.
document.addEventListener('click', e => {
    const el = /** @type {Element} */ (e.target);

    // Close panelist menu on outside click
    const nav = document.getElementById('panelist-nav');
    if (nav && !nav.contains(/** @type {Node} */ (el))) closePanelistMenu();

    const btn = el.closest('[data-action]');
    if (!btn) return;
    const d = /** @type {HTMLElement} */ (btn).dataset;
    switch (d.action) {
        case 'search':        setSearch(d.q ?? ""); break;
        case 'embed':         toggleEmbed(d.key ?? "", d.slug ?? "", Number(d.secs ?? 0)); break;
        case 'set-panelist':  setPanelist(d.name ?? ""); break;
        case 'toggle-guest':  toggleGuestOnly(); break;
        case 'home':          goHome(); break;
        case 'home-search':   goHome(); setSearch(d.q ?? ""); break;
        case 'panelist-sort': setPanelistSort(/** @type {"newest"|"oldest"} */ (d.sort ?? "newest")); break;
        case 'summary':       toggleCardSummary(d.id ?? ""); break;
        case 'panelist-menu': togglePanelistMenu(); break;
        case 'open-panelist': closePanelistMenu(); location.href = d.href ?? ""; break;
    }
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closePanelistMenu();
});
