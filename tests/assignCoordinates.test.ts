import test from "node:test";
import assert from "node:assert/strict";
import { assignLayers } from "../src/layout/layerAssigner";
import { reduceCrossings } from "../src/layout/crossingReducer";
import { assignCoordinates } from "../src/layout/coordinateSolver";
import { DUAL_ORIGIN_MARRIAGE_GAP, NODE_SIZE, PERSON_GAP } from "../src/layout/boxModel";
import { render } from "../src/render/svgRenderer";
import { PedigreeGraph } from "../src/model/pedigreeGraph";
import { Person } from "../src/model/person";

function person(id: string): [string, Person] {
  return [id, { id, sex: "U" }];
}

test("assignCoordinates lays out parents with three children and married second child", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      person("father"),
      person("mother"),
      person("c1"),
      person("c2"),
      person("c3"),
      person("spouse"),
      person("g1"),
      person("g2")
    ]),
    unions: new Map([
      ["u0", { id: "u0", partners: ["father", "mother"] }],
      ["u1", { id: "u1", partners: ["c2", "spouse"] }]
    ]),
    childrenMap: new Map([
      ["u0", ["c1", "c2", "c3"]],
      ["u1", ["g1", "g2"]]
    ])
  };

  assignLayers(graph);
  graph.persons.get("c1")!.birthOrder = 0;
  graph.persons.get("c2")!.birthOrder = 1;
  graph.persons.get("c3")!.birthOrder = 2;
  graph.persons.get("g1")!.birthOrder = 0;
  graph.persons.get("g2")!.birthOrder = 1;

  assignCoordinates(graph);

  const c1 = graph.persons.get("c1")!;
  const c2 = graph.persons.get("c2")!;
  const c3 = graph.persons.get("c3")!;
  const father = graph.persons.get("father")!;
  const mother = graph.persons.get("mother")!;
  const g1 = graph.persons.get("g1")!;
  const g2 = graph.persons.get("g2")!;

  assert.ok(c1.x! < c2.x!);
  assert.ok(c2.x! < c3.x!);
  assert.ok(g1.x! < g2.x!);
  assert.equal(father.y, mother.y);
  assert.ok((g1.y ?? 0) > (c2.y ?? 0));

  const svg = render(graph);
  assert.match(svg, /<svg /);
  assert.match(svg, /viewBox="/);
  assert.doesNotMatch(svg, /cx="0" cy="0"/);
});

test("parent drop anchor follows biological married child, not in-law partner", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      person("father"),
      person("mother"),
      person("child"),
      person("inlaw"),
      person("grandchild")
    ]),
    unions: new Map([
      ["parents", { id: "parents", partners: ["father", "mother"] }],
      ["marriage", { id: "marriage", partners: ["inlaw", "child"] }]
    ]),
    childrenMap: new Map([
      ["parents", ["child"]],
      ["marriage", ["grandchild"]]
    ])
  };

  assignLayers(graph);
  assignCoordinates(graph);

  const father = graph.persons.get("father")!;
  const mother = graph.persons.get("mother")!;
  const child = graph.persons.get("child")!;
  const inlaw = graph.persons.get("inlaw")!;
  const parentDropX = ((father.x ?? 0) + (mother.x ?? 0)) / 2;

  assert.ok(Math.abs(parentDropX - (child.x ?? 0)) < 0.5);
  assert.ok(Math.abs(parentDropX - (inlaw.x ?? 0)) > 0.5);
});

