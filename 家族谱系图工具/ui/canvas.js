"use strict";

/* global window */

(function () {
window.PedigreeUI = window.PedigreeUI || {};

const SVG_NS_UI = "http://www.w3.org/2000/svg";
const NODE_SIZE_UI = 44;
const R_UI = NODE_SIZE_UI / 2;
const LABEL_OFFSET_UI = R_UI + 14;

function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS_UI, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderSvg(ctx) {
  const { state, els } = ctx;
  const svg = els.pedigreeSvg;
  svg.innerHTML = "";
  const rect = els.canvasWrap.getBoundingClientRect();
  const width = Math.max(rect.width, 600);
  const height = Math.max(rect.height, 400);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.appendChild(ctx.buildDefs());

  const root = svgEl("g", { transform: `translate(${state.offsetX},${state.offsetY}) scale(${state.scale})` });
  svg.appendChild(root);

  if (state.project.people.length === 0) {
    root.appendChild(svgEl("text", { x: width / 2, y: height / 2, class: "empty-canvas-text" }, "点击左侧「添加先证者」开始绘制"));
    return;
  }

  drawGenerationLabels(root, ctx);
  drawRelationships(root, ctx);
  renderPeople(ctx).forEach((person) => drawPerson(root, ctx, person, { selected: state.selectedId === person.id }));
  if (state.project.settings.showTitle) drawTitle(root, ctx);
  if (state.project.settings.showLegend) drawLegend(root, ctx);
}

function drawGenerationLabels(root, ctx) {
  const labels = ctx.state.layoutResult?.generationLabels || fallbackGenerationLabels(ctx);
  labels.forEach((label) => {
    root.appendChild(svgEl("text", { x: label.x, y: label.y, class: "generation-label" }, label.label));
  });
}

function drawRelationships(root, ctx) {
  const segments = ctx.state.layoutResult?.relationshipSegments || [];
  segments.forEach((segment) => {
    drawSegment(root, segment, segmentClass(segment));
    if (segment.doubleLine) {
      drawSegment(root, offsetSegment(segment, 3), segmentClass(segment));
    }
  });
}

function drawSegment(root, segment, className) {
  const points = segment.points || [];
  if (points.length < 2) return;
  if (points.length === 2) {
    root.appendChild(svgEl("line", {
      x1: points[0].x,
      y1: points[0].y,
      x2: points[1].x,
      y2: points[1].y,
      class: className,
      "data-union": segment.unionId || "",
      "data-person": segment.personId || ""
    }));
    return;
  }
  root.appendChild(svgEl("polyline", {
    points: points.map((point) => `${point.x},${point.y}`).join(" "),
    class: className,
    "data-union": segment.unionId || "",
    "data-person": segment.personId || ""
  }));
}

function segmentClass(segment) {
  if (segment.type === "marriage") return "marriage-line";
  if (segment.type === "descent") return "descent-line";
  if (segment.type === "sibling") return "sibling-line";
  if (segment.type === "twin-bar") return "twin-bar";
  return "individual-line";
}

function offsetSegment(segment, dy) {
  return {
    ...segment,
    points: segment.points.map((point) => ({ x: point.x, y: point.y + dy }))
  };
}

function drawPerson(root, ctx, person, options = {}) {
  const group = svgEl("g", { class: "node-hit", "data-id": person.id });
  const settings = ctx.state.project.settings;

  if (person.proband) {
    const ax = person.x - R_UI - 26;
    const ay = person.y + R_UI + 26;
    group.appendChild(svgEl("line", {
      x1: ax,
      y1: ay,
      x2: person.x - R_UI * 0.78,
      y2: person.y + R_UI * 0.78,
      class: "proband-arrow",
      "marker-end": "url(#arrow)"
    }));
    group.appendChild(svgEl("text", { x: ax - 4, y: ay + 12, class: "proband-label" }, "P"));
  }

  if (options.selected) {
    group.appendChild(svgEl("rect", {
      x: person.x - R_UI - 8,
      y: person.y - R_UI - 8,
      width: NODE_SIZE_UI + 16,
      height: NODE_SIZE_UI + 16,
      rx: 8,
      class: "selected-ring"
    }));
  }

  const cls = `person-symbol ${person.affectedStatus || "unaffected"}`;
  if (person.sex === "female") {
    group.appendChild(svgEl("circle", { cx: person.x, cy: person.y, r: R_UI, class: cls }));
  } else if (person.sex === "male") {
    group.appendChild(svgEl("rect", { x: person.x - R_UI, y: person.y - R_UI, width: NODE_SIZE_UI, height: NODE_SIZE_UI, class: cls }));
  } else {
    group.appendChild(svgEl("polygon", {
      points: `${person.x},${person.y - R_UI} ${person.x + R_UI},${person.y} ${person.x},${person.y + R_UI} ${person.x - R_UI},${person.y}`,
      class: cls
    }));
  }

  if (person.deceased) {
    group.appendChild(svgEl("line", {
      x1: person.x - R_UI * 1.25,
      y1: person.y + R_UI * 1.25,
      x2: person.x + R_UI * 1.25,
      y2: person.y - R_UI * 1.25,
      class: "deceased-line"
    }));
  }

  if (settings.showNumber) {
    group.appendChild(svgEl("text", { x: person.x - R_UI - 5, y: person.y - R_UI + 2, class: "id-label" }, ctx.state.numberMap.get(person.id) || ""));
  }

  let ty = person.y + LABEL_OFFSET_UI;
  if (settings.showName && person.name) {
    group.appendChild(svgEl("text", { x: person.x, y: ty, class: "person-label" }, person.name));
    ty += 15;
  }
  if (settings.showAge) {
    const meta = [person.age && `${person.age}岁`, person.birthYear && `b.${person.birthYear}`].filter(Boolean).join(" ");
    if (meta) {
      group.appendChild(svgEl("text", { x: person.x, y: ty, class: "meta-label" }, meta));
      ty += 14;
    }
  }
  if (settings.showDiagnosis && person.diagnoses.length) {
    person.diagnoses.slice(0, 3).forEach((diagnosis) => {
      group.appendChild(svgEl("text", { x: person.x, y: ty, class: "diagnosis-label" }, diagnosis));
      ty += 14;
    });
  }

  root.appendChild(group);
}

function contentBounds(ctx) {
  const people = renderPeople(ctx);
  if (people.length === 0) return { minX: 0, minY: 0, maxX: 600, maxY: 400, width: 600, height: 400 };

  const minXs = [];
  const maxXs = [];
  const minYs = [];
  const maxYs = [];
  people.forEach((person) => {
    const labelWidth = estimatePersonTextWidth(ctx, person);
    minXs.push(person.x - Math.max(R_UI, labelWidth / 2));
    maxXs.push(person.x + Math.max(R_UI, labelWidth / 2));
    minYs.push(person.y - R_UI - 34);
    maxYs.push(person.y + R_UI + estimatePersonTextHeight(ctx, person));
  });

  const minX = Math.min(...minXs);
  const minY = Math.min(...minYs);
  const maxX = Math.max(...maxXs);
  const maxY = Math.max(...maxYs);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function decoratedBounds(ctx) {
  const body = contentBounds(ctx);
  const settings = ctx.state.project.settings;
  const minXs = [body.minX];
  const maxXs = [body.maxX];
  const minYs = [body.minY];
  const maxYs = [body.maxY];

  if (settings.showTitle) {
    const titleWidth = textWidth(ctx.state.project.title || "家族谱系图", 20, 1.1);
    const centerX = (body.minX + body.maxX) / 2;
    minXs.push(centerX - titleWidth / 2);
    maxXs.push(centerX + titleWidth / 2);
    minYs.push(body.minY - 70);
  }
  if (settings.showLegend) {
    minXs.push(body.maxX + 56);
    maxXs.push(body.maxX + 56 + 188);
    maxYs.push(body.minY + 336);
  }

  const minX = Math.min(...minXs);
  const minY = Math.min(...minYs);
  const maxX = Math.max(...maxXs);
  const maxY = Math.max(...maxYs);
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function drawTitle(root, ctx) {
  const bounds = contentBounds(ctx);
  root.appendChild(svgEl("text", { x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY - 56, class: "title-text" }, ctx.state.project.title || "家族谱系图"));
}

function drawLegend(root, ctx) {
  const bounds = contentBounds(ctx);
  const x = bounds.maxX + 56;
  const y = bounds.minY;
  const rowH = 30;
  const items = [
    { kind: "rect", fill: "#fff", text: "男性 · 未患病" },
    { kind: "circle", fill: "#fff", text: "女性 · 未患病" },
    { kind: "diamond", fill: "#e2e8ec", text: "性别未知" },
    { kind: "rect", fill: "#2f3a42", text: "患病" },
    { kind: "rect", fill: "url(#suspectedPattern)", text: "疑似" },
    { kind: "carrier", text: "携带者（纹理）" },
    { kind: "deceased", text: "已故（／）" },
    { kind: "proband", text: "先证者（箭头 P）" },
    { kind: "twin", text: "双胞胎（同卵带横杆）" },
    { kind: "consang", text: "近亲婚配（双线）" }
  ];
  const boxW = 188;
  const boxH = items.length * rowH + 36;
  const group = svgEl("g", { class: "legend-overlay" });
  group.appendChild(svgEl("rect", { x, y, width: boxW, height: boxH, rx: 8, class: "legend-box" }));
  group.appendChild(svgEl("text", { x: x + 14, y: y + 24, class: "legend-title" }, "图例"));
  items.forEach((item, index) => drawLegendItem(group, item, x, y + 48 + index * rowH));
  root.appendChild(group);
}

function drawLegendItem(group, item, x, cy) {
  const sx = x + 24;
  const r = 9;
  if (item.kind === "rect") group.appendChild(svgEl("rect", { x: sx - r, y: cy - r, width: r * 2, height: r * 2, fill: item.fill, stroke: "#2f3a42", "stroke-width": 2 }));
  else if (item.kind === "circle") group.appendChild(svgEl("circle", { cx: sx, cy, r, fill: item.fill, stroke: "#2f3a42", "stroke-width": 2 }));
  else if (item.kind === "diamond") group.appendChild(svgEl("polygon", { points: `${sx},${cy - r} ${sx + r},${cy} ${sx},${cy + r} ${sx - r},${cy}`, fill: item.fill, stroke: "#2f3a42", "stroke-width": 2 }));
  else if (item.kind === "carrier") group.appendChild(svgEl("circle", { cx: sx, cy, r, fill: "url(#carrierPattern)", stroke: "#2f3a42", "stroke-width": 2 }));
  else if (item.kind === "deceased") {
    group.appendChild(svgEl("rect", { x: sx - r, y: cy - r, width: r * 2, height: r * 2, fill: "#fff", stroke: "#2f3a42", "stroke-width": 2 }));
    group.appendChild(svgEl("line", { x1: sx - r - 3, y1: cy + r + 3, x2: sx + r + 3, y2: cy - r - 3, stroke: "#2f3a42", "stroke-width": 2 }));
  } else if (item.kind === "proband") {
    group.appendChild(svgEl("rect", { x: sx - r, y: cy - r, width: r * 2, height: r * 2, fill: "#fff", stroke: "#2f3a42", "stroke-width": 2 }));
    group.appendChild(svgEl("line", { x1: sx - r - 12, y1: cy + r + 8, x2: sx - r + 1, y2: cy + r - 1, stroke: "#2f3a42", "stroke-width": 2, "marker-end": "url(#arrow)" }));
  } else if (item.kind === "twin") {
    group.appendChild(svgEl("line", { x1: sx, y1: cy - r, x2: sx - r, y2: cy + r, stroke: "#2f3a42", "stroke-width": 2 }));
    group.appendChild(svgEl("line", { x1: sx, y1: cy - r, x2: sx + r, y2: cy + r, stroke: "#2f3a42", "stroke-width": 2 }));
    group.appendChild(svgEl("line", { x1: sx - r * 0.5, y1: cy, x2: sx + r * 0.5, y2: cy, stroke: "#2f3a42", "stroke-width": 2 }));
  } else if (item.kind === "consang") {
    group.appendChild(svgEl("line", { x1: sx - r, y1: cy - 2, x2: sx + r, y2: cy - 2, stroke: "#2f3a42", "stroke-width": 2 }));
    group.appendChild(svgEl("line", { x1: sx - r, y1: cy + 2, x2: sx + r, y2: cy + 2, stroke: "#2f3a42", "stroke-width": 2 }));
  }
  group.appendChild(svgEl("text", { x: x + 44, y: cy, class: "legend-text" }, item.text));
}

function buildExportSvg(ctx) {
  const bounds = decoratedBounds(ctx);
  const pad = 70;
  const vbX = bounds.minX - pad;
  const vbY = bounds.minY - pad;
  const width = bounds.width + pad * 2;
  const height = bounds.height + pad * 2;
  const svg = svgEl("svg", {
    xmlns: SVG_NS_UI,
    width,
    height,
    viewBox: `${vbX} ${vbY} ${width} ${height}`
  });
  svg.appendChild(svgEl("rect", { x: vbX, y: vbY, width, height, fill: "#ffffff" }));
  svg.appendChild(ctx.buildDefs());
  const style = svgEl("style");
  style.textContent = ctx.exportStyles();
  svg.appendChild(style);
  const root = svgEl("g");
  svg.appendChild(root);
  drawGenerationLabels(root, ctx);
  drawRelationships(root, ctx);
  renderPeople(ctx).forEach((person) => drawPerson(root, ctx, person, { selected: false }));
  if (ctx.state.project.settings.showTitle) drawTitle(root, ctx);
  if (ctx.state.project.settings.showLegend) drawLegend(root, ctx);
  return { svg, W: width, H: height };
}

function fallbackGenerationLabels(ctx) {
  const rows = new Map();
  renderPeople(ctx).forEach((person) => {
    const generation = ctx.state.genMap.get(person.id) ?? 0;
    if (!rows.has(generation)) rows.set(generation, []);
    rows.get(generation).push(person);
  });
  const bounds = contentBounds(ctx);
  return [...rows.keys()].sort((a, b) => a - b).map((generation, index) => ({
    generation,
    label: ctx.roman(index + 1),
    x: bounds.minX - 48,
    y: average(rows.get(generation).map((person) => person.y))
  }));
}

function renderPeople(ctx) {
  const nodes = new Map((ctx.state.layoutResult?.nodes || []).map((node) => [node.id, node]));
  return ctx.state.project.people.map((person) => {
    const node = nodes.get(person.id);
    return {
      ...person,
      x: Number.isFinite(node?.x) ? node.x : Number.isFinite(person.x) ? person.x : 0,
      y: Number.isFinite(node?.y) ? node.y : Number.isFinite(person.y) ? person.y : 0,
      generation: node?.generation ?? ctx.state.genMap.get(person.id) ?? 0,
      diagnoses: Array.isArray(person.diagnoses) ? person.diagnoses : []
    };
  });
}

function estimatePersonTextWidth(ctx, person) {
  const widths = [];
  const settings = ctx.state.project.settings;
  if (settings.showName && person.name) widths.push(textWidth(person.name, 13));
  if (settings.showDiagnosis && person.diagnoses && person.diagnoses.length) widths.push(textWidth(person.diagnoses.slice(0, 3).join("、"), 11));
  if (settings.showAge) {
    const meta = [person.age ? `${person.age}岁` : "", person.birthYear ? `${person.birthYear}年` : ""].filter(Boolean).join(" / ");
    if (meta) widths.push(textWidth(meta, 11));
  }
  return Math.max(NODE_SIZE_UI, ...widths);
}

function estimatePersonTextHeight(ctx, person) {
  const settings = ctx.state.project.settings;
  let height = 16;
  if (settings.showName && person.name) height += 18;
  if (settings.showDiagnosis && person.diagnoses && person.diagnoses.length) height += 16;
  if (settings.showAge && (person.age || person.birthYear)) height += 14;
  return height;
}

function textWidth(text, fontSize, factor = 0.62) {
  return String(text || "").length * fontSize * factor;
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
}

function canvasBoundary(name) {
  return name;
}

window.PedigreeUI.canvasBoundary = canvasBoundary;
window.PedigreeUI.renderSvg = renderSvg;
window.PedigreeUI.contentBounds = contentBounds;
window.PedigreeUI.decoratedBounds = decoratedBounds;
window.PedigreeUI.buildExportSvg = buildExportSvg;
})();
