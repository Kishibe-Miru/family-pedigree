import assert from "node:assert/strict";
import { createServer, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, Page } from "playwright";

const ROOT = process.cwd();
const TOOL_PATH = "/家族谱系图工具/index.html";
const ARTIFACT_DIR = path.join(ROOT, "output", "playwright", "browser-three-generation-matrix");
const AUTOSAVE_KEY = "psychiatric-pedigree-v3-autosave";
const CASES_PER_SHEET = 20;

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const scenarios = buildScenarios();
  assert.equal(scenarios.length, 100);

  const server = await startStaticServer(ROOT);
  const browser = await chromium.launch();
  const summaries: CaseSummary[] = [];

  try {
    const baseUrl = `http://127.0.0.1:${server.port}`;
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => consoleErrors.push(error.message));

      const pngPath = path.join(ARTIFACT_DIR, `${scenario.id}.png`);
      await page.goto(`${baseUrl}${encodeURI(TOOL_PATH)}`);
      await page.evaluate(({ key, project }) => {
        localStorage.clear();
        localStorage.setItem(key, JSON.stringify(project));
      }, { key: AUTOSAVE_KEY, project: scenario.project });
      await page.reload();
      await page.waitForSelector("#pedigreeSvg .person-symbol");
      await page.evaluate(() => {
        document.querySelector("#optShowLegend")?.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await fitViewportToSvg(page);
      const metrics = await collectMetrics(page);
      await page.locator("#canvasWrap").screenshot({ path: pngPath, scale: "css" });
      await page.close();

      summaries.push({
        id: scenario.id,
        title: scenario.title,
        png: pngPath,
        consoleErrors,
        ...metrics,
        issueCount: metrics.issues.length + consoleErrors.length
      });
    }

    for (let i = 0; i < summaries.length; i += CASES_PER_SHEET) {
      const sheetIndex = i / CASES_PER_SHEET + 1;
      const group = summaries.slice(i, i + CASES_PER_SHEET);
      const sheetHtmlPath = path.join(ARTIFACT_DIR, `contact-sheet-${String(sheetIndex).padStart(2, "0")}.html`);
      const sheetPngPath = path.join(ARTIFACT_DIR, `contact-sheet-${String(sheetIndex).padStart(2, "0")}.png`);
      writeFileSync(sheetHtmlPath, renderContactSheet(group, i + 1), "utf8");
      const page = await browser.newPage({ viewport: { width: 1680, height: 2200 }, deviceScaleFactor: 1 });
      await page.goto(`file://${sheetHtmlPath.replace(/\\/g, "/")}`);
      await page.locator(".sheet").screenshot({ path: sheetPngPath, scale: "css" });
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  writeFileSync(path.join(ARTIFACT_DIR, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    dir: ARTIFACT_DIR,
    cases: summaries.length,
    issues: summaries.filter((item) => item.issueCount > 0).length
  }, null, 2));
}

function buildScenarios(): BrowserScenario[] {
  const scenarios: BrowserScenario[] = [];
  for (const sourceSiblings of [1, 2, 3, 4, 5]) {
    for (const children of [1, 2, 3, 4, 5]) {
      for (const spouseOrigin of [false, true]) {
        for (const marriedSlot of [0, 1]) {
          const marriedIndex = sourceSiblings === 1 ? 0 : marriedSlot === 0 ? 0 : sourceSiblings - 1;
          const id = `${String(scenarios.length + 1).padStart(3, "0")}-g2-${sourceSiblings}-g3-${children}-${spouseOrigin ? "origin" : "direct"}-${marriedSlot === 0 ? "left" : "right"}`;
          scenarios.push(makeScenario(id, sourceSiblings, children, marriedIndex, spouseOrigin));
        }
      }
    }
  }
  return scenarios.slice(0, 100);
}