test("spouse origin family follows marriage anchor without drifting", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      person("I1"),
      person("I2"),
      person("II1"),
      person("II2"),
      person("II4"),
      person("I3"),
      person("I4"),
      person("II3")
    ]),
    unions: new Map([
      ["leftParents", { id: "leftParents", partners: ["I1", "I2"] }],
      ["rightParents", { id: "rightParents", partners: ["I3", "I4"] }],
      ["marriage", { id: "marriage", partners: ["II2", "II3"] }]
    ]),
    childrenMap: new Map([
      ["leftParents", ["II1", "II2", "II4"]],
      ["rightParents", ["II3"]],
      ["marriage", []]
    ])
  };

  assignLayers(graph);
  graph.persons.get("II1")!.birthOrder = 0;
  graph.persons.get("II2")!.birthOrder = 1;
  graph.persons.get("II4")!.birthOrder = 2;

  assert.doesNotThrow(() => assignCoordinates(graph));

  const i3 = graph.persons.get("I3")!;
  const i4 = graph.persons.get("I4")!;
  const ii2 = graph.persons.get("II2")!;
  const ii3 = graph.persons.get("II3")!;
  const ii4 = graph.persons.get("II4")!;
  const originDropX = ((i3.x ?? 0) + (i4.x ?? 0)) / 2;

  assert.equal(ii2.y, ii3.y);
  assert.ok(Math.abs((ii2.x ?? 0) - (ii3.x ?? 0)) >= DUAL_ORIGIN_MARRIAGE_GAP - 0.5);
  assert.ok(Math.abs((ii3.x ?? 0) - (ii4.x ?? 0)) >= PERSON_GAP - 0.5);
  assert.ok(Math.abs(originDropX - (ii3.x ?? 0)) < 0.5);
});

test("single-parent family assigns child below the parent", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      person("parent"),
      person("child")
    ]),
    unions: new Map([
      ["single", { id: "single", partners: ["parent"] }]
    ]),
    childrenMap: new Map([
      ["single", ["child"]]
    ])
  };

  assignLayers(graph);
  assignCoordinates(graph);

  assert.ok((graph.persons.get("child")!.y ?? 0) > (graph.persons.get("parent")!.y ?? 0));
  assert.ok(Math.abs((graph.persons.get("child")!.x ?? 0) - (graph.persons.get("parent")!.x ?? 0)) < 0.5);
});

test("multiple spouses and half siblings keep each child under its own union", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      person("P"),
      person("S1"),
      person("S2"),
      person("C1"),
      person("C2")
    ]),
    unions: new Map([
      ["u1", { id: "u1", partners: ["P", "S1"] }],
      ["u2", { id: "u2", partners: ["P", "S2"] }]
    ]),
    childrenMap: new Map([
      ["u1", ["C1"]],
      ["u2", ["C2"]]
    ])
  };

  assignLayers(graph);
  assignCoordinates(graph);

  assert.equal(graph.persons.get("P")!.y, graph.persons.get("S1")!.y);
  assert.equal(graph.persons.get("P")!.y, graph.persons.get("S2")!.y);
  assert.ok((graph.persons.get("C1")!.y ?? 0) > (graph.persons.get("P")!.y ?? 0));
  assert.ok((graph.persons.get("C2")!.y ?? 0) > (graph.persons.get("P")!.y ?? 0));
});

test("three generations with married grandchild keep spouse aligned", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      person("G1"),
      person("G2"),
      person("P1"),
      person("P2"),
      person("C1"),
      person("SP")
    ]),
    unions: new Map([
      ["grandparents", { id: "grandparents", partners: ["G1", "G2"] }],
      ["parents", { id: "parents", partners: ["P1", "P2"] }],
      ["childMarriage", { id: "childMarriage", partners: ["C1", "SP"] }]
    ]),
    childrenMap: new Map([
      ["grandparents", ["P1"]],
      ["parents", ["C1"]],
      ["childMarriage", []]
    ])
  };

  assignLayers(graph);
  assignCoordinates(graph);

  assert.equal(graph.persons.get("C1")!.y, graph.persons.get("SP")!.y);
  assert.ok((graph.persons.get("C1")!.y ?? 0) > (graph.persons.get("P1")!.y ?? 0));
  assert.ok((graph.persons.get("P1")!.y ?? 0) > (graph.persons.get("G1")!.y ?? 0));
});

test("multiple independent roots are separated on the same generation", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      person("A1"),
      person("A2"),
      person("AC"),
      person("B1"),
      person("B2"),
      person("BC")
    ]),
    unions: new Map([
      ["a", { id: "a", partners: ["A1", "A2"] }],
      ["b", { id: "b", partners: ["B1", "B2"] }]
    ]),
    childrenMap: new Map([
      ["a", ["AC"]],
      ["b", ["BC"]]
    ])
  };

  assignLayers(graph);
  assignCoordinates(graph);

  const aMid = ((graph.persons.get("A1")!.x ?? 0) + (graph.persons.get("A2")!.x ?? 0)) / 2;
  const bMid = ((graph.persons.get("B1")!.x ?? 0) + (graph.persons.get("B2")!.x ?? 0)) / 2;
  assert.ok(Math.abs(aMid - bMid) > 100);
  assert.equal(graph.persons.get("AC")!.y, graph.persons.get("BC")!.y);
});

