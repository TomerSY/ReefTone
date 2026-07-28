import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("web comparison markup and state default to whole-image Before/After", async () => {
  const [html, main] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("src/main.js", root), "utf8"),
  ]);
  assert.match(html, /id="swipeToggle"[^>]*aria-pressed="false"/);
  assert.match(html, /id="compareLine"[^>]*hidden/);
  assert.match(html, /class="image-label before-label" hidden/);
  assert.match(html, /class="image-label after-label" hidden/);
  assert.match(main, /swipeEnabled:\s*false/);
  assert.ok((main.match(/setSwipeEnabled\(false\)/g) || []).length >= 2);
});

test("web uses canonical desktop scale and exact balance and Sharpening labels", async () => {
  const [html, main, desktopCss, webCss] = await Promise.all([
    readFile(new URL("index.html", root), "utf8"),
    readFile(new URL("src/main.js", root), "utf8"),
    readFile(new URL("../src/reeftone/static/styles.css", root), "utf8"),
    readFile(new URL("src/web-style.css", root), "utf8"),
  ]);
  assert.match(main, /import "\.\.\/\.\.\/src\/reeftone\/static\/styles\.css"/);
  assert.match(desktopCss, /--ui-scale:\s*1\.5/);
  assert.doesNotMatch(webCss, /--ui-scale\s*:/);
  ["Red balance", "Green balance", "Blue balance", "Sharpening", "Amount", "Radius", "Threshold"].forEach(label => {
    assert.ok(html.includes(label), `${label} should be visible in the web contract`);
  });
  assert.match(html, /data-setting="red_recovery"[^>]*aria-label="Red balance"/);
  assert.match(html, /data-setting="green_correction"[^>]*aria-label="Green balance"/);
  assert.match(html, /data-setting="blue_balance"[^>]*aria-label="Blue balance"/);
});

test("a loaded photo gets a mobile-only sticky preview below the app header", async () => {
  const [main, webCss] = await Promise.all([
    readFile(new URL("src/main.js", root), "utf8"),
    readFile(new URL("src/web-style.css", root), "utf8"),
  ]);
  const mobileRules = webCss.slice(webCss.indexOf("@media (max-width: 1035px)"));

  assert.match(main, /\$\("#app"\)\.classList\.add\("has-photo"\)/);
  assert.match(mobileRules, /\.app\.has-photo \.canvas-area\s*\{[^}]*position:\s*sticky/s);
  assert.match(mobileRules, /top:\s*var\(--web-mobile-header-height\)/);
  assert.doesNotMatch(
    webCss.slice(0, webCss.indexOf("@media (max-width: 1035px)")),
    /\.app\.has-photo \.canvas-area\s*\{[^}]*position:\s*sticky/s,
  );
});

test("mobile prioritizes the photo and keeps Before/After beside the looks", async () => {
  const webCss = await readFile(new URL("src/web-style.css", root), "utf8");
  const mobileRules = webCss.slice(
    webCss.indexOf("@media (max-width: 1035px)"),
    webCss.indexOf("@media (max-width: 359px)"),
  );

  assert.match(mobileRules, /--web-mobile-header-height:\s*72px/);
  assert.match(mobileRules, /\.canvas-color-info\s*\{\s*display:\s*none/);
  assert.match(mobileRules, /\.toolbar-right\s*\{\s*display:\s*flex/);
  assert.match(mobileRules, /#beforeAfterButton\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(mobileRules, /\.image-meta\s*\{\s*display:\s*none/);
  assert.match(mobileRules, /height:\s*clamp\(320px,\s*55svh,\s*460px\)/);
});

test("mobile centers setting values, keeps actions inline, and uses moderately tighter spacing", async () => {
  const webCss = await readFile(new URL("src/web-style.css", root), "utf8");
  const mobileRules = webCss.slice(
    webCss.indexOf("@media (max-width: 1035px)"),
    webCss.indexOf("@media (max-width: 359px)"),
  );

  assert.match(mobileRules, /\.control-section\s*\{\s*padding-block:\s*calc\(13px \* var\(--ui-scale\)\)/);
  assert.match(mobileRules, /\.control-list\s*\{\s*gap:\s*calc\(12px \* var\(--ui-scale\)\)/);
  assert.match(mobileRules, /\.slider-control\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(mobileRules, /\.slider-control output\s*\{[^}]*grid-column:\s*2;[^}]*justify-self:\s*center;[^}]*text-align:\s*center/s);
  assert.match(mobileRules, /\.slider-control \.control-actions\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;[^}]*justify-self:\s*end/s);
  assert.match(mobileRules, /\.slider-control input\s*\{[^}]*grid-row:\s*2;[^}]*margin-top:\s*0/s);
  assert.match(mobileRules, /\.toolbar-left \.presets button\s*\{[^}]*min-height:\s*36px/s);
  assert.match(mobileRules, /#beforeAfterButton\s*\{[^}]*min-height:\s*42px/s);
});

test("web sharpening is an unboxed subsection with the standard heading hierarchy", async () => {
  const webCss = await readFile(new URL("src/web-style.css", root), "utf8");

  assert.match(webCss, /\.sharpening-tool\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent/s);
  assert.match(webCss, /\.sharpening-heading strong\s*\{[^}]*font-size:\s*calc\(12px \* var\(--ui-scale\)\);[^}]*font-weight:\s*680/s);
  assert.match(webCss, /\.sharpening-heading small\s*\{[^}]*font-size:\s*calc\(9px \* var\(--ui-scale\)\)/s);
});

test("desktop web keeps the image sticky on the left and settings on the right", async () => {
  const webCss = await readFile(new URL("src/web-style.css", root), "utf8");
  const desktopRules = webCss.slice(
    webCss.indexOf("@media (min-width: 1036px)"),
    webCss.indexOf("@media (max-width: 1035px)"),
  );

  assert.match(desktopRules, /\.workspace\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:[^;]*minmax\(0,\s*1fr\)[^;]*clamp\(420px,\s*32vw,\s*calc\(344px \* var\(--ui-scale\)\)\)/s);
  assert.match(desktopRules, /\.canvas-area\s*\{[^}]*position:\s*sticky;[^}]*top:\s*var\(--web-desktop-header-height\)/s);
  assert.match(desktopRules, /\.inspector\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*grid-template-rows:\s*auto auto auto auto auto/s);
  assert.match(desktopRules, /\.inspector-header,\s*\.controls-scroll,\s*\.inspector-footer\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*100%/s);
  assert.match(desktopRules, /\.controls-scroll\s*\{\s*overflow:\s*visible/);
  assert.match(desktopRules, /@media \(min-width:\s*1036px\) and \(max-width:\s*1350px\)/);
  assert.match(desktopRules, /\.canvas-toolbar\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(desktopRules, /\.canvas-color-info\s*\{\s*display:\s*none/);
  assert.doesNotMatch(desktopRules, /flex-direction:\s*column/);
});