function makeScenario(
  id: string,
  sourceSiblings: number,
  children: number,
  marriedIndex: number,
  spouseOrigin: boolean
): BrowserScenario {
  const now = new Date().toISOString();
  const people: BrowserProject["people"] = [
    person("gf", "父", "male", 1),
    person("gm", "母", "female", 2)
  ];
  const unions: BrowserProject["unions"] = [
    union("grandparents", ["gf", "gm"])
  ];
  const parentages: BrowserProject["parentages"] = [];

  for (let i = 0; i < sourceSiblings; i++) {
    const personId = i === marriedIndex ? "parent" : `sib${i + 1}`;
    people.push(person(personId, i === marriedIndex ? "先证者" : `同胞${i + 1}`, i % 2 === 0 ? "unknown" : "female", i + 3));
    parentages.push(parentage(`pg_${personId}`, ["gf", "gm"], "grandparents", personId));
  }

  if (spouseOrigin) {
    people.push(
      person("sgf", "配偶父", "male", 100),
      person("sgm", "配偶母", "female", 101),
      person("spouse", "配偶", "unknown", 102)
    );
    unions.push(union("spouseParents", ["sgf", "sgm"]));
    parentages.push(parentage("pg_spouse", ["sgf", "sgm"], "spouseParents", "spouse"));
  } else {
    people.push(person("spouse", "配偶", "unknown", 100));
  }

  unions.push(union("parents", ["parent", "spouse"]));
  for (let i = 0; i < children; i++) {
    const childId = `child${i + 1}`;
    people.push(person(childId, `子女${i + 1}`, i % 2 === 0 ? "male" : "female", 200 + i));
    parentages.push(parentage(`pg_${childId}`, ["parent", "spouse"], "parents", childId));
  }

  const project: BrowserProject = {
    schemaVersion: 2,
    version: "6.0.2",
    title: `浏览器三代 ${id}`,
    createdAt: now,
    updatedAt: now,
    people,
    unions,
    parentages,
    phenotypes: [],
    geneticFindings: [],
    pregnancies: [],
    layout: { positions: {} },
    settings: {
      showNumber: true,
      showName: true,
      showDiagnosis: false,
      showAge: false,
      showLegend: false,
      showTitle: false,
      snapDrag: true
    }
  };

  return {
    id,
    title: `浏览器三代 G2=${sourceSiblings} G3=${children} ${spouseOrigin ? "配偶原生" : "外配偶"} ${marriedIndex + 1}号结婚`,
    project
  };
}

function person(id: string, name: string, sex: BrowserPerson["sex"], order: number): BrowserPerson {
  return {
    id,
    name,
    sex,
    age: "",
    birthYear: "",
    deceased: false,
    proband: id === "parent",
    twinGroup: "",
    twinType: "fraternal",
    notes: "",
    order
  };
}

function union(id: string, partnerIds: string[]): BrowserUnion {
  return {
    id,
    partnerIds,
    status: partnerIds.length === 1 ? "single-parent" : "partner",
    consanguineous: false
  };
}

function parentage(id: string, parentIds: string[], unionId: string, childId: string): BrowserParentage {
  return {
    id,
    parentIds,
    unionId,
    childId,
    relation: "biological"
  };
}

async function fitViewportToSvg(page: Page) {
  const size = await page.evaluate(() => {
    const svg = document.querySelector("#pedigreeSvg");
    const wrap = document.querySelector("#canvasWrap");
    const svgRect = svg?.getBoundingClientRect();
    const wrapRect = wrap?.getBoundingClientRect();
    return {
      width: Math.ceil(Math.max(1440, (svgRect?.right ?? 0) + 24, (wrapRect?.right ?? 0) + 24)),
      height: Math.ceil(Math.max(920, (svgRect?.bottom ?? 0) + 24, (wrapRect?.bottom ?? 0) + 24))
    };
  });
  await page.setViewportSize(size);
}

