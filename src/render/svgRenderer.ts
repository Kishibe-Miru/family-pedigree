import { computeLayout } from "../layout/computeLayout";
import { NODE_SIZE } from "../layout/boxModel";
import { buildLayoutResult } from "../layout/layoutResultBuilder";
import { LayoutInput, LayoutNode, LayoutResult, RelationshipSegment } from "../model/layoutResult";
import { PedigreeGraph } from "../model/pedigreeGraph";
import { validateGraph } from "../rules/validation";

const R = NODE_SIZE / 2;
const MARGIN = NODE_SIZE;

// Diagnostic renderer only. Product medical rendering lives in the browser UI.
export function renderLayoutResultToSvg(layout: LayoutResult): string {
  const frame = computeFrame(layout);
  const labels = layout.generationLabels.map(renderGenerationLabel).join("");
  const lines = layout.relationshipSegments.map(renderRelationshipSegment).join("");
  const nodes = layout.nodes.filter(hasCoordinates).map(renderNode).join("");

  return `<svg viewBox="${frame.viewBox}" width="${frame.width}" height="${frame.height}" xmlns="http://www.w3.org/2000/svg">${style()}${labels}${lines}${nodes}</svg>`;
}

export function render(layoutOrGraph: LayoutResult | PedigreeGraph): string {
  if (isLayoutResult(layoutOrGraph)) return renderLayoutResultToSvg(layoutOrGraph);
  return renderGraphToSvg(layoutOrGraph);
}

export function renderGraphToSvg(graph: PedigreeGraph): string {
  const validGraph = validateGraph(graph);
  const laidOutGraph = computeLayout(validGraph);
  return renderLayoutResultToSvg(buildLayoutResult(laidOutGraph, layoutInputFromGraph(laidOutGraph)));
}

function layoutInputFromGraph(graph: PedigreeGraph): LayoutInput {
  return {
    persons: [...graph.persons.values()].map((person) => ({
      id: person.id,
      sex: person.sex,
      birthOrder: person.birthOrder
    })),
    unions: [...graph.unions.values()].map((union) => ({
      id: union.id,
      partners: [...union.partners]
    })),
    childrenMap: [...graph.childrenMap.entries()].map(([unionId, childIds]) => [unionId, [...childIds]])
  };
}

function renderRelationshipSegment(segment: RelationshipSegment): string {
  const points = segment.points || [];
  if (points.length < 2) return "";
  const primary = renderSegmentPoints(segment, points);
  if (!segment.doubleLine) return primary;
  return `${primary}${renderSegmentPoints(segment, points.map((point) => ({ x: point.x, y: point.y + 3 })))}`;
}

function renderSegmentPoints(segment: RelationshipSegment, points: Array<{ x: number; y: number }>): string {
  const attrs = [
    `class="${segmentClass(segment)}"`,
    `data-kind="${escapeAttr(segment.kind || segment.type || "unknown")}"`,
    `data-union="${escapeAttr(segment.unionId || "")}"`,
    `data-union-id="${escapeAttr(segment.unionId || "")}"`,
    `data-person="${escapeAttr(segment.personId || "")}"`,
    `data-person-id="${escapeAttr(segment.personId || "")}"`
  ].join(" ");
  if (points.length === 2) {
    return `<line ${attrs} x1="${fmt(points[0].x)}" y1="${fmt(points[0].y)}" x2="${fmt(points[1].x)}" y2="${fmt(points[1].y)}"/>`;
  }
  return `<polyline ${attrs} points="${points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" ")}"/>`;
}

function segmentClass(segment: RelationshipSegment): string {
  const semanticClass = (() => {
    if (segment.type === "marriage") return "marriage-line";
    if (segment.type === "descent") return "descent-line";
    if (segment.type === "sibling") return "sibling-line";
    if (segment.type === "individual") return "individual-line child-line";
    if (segment.type === "twin-bar") return "twin-bar";
    return "pedigree-relationship-line";
  })();
  return `pedigree-line ${semanticClass}`;
}

function renderNode(node: LayoutNodeWithCoordinates): string {
  const classes = `pedigree-symbol${node.affected ? " affected" : ""}`;
  const attrs = `class="${classes}" data-person="${escapeAttr(node.id)}"`;
  let symbol = "";

  if (node.sex === "M") {
    symbol = `<rect ${attrs} x="${fmt(node.x - R)}" y="${fmt(node.y - R)}" width="${NODE_SIZE}" height="${NODE_SIZE}"/>`;
  } else if (node.sex === "F") {
    symbol = `<circle ${attrs} cx="${fmt(node.x)}" cy="${fmt(node.y)}" r="${R}"/>`;
  } else {
    const points = [
      [node.x, node.y - R],
      [node.x + R, node.y],
      [node.x, node.y + R],
      [node.x - R, node.y]
    ].map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(" ");
    symbol = `<polygon ${attrs} points="${points}"/>`;
  }

  if (!node.carrier) return symbol;
  return `${symbol}<circle class="carrier-dot" data-person="${escapeAttr(node.id)}" cx="${fmt(node.x)}" cy="${fmt(node.y)}" r="${fmt(R * 0.18)}"/>`;
}

function renderGenerationLabel(label: LayoutResult["generationLabels"][number]): string {
  return `<text class="generation-label" data-generation="${label.generation}" x="${fmt(label.x)}" y="${fmt(label.y)}">${escapeText(label.label)}</text>`;
}

function computeFrame(layout: LayoutResult): { viewBox: string; width: string; height: string } {
  const bounds = layout.bounds;
  if (!layout.nodes.length || !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) {
    return {
      viewBox: `${-MARGIN} ${-MARGIN} ${MARGIN * 2} ${MARGIN * 2}`,
      width: String(MARGIN * 2),
      height: String(MARGIN * 2)
    };
  }

  const minX = bounds.minX - MARGIN;
  const minY = bounds.minY - MARGIN;
  const width = bounds.width + MARGIN * 2;
  const height = bounds.height + MARGIN * 2;
  return {
    viewBox: `${fmt(minX)} ${fmt(minY)} ${fmt(width)} ${fmt(height)}`,
    width: fmt(width),
    height: fmt(height)
  };
}

function style(): string {
  return `<style>
.pedigree-line{fill:none;stroke:#111;stroke-width:2;stroke-linecap:square;stroke-linejoin:miter}
.pedigree-symbol{fill:#fff;stroke:#111;stroke-width:2}
.pedigree-symbol.affected{fill:#111}
.carrier-dot{fill:#111;stroke:none}
.generation-label{font:700 14px sans-serif;fill:#777;text-anchor:middle;dominant-baseline:middle}
</style>`;
}

type LayoutNodeWithCoordinates = LayoutNode & { x: number; y: number };

function hasCoordinates(node: LayoutNode): node is LayoutNodeWithCoordinates {
  return Number.isFinite(node.x) && Number.isFinite(node.y);
}

function isLayoutResult(value: LayoutResult | PedigreeGraph): value is LayoutResult {
  return Array.isArray((value as LayoutResult).nodes) &&
    Array.isArray((value as LayoutResult).relationshipSegments);
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
