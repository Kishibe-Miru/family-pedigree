import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/browser/entry";
import { NODE_SIZE } from "../src/layout/boxModel";
import { diagnoseLayoutAgainstGroups } from "../src/layout/layoutDiagnostics";
import { buildRelationshipGroups } from "../src/layout/relationshipGroups";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";
import { PedigreeGraph } from "../src/model/pedigreeGraph";
import {
  complexKnownProblemFamily,
  halfSiblingsThroughMultipleUnions,
  marriedSiblingWithOwnChild,
  multiChildSiblingGroup,
  simpleNuclearFamily,
  singleParentUnion,
  spouseWithOriginFamily,
  threeGenerationChain
} from "./fixtures/complexPedigrees";
import {
  assertChildHasVerticalSegmentToNode,
  assertChildrenDoNotShareSiblingLine,
  assertChildrenShareSiblingLine,
  assertGenerationOrder,
  assertMarriageSegmentConnects,
  assertNoNodeOverlaps,
  assertSegmentBelongsToUnion,
  assertUnionHasCompleteProvenance,
  assertUnionSegmentsAreSeparate,
  findParentDropForUnion,
  findNode
} from "./helpers/layoutAssertions";

test("simple nuclear family renders valid layout", () => {
  const layout = buildLayout(simpleNuclearFamily.input);

  assertNoNodeOverlaps(layout);
  assertMarriageSegmentConnects(layout, "A", "B");
  assertChildHasVerticalSegmentToNode(layout, "C");
  assertGenerationOrder(layout, ["A", "B"], ["C"]);
});

test("siblings from same union share one sibling line", () => {
  const layout = buildLayout(multiChildSiblingGroup.input);

  assertNoNodeOverlaps(layout);
  assertChildrenShareSiblingLine(layout, ["C", "D", "E"]);
  assert.equal(
    layout.relationshipSegments.filter((segment) => segment.type === "sibling" && segment.unionId === "uAB").length,
    1
  );
});

test("half siblings from different unions do not share sibling line", () => {
  const layout = buildLayout(halfSiblingsThroughMultipleUnions.input);

  assertNoNodeOverlaps(layout);
  assertMarriageSegmentConnects(layout, "A", "B");
  assertMarriageSegmentConnects(layout, "A", "D");
  assertChildrenDoNotShareSiblingLine(layout, ["C"], ["E"]);
  assertUnionSegmentsAreSeparate(layout, ["uAB", "uAD"]);
});

test("spouse origin family stays separate from core family", () => {
  const layout = buildLayout(spouseWithOriginFamily.input);

  assertNoNodeOverlaps(layout);
  assertMarriageSegmentConnects(layout, "A", "B");
  assertMarriageSegmentConnects(layout, "P", "Q");
  assertChildHasVerticalSegmentToNode(layout, "B");
  assertChildHasVerticalSegmentToNode(layout, "C");
  assertUnionSegmentsAreSeparate(layout, ["uAB", "uPQ"]);

  const coreChildSegment = layout.relationshipSegments.find((segment) =>
    segment.type === "individual" && segment.personId === "C"
  );
  const originChildSegment = layout.relationshipSegments.find((segment) =>
    segment.type === "individual" && segment.personId === "B"
  );
  assert.equal(coreChildSegment?.unionId, "uAB");
  assert.equal(originChildSegment?.unionId, "uPQ");
});

test("married sibling layout remains non-overlapping", () => {
  const layout = buildLayout(marriedSiblingWithOwnChild.input);

  assertNoNodeOverlaps(layout);
  assertChildrenShareSiblingLine(layout, ["C", "D"]);
  assertMarriageSegmentConnects(layout, "D", "E");
  assertChildHasVerticalSegmentToNode(layout, "F");
  assertGenerationOrder(layout, ["D", "E"], ["F"]);
});

test("single parent union keeps child below parent", () => {
  const layout = buildLayout(singleParentUnion.input);

  assertNoNodeOverlaps(layout);
  assertChildHasVerticalSegmentToNode(layout, "C");
  assertGenerationOrder(layout, ["A"], ["C"]);
});

test("three generation chain keeps y order", () => {
  const layout = buildLayout(threeGenerationChain.input);

  assertNoNodeOverlaps(layout);
  assertMarriageSegmentConnects(layout, "G1A", "G1B");
  assertMarriageSegmentConnects(layout, "G2A", "G2B");
  assertGenerationOrder(layout, ["G1A", "G1B"], ["G2A"]);
  assertGenerationOrder(layout, ["G2A", "G2B"], ["G3A"]);
});

