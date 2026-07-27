import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

test("hosted HTML receives an absolute social image origin", async () => {
  let requestedAsset;
  const env = {
    ASSETS: {
      async fetch(request) {
        requestedAsset = new URL(request.url).pathname;
        return new Response(
          '<meta property="og:image" content="__REEFTONE_ORIGIN__/og.png">',
          {headers: {"content-type": "text/html; charset=utf-8"}},
        );
      },
    },
  };

  const response = await worker.fetch(new Request("https://alpha.example/"), env);
  assert.match(await response.text(), /https:\/\/alpha\.example\/og\.png/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(requestedAsset, "/static/index.html");
});

test("non-HTML assets pass through unchanged", async () => {
  const asset = new Response("image-bytes", {headers: {"content-type": "image/png"}});
  let requestedAsset;
  const env = {
    ASSETS: {
      async fetch(request) {
        requestedAsset = new URL(request.url).pathname;
        return asset;
      },
    },
  };
  assert.equal(await (await worker.fetch(new Request("https://alpha.example/og.png"), env)).text(), "image-bytes");
  assert.equal(requestedAsset, "/static/og.png");
});