test("wide spouse origin family expands horizontally without generation downshift", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      person("I1"),
      person("I2"),
      person("II1"),
      person("II2"),
      person("II4"),
      person("II5"),
      person("II6"),
      person("I3"),
      person("I4"),
      person("R1"),
      person("R2"),
      person("II3"),
      person("R4"),
      person("R5")
    ]),
    unions: new Map([
      ["coreParents", { id: "coreParents", partners: ["I1", "I2"] }],
      ["originParents", { id: "originParents", partners: ["I3", "I4"] }],
      ["marriage", { id: "marriage", partners: ["II2", "II3"] }]
    ]),
    childrenMap: new Map([
      ["coreParents", ["II1", "II2", "II4", "II5", "II6"]],
      ["originParents", ["R1", "R2", "II3", "R4", "R5"]],
      ["marriage", []]
    ])
  };

  assignLayers(graph);
  for (const [index, id] of ["II1", "II2", "II4", "II5", "II6"].entries()) {
    graph.persons.get(id)!.birthOrder = index;
  }
  for (const [index, id] of ["R1", "R2", "II3", "R4", "R5"].entries()) {
    graph.persons.get(id)!.birthOrder = index;
  }

  assert.doesNotThrow(() => assignCoordinates(graph));

  const i3 = graph.persons.get("I3")!;
  const i4 = graph.persons.get("I4")!;
  const ii1 = graph.persons.get("II1")!;
  const ii2 = graph.persons.get("II2")!;
  const ii3 = graph.persons.get("II3")!;
  const ii4 = graph.persons.get("II4")!;
  const sourceChildren = ["R1", "R2", "II3", "R4", "R5"].map((id) => graph.persons.get(id)!);
  const originDropX = ((i3.x ?? 0) + (i4.x ?? 0)) / 2;
  const originSiblingCenter = ((sourceChildren[0].x ?? 0) + (sourceChildren[sourceChildren.length - 1].x ?? 0)) / 2;
  const sourceLeft = Math.min(...sourceChildren.map((child) => child.x ?? 0));
  const sourceRight = Math.max(...sourceChildren.map((child) => child.x ?? 0));

  assert.ok(Math.abs(originDropX - originSiblingCenter) < 0.5);
  assert.equal(ii2.y, ii3.y);
  assert.equal(ii2.y, ii1.y);
  assert.equal(ii2.y, ii4.y);
  assert.equal(i3.y, graph.persons.get("I1")!.y);
  assert.equal(i4.y, graph.persons.get("I2")!.y);
  assert.ok(originDropX >= sourceLeft);
  assert.ok(originDropX <= sourceRight);
  for (const child of sourceChildren) {
    assert.equal(child.y, ii3.y);
  }
  assertNoSameGenerationSymbolOverlap(graph);
});