test("complex known-problem family satisfies layout regression invariants", () => {
  const layout = buildLayout(complexKnownProblemFamily.input);
  const diagnostics = diagnoseLayoutAgainstGroups(
    graphFromInput(complexKnownProblemFamily.input),
    layout,
    buildRelationshipGroups(graphFromInput(complexKnownProblemFamily.input))
  );

  assertNoNodeOverlaps(layout);
  assertChildrenShareSiblingLine(layout, ["K1", "K2"]);
  assertUnionSegmentsAreSeparate(layout, ["uA", "uB", "uC", "uK1S1", "uK2S2"]);
  assertGenerationOrder(layout, ["A1", "A2", "B1", "B2", "C1", "C2"], ["K1", "K2", "S1", "S2"]);
  assertGenerationOrder(layout, ["K1", "S1"], ["G1"]);
  assertMarriageSegmentConnects(layout, "K1", "S1");
  assertMarriageSegmentConnects(layout, "K2", "S2");
  assert.ok(findNode(layout, "G1"));
  assertNodeSeparatedFrom(layout, "G1", ["K2", "S2"]);
  assertOriginParentDrop(layout, "uA", ["A1", "A2"], ["K1", "K2"]);
  assertOriginParentDrop(layout, "uB", ["B1", "B2"], ["S1"]);
  assertOriginParentDrop(layout, "uC", ["C1", "C2"], ["S2"]);
  assertOriginParentDrop(layout, "uK1S1", ["K1", "S1"], ["G1"]);
  assertUnionHasCompleteProvenance(layout, "uA", { parentIds: ["A1", "A2"], childIds: ["K1", "K2"] });
  assertUnionHasCompleteProvenance(layout, "uB", { parentIds: ["B1", "B2"], childIds: ["S1"] });
  assertUnionHasCompleteProvenance(layout, "uC", { parentIds: ["C1", "C2"], childIds: ["S2"] });
  assertUnionHasCompleteProvenance(layout, "uK1S1", { parentIds: ["K1", "S1"], childIds: ["G1"] });
  assert.deepEqual(
    diagnostics.filter((diagnostic) =>
      diagnostic.kind === "constraint-reference-invalid" ||
      diagnostic.kind === "semantic-view-missing-link" ||
      diagnostic.kind === "subfamily-space-collapsed" ||
      diagnostic.kind === "origin-family-crosses-core-family"
    ),
    []
  );
});

test("consanguineous cousin marriage loop remains layoutable", () => {
  const layout = buildLayout({
    persons: [
      { id: "GF", sex: "M" },
      { id: "GM", sex: "F" },
      { id: "P1", sex: "M", birthOrder: 0 },
      { id: "P2", sex: "F", birthOrder: 1 },
      { id: "S1", sex: "F" },
      { id: "S2", sex: "M" },
      { id: "C1", sex: "M", birthOrder: 0 },
      { id: "C2", sex: "F", birthOrder: 0 },
      { id: "K", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "uGrand", partners: ["GF", "GM"] },
      { id: "uP1", partners: ["P1", "S1"] },
      { id: "uP2", partners: ["P2", "S2"] },
      { id: "uCousin", partners: ["C1", "C2"], consanguineous: true }
    ],
    childrenMap: [
      ["uGrand", ["P1", "P2"]],
      ["uP1", ["C1"]],
      ["uP2", ["C2"]],
      ["uCousin", ["K"]]
    ]
  });

  assertNoNodeOverlaps(layout);
  assertMarriageSegmentConnects(layout, "C1", "C2");
  assertGenerationOrder(layout, ["GF", "GM"], ["P1", "P2"]);
  assertGenerationOrder(layout, ["P1", "S1", "P2", "S2"], ["C1", "C2"]);
  assertGenerationOrder(layout, ["C1", "C2"], ["K"]);
  const cousinMarriage = layout.relationshipSegments.find((segment) => segment.id === "uCousin:marriage");
  assert.equal(cousinMarriage?.doubleLine, true);
  assertUnionHasCompleteProvenance(layout, "uCousin", { parentIds: ["C1", "C2"], childIds: ["K"] });
});

function buildLayout(input: LayoutInput): LayoutResult {
  const response = layout(input);
  assert.ok(response.ok);
  return response.layout;
}

function assertNodeSeparatedFrom(layout: LayoutResult, personId: string, otherIds: string[]) {
  const node = findNode(layout, personId);
  for (const otherId of otherIds) {
    const other = findNode(layout, otherId);
    assert.ok(
      Math.abs(node.x - other.x) >= NODE_SIZE || Math.abs(node.y - other.y) >= NODE_SIZE,
      `${personId} should not overlap ${otherId}`
    );
  }
}

function assertOriginParentDrop(layout: LayoutResult, unionId: string, parentIds: string[], childIds: string[]) {
  const parentDrop = findParentDropForUnion(layout, unionId);
  assertSegmentBelongsToUnion(parentDrop, unionId);
  assert.deepEqual([...(parentDrop.parentIds ?? [])].sort(), [...parentIds].sort());
  assert.deepEqual([...(parentDrop.childIds ?? [])].sort(), [...childIds].sort());
}

function graphFromInput(input: LayoutInput): PedigreeGraph {
  return {
    persons: new Map(input.persons.map((person) => [
      person.id,
      {
        id: person.id,
        sex: person.sex,
        birthOrder: person.birthOrder,
        twinGroup: person.twinGroup,
        twinType: person.twinType
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
