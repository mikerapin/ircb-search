// Archivo needs the wdth axis (the display type runs at wdth 125/112) and Shantell needs
// its full axis set (.hand sets BNCE/INFM) — the default index.css of each ships wght only.
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource-variable/shantell-sans/full.css";
import "./style/tokens.css";
import "./style/dress.css";

// Temporary token sheet — replaced by the shell in Task 5.
const app = document.getElementById("app");
if (app) {
  app.innerHTML = `
<div class="grain"></div>
<main>
  <section class="sec">
    <div class="sec-head"><h2 class="disp">Four Inks On Paper</h2><span class="note">Token sheet</span></div>
    <p class="lead">Body copy sets in Inter. <span class="hand">This line is the hand.</span></p>
    <span class="sfx">Test!</span>
    <div class="panels">
      <article class="panel">
        <div class="epw">
          <span class="epw-art"></span>
        </div>
        <span class="pricebox">44:17<small>Runtime</small></span>
      </article>
    </div>
  </section>
</main>`;
}
