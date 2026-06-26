import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/browser/entry";
import { BASE_MARRIAGE_GAP, BRANCHED_MARRIAGE_GAP } from "../src/layout/boxModel";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";
import {
  assertChildHasVerticalSegmentToNode,
  assertChildrenShareSiblingLine,
  assertGenerationOrder,
  assertMarriageSegmentConnects,
  assertNoNodeOverlaps,
  assertUnionHasCompleteProvenance,
  findNode,
  findParentDropForUnion
} from "./helpers/layoutAssertions";

test("normal two-parent family centers one child below parents", () => {
  const result = buildLayout({
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
  });

  assertNoNodeOverlaps(result);
  assertMarriageSegmentConnects(result, "father", "mother");
  assertChildHasVerticalSegmentToNode(result, "child");
  assertGenerationOrder(result, ["father", "mother"], ["child"]);
  assertUnionHasCompleteProvenance(result, "parents", {
    parentIds: ["father", "mother"],
    childIds: ["child"]
  });

  const father = findNode(result, "father");
  const mother = findNode(result, "mother");
  const child = findNode(result, "child");
  assert.ok(Math.abs(child.x - (father.x + mother.x) / 2) < 0.5);
  assert.ok(Math.abs(Math.abs(father.x - mother.x) - BRANCHED_MARRIAGE_GAP) < 0.5);
});

test("normal no-child spouse union stays more compact than childbearing parents", () => {
  const result = buildLayout({
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
  });

  assertNoNodeOverlaps(result);
  assertMarriageSegmentConnects(result, "partnerA", "partnerB");

  const partnerA = findNode(result, "partnerA");
  const partnerB = findNode(result, "partnerB");
  assert.ok(Math.abs(Math.abs(partnerA.x - partnerB.x) - BASE_MARRIAGE_GAP) < 0.5);
  assert.ok(BASE_MARRIAGE_GAP < BRANCHED_MARRIAGE_GAP);
});

test("normal sibling group keeps birth order and one shared sibling line", () => {
  const result = buildLayout({
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
  });

  assertNoNodeOverlaps(result);
  assertChildrenShareSiblingLine(result, ["oldest", "middle", "youngest"]);
  assertGenerationOrder(result, ["father", "mother"], ["oldest", "middle", "youngest"]);

  const orderedChildren = ["oldest", "middle", "youngest"].map((id) => findNode(result, id));
  assert.ok(orderedChildren[0].x < orderedChildren[1].x);
  assert.ok(orderedChildren[1].x < orderedChildren[2].x);
});

test("normal married child keeps source parent drop on biological child", () => {
  const result = buildLayout({
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
  });

  assertNoNodeOverlaps(result);
  assertMarriageSegmentConnects(result, "father", "mother");
  assertMarriageSegmentConnects(result, "child", "spouse");
  assertGenerationOrder(result, ["father", "mother"], ["child"]);
  assertGenerationOrder(result, ["child", "spouse"], ["grandchild"]);
  assertUnionHasCompleteProvenance(result, "parents", {
    parentIds: ["father", "mother"],
    childIds: ["child"]
  });
  assertUnionHasCompleteProvenance(result, "marriage", {
    parentIds: ["child", "spouse"],
    childIds: ["grandchild"]
  });

  const parentDrop = findParentDropForUnion(result, "parents");
  const child = findNode(result, "child");
  const dropEnd = parentDrop.points[parentDrop.points.length - 1];
  assert.ok(Math.abs(dropEnd.x - child.x) < 0.5);
});

test("normal three-generation family keeps each generation ordered", () => {
  const result = buildLayout({
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
  });

  assertNoNodeOverlaps(result);
  assertMarriageSegmentConnects(result, "grandfather", "grandmother");
  assertMarriageSegmentConnects(result, "parent", "partner");
  assertChildHasVerticalSegmentToNode(result, "parent");
  assertChildHasVerticalSegmentToNode(result, "child");
  assertGenerationOrder(result, ["grandfather", "grandmother"], ["parent", "partner"]);
  assertGenerationOrder(result, ["parent", "partner"], ["child"]);
});

