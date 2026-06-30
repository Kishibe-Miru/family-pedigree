import test from "node:test";
import assert from "node:assert/strict";
import { createServer, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, Page } from "playwright";

const ROOT = process.cwd();
const TOOL_PATH = "/家族谱系图工具/index.html";
const ARTIFACT_DIR = path.join(ROOT, "output", "playwright", "browser-smoke");

test("browser smoke renders stable pedigree scenarios", async (t) => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const server = await startStaticServer(ROOT);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const scenarioMetrics: ScenarioMetrics[] = [];

  try {
    try {
      browser = await chromium.launch();
    } catch (error) {
      if (isMissingChromium(error)) {
        t.skip("Playwright Chromium is not installed. Run: npx playwright install chromium");
        return;
      }
      throw error;
    }
    const baseUrl = `http://127.0.0.1:${server.port}`;

    scenarioMetrics.push(await runScenario(browser, baseUrl, "01-empty", async () => {
      // Initial empty canvas.
    }));

    scenarioMetrics.push(await runScenario(browser, baseUrl, "02-three-generation-family", async (page) => {
      await clickButton(page, "＋ 添加先证者");
      await clickButton(page, "父亲 F");
      await clickButton(page, "母亲 M");
      await clickButton(page, "弟弟 B");
      await clickButton(page, "妹妹 S");
      await clickButton(page, "配偶 E");
      await clickButton(page, "儿子 C");
      await clickButton(page, "女儿 D");
    }));

    scenarioMetrics.push(await runScenario(browser, baseUrl, "03-sibling-controls", async (page) => {
      await clickButton(page, "＋ 添加先证者");
      await clickButton(page, "哥哥");
      await clickButton(page, "弟弟 B");
      await clickButton(page, "姐姐");
      await clickButton(page, "妹妹 S");
      await clickButton(page, "孪生弟弟");
      await clickButton(page, "孪生妹妹");
    }));

    scenarioMetrics.push(await runScenario(browser, baseUrl, "04-half-siblings", async (page) => {
      await clickButton(page, "＋ 添加先证者");
      await clickButton(page, "配偶 E");
      await clickButton(page, "儿子 C");
      await clickButton(page, "配偶 E");
      page.once("dialog", async (dialog) => dialog.accept("2"));
      await clickButton(page, "女儿 D");
    }));
  } finally {
    await browser?.close();
    await server.close();
  }

  writeFileSync(
    path.join(ARTIFACT_DIR, "metrics.json"),
    `${JSON.stringify(scenarioMetrics, null, 2)}\n`,
    "utf8"
  );

  const empty = scenarioMetrics.find((metrics) => metrics.name === "01-empty");
  const family = scenarioMetrics.find((metrics) => metrics.name === "02-three-generation-family");
  const siblingControls = scenarioMetrics.find((metrics) => metrics.name === "03-sibling-controls");
  const halfSiblings = scenarioMetrics.find((metrics) => metrics.name === "04-half-siblings");

  assert.ok(empty);
  assert.equal(empty.title, "精神科遗传家族谱系图绘制工具 6.0.2");
  assert.equal(empty.heading, "家族谱系图绘制工具 6.0.2");
  assert.equal(empty.personFormHidden, true);
  assert.equal(empty.symbolCount, 0);

  assert.ok(family);
  assert.equal(family.symbolCount, 8);
  assert.ok(family.lineCount >= 10);
  assert.match(family.projectMeta, /8 名成员/);
  assertNoInvalidSvgAttributes(family);
  assertNoSymbolOverlaps(family);
  assertNoTextSymbolOverlaps(family);
  assertNoTextLineOverlaps(family);

  assert.ok(siblingControls);
  assert.equal(siblingControls.symbolCount, 9);
  assert.match(siblingControls.projectMeta, /9 名成员/);
  assert.ok(siblingControls.textLabels.some((label) => label.includes("哥哥")));
  assert.ok(siblingControls.textLabels.some((label) => label.includes("弟弟")));
  assert.ok(siblingControls.textLabels.some((label) => label.includes("姐姐")));
  assert.ok(siblingControls.textLabels.some((label) => label.includes("妹妹")));
  assert.ok(siblingControls.textLabels.some((label) => label.includes("孪生弟弟")));
  assert.ok(siblingControls.textLabels.some((label) => label.includes("孪生妹妹")));
  assertNoInvalidSvgAttributes(siblingControls);
  assertNoSymbolOverlaps(siblingControls);
  assertNoTextSymbolOverlaps(siblingControls);
  assertNoTextLineOverlaps(siblingControls);

  assert.ok(halfSiblings);
  assert.equal(halfSiblings.symbolCount, 5);
  assert.ok(halfSiblings.lineCount >= 6);
  assert.match(halfSiblings.projectMeta, /5 名成员/);
  assertNoInvalidSvgAttributes(halfSiblings);
  assertNoSymbolOverlaps(halfSiblings);
  assertNoTextSymbolOverlaps(halfSiblings);
  assertNoTextLineOverlaps(halfSiblings);
});

