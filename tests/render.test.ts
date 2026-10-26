import test from "node:test";
import assert from "node:assert/strict";
import { buildPedigree } from "../src/core/engine";
import { computeLayout } from "../src/layout/computeLayout";
import { NODE_SIZE } from "../src/layout/boxModel";
import {
  applyManualNodePositionsToLayout,
  buildLayoutResult
} from "../src/layout/layoutResultBuilder";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";
import { PedigreeGraph } from "../src/model/pedigreeGraph";
import { Person, Sex } from "../src/model/person";
import { renderLayoutResultToSvg } from "../src/render/svgRenderer";
import { layout } from "../src/browser/entry";
import { complexKnownProblemFamily } from "./fixtures/complexPedigrees";

function person(id: string, sex: Sex, extra: Partial<Person> = {}): [string, Person] {
  return [id, { id, sex, ...extra }];
}

test("buildPedigree renders standard pedigree symbols and relationship lines", () => {
  const { graph } = standardGraph();

  const svg = buildPedigree(graph);

  assert.match(svg, /<svg viewBox="[^"]+"/);
  assert.doesNotMatch(svg, /cx="0" cy="0"/);
  assert.match(svg, /<rect class="pedigree-symbol/);
  assert.match(svg, /<circle class="pedigree-symbol/);
  assert.match(svg, /<polygon class="pedigree-symbol/);
  assert.match(svg, /class="pedigree-line marriage-line"/);
  assert.match(svg, /class="pedigree-line sibling-line"/);
  assert.match(svg, /class="pedigree-line descent-line"/);

  const descentX = Number(readLineAttr(svg, "descent-line", "u1", "x1"));
  const siblingX1 = Number(readLineAttr(svg, "sibling-line", "u1", "x1"));
  const siblingX2 = Number(readLineAttr(svg, "sibling-line", "u1", "x2"));
  assert.ok(descentX >= Math.min(siblingX1, siblingX2));
  assert.ok(descentX <= Math.max(siblingX1, siblingX2));
});

test("renderLayoutResultToSvg renders a computed LayoutResult", () => {
  const { graph, input } = standardGraph();
  const layout = buildLayoutResult(computeLayout(graph), input);
  const svg = renderLayoutResultToSvg(layout);

  assert.match(svg, /data-person="father"/);
  assert.match(svg, /data-person="mother"/);
  assert.match(svg, /data-person="c1"/);
  assert.match(svg, /class="pedigree-line marriage-line"/);
  assert.match(svg, /class="pedigree-line descent-line"/);
  assert.match(svg, /class="pedigree-line individual-line child-line"/);
});

test("renderLayoutResultToSvg does not require a graph", () => {
  const layout: LayoutResult = {
    nodes: [
      { id: "A", sex: "M", x: 0, y: 0, generation: 0 },
      { id: "B", sex: "F", x: 100, y: 0, generation: 0 }
    ],
    positions: [
      { id: "A", x: 0, y: 0, generation: 0 },
      { id: "B", x: 100, y: 0, generation: 0 }
    ],
    relationshipSegments: [
      {
        id: "u0:marriage",
        type: "marriage",
        kind: "marriage",
        unionId: "u0",
        partnerIds: ["A", "B"],
        parentIds: ["A", "B"],
        source: {
          unionId: "u0",
          parentIds: ["A", "B"],
          personIds: ["A", "B"]
        },
        points: [
          { x: NODE_SIZE / 2, y: 0 },
          { x: 100 - NODE_SIZE / 2, y: 0 }
        ]
      }
    ],
    unionAnchors: [
      { unionId: "u0", partnerIds: ["A", "B"], x: 50, y: 0 }
    ],
    bounds: {
      minX: -NODE_SIZE / 2,
      minY: -NODE_SIZE / 2,
      maxX: 100 + NODE_SIZE / 2,
      maxY: NODE_SIZE / 2,
      width: 100 + NODE_SIZE,
      height: NODE_SIZE
    },
    generationLabels: []
  };

  const svg = renderLayoutResultToSvg(layout);

  assert.match(svg, /data-person="A"/);
  assert.match(svg, /data-person="B"/);
  assert.match(svg, /class="pedigree-line marriage-line"/);
  assert.match(svg, /x1="22"/);
  assert.match(svg, /x2="78"/);
});

test("renderLayoutResultToSvg uses finalized manual coordinates", () => {
  const input: LayoutInput = {
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "child", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "u0", partners: ["father", "mother"] }
    ],
    childrenMap: [
      ["u0", ["child"]]
    ]
  };
  const graph: PedigreeGraph = {
    persons: new Map(input.persons.map((candidate) => person(candidate.id, candidate.sex))),
    unions: new Map([
      ["u0", { id: "u0", partners: ["father", "mother"] }]
    ]),
    childrenMap: new Map(input.childrenMap)
  };
  const layout = buildLayoutResult(computeLayout(graph), input);
  const finalLayout = applyManualNodePositionsToLayout({
    layout,
    people: [
      { id: "father" },
      { id: "mother" },
      { id: "child", manual: true, x: 240, y: 320 }
    ],
    unions: input.unions,
    childrenMap: input.childrenMap
  });

  const svg = renderLayoutResultToSvg(finalLayout);

  assert.match(svg, /points="240,298 262,320 240,342 218,320"/);
  assert.match(svg, /class="pedigree-line individual-line child-line"[^>]*x2="240" y2="320"/);
});

test("renderLayoutResultToSvg renders complex known-problem fixture metadata", () => {
  const response = layout(complexKnownProblemFamily.input);
  assert.ok(response.ok);

  const svg = renderLayoutResultToSvg(response.layout);

  assert.match(svg, /data-kind="parent-drop"/);
  assert.match(svg, /data-kind="sibling-line"/);
  assert.match(svg, /data-union-id="uA"/);
  assert.match(svg, /data-union-id="uK1S1"/);
  assert.match(svg, /data-person="G1"/);
});

function readLineAttr(svg: string, className: string, unionId: string, attr: string): string {
  const pattern = new RegExp(`<line class="pedigree-line ${className}"[^>]*data-union="${unionId}"[^>]*\\s${attr}="([^"]+)"`);
  const match = svg.match(pattern);
  assert.ok(match, `missing ${className} ${attr} for ${unionId}`);
  return match[1];
}

function standardGraph(): { graph: PedigreeGraph; input: LayoutInput } {
  const input: LayoutInput = {
    persons: [
      { id: "father", sex: "M", birthOrder: undefined },
      { id: "mother", sex: "F", birthOrder: undefined },
      { id: "c1", sex: "U", birthOrder: 0 },
      { id: "c2", sex: "M", birthOrder: 1 },
      { id: "c3", sex: "F", birthOrder: 2 },
      { id: "spouse", sex: "F", birthOrder: undefined },
      { id: "g1", sex: "M", birthOrder: 0 },
      { id: "g2", sex: "U", birthOrder: 1 }
    ],
    unions: [
      { id: "u0", partners: ["father", "mother"] },
      { id: "u1", partners: ["c2", "spouse"] }
    ],
    childrenMap: [
      ["u0", ["c1", "c2", "c3"]],
      ["u1", ["g1", "g2"]]
    ]
  };
  const graph: PedigreeGraph = {
    persons: new Map([
      person("father", "M"),
      person("mother", "F"),
      person("c1", "U", { birthOrder: 0 }),
      person("c2", "M", { birthOrder: 1, affected: true }),
      person("c3", "F", { birthOrder: 2 }),
      person("spouse", "F", { carrier: true }),
      person("g1", "M", { birthOrder: 0 }),
      person("g2", "U", { birthOrder: 1 })
    ]),
    unions: new Map([
      ["u0", { id: "u0", partners: ["father", "mother"] }],
      ["u1", { id: "u1", partners: ["c2", "spouse"] }]
    ]),
    childrenMap: new Map(input.childrenMap)
  };
  return { graph, input };
}

/* ============================================================
   离婚 / 分居标记
   ============================================================ */
function marriageSegmentOf(result: LayoutResult, unionId: string) {
  const segment = result.relationshipSegments.find((candidate) => candidate.type === "marriage" && candidate.unionId === unionId);
  assert.ok(segment, `missing marriage segment for ${unionId}`);
  return segment;
}

function divorceInput(status: "partner" | "separated" | "divorced", withChildren: boolean): LayoutInput {
  return {
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      ...(withChildren ? [{ id: "c1", sex: "U" as const, birthOrder: 0 }, { id: "c2", sex: "M" as const, birthOrder: 1 }] : [])
    ],
    unions: [{ id: "u0", partners: ["father", "mother"], status }],
    childrenMap: withChildren ? [["u0", ["c1", "c2"]]] : []
  };
}

