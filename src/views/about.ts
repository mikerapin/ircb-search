import { core, mentions as loadMentions } from "../data/load";
import { ALIASED_REGULARS, ROSTER } from "../data/roster";
import type { EpisodeCore } from "../data/types";
import { nf, pl } from "../lib/html";
import { href } from "../router";
import { jumpable } from "../search/engine";
import { subscribeCoupon } from "./blocks";

/**
 * The three eras, as counts.
 *
 * They must partition the archive, so they split on one axis: in the feed or not, then
 * Patreon or not. Splitting the back catalogue on `date` instead looked verified — the
 * counts summed to 798 — while double-counting the one dated Patreon record (Wic+Div's
 * Younger Sibling) and orphaning the one record with no showId, no date and no Patreon URL.
 *
 * Exported so the invariant is reachable, because **on the live data the broken split and
 * the correct one return the identical 84**: the double-count and the orphan cancel in the
 * count exactly as they cancel in the sum, so no assertion about a rendered number can tell
 * them apart. Only a fixture built to separate them can. See tests/unit/eras.test.ts.
 */
export function eraCounts(episodes: EpisodeCore[]): {
  feed: number; backCatalogue: number; backCatalogueDated: number; patreonShelf: number;
} {
  return {
    feed: episodes.filter(e => e.showId).length,
    backCatalogue: episodes.filter(e => !e.showId && !e.patreonUrl).length,
    backCatalogueDated: episodes.filter(e => !e.showId && !e.patreonUrl && e.date).length,
    patreonShelf: episodes.filter(e => !e.showId && e.patreonUrl).length,
  };
}

/**
 * Every figure here is computed from the same files the rest of the site reads, so the page
 * cannot drift from the data it describes. Nothing is written down as a literal.
 */