test("unmarried sibling leaves do not overlap spouse origin family symbols", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      ["I1", { id: "I1", sex: "M" }],
      ["I2", { id: "I2", sex: "F" }],
      ["II1", { id: "II1", sex: "M" }],
      ["II2", { id: "II2", sex: "M" }],
      ["II4", { id: "II4", sex: "F" }],
      ["I3", { id: "I3", sex: "M" }],
      ["I4", { id: "I4", sex: "F" }],
      ["II3", { id: "II3", sex: "F" }],
      ["II5", { id: "II5", sex: "M" }],
      ["II6", { id: "II6", sex: "F" }]
    ]),
    unions: new Map([
      ["L", { id: "L", partners: ["I1", "I2"] }],
      ["R", { id: "R", partners: ["I3", "I4"] }],
      ["M", { id: "M", partners: ["II2", "II3"] }]
    ]),
    childrenMap: new Map([
      ["L", ["II1", "II2", "II4"]],
      ["R", ["II3", "II5", "II6"]],
      ["M", []]
    ])
  };

  assignLayers(graph);
  graph.persons.get("II1")!.birthOrder = 0;
  graph.persons.get("II2")!.birthOrder = 1;
  graph.persons.get("II4")!.birthOrder = 2;
  graph.persons.get("II3")!.birthOrder = 0;
  graph.persons.get("II5")!.birthOrder = 1;
  graph.persons.get("II6")!.birthOrder = 2;

  assert.doesNotThrow(() => assignCoordinates(graph));
  const i1 = graph.persons.get("I1")!;
  const i2 = graph.persons.get("I2")!;
  const i3 = graph.persons.get("I3")!;
  const i4 = graph.persons.get("I4")!;
  const ii1 = graph.persons.get("II1")!;
  const ii2 = graph.persons.get("II2")!;
  const ii3 = graph.persons.get("II3")!;
  const ii4 = graph.persons.get("II4")!;
  const ii5 = graph.persons.get("II5")!;
  const ii6 = graph.persons.get("II6")!;
  const originDropX = ((i3.x ?? 0) + (i4.x ?? 0)) / 2;
  const originSiblingCenter = ((ii3.x ?? 0) + (ii6.x ?? 0)) / 2;

  assert.equal(i1.y, i2.y);
  assert.equal(i1.y, i3.y);
  assert.equal(i1.y, i4.y);
  assert.equal(ii1.y, ii2.y);
  assert.equal(ii1.y, ii3.y);
  assert.equal(ii1.y, ii4.y);
  assert.equal(ii1.y, ii5.y);
  assert.equal(ii1.y, ii6.y);
  assert.ok(Math.abs(originDropX - originSiblingCenter) < 0.5);
  assert.ok(Math.abs((ii2.x ?? 0) - (ii3.x ?? 0)) >= DUAL_ORIGIN_MARRIAGE_GAP - 0.5);
  assertNoSameGenerationSymbolOverlap(graph);
});

test("single spouse origin family stays compact after horizontal relaxation", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      ["A1", { id: "A1", sex: "M" }],
      ["A2", { id: "A2", sex: "F" }],
      ["B1", { id: "B1", sex: "M" }],
      ["B2", { id: "B2", sex: "F" }],
      ["k1", { id: "k1", sex: "M" }],
      ["k2", { id: "k2", sex: "F" }],
      ["s", { id: "s", sex: "M" }]
    ]),
    unions: new Map([
      ["uA", { id: "uA", partners: ["A1", "A2"] }],
      ["uB", { id: "uB", partners: ["B1", "B2"] }],
      ["uM", { id: "uM", partners: ["k2", "s"] }]
    ]),
    childrenMap: new Map([
      ["uA", ["k1", "k2"]],
      ["uB", ["s"]],
      ["uM", []]
    ])
  };

  assignLayers(graph);
  graph.persons.get("k1")!.birthOrder = 0;
  graph.persons.get("k2")!.birthOrder = 1;

  assert.doesNotThrow(() => assignCoordinates(graph));

  const people = [...graph.persons.values()];
  const minX = Math.min(...people.map((p) => p.x ?? 0));
  const maxX = Math.max(...people.map((p) => p.x ?? 0));
  const b1 = graph.persons.get("B1")!;
  const b2 = graph.persons.get("B2")!;
  const k1 = graph.persons.get("k1")!;
  const k2 = graph.persons.get("k2")!;
  const s = graph.persons.get("s")!;

  assert.ok(Math.abs((k1.x ?? 0) - (k2.x ?? 0)) < 3 * PERSON_GAP);
  assert.ok(maxX - minX < 8 * PERSON_GAP);
  assert.ok(Math.abs(((b1.x ?? 0) + (b2.x ?? 0)) / 2 - (s.x ?? 0)) < 0.5);
  assertNoSameGenerationSymbolOverlap(graph);
});

