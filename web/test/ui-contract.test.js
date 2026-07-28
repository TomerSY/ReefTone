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
  assert.doesNotMatch(webCss.slice(0, webCss.indexOf("@media (max-width: 1035px)")), /position:\s*sticky/);
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