test("在婚状态不生成斜杠标记", () => {
  const response = layout(divorceInput("partner", true));
  assert.ok(response.ok);
  const segment = marriageSegmentOf(response.layout, "u0");
  assert.equal(segment.status, "partner");
  assert.deepEqual(segment.marks, []);
  assert.doesNotMatch(renderLayoutResultToSvg(response.layout), /marriage-mark/);
});

test("分居生成 1 道斜杠，离婚生成 2 道斜杠，都落在婚配线上", () => {
  for (const [status, count] of [["separated", 1], ["divorced", 2]] as const) {
    const response = layout(divorceInput(status, false));
    assert.ok(response.ok);
    const segment = marriageSegmentOf(response.layout, "u0");
    assert.equal(segment.status, status);
    assert.equal(segment.marks?.length, count);
    const [start, end] = [segment.points[0], segment.points[segment.points.length - 1]];
    for (const mark of segment.marks ?? []) {
      assert.equal(mark.kind, status);
      assert.equal(mark.y, start.y);
      assert.ok(mark.x > Math.min(start.x, end.x) + NODE_SIZE / 2);
      assert.ok(mark.x < Math.max(start.x, end.x) - NODE_SIZE / 2);
    }
    const svg = renderLayoutResultToSvg(response.layout);
    assert.equal((svg.match(/class="pedigree-line marriage-mark marriage-mark-/g) ?? []).length, count);
  }
});

test("有子女时斜杠避开子女下降线，并位于下降线与外侧配偶之间", () => {
  const response = layout(divorceInput("divorced", true));
  assert.ok(response.ok);
  const segment = marriageSegmentOf(response.layout, "u0");
  const descent = response.layout.relationshipSegments.find((candidate) => candidate.type === "descent" && candidate.unionId === "u0");
  assert.ok(descent);
  const dropX = descent.points[0].x;
  const father = response.layout.nodes.find((node) => node.id === "father")!;
  assert.equal(segment.marks?.length, 2);
  for (const mark of segment.marks ?? []) {
    assert.ok(Math.abs(mark.x - dropX) > 6, "斜杠不能压在下降线上");
    assert.ok(mark.x > father.x + NODE_SIZE / 2, "斜杠不能压在配偶符号上");
    assert.ok(mark.x < dropX);
  }
});

test("再婚：斜杠落在只有这一段婚姻的一方那一侧", () => {
  const response = layout({
    persons: [
      { id: "ex", sex: "M", birthOrder: 1 },
      { id: "mother", sex: "F", birthOrder: 2 },
      { id: "husband", sex: "M", birthOrder: 3 },
      { id: "c1", sex: "U", birthOrder: 4 },
      { id: "c2", sex: "U", birthOrder: 5 }
    ],
    unions: [
      { id: "first", partners: ["ex", "mother"], status: "divorced", order: 1 },
      { id: "second", partners: ["husband", "mother"], status: "partner", order: 2 }
    ],
    childrenMap: [["first", ["c1"]], ["second", ["c2"]]]
  });
  assert.ok(response.ok);
  const nodes = new Map(response.layout.nodes.map((node) => [node.id, node]));
  const first = marriageSegmentOf(response.layout, "first");
  const second = marriageSegmentOf(response.layout, "second");
  assert.deepEqual(second.marks, []);
  assert.equal(first.marks?.length, 2);
  const ex = nodes.get("ex")!;
  const mother = nodes.get("mother")!;
  const mid = (ex.x + mother.x) / 2;
  for (const mark of first.marks ?? []) {
    const nearerToEx = Math.abs(mark.x - ex.x) < Math.abs(mark.x - mother.x);
    assert.ok(nearerToEx || Math.abs(mark.x - mid) < 1, "斜杠应靠近前夫一侧");
  }
});
