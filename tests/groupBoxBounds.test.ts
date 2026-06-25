import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/browser/entry";
import {
  boundsContainPoint,
  boundsOverlap,
  deriveGroupBoxBounds,
  findGroupBoxBounds
} from "../src/layout/groupBoxBounds";
import { buildRelationshipGroups } from "../src/layout/relationshipGroups";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";
import { PedigreeGraph } from "../src/model/pedigreeGraph";
import {
  complexKnownProblemFamily,
  complexPedigreeFixtures,
  marriedSiblingWithOwnChild,
  multiChildSiblingGroup,
  simpleNuclearFamily,
  spouseWithOriginFamily
} from "./fixtures/complexPedigrees";

test("derives group box bounds for every complex pedigree fixture", () => {
  for (const fixture of complexPedigreeFixtures) {
    const { boundsModel } = deriveFixtureBounds(fixture.input);

    assert.ok(Array.isArray(boundsModel.bounds), `${fixture.id} bounds should be an array`);
    assert.deepEqual(
      boundsModel.bounds.map((bounds) => bounds.id),
      [...boundsModel.bounds.map((bounds) => bounds.id)].sort(),
      `${fixture.id} bounds should be sorted by id`
    );
    for (const bounds of boundsModel.bounds) {
      assert.ok(bounds.width > 0, `${fixture.id} ${bounds.id} width`);
      assert.ok(bounds.height > 0, `${fixture.id} ${bounds.id} height`);
    }
  }
});

test("family box bounds contain core family nodes", () => {
  const { layout, boundsModel } = deriveFixtureBounds(simpleNuclearFamily.input);
  const family = findGroupBoxBounds(boundsModel, "family:uAB");

  assert.ok(family);
  assert.equal(family.role, "family");
  assert.equal(family.kind, "nuclear-family");
  assert.deepEqual([...family.personIds].sort(), ["A", "B", "C"]);
  for (const personId of ["A", "B", "C"]) {
    assert.ok(boundsContainPoint(family, findNode(layout, personId)), `family bounds should contain ${personId}`);
  }
});

test("sibling group bounds exist with expected person ids", () => {
  const { layout, boundsModel } = deriveFixtureBounds(multiChildSiblingGroup.input);
  const siblings = findGroupBoxBounds(boundsModel, "sibling:uAB");

  assert.ok(siblings);
  assert.equal(siblings.role, "sibling-group");
  assert.equal(siblings.kind, "sibling-group");
  assert.deepEqual([...siblings.personIds].sort(), ["C", "D", "E"]);
  assert.deepEqual([...siblings.childIds].sort(), ["C", "D", "E"]);
  for (const personId of ["C", "D", "E"]) {
    assert.ok(boundsContainPoint(siblings, findNode(layout, personId)), `sibling bounds should contain ${personId}`);
  }
});

test("origin-family semantic view does not create duplicate physical bounds", () => {
  const { boundsModel } = deriveFixtureBounds(spouseWithOriginFamily.input);

  assert.equal(findGroupBoxBounds(boundsModel, "origin:B:uPQ"), undefined);
  assert.ok(findGroupBoxBounds(boundsModel, "family:uPQ"));
  assert.ok(findGroupBoxBounds(boundsModel, "family:uAB"));
  assert.equal(
    boundsModel.bounds.filter((bounds) => bounds.unionIds.includes("uPQ")).length,
    1,
    "source origin union should have one physical bounds entry"
  );
});

test("no-child spouse union has union bounds without descendant space", () => {
  const { layout, boundsModel } = deriveFixtureBounds({
    persons: [
      { id: "A", sex: "U" },
      { id: "B", sex: "U" }
    ],
    unions: [
      { id: "uAB", partners: ["A", "B"] }
    ],
    childrenMap: [
      ["uAB", []]
    ]
  });
  const union = findGroupBoxBounds(boundsModel, "family:uAB");

  assert.ok(union);
  assert.equal(union.role, "union");
  assert.equal(union.kind, "spouse-union");
  assert.equal(union.requiresDescendantSpace, false);
  assert.deepEqual(union.childIds, []);
  assert.ok(boundsContainPoint(union, findNode(layout, "A")));
  assert.ok(boundsContainPoint(union, findNode(layout, "B")));
});

