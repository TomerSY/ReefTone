const worker = {
  async fetch(request, env) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = assetUrl.pathname === "/"
      ? "/static/index.html"
      : `/static${assetUrl.pathname}`;
    const assetRequest = new Request(assetUrl, {
      method: request.method,
      headers: request.headers,
    });
    const response = await env.ASSETS.fetch(assetRequest);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return response;

    const origin = new URL(request.url).origin;
    const html = (await response.text()).replaceAll("__REEFTONE_ORIGIN__", origin);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control", "no-cache");
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "strict-origin-when-cross-origin");
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default worker;