test("two siblings marrying into different origin families stay ordered and compact", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      ["A1", { id: "A1", sex: "M" }],
      ["A2", { id: "A2", sex: "F" }],
      ["B1", { id: "B1", sex: "M" }],
      ["B2", { id: "B2", sex: "F" }],
      ["C1", { id: "C1", sex: "M" }],
      ["C2", { id: "C2", sex: "F" }],
      ["k1", { id: "k1", sex: "F" }],
      ["k2", { id: "k2", sex: "M" }],
      ["sb", { id: "sb", sex: "M" }],
      ["sc", { id: "sc", sex: "F" }]
    ]),
    unions: new Map([
      ["uA", { id: "uA", partners: ["A1", "A2"] }],
      ["uB", { id: "uB", partners: ["B1", "B2"] }],
      ["uC", { id: "uC", partners: ["C1", "C2"] }],
      ["uKB", { id: "uKB", partners: ["k1", "sb"] }],
      ["uKC", { id: "uKC", partners: ["k2", "sc"] }]
    ]),
    childrenMap: new Map([
      ["uA", ["k1", "k2"]],
      ["uB", ["sb"]],
      ["uC", ["sc"]],
      ["uKB", []],
      ["uKC", []]
    ])
  };

  assignLayers(graph);
  const generations = snapshotGenerations(graph);
  graph.persons.get("k1")!.birthOrder = 0;
  graph.persons.get("k2")!.birthOrder = 1;
  reduceCrossings(graph);

  assert.doesNotThrow(() => assignCoordinates(graph));
  assertGenerationsUnchanged(graph, generations);
  assertNoSameGenerationSymbolOverlap(graph);
  for (const id of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
    for (const other of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      if (id >= other) continue;
      assert.ok(Math.abs((graph.persons.get(id)!.x ?? 0) - (graph.persons.get(other)!.x ?? 0)) >= NODE_SIZE - 0.5);
    }
  }
  assert.ok(contentWidth(graph) < 10 * PERSON_GAP);
});

test("four-generation multi-origin pedigree remains ordered and bounded", () => {
  const ids = [
    "A1", "A2", "B1", "B2", "C1", "C2",
    "a", "b", "c", "d", "e", "f",
    "x", "y", "z", "m",
    "g1", "g2", "h1", "h2"
  ];
  const graph: PedigreeGraph = {
    persons: new Map(ids.map((id) => [id, { id, sex: "U" }])),
    unions: new Map([
      ["uA", { id: "uA", partners: ["A1", "A2"] }],
      ["uB", { id: "uB", partners: ["B1", "B2"] }],
      ["uC", { id: "uC", partners: ["C1", "C2"] }],
      ["uAX", { id: "uAX", partners: ["a", "x"] }],
      ["uBZ", { id: "uBZ", partners: ["b", "z"] }],
      ["uGM", { id: "uGM", partners: ["g1", "m"] }]
    ]),
    childrenMap: new Map([
      ["uA", ["a", "b", "c"]],
      ["uB", ["x", "y", "e"]],
      ["uC", ["d", "z", "f"]],
      ["uAX", ["g1", "g2"]],
      ["uBZ", ["h1"]],
      ["uGM", ["h2"]]
    ])
  };

  assignLayers(graph);
  const generations = snapshotGenerations(graph);
  setBirthOrder(graph, ["a", "b", "c"]);
  setBirthOrder(graph, ["x", "y", "e"]);
  setBirthOrder(graph, ["d", "z", "f"]);
  setBirthOrder(graph, ["g1", "g2"]);
  reduceCrossings(graph);

  assert.doesNotThrow(() => assignCoordinates(graph));
  assertGenerationsUnchanged(graph, generations);
  assertNoSameGenerationSymbolOverlap(graph);
  assert.ok(contentWidth(graph) < 18 * PERSON_GAP);
});

