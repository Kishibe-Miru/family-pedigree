import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, Page } from "playwright";
import { layout } from "../src/browser/entry";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, "output", "playwright", "three-generation-matrix");
const CASES_PER_SHEET = 20;

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const scenarios = buildScenarios();
  assert.equal(scenarios.length, 100);
  const browser = await chromium.launch();
  const summaries: CaseSummary[] = [];

  try {
    for (const scenario of scenarios) {
      const response = layout(scenario.input);
      assert.ok(response.ok, `${scenario.id} layout failed`);
      const htmlPath = path.join(ARTIFACT_DIR, `${scenario.id}.html`);
      const pngPath = path.join(ARTIFACT_DIR, `${scenario.id}.png`);
      writeFileSync(htmlPath, renderHtml(scenario, response.layout), "utf8");

      const page = await browser.newPage({ viewport: { width: 820, height: 580 }, deviceScaleFactor: 1 });
      await page.goto(`file://${htmlPath.replace(/\\/g, "/")}`);
      await page.setViewportSize(await measureCaptureViewport(page));
      const metrics = await collectMetrics(page);
      await page.locator(".capture").screenshot({ path: pngPath, scale: "css" });
      await page.close();

      summaries.push({
        id: scenario.id,
        title: scenario.title,
        png: pngPath,
        nodeCount: response.layout.nodes.length,
        segmentCount: response.layout.relationshipSegments.length,
        ...metrics
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
  }

  writeFileSync(path.join(ARTIFACT_DIR, "summary.json"), `${JSON.stringify(summaries, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    dir: ARTIFACT_DIR,
    cases: summaries.length,
    issues: summaries.filter((item) => item.issueCount > 0).length
  }, null, 2));
}

function buildScenarios(): ThreeGenerationScenario[] {
  const scenarios: ThreeGenerationScenario[] = [];
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
): ThreeGenerationScenario {
  const persons: LayoutInput["persons"] = [
    { id: "father", sex: "M" },
    { id: "mother", sex: "F" }
  ];
  const unions: LayoutInput["unions"] = [
    { id: "parentsOfProband", partners: ["father", "mother"] }
  ];
  const childrenMap: LayoutInput["childrenMap"] = [
    ["parentsOfProband", []]
  ];

  for (let i = 0; i < sourceSiblings; i++) {
    const personId = i === marriedIndex ? "proband" : `sib${i + 1}`;
    persons.push({ id: personId, sex: i % 2 === 0 ? "U" : "F", birthOrder: i });
    childrenMap[0][1].push(personId);
  }

  if (spouseOrigin) {
    persons.push(
      { id: "sgf", sex: "M" },
      { id: "sgm", sex: "F" },
      { id: "spouse", sex: "U", birthOrder: 0 }
    );
    unions.push({ id: "spouseParents", partners: ["sgf", "sgm"] });
    childrenMap.push(["spouseParents", ["spouse"]]);
  } else {
    persons.push({ id: "spouse", sex: "U" });
  }

  unions.push({ id: "parents", partners: ["proband", "spouse"] });
  const childIds: string[] = [];
  for (let i = 0; i < children; i++) {
    const childId = `child${i + 1}`;
    persons.push({ id: childId, sex: i % 2 === 0 ? "M" : "F", birthOrder: i });
    childIds.push(childId);
  }
  childrenMap.push(["parents", childIds]);

  return {
    id,
    title: `三代 G2=${sourceSiblings} G3=${children} ${spouseOrigin ? "配偶原生" : "外配偶"} ${marriedIndex + 1}号结婚`,
    input: { persons, unions, childrenMap }
  };
}

async function collectMetrics(page: Page): Promise<VisualMetrics> {
  return page.evaluate(`(() => {
    const round = (value) => Math.round(value * 100) / 100;
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height) };
    };
    const symbolRects = [...document.querySelectorAll(".node")].map(rectOf);
    const textRects = [...document.querySelectorAll(".label")]
      .map((element) => ({ text: element.textContent ?? "", rect: rectOf(element) }))
      .filter((item) => item.text.trim() && item.rect.width > 0 && item.rect.height > 0);
    const lineRects = [...document.querySelectorAll(".relationship")].map(rectOf);
    const lineSegments = [...document.querySelectorAll(".relationship")].flatMap((element) => {
      const raw = element.getAttribute("points") ?? "";
      const points = raw.trim().split(/\\s+/).map((item) => {
        const [x, y] = item.split(",").map(Number);
        return { x, y };
      }).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      const out = [];
      for (let i = 1; i < points.length; i++) {
        if (distance(points[i - 1], points[i]) < 0.5) continue;
        out.push({
          id: element.getAttribute("data-id") ?? "",
          unionId: element.getAttribute("data-union") ?? "",
          kind: element.getAttribute("data-kind") ?? "",
          a: points[i - 1],
          b: points[i]
        });
      }
      return out;
    });
    const canvasRect = rectOf(document.querySelector(".canvas"));
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const issues = [];
    if (canvasRect.x < 0 || canvasRect.y < 0 || canvasRect.x + canvasRect.width > viewport.width || canvasRect.y + canvasRect.height > viewport.height) {
      issues.push("canvas is clipped by viewport");
    }
    for (let i = 0; i < symbolRects.length; i++) {
      for (let j = i + 1; j < symbolRects.length; j++) {
        if (overlaps(symbolRects[i], symbolRects[j], 2)) issues.push("symbol " + i + " overlaps symbol " + j);
      }
    }
    for (const text of textRects) {
      for (let i = 0; i < symbolRects.length; i++) {
        if (overlaps(text.rect, symbolRects[i], 1)) issues.push("text " + text.text + " overlaps symbol " + i);
      }
      for (let i = 0; i < lineRects.length; i++) {
        if (overlaps(text.rect, lineRects[i], 1)) issues.push("text " + text.text + " bbox overlaps line " + i);
      }
    }
    for (let i = 0; i < lineSegments.length; i++) {
      for (let j = i + 1; j < lineSegments.length; j++) {
        const a = lineSegments[i];
        const b = lineSegments[j];
        if (a.unionId && a.unionId === b.unionId) continue;
        if (segmentsShareEndpoint(a, b)) continue;
        if (segmentsCross(a, b)) issues.push("line " + a.id + " crosses line " + b.id);
      }
    }
    return { symbolCount: symbolRects.length, lineCount: lineRects.length, issueCount: issues.length, issues };

    function overlaps(a, b, inset) {
      return a.x + inset < b.x + b.width - inset &&
        a.x + a.width - inset > b.x + inset &&
        a.y + inset < b.y + b.height - inset &&
        a.y + a.height - inset > b.y + inset;
    }
    function distance(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    function segmentsShareEndpoint(a, b) {
      return [a.a, a.b].some((left) => [b.a, b.b].some((right) => distance(left, right) < 0.5));
    }
    function segmentsCross(a, b) {
      const denom = (a.b.x - a.a.x) * (b.b.y - b.a.y) - (a.b.y - a.a.y) * (b.b.x - b.a.x);
      if (Math.abs(denom) < 0.0001) return overlappingCollinear(a, b);
      const ua = ((b.a.x - a.a.x) * (b.b.y - b.a.y) - (b.a.y - a.a.y) * (b.b.x - b.a.x)) / denom;
      const ub = ((b.a.x - a.a.x) * (a.b.y - a.a.y) - (b.a.y - a.a.y) * (a.b.x - a.a.x)) / denom;
      return ua > 0.02 && ua < 0.98 && ub > 0.02 && ub < 0.98;
    }
    function overlappingCollinear(a, b) {
      const cross = (a.b.x - a.a.x) * (b.a.y - a.a.y) - (a.b.y - a.a.y) * (b.a.x - a.a.x);
      if (Math.abs(cross) > 0.5) return false;
      const horizontal = Math.abs(a.a.y - a.b.y) <= Math.abs(a.a.x - a.b.x);
      const aMin = Math.min(horizontal ? a.a.x : a.a.y, horizontal ? a.b.x : a.b.y);
      const aMax = Math.max(horizontal ? a.a.x : a.a.y, horizontal ? a.b.x : a.b.y);
      const bMin = Math.min(horizontal ? b.a.x : b.a.y, horizontal ? b.b.x : b.b.y);
      const bMax = Math.max(horizontal ? b.a.x : b.a.y, horizontal ? b.b.x : b.b.y);
      return Math.min(aMax, bMax) - Math.max(aMin, bMin) > 1;
    }
  })()`);
}

async function measureCaptureViewport(page: Page) {
  return page.evaluate(() => {
    const capture = document.querySelector(".capture");
    const canvas = document.querySelector(".canvas");
    const title = document.querySelector(".case-title");
    const maxRight = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      capture?.scrollWidth ?? 0,
      canvas ? canvas.getBoundingClientRect().right + 22 : 0,
      title ? title.getBoundingClientRect().right + 22 : 0
    );
    const maxBottom = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
      capture?.scrollHeight ?? 0,
      canvas ? canvas.getBoundingClientRect().bottom + 22 : 0
    );
    return {
      width: Math.ceil(Math.max(820, maxRight)),
      height: Math.ceil(Math.max(580, maxBottom))
    };
  });
}

function renderHtml(scenario: ThreeGenerationScenario, result: LayoutResult) {
  const frame = computeFrame(result);
  const lines = result.relationshipSegments
    .map((segment) => svgPolyline(segment))
    .join("\n");
  const nodes = result.nodes.map((node) => svgNode(node)).join("\n");
  const labels = result.generationLabels
    .map((label) => `<text class="generation-label" x="${escapeAttr(frame.left + 20)}" y="${escapeAttr(label.y)}">${escapeHtml(label.label)}</text>`)
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(scenario.title)}</title>
  <style>
    body { margin: 0; background: #f7f8fb; color: #1f2937; font-family: Arial, "Microsoft YaHei", sans-serif; }
    .wrap { padding: 22px; }
    .case-title { margin: 0 0 10px; font-size: 18px; font-weight: 700; }
    .canvas { background: white; border: 1px solid #d7dce5; border-radius: 8px; box-shadow: 0 8px 28px rgba(31, 41, 55, 0.08); display: inline-block; }
    svg { display: block; }
    .relationship { fill: none; stroke: #374151; stroke-width: 2; stroke-linecap: square; stroke-linejoin: miter; }
    .marriage { stroke-width: 2.4; }
    .node { fill: #ffffff; stroke: #111827; stroke-width: 2; }
    .label { fill: #111827; font-size: 12px; text-anchor: middle; dominant-baseline: hanging; }
    .generation-label { fill: #64748b; font-size: 14px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="wrap capture">
    <h1 class="case-title">${escapeHtml(scenario.id)} ${escapeHtml(scenario.title)}</h1>
    <div class="canvas">
      <svg width="${Math.ceil(frame.width)}" height="${Math.ceil(frame.height)}" viewBox="${escapeAttr(frame.left)} ${escapeAttr(frame.top)} ${escapeAttr(frame.width)} ${escapeAttr(frame.height)}" role="img" aria-label="${escapeAttr(scenario.title)}">
        ${labels}
        ${lines}
        ${nodes}
      </svg>
    </div>
  </div>
</body>
</html>`;
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

function computeFrame(result: LayoutResult) {
  const padding = 70;
  const labelBottomPadding = 42;
  const generationLabelXs = result.generationLabels.map((label) => label.x);
  const minX = Math.min(result.bounds.minX, ...generationLabelXs) - padding;
  const minY = result.bounds.minY - padding;
  const maxX = result.bounds.maxX + padding;
  const maxY = Math.max(result.bounds.maxY, ...result.nodes.map((node) => node.y + labelBottomPadding)) + padding;
  return {
    left: minX,
    top: minY,
    width: Math.max(220, maxX - minX),
    height: Math.max(220, maxY - minY)
  };
}

function svgPolyline(segment: LayoutResult["relationshipSegments"][number]) {
  const points = segment.points;
  if (points.length < 2) return "";
  const d = points.map((point) => `${point.x},${point.y}`).join(" ");
  const className = classNameForSegment(segment.kind ?? segment.type);
  return `<polyline class="relationship ${className}" data-id="${escapeAttr(segment.id)}" data-union="${escapeAttr(segment.unionId ?? "")}" data-kind="${escapeAttr(segment.kind)}" points="${escapeAttr(d)}" />`;
}

function svgNode(node: LayoutResult["nodes"][number]) {
  const size = 44;
  const half = size / 2;
  const label = escapeHtml(node.id);
  if (node.sex === "F") {
    return `<g><circle class="node" cx="${escapeAttr(node.x)}" cy="${escapeAttr(node.y)}" r="${half}" /><text class="label" x="${escapeAttr(node.x)}" y="${escapeAttr(node.y + half + 12)}">${label}</text></g>`;
  }
  if (node.sex === "M") {
    return `<g><rect class="node" x="${escapeAttr(node.x - half)}" y="${escapeAttr(node.y - half)}" width="${size}" height="${size}" /><text class="label" x="${escapeAttr(node.x)}" y="${escapeAttr(node.y + half + 12)}">${label}</text></g>`;
  }
  return `<g><path class="node" d="M ${escapeAttr(node.x)} ${escapeAttr(node.y - half)} L ${escapeAttr(node.x + half)} ${escapeAttr(node.y)} L ${escapeAttr(node.x)} ${escapeAttr(node.y + half)} L ${escapeAttr(node.x - half)} ${escapeAttr(node.y)} Z" /><text class="label" x="${escapeAttr(node.x)}" y="${escapeAttr(node.y + half + 12)}">${label}</text></g>`;
}

function classNameForSegment(kind: string) {
  return kind === "marriage" ? "marriage" : kind;
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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisualMetrics {
  symbolCount: number;
  lineCount: number;
  issueCount: number;
  issues: string[];
}

interface CaseSummary extends VisualMetrics {
  id: string;
  title: string;
  png: string;
  nodeCount: number;
  segmentCount: number;
}

interface ThreeGenerationScenario {
  id: string;
  title: string;
  input: LayoutInput;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
