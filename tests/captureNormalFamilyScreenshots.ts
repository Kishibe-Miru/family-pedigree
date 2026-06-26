import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { layout } from "../src/browser/entry";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";

const ROOT = process.cwd();
const ARTIFACT_DIR = path.join(ROOT, "output", "playwright", "normal-family-layouts");

const scenarios: NormalScenario[] = [
  {
    id: "00-no-child-spouse-union",
    title: "无子女配偶",
    input: {
      persons: [
        { id: "partnerA", sex: "M" },
        { id: "partnerB", sex: "F" }
      ],
      unions: [
        { id: "marriage", partners: ["partnerA", "partnerB"] }
      ],
      childrenMap: [
        ["marriage", []]
      ]
    }
  },
  {
    id: "01-two-parent-one-child",
    title: "双亲一孩",
    input: {
      persons: [
        { id: "father", sex: "M" },
        { id: "mother", sex: "F" },
        { id: "child", sex: "U", birthOrder: 0 }
      ],
      unions: [
        { id: "parents", partners: ["father", "mother"] }
      ],
      childrenMap: [
        ["parents", ["child"]]
      ]
    }
  },
  {
    id: "02-three-siblings",
    title: "双亲三孩",
    input: {
      persons: [
        { id: "father", sex: "M" },
        { id: "mother", sex: "F" },
        { id: "oldest", sex: "U", birthOrder: 0 },
        { id: "middle", sex: "U", birthOrder: 1 },
        { id: "youngest", sex: "U", birthOrder: 2 }
      ],
      unions: [
        { id: "parents", partners: ["father", "mother"] }
      ],
      childrenMap: [
        ["parents", ["oldest", "middle", "youngest"]]
      ]
    }
  },
  {
    id: "03-married-child-with-child",
    title: "子女结婚并生育",
    input: {
      persons: [
        { id: "father", sex: "M" },
        { id: "mother", sex: "F" },
        { id: "child", sex: "U", birthOrder: 0 },
        { id: "spouse", sex: "U" },
        { id: "grandchild", sex: "U", birthOrder: 0 }
      ],
      unions: [
        { id: "parents", partners: ["father", "mother"] },
        { id: "marriage", partners: ["child", "spouse"] }
      ],
      childrenMap: [
        ["parents", ["child"]],
        ["marriage", ["grandchild"]]
      ]
    }
  },
  {
    id: "04-three-generation-family",
    title: "正常三代家庭",
    input: {
      persons: [
        { id: "grandfather", sex: "M" },
        { id: "grandmother", sex: "F" },
        { id: "parent", sex: "U", birthOrder: 0 },
        { id: "partner", sex: "U" },
        { id: "child", sex: "U", birthOrder: 0 }
      ],
      unions: [
        { id: "grandparents", partners: ["grandfather", "grandmother"] },
        { id: "parents", partners: ["parent", "partner"] }
      ],
      childrenMap: [
        ["grandparents", ["parent"]],
        ["parents", ["child"]]
      ]
    }
  }
];

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const browser = await chromium.launch();

  try {
    for (const scenario of scenarios) {
      const response = layout(scenario.input);
      assert.ok(response.ok, `${scenario.id} layout failed`);
      const htmlPath = path.join(ARTIFACT_DIR, `${scenario.id}.html`);
      const pngPath = path.join(ARTIFACT_DIR, `${scenario.id}.png`);
      writeFileSync(htmlPath, renderHtml(scenario.title, response.layout), "utf8");

      const page = await browser.newPage({ viewport: { width: 980, height: 680 }, deviceScaleFactor: 1 });
      await page.goto(`file://${htmlPath.replace(/\\/g, "/")}`);
      await page.locator(".capture").screenshot({ path: pngPath, scale: "css" });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(ARTIFACT_DIR);
}

function renderHtml(title: string, result: LayoutResult) {
  const frame = computeFrame(result);
  const lines = result.relationshipSegments
    .map((segment) => svgPolyline(segment.points, classNameForSegment(segment.kind ?? segment.type)))
    .join("\n");
  const nodes = result.nodes.map((node) => svgNode(node)).join("\n");
  const labels = result.generationLabels
    .map((label) => `<text class="generation-label" x="${escapeAttr(frame.left + 20)}" y="${escapeAttr(label.y)}">${escapeHtml(label.label)}</text>`)
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f7f8fb; color: #1f2937; font-family: Arial, "Microsoft YaHei", sans-serif; }
    .wrap { padding: 28px; }
    h1 { margin: 0 0 14px; font-size: 22px; font-weight: 700; }
    .canvas { background: white; border: 1px solid #d7dce5; border-radius: 8px; box-shadow: 0 8px 28px rgba(31, 41, 55, 0.08); display: inline-block; }
    svg { display: block; }
    .relationship { fill: none; stroke: #374151; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .marriage { stroke-width: 2.5; }
    .node { fill: #ffffff; stroke: #111827; stroke-width: 2; }
    .male { rx: 0; }
    .female { }
    .label { fill: #111827; font-size: 13px; text-anchor: middle; dominant-baseline: middle; }
    .generation-label { fill: #64748b; font-size: 14px; font-weight: 700; }
  </style>
</head>
<body>
  <div class="wrap capture">
    <h1>${escapeHtml(title)}</h1>
    <div class="canvas">
      <svg width="${Math.ceil(frame.width)}" height="${Math.ceil(frame.height)}" viewBox="${escapeAttr(frame.left)} ${escapeAttr(frame.top)} ${escapeAttr(frame.width)} ${escapeAttr(frame.height)}" role="img" aria-label="${escapeAttr(title)}">
        ${labels}
        ${lines}
        ${nodes}
      </svg>
    </div>
  </div>
</body>
</html>`;
}

function computeFrame(result: LayoutResult) {
  const padding = 70;
  const labelBottomPadding = 44;
  const generationLabelXs = result.generationLabels.map((label) => label.x);
  const minX = Math.min(result.bounds.minX, ...generationLabelXs) - padding;
  const minY = result.bounds.minY - padding;
  const maxX = result.bounds.maxX + padding;
  const maxY = Math.max(result.bounds.maxY, ...result.nodes.map((node) => node.y + labelBottomPadding)) + padding;
  return {
    left: minX,
    top: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function svgPolyline(points: { x: number; y: number }[], className: string) {
  if (points.length < 2) return "";
  const d = points.map((point) => `${point.x},${point.y}`).join(" ");
  return `<polyline class="relationship ${className}" points="${escapeAttr(d)}" />`;
}

function svgNode(node: LayoutResult["nodes"][number]) {
  const size = 48;
  const half = size / 2;
  const label = escapeHtml(node.id);
  if (node.sex === "F") {
    return `<g><circle class="node female" cx="${escapeAttr(node.x)}" cy="${escapeAttr(node.y)}" r="${half}" /><text class="label" x="${escapeAttr(node.x)}" y="${escapeAttr(node.y + half + 18)}">${label}</text></g>`;
  }
  if (node.sex === "M") {
    return `<g><rect class="node male" x="${escapeAttr(node.x - half)}" y="${escapeAttr(node.y - half)}" width="${size}" height="${size}" /><text class="label" x="${escapeAttr(node.x)}" y="${escapeAttr(node.y + half + 18)}">${label}</text></g>`;
  }
  return `<g><path class="node" d="M ${escapeAttr(node.x)} ${escapeAttr(node.y - half)} L ${escapeAttr(node.x + half)} ${escapeAttr(node.y)} L ${escapeAttr(node.x)} ${escapeAttr(node.y + half)} L ${escapeAttr(node.x - half)} ${escapeAttr(node.y)} Z" /><text class="label" x="${escapeAttr(node.x)}" y="${escapeAttr(node.y + half + 18)}">${label}</text></g>`;
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

interface NormalScenario {
  id: string;
  title: string;
  input: LayoutInput;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