async function runScenario(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  baseUrl: string,
  name: string,
  build: (page: Page) => Promise<void>
): Promise<ScenarioMetrics> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleMessages.push(message.text());
  });
  page.on("pageerror", (error) => consoleMessages.push(error.message));

  try {
    await page.goto(`${baseUrl}${encodeURI(TOOL_PATH)}`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await build(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, `${name}.png`), scale: "css" });
    const metrics = await collectMetrics(page, name);

    assert.deepEqual(consoleMessages, [], `${name} console errors`);
    return metrics;
  } finally {
    await page.close();
  }
}

async function clickButton(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

async function collectMetrics(page: Page, name: string): Promise<ScenarioMetrics> {
  return page.evaluate(`(() => {
    const scenarioName = ${JSON.stringify(name)};
    const round = (value) => Math.round(value * 100) / 100;
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height)
      };
    };
    const attrs = [...document.querySelectorAll("svg *")].flatMap((element) =>
      [...element.attributes].map((attr) => attr.name + "=" + attr.value)
    );

    return {
      name: scenarioName,
      title: document.title,
      heading: document.querySelector("h1")?.textContent?.trim() ?? "",
      projectMeta: document.querySelector("#projectMeta")?.textContent?.trim() ?? "",
      status: document.querySelector("#statusLine")?.textContent?.trim() ?? "",
      zoom: document.querySelector("#zoomLabel")?.textContent?.trim() ?? "",
      viewBox: document.querySelector("#pedigreeSvg")?.getAttribute("viewBox") ?? "",
      personFormHidden: document.querySelector("#personForm")?.hidden ?? false,
      symbolCount: document.querySelectorAll(".person-symbol").length,
      lineCount: document.querySelectorAll(".marriage-line,.descent-line,.sibling-line,.individual-line").length,
      generationLabels: [...document.querySelectorAll(".generation-label")].map((element) => element.textContent ?? ""),
      textLabels: [...document.querySelectorAll("text")].map((element) => element.textContent ?? ""),
      symbolRects: [...document.querySelectorAll(".person-symbol")].map(rectOf),
      textRects: [...document.querySelectorAll(".person-label,.id-label,.meta-label,.diagnosis-label,.proband-label")]
        .map((element) => ({
          text: element.textContent ?? "",
          className: element.getAttribute("class") ?? "",
          rect: rectOf(element)
        }))
        .filter((item) => item.text.trim().length > 0 && item.rect.width > 0 && item.rect.height > 0),
      relationshipSegments: [...document.querySelectorAll(".marriage-line,.descent-line,.sibling-line,.individual-line,.twin-bar")]
        .flatMap((element) => relationshipSegments(element)),
      invalidSvgAttributes: attrs.filter((value) => /\\b(?:NaN|Infinity|-Infinity|undefined|null)\\b/.test(value))
    };

    function relationshipSegments(element) {
      const matrix = element.getScreenCTM();
      if (!matrix) return [];
      const className = element.getAttribute("class") ?? "";
      const toScreen = (x, y) => {
        const point = element.ownerSVGElement.createSVGPoint();
        point.x = Number(x);
        point.y = Number(y);
        const out = point.matrixTransform(matrix);
        return { x: round(out.x), y: round(out.y) };
      };
      const points = element.tagName.toLowerCase() === "line"
        ? [
            toScreen(element.getAttribute("x1"), element.getAttribute("y1")),
            toScreen(element.getAttribute("x2"), element.getAttribute("y2"))
          ]
        : (element.getAttribute("points") ?? "")
            .trim()
            .split(/\\s+/)
            .map((pair) => pair.split(",").map(Number))
            .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
            .map(([x, y]) => toScreen(x, y));
      return points.slice(1).map((point, index) => ({
        className,
        from: points[index],
        to: point
      }));
    }
  })()`);
}

function assertNoInvalidSvgAttributes(metrics: ScenarioMetrics) {
  assert.deepEqual(metrics.invalidSvgAttributes, [], `${metrics.name} invalid SVG attributes`);
}

function assertNoSymbolOverlaps(metrics: ScenarioMetrics) {
  for (let i = 0; i < metrics.symbolRects.length; i++) {
    for (let j = i + 1; j < metrics.symbolRects.length; j++) {
      assert.equal(
        overlaps(metrics.symbolRects[i], metrics.symbolRects[j]),
        false,
        `${metrics.name} symbol ${i} overlaps symbol ${j}`
      );
    }
  }
}

function assertNoTextSymbolOverlaps(metrics: ScenarioMetrics) {
  for (const text of metrics.textRects) {
    for (let i = 0; i < metrics.symbolRects.length; i++) {
      assert.equal(
        overlaps(text.rect, metrics.symbolRects[i], 1),
        false,
        `${metrics.name} text "${text.text}" overlaps symbol ${i}`
      );
    }
  }
}

function assertNoTextLineOverlaps(metrics: ScenarioMetrics) {
  for (const text of metrics.textRects) {
    for (const segment of metrics.relationshipSegments) {
      assert.equal(
        segmentIntersectsRect(segment.from, segment.to, text.rect, -4),
        false,
        `${metrics.name} text "${text.text}" overlaps ${segment.className}`
      );
    }
  }
}

function overlaps(a: RectMetrics, b: RectMetrics, inset = 2) {
  return a.x + inset < b.x + b.width - inset &&
    a.x + a.width - inset > b.x + inset &&
    a.y + inset < b.y + b.height - inset &&
    a.y + a.height - inset > b.y + inset;
}

function segmentIntersectsRect(from: PointMetrics, to: PointMetrics, rect: RectMetrics, inset = 0) {
  const left = rect.x + inset;
  const right = rect.x + rect.width - inset;
  const top = rect.y + inset;
  const bottom = rect.y + rect.height - inset;
  if (right <= left || bottom <= top) return false;
  if (pointInsideRect(from, left, right, top, bottom) || pointInsideRect(to, left, right, top, bottom)) return true;
  const edges = [
    [{ x: left, y: top }, { x: right, y: top }],
    [{ x: right, y: top }, { x: right, y: bottom }],
    [{ x: right, y: bottom }, { x: left, y: bottom }],
    [{ x: left, y: bottom }, { x: left, y: top }]
  ] as const;
  return edges.some(([a, b]) => segmentsIntersect(from, to, a, b));
}

function pointInsideRect(point: PointMetrics, left: number, right: number, top: number, bottom: number) {
  return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
}

function segmentsIntersect(a: PointMetrics, b: PointMetrics, c: PointMetrics, d: PointMetrics) {
  const d1 = direction(a, b, c);
  const d2 = direction(a, b, d);
  const d3 = direction(c, d, a);
  const d4 = direction(c, d, b);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return d1 === 0 && onSegment(a, b, c) ||
    d2 === 0 && onSegment(a, b, d) ||
    d3 === 0 && onSegment(c, d, a) ||
    d4 === 0 && onSegment(c, d, b);
}

function direction(a: PointMetrics, b: PointMetrics, c: PointMetrics) {
  return Math.sign((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x));
}

function onSegment(a: PointMetrics, b: PointMetrics, c: PointMetrics) {
  return c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) &&
    c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y);
}