test("no-child married sibling union has union bounds without descendant space", () => {
  const { layout, boundsModel } = deriveFixtureBounds(complexKnownProblemFamily.input);
  const union = findGroupBoxBounds(boundsModel, "family:uK2S2");

  assert.ok(union);
  assert.equal(union.role, "union");
  assert.equal(union.kind, "married-sibling-union");
  assert.equal(union.requiresDescendantSpace, false);
  assert.deepEqual(union.childIds, []);
  assert.ok(boundsContainPoint(union, findNode(layout, "K2")));
  assert.ok(boundsContainPoint(union, findNode(layout, "S2")));
});

test("married sibling subfamily has subfamily bounds with descendant space", () => {
  const { layout, boundsModel } = deriveFixtureBounds(marriedSiblingWithOwnChild.input);
  const subfamily = findGroupBoxBounds(boundsModel, "family:uDE");
  const sibling = findGroupBoxBounds(boundsModel, "sibling:uAB");

  assert.ok(subfamily);
  assert.equal(subfamily.role, "subfamily");
  assert.equal(subfamily.kind, "married-sibling-subfamily");
  assert.equal(subfamily.requiresDescendantSpace, true);
  assert.deepEqual([...subfamily.personIds].sort(), ["D", "E", "F"]);
  assert.ok(sibling);
  assert.equal(boundsOverlap(subfamily, sibling), true, "derived bounds may overlap before solver uses them");
  for (const personId of ["D", "E", "F"]) {
    assert.ok(boundsContainPoint(subfamily, findNode(layout, personId)), `subfamily bounds should contain ${personId}`);
  }
});

test("complex known-problem fixture derives bounds without throwing", () => {
  const { boundsModel } = deriveFixtureBounds(complexKnownProblemFamily.input);

  assert.ok(findGroupBoxBounds(boundsModel, "family:uA"));
  assert.ok(findGroupBoxBounds(boundsModel, "sibling:uA"));
  assert.ok(findGroupBoxBounds(boundsModel, "family:uK1S1"));
  assert.ok(findGroupBoxBounds(boundsModel, "family:uK2S2"));
});

test("deriveGroupBoxBounds does not mutate finalized layout", () => {
  for (const input of [simpleNuclearFamily.input, complexKnownProblemFamily.input]) {
    const { layout, groupModel } = fixtureLayoutAndGroups(input);
    const before = normalizeLayout(layout);

    deriveGroupBoxBounds(layout, groupModel);

    assert.deepEqual(normalizeLayout(layout), before);
  }
});

function deriveFixtureBounds(input: LayoutInput) {
  const { graph, layout, groupModel } = fixtureLayoutAndGroups(input);
  const boundsModel = deriveGroupBoxBounds(layout, groupModel);

  return { graph, layout, groupModel, boundsModel };
}

function fixtureLayoutAndGroups(input: LayoutInput) {
  const graph = graphFromInput(input);
  const layout = buildLayout(input);
  const groupModel = buildRelationshipGroups(graph);

  return { graph, layout, groupModel };
}

function buildLayout(input: LayoutInput): LayoutResult {
  const response = layout(input);
  assert.ok(response.ok);
  return response.layout;
}

function graphFromInput(input: LayoutInput): PedigreeGraph {
  return {
    persons: new Map(input.persons.map((person) => [
      person.id,
      {
        id: person.id,
        sex: person.sex,
        birthOrder: person.birthOrder
      }
    ])),
    unions: new Map(input.unions.map((union) => [
      union.id,
      {
        id: union.id,
        partners: union.partners.length === 1
          ? [union.partners[0]]
          : [union.partners[0], union.partners[1]]
      }
    ])),
    childrenMap: new Map(input.childrenMap.map(([unionId, childIds]) => [unionId, [...childIds]]))
  };
}

function findNode(layout: LayoutResult, id: string) {
  const node = layout.nodes.find((candidate) => candidate.id === id);
  assert.ok(node, `missing node ${id}`);
  return node;
}

function normalizeLayout(layout: LayoutResult) {
  return {
    nodes: layout.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      generation: node.generation
    })),
    relationshipSegments: layout.relationshipSegments.map((segment) => ({
      id: segment.id,
      kind: segment.kind,
      unionId: segment.unionId,
      personId: segment.personId,
      from: segment.points[0],
      to: segment.points[segment.points.length - 1],
      source: segment.source ? {
        unionId: segment.source.unionId,
        parentIds: segment.source.parentIds,
        childIds: segment.source.childIds,
        personIds: segment.source.personIds
      } : undefined
    })),
    bounds: layout.bounds,
    generationLabels: layout.generationLabels
  };
}
