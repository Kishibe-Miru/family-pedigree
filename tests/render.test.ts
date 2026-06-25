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
  assert.match(svg, /class="pedigree-line individual-line child-line"[^>]*x2="240" y2="298"/);
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