export async function viewAbout(): Promise<{ html: string; after: () => void }> {
  const data = await core();
  const men = await loadMentions();
  const s = data.stats;

  const byKey = new Map(data.episodes.map(e => [e.key, e]));
  const noMention = s.episodes - s.indexedEpisodes;
  const undated = data.episodes.filter(e => !e.date).length;
  const noAudio = data.episodes.filter(e => !e.enclosure).length;
  const { feed: feedEps, backCatalogue, backCatalogueDated, patreonShelf } = eraCounts(data.episodes);
  const noTitle = data.episodes.filter(e => !e.title).length;
  const noMinute = men.filter(m => m.secs == null).length;
  /* Not `men.length - noMinute`: a minute is necessary but not sufficient. jumpable() also
     needs audio on file and a stamp inside the runtime, which is one mention fewer. Quote
     the number the play controls actually honour. */
  const canJump = men.filter(m => jumpable(m, byKey.get(m.epKey))).length;
  const pastRuntime = men.filter(m => {
    const e = byKey.get(m.epKey);
    return m.secs != null && e?.runtimeSecs != null && m.secs >= e.runtimeSecs;
  }).length;
  const folded = s.uniqueComics - s.series;

  const html =
    `<div class="pagehead"><div class="eyebrow">Catalogue policy</div><h1 class="disp">About the Data</h1>
      <p>Where the numbers come from, what the rules are, and what&rsquo;s missing. Everything on
      this site is computed from the sources below — including every figure on this page.</p></div>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">Sources</h2></div>
      <dl class="kv">
        <div><dt>Mentions</dt><dd><a href="https://github.com/sshugars/ircb">sshugars/ircb</a> — ${nf(s.mentions)}
          comic mentions across ${nf(s.indexedEpisodes)} episodes, hand-built from show notes.
          ${nf(men.length - noMinute)} of them carry a minute; the rest name the comic and nothing else.</dd></div>
        <div><dt>Episodes</dt><dd>The same <a href="https://github.com/sshugars/ircb">sshugars/ircb</a> episode
          table — titles, air dates and panel for all ${nf(s.episodes)} records. The show&rsquo;s
          <a href="https://feeds.simplecast.com/U93zjuSN">Simplecast RSS feed</a> adds artwork, runtimes and
          audio to the ${nf(feedEps)} of those that reached it.</dd></div>
        <div><dt>Audio</dt><dd>Played straight from the feed&rsquo;s own enclosure, untouched, so a listen here counts
          exactly like a listen anywhere else. Nothing is re-hosted.</dd></div>
        <div><dt>Portraits</dt><dd>The ircbpodcast.com roster — ${ROSTER.length} regulars. Guests carry no portrait,
          so their pages run on the record alone.</dd></div>
        <div><dt>Cover art</dt><dd>Every comic wears a generated plate rather than risk showing the wrong cover.
          Real covers would come from GCD (CC BY 3.0) and Metron (CC BY-SA 4.0) later, baked in at build time and
          credited here. Cover images are publisher copyright, shown to identify a book.</dd></div>
      </dl>
    </section>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">The Three Eras</h2></div>
      <p class="lead">The archive comes in three eras, and the site doesn&rsquo;t pretend otherwise.</p>
      <dl class="kv">
        <div><dt>The feed era</dt><dd>${nf(feedEps)} episodes published to the RSS feed, with titles, dates, panel,
          runtime and audio. These are the ones that carry a broadcast number, and the mention index reaches
          ${nf(s.indexedEpisodes)} of them.</dd></div>
        <div><dt>Before the feed</dt><dd>${nf(backCatalogue)} records never reached the feed and aren&rsquo;t Patreon
          bonuses. ${nf(backCatalogueDated)} of them carry air dates — it&rsquo;s the audio that&rsquo;s missing, so
          those pages offer no play control. They were never numbered in the feed, so the site doesn&rsquo;t give them
          a number.</dd></div>
        <div><dt>The Patreon shelf</dt><dd>${nf(patreonShelf)} bonus episodes made for Patreon members. They never
          hit the public feed, and ${nf(undated)} of the archive&rsquo;s records carry no recoverable air date —
          almost entirely these. They&rsquo;re listed and searchable; they just can&rsquo;t be placed on a calendar,
          and they link to Patreon rather than to audio. In all, ${nf(noAudio)} records have no audio on file.</dd></div>
        <div><dt>The honest headline</dt><dd><b>${nf(s.indexedEpisodes)} episodes indexed</b>, not
          &ldquo;${nf(s.episodes)} episodes searchable.&rdquo; ${nf(noMention)} episodes have no mention data —
          search can&rsquo;t reach inside them, and the site won&rsquo;t pretend it can.</dd></div>
      </dl>
    </section>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">Series Normalization</h2>
        <span class="note">${nf(s.uniqueComics)} written headings → ${nf(s.series)} series</span></div>
      <p class="lead">The index records what was said, in whatever form it was written down. To put a run on one
      page, ${nf(folded)} of those ${nf(s.uniqueComics)} headings fold into another. These are the rules.</p>
      <dl class="kv">
        <div><dt>Stripped</dt><dd>Issue, volume and chapter numbering: <b>#12</b> · <b>Vol. 3</b> ·
          <b>volumes 1&ndash;9</b> · <b>Book 1</b> · <b>Chapter 381</b>. Also <b>ft.</b> credits and the stray HTML
          that came in with some scraped show notes.</dd></div>
        <div><dt>Volume years</dt><dd>A year in brackets is dropped &mdash; unless the same title was written under
          two different ones, which is the only time it&rsquo;s telling you something. <i>Daredevil (1998)</i> is
          just <i>Daredevil</i>, but <i>Mister Miracle (1971)</i> and <i>Mister Miracle (2017)</i> are different
          books and get separate pages. Mentions written without a year stay on their own run, because there&rsquo;s
          no way to know which volume was meant.</dd></div>
        <div><dt>Folded together</dt><dd>Headings that differ only in punctuation, quote style or capitals.
          <i>Star Wars: Visions</i> and <i>Star Wars Visions</i> are one run; so are <i>Dead Dog&rsquo;s Bite</i> and
          <i>Dead Dogs Bite</i>. Each run is shown under whichever spelling was written most often.</dd></div>
        <div><dt>Kept apart</dt><dd>Anything that differs by a letter or a word. <i>Monster</i> and <i>Monsters</i>,
          <i>Black Magick</i> and <i>Black Magic</i>, <i>Batman</i> and <i>Batman: The Killing Joke</i> are separate
          books. A wrong merge would quietly misstate which episodes discussed which comic, so the rules stay
          cautious and the near-misses get a <b>See Also</b> rail instead.</dd></div>
        <div><dt>Shown verbatim</dt><dd>Every checklist row prints the heading exactly as the index recorded it.
          The series name is only the shelf it sits on, never a rewrite of what was said.</dd></div>
      </dl>
    </section>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">Known Gaps</h2>
        <span class="note">What the rules above can&rsquo;t fix</span></div>
      <dl class="kv">
        <div><dt>Minutes</dt><dd><b>${nf(noMinute)} of ${nf(men.length)} mentions carry no minute</b> — someone logged
          the comic but never the timestamp. Only ${nf(canJump)} can be jumped into. Those without show
          <b>&mdash;:&mdash;&mdash;</b> and link to the episode rather than fake a play button.</dd></div>
        <div><dt>Dates</dt><dd>${nf(undated)} episodes have no recoverable air date, so they sort last everywhere
          and sit outside every calendar.</dd></div>
        ${pastRuntime ? `<div><dt>Bad stamps</dt><dd>${nf(pastRuntime)} mention${pl(pastRuntime)} carries a timestamp
          past the end of its own episode — a typo in the notes. Those aren&rsquo;t offered as jumps.</dd></div>` : ""}
        ${noTitle ? `<div><dt>Records</dt><dd>${nf(noTitle)} record${pl(noTitle)} in the source carries no title at all.
          It still gets a page, because it still happened.</dd></div>` : ""}
        <div><dt>Names</dt><dd>Some headings resist any safe rule — different romanisations of the same manga,
          spacing variants, sequel numbering. They stay split rather than risk a wrong merge, and turn up in
          <b>See Also</b> on the series pages.</dd></div>
        <div><dt>People</dt><dd>${nf(ALIASED_REGULARS)} regulars are credited by a short name in some episodes &mdash;
          a first name on its own, or a nickname. Every spelling resolves to the one person, so their episode counts and
          percentages are whole rather than split across two pages. Guests are whoever appears in the credits and
          isn&rsquo;t on the roster.</dd></div>
      </dl>
    </section>` +

    `<section class="sec">
      <div class="sec-head"><h2 class="disp">What&rsquo;s In This Build</h2></div>
      <div class="sparse">
        All <b>${nf(s.episodes)}</b> episode records, every one of the <b>${nf(s.mentions)}</b> mentions, the full
        <b>${nf(s.series)}</b>-series index and the <b>${nf(s.people)}</b> people who have sat at the table.
        Audio plays from the show&rsquo;s own feed and the jumps are real. Where a page has no data to show, it says so
        on the page rather than leaving a blank. <a href="${href("/index")}">Browse the whole index →</a>
      </div>
    </section>` +

    subscribeCoupon();

  return { html, after: () => {} };
}
