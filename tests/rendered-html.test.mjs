import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

async function readDirectoryIfPresent(url) {
  try {
    return await readdir(url);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Chalkline teaching brief", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Chalkline/);
  assert.match(html, /Good morning, Jamie/);
  assert.match(html, /Your teaching brief/);
  assert.match(html, /Evidence signals/);
  assert.match(html, /Local prototype · synthetic data/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("starter preview is removed and product metadata is installed", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /ChalklineApp/);
  assert.match(layout, /Classroom evidence into tomorrow's lesson/);
  assert.match(packageJson, /"name": "onyx-chalkline"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual(
    await readDirectoryIfPresent(new URL("../app/_sites-preview", import.meta.url)),
    [],
  );
});

test("the teacher workflow includes release gates and portable integration paths", async () => {
  const source = await readFile(new URL("../app/ChalklineApp.tsx", import.meta.url), "utf8");
  assert.match(source, /Teacher release/);
  assert.match(source, /Nothing becomes an assignment or grade until you review and release it/);
  assert.match(source, /Import roster CSV/);
  assert.match(source, /Export evidence CSV/);
  assert.match(source, /This prototype uses synthetic data and does not claim a live district connection/);
});