test("chain marriages keep founders separated and sibling birth order fixed", () => {
  const graph: PedigreeGraph = {
    persons: new Map([
      ["A1", { id: "A1", sex: "M" }],
      ["A2", { id: "A2", sex: "F" }],
      ["B1", { id: "B1", sex: "M" }],
      ["B2", { id: "B2", sex: "F" }],
      ["C1", { id: "C1", sex: "M" }],
      ["C2", { id: "C2", sex: "F" }],
      ["P1", { id: "P1", sex: "M" }],
      ["P2", { id: "P2", sex: "F", affected: true }],
      ["P3", { id: "P3", sex: "M" }],
      ["Q1", { id: "Q1", sex: "F" }],
      ["Q2", { id: "Q2", sex: "M", carrier: true }],
      ["Q3", { id: "Q3", sex: "F" }],
      ["X1", { id: "X1", sex: "M" }],
      ["R1", { id: "R1", sex: "M" }],
      ["R2", { id: "R2", sex: "F", affected: true }],
      ["R3", { id: "R3", sex: "F" }],
      ["R4", { id: "R4", sex: "M" }],
      ["Y1", { id: "Y1", sex: "M" }],
      ["S1", { id: "S1", sex: "U" }],
      ["S2", { id: "S2", sex: "F" }]
    ]),
    unions: new Map([
      ["uA", { id: "uA", partners: ["A1", "A2"] }],
      ["uB", { id: "uB", partners: ["B1", "B2"] }],
      ["uC", { id: "uC", partners: ["C1", "C2"] }],
      ["uP2Q2", { id: "uP2Q2", partners: ["P2", "Q2"] }],
      ["uP3Q3", { id: "uP3Q3", partners: ["P3", "Q3"] }],
      ["uQ1X1", { id: "uQ1X1", partners: ["Q1", "X1"] }],
      ["uR2Y1", { id: "uR2Y1", partners: ["R2", "Y1"] }]
    ]),
    childrenMap: new Map([
      ["uA", ["P1", "P2", "P3"]],
      ["uB", ["Q1", "Q2"]],
      ["uC", ["Q3"]],
      ["uP2Q2", ["R1", "R2"]],
      ["uP3Q3", ["R3"]],
      ["uQ1X1", ["R4"]],
      ["uR2Y1", ["S1", "S2"]]
    ])
  };

  assignLayers(graph);
  const generations = snapshotGenerations(graph);
  setBirthOrder(graph, ["P1", "P2", "P3"]);
  setBirthOrder(graph, ["Q1", "Q2"]);
  setBirthOrder(graph, ["R1", "R2"]);
  setBirthOrder(graph, ["S1", "S2"]);
  reduceCrossings(graph);

  assert.doesNotThrow(() => assignCoordinates(graph));
  assertNoSameGenerationSymbolOverlap(graph);
  assertGenerationsUnchanged(graph, generations);

  const pChildren = ["P1", "P2", "P3"]
    .map((id) => graph.persons.get(id)!)
    .sort((a, b) => (a.x ?? 0) - (b.x ?? 0))
    .map((person) => person.id);
  assert.deepEqual(pChildren, ["P1", "P2", "P3"]);
  const aParentDrop = ((graph.persons.get("A1")!.x ?? 0) + (graph.persons.get("A2")!.x ?? 0)) / 2;
  const aChildCenter = ((graph.persons.get("P1")!.x ?? 0) + (graph.persons.get("P3")!.x ?? 0)) / 2;
  assert.ok(Math.abs(aParentDrop - aChildCenter) < 1);
  assert.ok(contentWidth(graph) < 22 * PERSON_GAP);
});

function assertNoSameGenerationSymbolOverlap(graph: PedigreeGraph) {
  const people = [...graph.persons.values()].filter((p) =>
    Number.isFinite(p.x) && Number.isFinite(p.y)
  );
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      if (Math.abs((people[i].y ?? 0) - (people[j].y ?? 0)) >= 1) continue;
      assert.ok(
        Math.abs((people[i].x ?? 0) - (people[j].x ?? 0)) >= NODE_SIZE - 0.5,
        `${people[i].id} overlaps ${people[j].id}`
      );
    }
  }
}

function setBirthOrder(graph: PedigreeGraph, ids: string[]) {
  ids.forEach((id, index) => {
    graph.persons.get(id)!.birthOrder = index;
  });
}

function snapshotGenerations(graph: PedigreeGraph): Map<string, number | undefined> {
  return new Map([...graph.persons.values()].map((person) => [person.id, person.generation]));
}

function assertGenerationsUnchanged(graph: PedigreeGraph, expected: Map<string, number | undefined>) {
  for (const person of graph.persons.values()) {
    assert.equal(person.generation, expected.get(person.id), `${person.id} generation changed`);
  }
}

function contentWidth(graph: PedigreeGraph): number {
  const xs = [...graph.persons.values()].map((person) => person.x ?? 0);
  return Math.max(...xs) - Math.min(...xs);
}