test("normal family ignores stale no-child single-parent unions", () => {
  const result = buildLayout({
    persons: [
      { id: "father", sex: "M", birthOrder: 1 },
      { id: "mother", sex: "F", birthOrder: 2 },
      { id: "spouseFather", sex: "M", birthOrder: 3 },
      { id: "spouseMother", sex: "F", birthOrder: 4 },
      { id: "olderBrother", sex: "M", birthOrder: 5 },
      { id: "spouse", sex: "F", birthOrder: 6 },
      { id: "proband", sex: "M", birthOrder: 7 },
      { id: "youngerBrother", sex: "M", birthOrder: 8 },
      { id: "youngestBrother", sex: "M", birthOrder: 9 }
    ],
    unions: [
      { id: "staleFatherOnly", partners: ["father"] },
      { id: "parents", partners: ["father", "mother"] },
      { id: "marriage", partners: ["proband", "spouse"] },
      { id: "staleSpouseFatherOnly", partners: ["spouseFather"] },
      { id: "spouseParents", partners: ["spouseFather", "spouseMother"] }
    ],
    childrenMap: [
      ["parents", ["proband", "youngerBrother", "youngestBrother", "olderBrother"]],
      ["spouseParents", ["spouse"]]
    ]
  });

  assertNoNodeOverlaps(result);
  assertChildrenShareSiblingLine(result, ["olderBrother", "proband", "youngerBrother", "youngestBrother"]);
  assertMarriageSegmentConnects(result, "father", "mother");
  assertMarriageSegmentConnects(result, "spouseFather", "spouseMother");
  assertMarriageSegmentConnects(result, "proband", "spouse");
  assertParentDropOutsideSiblingLine(result, "parents", "spouseParents");
  assertMarriageLineDetoursAroundBlockers(result, "marriage");

  const olderBrother = findNode(result, "olderBrother");
  const proband = findNode(result, "proband");
  const youngerBrother = findNode(result, "youngerBrother");
  const youngestBrother = findNode(result, "youngestBrother");
  const spouse = findNode(result, "spouse");

  assert.ok(olderBrother.x < proband.x);
  assert.ok(proband.x < youngerBrother.x);
  assert.ok(youngerBrother.x < youngestBrother.x);
  assert.ok(proband.x < spouse.x);

  const xs = result.nodes.map((node) => node.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 650);
  assert.equal(result.unionAnchors.some((anchor) => anchor.unionId === "staleFatherOnly"), false);
  assert.equal(result.unionAnchors.some((anchor) => anchor.unionId === "staleSpouseFatherOnly"), false);
});

function buildLayout(input: LayoutInput): LayoutResult {
  const response = layout(input);
  assert.ok(response.ok);
  return response.layout;
}

function assertParentDropOutsideSiblingLine(layout: LayoutResult, siblingUnionId: string, crossingUnionId: string) {
  const sibling = layout.relationshipSegments.find((segment) =>
    segment.unionId === siblingUnionId && segment.kind === "sibling-line"
  );
  const parentDrop = layout.relationshipSegments.find((segment) =>
    segment.unionId === crossingUnionId && segment.kind === "parent-drop"
  );
  assert.ok(sibling, `missing sibling line for ${siblingUnionId}`);
  assert.ok(parentDrop, `missing parent drop for ${crossingUnionId}`);

  const x = parentDrop.points[0].x;
  const minX = Math.min(sibling.points[0].x, sibling.points[1].x);
  const maxX = Math.max(sibling.points[0].x, sibling.points[1].x);
  assert.ok(x < minX || x > maxX, `expected ${crossingUnionId} parent drop outside ${siblingUnionId} sibling rail`);
}

function assertMarriageLineDetoursAroundBlockers(layout: LayoutResult, unionId: string) {
  const marriage = layout.relationshipSegments.find((segment) =>
    segment.unionId === unionId && segment.kind === "marriage"
  );
  assert.ok(marriage, `missing marriage line for ${unionId}`);
  assert.ok(marriage.points.length > 2, `expected ${unionId} marriage line to use a lowered route`);
}