async function collectMetrics(page: Page): Promise<VisualMetrics> {
  return page.evaluate(`(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
    };
    const attrs = [...document.querySelectorAll("svg *")].flatMap((element) =>
      [...element.attributes].map((attr) => attr.name + "=" + attr.value)
    );
    const symbolRects = [...document.querySelectorAll(".person-symbol")].map(rectOf);
    const textRects = [...document.querySelectorAll(".person-label,.id-label,.meta-label,.diagnosis-label,.proband-label")]
      .map((element) => ({ text: element.textContent ?? "", rect: rectOf(element) }))
      .filter((item) => item.text.trim() && item.rect.width > 0 && item.rect.height > 0);
    const relationshipSegments = [...document.querySelectorAll(".marriage-line,.descent-line,.sibling-line,.individual-line,.twin-bar")]
      .flatMap((element) => segmentsForElement(element));
    const issues = [];
    const invalidSvgAttributes = attrs.filter((value) => /\\b(?:NaN|Infinity|-Infinity|undefined|null)\\b/.test(value));
    invalidSvgAttributes.forEach((value) => issues.push("invalid svg attribute " + value));
    for (let i = 0; i < symbolRects.length; i++) {
      for (let j = i + 1; j < symbolRects.length; j++) {
        if (overlaps(symbolRects[i], symbolRects[j], 2)) issues.push("symbol " + i + " overlaps symbol " + j);
      }
    }
    for (const text of textRects) {
      for (let i = 0; i < symbolRects.length; i++) {
        if (overlaps(text.rect, symbolRects[i], 1)) issues.push("text " + text.text + " overlaps symbol " + i);
      }
      for (const segment of relationshipSegments) {
        if (segmentIntersectsRect(segment.from, segment.to, text.rect, -4)) issues.push("text " + text.text + " overlaps line " + segment.className);
      }
    }
    for (let i = 0; i < relationshipSegments.length; i++) {
      for (let j = i + 1; j < relationshipSegments.length; j++) {
        const a = relationshipSegments[i];
        const b = relationshipSegments[j];
        if (a.className === b.className && a.className.includes("sibling-line")) continue;
        if (segmentsShareEndpoint(a, b)) continue;
        if (segmentsCross(a, b)) issues.push("line " + a.className + " crosses line " + b.className);
      }
    }
    return {
      projectMeta: document.querySelector("#projectMeta")?.textContent?.trim() ?? "",
      symbolCount: symbolRects.length,
      lineCount: document.querySelectorAll(".marriage-line,.descent-line,.sibling-line,.individual-line").length,
      textCount: textRects.length,
      issues
    };

    function segmentsForElement(element) {
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
      const tag = element.tagName.toLowerCase();
      const points = tag === "line"
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
      return points.slice(1)
        .map((point, index) => ({ className, from: points[index], to: point }))
        .filter((segment) => distance(segment.from, segment.to) > 0.5);
    }
    function overlaps(a, b, inset) {
      return a.x + inset < b.x + b.width - inset &&
        a.x + a.width - inset > b.x + inset &&
        a.y + inset < b.y + b.height - inset &&
        a.y + a.height - inset > b.y + inset;
    }
    function segmentIntersectsRect(from, to, rect, inset) {
      const left = rect.x + inset;
      const right = rect.x + rect.width - inset;
      const top = rect.y + inset;
      const bottom = rect.y + rect.height - inset;
      if (right <= left || bottom <= top) return false;
      const edges = [
        [{ x: left, y: top }, { x: right, y: top }],
        [{ x: right, y: top }, { x: right, y: bottom }],
        [{ x: right, y: bottom }, { x: left, y: bottom }],
        [{ x: left, y: bottom }, { x: left, y: top }]
      ];
      return edges.some(([a, b]) => segmentsCross({ from, to }, { from: a, to: b }));
    }
    function distance(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    function segmentsShareEndpoint(a, b) {
      return [a.from, a.to].some((left) => [b.from, b.to].some((right) => distance(left, right) < 0.5));
    }
    function segmentsCross(a, b) {
      const a1 = a.from;
      const a2 = a.to;
      const b1 = b.from;
      const b2 = b.to;
      const denom = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
      if (Math.abs(denom) < 0.0001) return false;
      const ua = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / denom;
      const ub = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / denom;
      return ua > 0.02 && ua < 0.98 && ub > 0.02 && ub < 0.98;
    }
  })()`);
}

function renderContactSheet(items: CaseSummary[], startIndex: number) {
  const cards = items.map((item, index) => {
    const rel = `./${path.basename(item.png)}`;
    const status = item.issueCount === 0 ? "OK" : `${item.issueCount} issues`;
    return `<section class="card">
      <h2>${startIndex + index}. ${escapeHtml(item.title)}</h2>
      <div class="${item.issueCount === 0 ? "ok" : "warn"}">${escapeHtml(status)}</div>
      <img src="${escapeAttr(rel)}" />
    </section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; background: #eef2f7; font-family: Arial, "Microsoft YaHei", sans-serif; color: #172026; }
    .sheet { padding: 18px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .card { background: white; border: 1px solid #d8dee8; border-radius: 8px; padding: 10px; overflow: hidden; }
    h2 { margin: 0 0 6px; font-size: 13px; line-height: 1.25; }
    .ok, .warn { font-size: 12px; font-weight: 700; margin-bottom: 6px; }
    .ok { color: #047857; }
    .warn { color: #b45309; }
    img { width: 100%; display: block; border: 1px solid #edf0f4; }
  </style>
</head>
<body><main class="sheet">${cards}</main></body>
</html>`;
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char] ?? char));
}

function escapeAttr(value: string | number) {
  return escapeHtml(String(value));
}

interface StaticServer {
  port: number;
  close: () => Promise<void>;
}

interface BrowserScenario {
  id: string;
  title: string;
  project: BrowserProject;
}

interface BrowserProject {
  schemaVersion: number;
  version: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  people: BrowserPerson[];
  unions: BrowserUnion[];
  parentages: BrowserParentage[];
  phenotypes: unknown[];
  geneticFindings: unknown[];
  pregnancies: unknown[];
  layout: { positions: Record<string, unknown> };
  settings: Record<string, boolean>;
}

interface BrowserPerson {
  id: string;
  name: string;
  sex: "male" | "female" | "unknown";
  age: string;
  birthYear: string;
  deceased: boolean;
  proband: boolean;
  twinGroup: string;
  twinType: "fraternal" | "identical";
  notes: string;
  order: number;
}

interface BrowserUnion {
  id: string;
  partnerIds: string[];
  status: string;
  consanguineous: boolean;
}

interface BrowserParentage {
  id: string;
  parentIds: string[];
  unionId: string;
  childId: string;
  relation: string;
}

interface VisualMetrics {
  projectMeta: string;
  symbolCount: number;
  lineCount: number;
  textCount: number;
  issues: string[];
}

interface CaseSummary extends VisualMetrics {
  id: string;
  title: string;
  png: string;
  consoleErrors: string[];
  issueCount: number;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