async function startStaticServer(root: string): Promise<StaticServer> {
  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/favicon.ico") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const filePath = resolveRequestPath(root, url.pathname);
      if (!filePath) {
        send(response, 403, "text/plain", "Forbidden");
        return;
      }

      const stat = statSync(filePath);
      const finalPath = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
      const body = await readFile(finalPath);
      send(response, 200, contentType(finalPath), body);
    } catch {
      send(response, 404, "text/plain", "Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    )
  };
}

function resolveRequestPath(root: string, pathname: string) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, "");
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(root) && existsSync(resolved) ? resolved : null;
}

function send(response: ServerResponse, status: number, type: string, body: Buffer | string = "") {
  response.writeHead(status, { "content-type": type });
  response.end(body);
}

function contentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function isMissingChromium(error: unknown) {
  return error instanceof Error &&
    /Executable doesn't exist|browser executable|playwright install/i.test(error.message);
}

interface StaticServer {
  port: number;
  close: () => Promise<void>;
}

interface RectMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PointMetrics {
  x: number;
  y: number;
}

interface ScenarioMetrics {
  name: string;
  title: string;
  heading: string;
  projectMeta: string;
  status: string;
  zoom: string;
  viewBox: string;
  personFormHidden: boolean;
  symbolCount: number;
  lineCount: number;
  generationLabels: string[];
  textLabels: string[];
  symbolRects: RectMetrics[];
  textRects: Array<{
    text: string;
    className: string;
    rect: RectMetrics;
  }>;
  relationshipSegments: Array<{
    className: string;
    from: PointMetrics;
    to: PointMetrics;
  }>;
  invalidSvgAttributes: string[];
}
