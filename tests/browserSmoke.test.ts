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

    // 一女两男：女先证者与两任丈夫各育一子女（2026-10-27 前会触发布局不变量失败、画布塌缩）
    scenarioMetrics.push(await runScenario(browser, baseUrl, "05-woman-two-husbands", async (page) => {
      await clickButton(page, "＋ 添加先证者");
      await page.selectOption("#personSex", "female");
      await clickButton(page, "配偶 E");
      await clickButton(page, "配偶 E");
      page.once("dialog", async (dialog) => dialog.accept("1"));
      await clickButton(page, "儿子 C");
      page.once("dialog", async (dialog) => dialog.accept("2"));
      await clickButton(page, "女儿 D");
    }));

    // 先证者之母再婚：母亲与前夫、现夫各一子（同母异父弟）
    scenarioMetrics.push(await runScenario(browser, baseUrl, "06-mother-remarried", async (page) => {
      await clickButton(page, "＋ 添加先证者");
      await page.selectOption("#personSex", "male");
      await clickButton(page, "父亲 F");
      await clickButton(page, "母亲 M");
      await clickPersonByLabel(page, "母");
      await clickButton(page, "配偶 E");
      page.once("dialog", async (dialog) => dialog.accept("2"));
      await clickButton(page, "儿子 C");
    }));

    // 离婚 / 分居：通过右侧"婚姻关系"面板改状态，第一段离婚、第二段分居
    scenarioMetrics.push(await runScenario(browser, baseUrl, "07-divorce-marks", async (page) => {
      await clickButton(page, "＋ 添加先证者");
      await page.selectOption("#personSex", "male");
      await clickButton(page, "配偶 E");
      await clickButton(page, "配偶 E");
      page.once("dialog", async (dialog) => dialog.accept("1"));
      await clickButton(page, "儿子 C");
      page.once("dialog", async (dialog) => dialog.accept("2"));
      await clickButton(page, "女儿 D");
      await page.locator(".marriage-row").nth(0).locator(".marriage-status").selectOption("divorced");
      await page.locator(".marriage-row").nth(1).locator(".marriage-status").selectOption("separated");
      assert.match(await page.locator("#statusLine").innerText(), /分居/);
      await page.locator(".marriage-row").nth(0).locator(".marriage-year").nth(1).fill("2010");

      // 家族史文字应写出先证者的婚姻情况；导出 SVG 应带斜杠及其样式
      await clickButton(page, "📋 生成家族史文字");
      const history = await page.locator("#historyText").inputValue();
      assert.match(history, /先证者有 2 段婚姻（已离婚 1 段，分居 1 段）/);
      await clickButton(page, "关闭");
      const exported = String(await page.evaluate("buildExportSvg().svg.outerHTML"));
      assert.equal((exported.match(/class="marriage-mark marriage-mark-/g) ?? []).length, 3);
      assert.match(exported, /\.marriage-mark\{stroke:#2f3a42/);

      // 撤销：第一次撤销年份输入，第二次撤销状态修改（分居 → 在婚），斜杠减少 1 道
      // （撤销后会取消选中，需重新点击先证者才能看到婚姻关系面板）
      await clickButton(page, "↶ 撤销");
      assert.equal(await page.locator("#pedigreeSvg .marriage-mark").count(), 3);
      await clickPersonByLabel(page, "先证者");
      assert.equal(await page.locator(".marriage-row").nth(0).locator(".marriage-year").nth(1).inputValue(), "");
      await clickButton(page, "↶ 撤销");
      assert.equal(await page.locator("#pedigreeSvg .marriage-mark").count(), 2);
      await clickButton(page, "↷ 重做");
      await clickButton(page, "↷ 重做");
      assert.equal(await page.locator("#pedigreeSvg .marriage-mark").count(), 3);
      await clickPersonByLabel(page, "先证者");
    }));

    // 加载旧格式项目（union 无 status 字段）应按在婚处理，不报错
    scenarioMetrics.push(await runScenario(browser, baseUrl, "08-legacy-project-load", async (page) => {
      const legacyProject = {
        schemaVersion: 2,
        version: "6.0.3",
        title: "旧项目",
        people: [
          { id: "p1", name: "先证者", sex: "female", proband: true, order: 1 },
          { id: "p2", name: "前夫", sex: "male", order: 2 },
          { id: "p3", name: "现夫", sex: "male", order: 3 },
          { id: "p4", name: "儿子", sex: "male", order: 4 }
        ],
        unions: [
          { id: "u1", partnerIds: ["p2", "p1"] },
          { id: "u2", partnerIds: ["p3", "p1"] }
        ],
        parentages: [{ id: "pa1", unionId: "u1", parentIds: ["p2", "p1"], childId: "p4", kind: "biological" }],
        phenotypes: [], geneticFindings: [], pregnancies: [],
        settings: {}, layout: { positions: {} }
      };
      await page.setInputFiles("#loadJsonInput", {
        name: "legacy.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(legacyProject), "utf8")
      });
      await page.waitForFunction(() => document.querySelectorAll(".person-symbol").length === 4);
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
  assert.equal(empty.title, "精神科遗传家族谱系图绘制工具 6.0.3");
  assert.equal(empty.heading, "家族谱系图绘制工具 6.0.3");
  assert.equal(empty.personFormHidden, true);
  assert.equal(empty.hasCopyPngButton, true);
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

  const womanTwoHusbands = scenarioMetrics.find((metrics) => metrics.name === "05-woman-two-husbands");
  assert.ok(womanTwoHusbands);
  assert.equal(womanTwoHusbands.symbolCount, 5);
  assert.equal(womanTwoHusbands.marriageLineCount, 2, "两段婚姻都应画出婚配线");
  assert.ok(womanTwoHusbands.lineCount >= 6);
  assert.doesNotMatch(womanTwoHusbands.status, /布局失败/);
  assertNoInvalidSvgAttributes(womanTwoHusbands);
  assertNoSymbolOverlaps(womanTwoHusbands);
  assertNoTextSymbolOverlaps(womanTwoHusbands);
  assertNoTextLineOverlaps(womanTwoHusbands);

  const motherRemarried = scenarioMetrics.find((metrics) => metrics.name === "06-mother-remarried");
  assert.ok(motherRemarried);
  assert.equal(motherRemarried.symbolCount, 5);
  assert.equal(motherRemarried.marriageLineCount, 2);
  assert.doesNotMatch(motherRemarried.status, /布局失败/);
  assertNoInvalidSvgAttributes(motherRemarried);
  assertNoSymbolOverlaps(motherRemarried);
  assertNoTextSymbolOverlaps(motherRemarried);
  assertNoTextLineOverlaps(motherRemarried);

  const divorceMarks = scenarioMetrics.find((metrics) => metrics.name === "07-divorce-marks");
  assert.ok(divorceMarks);
  assert.equal(divorceMarks.symbolCount, 5);
  assert.equal(divorceMarks.marriageLineCount, 2);
  assert.equal(divorceMarks.marriageMarkCount, 3, "离婚 2 道 + 分居 1 道斜杠");
  assert.ok(divorceMarks.marriageRows.length === 2);
  assert.deepEqual(divorceMarks.marriageRows.map((row) => row.status), ["divorced", "separated"]);
  assert.equal(divorceMarks.marriageRows[0].endYear, "2010");
  assert.ok(divorceMarks.textLabels.some((label) => label.includes("离婚")));
  assert.ok(divorceMarks.textLabels.some((label) => label.includes("分居")));
  assertNoInvalidSvgAttributes(divorceMarks);
  assertNoSymbolOverlaps(divorceMarks);
  assertNoTextSymbolOverlaps(divorceMarks);
  assertNoTextLineOverlaps(divorceMarks);
  assertMarksOnMarriageLines(divorceMarks);

  const legacy = scenarioMetrics.find((metrics) => metrics.name === "08-legacy-project-load");
  assert.ok(legacy);
  assert.equal(legacy.symbolCount, 4);
  assert.equal(legacy.marriageLineCount, 2);
  assert.equal(legacy.marriageMarkCount, 0);
  assert.doesNotMatch(legacy.status, /失败|错误/);
  assertNoInvalidSvgAttributes(legacy);
  assertNoSymbolOverlaps(legacy);
});

async function clickPersonByLabel(page: Page, label: string) {
  // 点击符号本身而不是整个 <g>：先证者箭头会把组的外接框拉大，中心可能落在空白处
  await page.locator("g.node-hit")
    .filter({ has: page.locator("text", { hasText: new RegExp(`^${label}$`) }) })
    .first()
    .locator(".person-symbol")
    .click();
}

// 每道斜杠的中心都必须落在某条婚配线的水平段上，且不与子女下降线重合
function assertMarksOnMarriageLines(metrics: ScenarioMetrics) {
  const marriages = metrics.relationshipSegments.filter((segment) => segment.className.includes("marriage-line"));
  const descents = metrics.relationshipSegments.filter((segment) => segment.className.includes("descent-line"));
  for (const mark of metrics.marriageMarks) {
    const onLine = marriages.some((segment) =>
      Math.abs(segment.from.y - segment.to.y) < 0.5 &&
      Math.abs(mark.y - segment.from.y) < 1 &&
      mark.x > Math.min(segment.from.x, segment.to.x) &&
      mark.x < Math.max(segment.from.x, segment.to.x)
    );
    assert.ok(onLine, `${metrics.name} mark at ${mark.x},${mark.y} is not on a marriage line`);
    const hitsDescent = descents.some((segment) => Math.abs(segment.from.x - mark.x) < 4 && Math.abs(segment.to.x - mark.x) < 4);
    assert.ok(!hitsDescent, `${metrics.name} mark at ${mark.x},${mark.y} overlaps a descent line`);
  }
}

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
      hasCopyPngButton: !!document.querySelector("#copyPngBtn"),
      status: document.querySelector("#statusLine")?.textContent?.trim() ?? "",
      zoom: document.querySelector("#zoomLabel")?.textContent?.trim() ?? "",
      viewBox: document.querySelector("#pedigreeSvg")?.getAttribute("viewBox") ?? "",
      personFormHidden: document.querySelector("#personForm")?.hidden ?? false,
      symbolCount: document.querySelectorAll(".person-symbol").length,
      lineCount: document.querySelectorAll(".marriage-line,.descent-line,.sibling-line,.individual-line").length,
      marriageLineCount: document.querySelectorAll("#pedigreeSvg .marriage-line").length,
      marriageMarkCount: document.querySelectorAll("#pedigreeSvg .marriage-mark").length,
      marriageMarks: [...document.querySelectorAll("#pedigreeSvg .marriage-mark")].map((element) => {
        const [segment] = relationshipSegments(element);
        return segment ? { x: round((segment.from.x + segment.to.x) / 2), y: round((segment.from.y + segment.to.y) / 2) } : { x: NaN, y: NaN };
      }),
      marriageRows: [...document.querySelectorAll(".marriage-row")].map((row) => ({
        head: row.querySelector(".marriage-row-head")?.textContent ?? "",
        status: row.querySelector(".marriage-status")?.value ?? "",
        startYear: row.querySelectorAll(".marriage-year")[0]?.value ?? "",
        endYear: row.querySelectorAll(".marriage-year")[1]?.value ?? ""
      })),
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
  hasCopyPngButton: boolean;
  symbolCount: number;
  lineCount: number;
  marriageLineCount: number;
  marriageMarkCount: number;
  marriageMarks: PointMetrics[];
  marriageRows: Array<{ head: string; status: string; startYear: string; endYear: string }>;
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
