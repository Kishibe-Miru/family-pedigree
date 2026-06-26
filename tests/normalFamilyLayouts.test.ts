import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/browser/entry";
import { BASE_MARRIAGE_GAP, BRANCHED_MARRIAGE_GAP, DUAL_ORIGIN_MARRIAGE_GAP, GENERATION_GAP, NODE_SIZE, PERSON_GAP } from "../src/layout/boxModel";
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
  assertSingleChildUsesPointSiblingLine(result, "parents", "child");
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
  assert.ok(Math.max(...xs) - Math.min(...xs) < 720);
  assert.equal(result.unionAnchors.some((anchor) => anchor.unionId === "staleFatherOnly"), false);
  assert.equal(result.unionAnchors.some((anchor) => anchor.unionId === "staleSpouseFatherOnly"), false);
});

test("normal sibling row keeps external spouse out of source sibling occupancy", () => {
  const result = buildLayout({
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "olderBrother", sex: "M", birthOrder: 0 },
      { id: "proband", sex: "M", birthOrder: 1 },
      { id: "youngerBrother", sex: "M", birthOrder: 2 },
      { id: "youngestBrother", sex: "M", birthOrder: 3 },
      { id: "spouseFather", sex: "M" },
      { id: "spouseMother", sex: "F" },
      { id: "spouse", sex: "F" },
      { id: "child", sex: "M", birthOrder: 0 }
    ],
    unions: [
      { id: "parents", partners: ["father", "mother"] },
      { id: "spouseParents", partners: ["spouseFather", "spouseMother"] },
      { id: "marriage", partners: ["proband", "spouse"] }
    ],
    childrenMap: [
      ["parents", ["olderBrother", "proband", "youngerBrother", "youngestBrother"]],
      ["spouseParents", ["spouse"]],
      ["marriage", ["child"]]
    ]
  });

  assertNoNodeOverlaps(result);
  assertChildrenShareSiblingLine(result, ["olderBrother", "proband", "youngerBrother", "youngestBrother"]);
  assertMarriageSegmentConnects(result, "proband", "spouse");
  assertGenerationOrder(result, ["father", "mother", "spouseFather", "spouseMother"], ["olderBrother", "proband", "youngerBrother", "youngestBrother", "spouse"]);
  assertGenerationOrder(result, ["proband", "spouse"], ["child"]);

  const olderBrother = findNode(result, "olderBrother");
  const proband = findNode(result, "proband");
  const spouse = findNode(result, "spouse");
  const youngerBrother = findNode(result, "youngerBrother");
  const youngestBrother = findNode(result, "youngestBrother");
  const rowBounds = [
    { left: olderBrother.x - NODE_SIZE / 2, right: olderBrother.x + NODE_SIZE / 2 },
    { left: proband.x - NODE_SIZE / 2, right: proband.x + NODE_SIZE / 2 },
    { left: youngerBrother.x - NODE_SIZE / 2, right: youngerBrother.x + NODE_SIZE / 2 },
    { left: youngestBrother.x - NODE_SIZE / 2, right: youngestBrother.x + NODE_SIZE / 2 }
  ];
  const edgeGaps = rowBounds.slice(1).map((bounds, index) => bounds.left - rowBounds[index].right);
  assert.ok(edgeGaps.every((gap) => gap > 0));
  assert.ok(Math.max(...edgeGaps) - Math.min(...edgeGaps) < NODE_SIZE * 0.15);
  assert.ok(spouse.x > youngestBrother.x);
});

test("normal children descend from lowered marriage route when spouse line detours", () => {
  const result = buildLayout({
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "olderBrother", sex: "M", birthOrder: 0 },
      { id: "proband", sex: "M", birthOrder: 1 },
      { id: "youngerBrother", sex: "M", birthOrder: 2 },
      { id: "youngestBrother", sex: "M", birthOrder: 3 },
      { id: "spouseFather", sex: "M" },
      { id: "spouseMother", sex: "F" },
      { id: "spouse", sex: "F" },
      { id: "son", sex: "M", birthOrder: 0 },
      { id: "daughter", sex: "F", birthOrder: 1 }
    ],
    unions: [
      { id: "parents", partners: ["father", "mother"] },
      { id: "spouseParents", partners: ["spouseFather", "spouseMother"] },
      { id: "marriage", partners: ["proband", "spouse"] }
    ],
    childrenMap: [
      ["parents", ["olderBrother", "proband", "youngerBrother", "youngestBrother"]],
      ["spouseParents", ["spouse"]],
      ["marriage", ["son", "daughter"]]
    ]
  });

  assertNoNodeOverlaps(result);
  assertChildrenShareSiblingLine(result, ["olderBrother", "proband", "youngerBrother", "youngestBrother"]);
  assertChildrenShareSiblingLine(result, ["son", "daughter"]);

  const marriage = result.relationshipSegments.find((segment) =>
    segment.unionId === "marriage" && segment.kind === "marriage"
  );
  const parentDrop = findParentDropForUnion(result, "marriage");
  assert.ok(marriage, "missing marriage line");
  assert.ok(marriage.points.length > 2, "expected marriage line to use a lowered route");

  const horizontalSegments = marriage.points
    .slice(1)
    .map((point, index) => [marriage.points[index], point])
    .filter(([a, b]) => Math.abs(a.y - b.y) < 0.5);
  const loweredHorizontal = horizontalSegments[horizontalSegments.length - 1];
  assert.ok(loweredHorizontal, "missing lowered horizontal marriage segment");
  const [a, b] = loweredHorizontal;
  assert.ok(Math.abs(parentDrop.points[0].x - (a.x + b.x) / 2) < 0.5);
  assert.ok(Math.abs(parentDrop.points[0].y - a.y) < 0.5);
  assert.ok(parentDrop.points[1].y - parentDrop.points[0].y >= NODE_SIZE * 0.45);

  const proband = findNode(result, "proband");
  const son = findNode(result, "son");
  assert.ok(son.y - proband.y > GENERATION_GAP);
});

test("normal spouse sibling stays outside source sibling row occupancy", () => {
  const result = buildLayout({
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "olderBrother", sex: "M", birthOrder: 0 },
      { id: "proband", sex: "M", birthOrder: 1 },
      { id: "youngerBrother", sex: "M", birthOrder: 2 },
      { id: "youngestBrother", sex: "M", birthOrder: 3 },
      { id: "spouseFather", sex: "M" },
      { id: "spouseMother", sex: "F" },
      { id: "spouse", sex: "F", birthOrder: 0 },
      { id: "spouseSister", sex: "F", birthOrder: 1 },
      { id: "son", sex: "M", birthOrder: 0 }
    ],
    unions: [
      { id: "parents", partners: ["father", "mother"] },
      { id: "spouseParents", partners: ["spouseFather", "spouseMother"] },
      { id: "marriage", partners: ["proband", "spouse"] }
    ],
    childrenMap: [
      ["parents", ["olderBrother", "proband", "youngerBrother", "youngestBrother"]],
      ["spouseParents", ["spouse", "spouseSister"]],
      ["marriage", ["son"]]
    ]
  });

  assertNoNodeOverlaps(result);
  assertChildrenShareSiblingLine(result, ["olderBrother", "proband", "youngerBrother", "youngestBrother"]);

  const olderBrother = findNode(result, "olderBrother");
  const proband = findNode(result, "proband");
  const youngerBrother = findNode(result, "youngerBrother");
  const youngestBrother = findNode(result, "youngestBrother");
  const spouse = findNode(result, "spouse");
  const spouseSister = findNode(result, "spouseSister");

  const sourceSiblingXs = [olderBrother.x, proband.x, youngerBrother.x, youngestBrother.x];
  const sourceGaps = sourceSiblingXs.slice(1).map((x, index) => x - sourceSiblingXs[index]);
  assert.ok(Math.max(...sourceGaps) - Math.min(...sourceGaps) < NODE_SIZE * 0.15);
  assert.ok(spouse.x > youngestBrother.x);
  assert.ok(spouseSister.x > spouse.x);
});

test("normal single-parent family keeps one child below parent", () => {
  const result = buildLayout({
    persons: [
      { id: "parent", sex: "F" },
      { id: "child", sex: "U", birthOrder: 0 }
    ],
    unions: [
      { id: "singleParent", partners: ["parent"] }
    ],
    childrenMap: [
      ["singleParent", ["child"]]
    ]
  });

  assertNoNodeOverlaps(result);
  assertChildHasVerticalSegmentToNode(result, "child");
  assertGenerationOrder(result, ["parent"], ["child"]);
  assertUnionHasCompleteProvenance(result, "singleParent", {
    parentIds: ["parent"],
    childIds: ["child"],
    hasMarriage: false
  });

  const parent = findNode(result, "parent");
  const child = findNode(result, "child");
  assert.ok(Math.abs(parent.x - child.x) < 0.5);
});

test("normal two-parent two-child family preserves child order", () => {
  const result = buildLayout({
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "son", sex: "M", birthOrder: 0 },
      { id: "daughter", sex: "F", birthOrder: 1 }
    ],
    unions: [
      { id: "parents", partners: ["father", "mother"] }
    ],
    childrenMap: [
      ["parents", ["daughter", "son"]]
    ]
  });

  assertNoNodeOverlaps(result);
  assertMarriageSegmentConnects(result, "father", "mother");
  assertChildrenShareSiblingLine(result, ["son", "daughter"]);
  assertChildHasVerticalSegmentToNode(result, "son");
  assertChildHasVerticalSegmentToNode(result, "daughter");
  assertGenerationOrder(result, ["father", "mother"], ["son", "daughter"]);

  const son = findNode(result, "son");
  const daughter = findNode(result, "daughter");
  assert.ok(son.x < daughter.x);
});

test("normal married child without children remains a compact spouse union", () => {
  const result = buildLayout({
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "child", sex: "U", birthOrder: 0 },
      { id: "spouse", sex: "U" }
    ],
    unions: [
      { id: "parents", partners: ["father", "mother"] },
      { id: "marriage", partners: ["child", "spouse"] }
    ],
    childrenMap: [
      ["parents", ["child"]],
      ["marriage", []]
    ]
  });

  assertNoNodeOverlaps(result);
  assertMarriageSegmentConnects(result, "father", "mother");
  assertMarriageSegmentConnects(result, "child", "spouse");
  assertGenerationOrder(result, ["father", "mother"], ["child", "spouse"]);

  const child = findNode(result, "child");
  const spouse = findNode(result, "spouse");
  assert.ok(Math.abs(Math.abs(child.x - spouse.x) - BRANCHED_MARRIAGE_GAP) < 0.5);
  assert.equal(result.relationshipSegments.some((segment) => segment.unionId === "marriage" && segment.kind === "parent-drop"), false);
});

test("normal local spouse of an origin sibling stays adjacent by couple order", () => {
  const result = buildLayout({
    persons: [
      { id: "father", sex: "M" },
      { id: "mother", sex: "F" },
      { id: "proband", sex: "M", birthOrder: 1 },
      { id: "brother1", sex: "M", birthOrder: 0 },
      { id: "brother2", sex: "M", birthOrder: 2 },
      { id: "brother3", sex: "M", birthOrder: 3 },
      { id: "spouseFather", sex: "M" },
      { id: "spouseMother", sex: "F" },
      { id: "spouse", sex: "F", birthOrder: 0 },
      { id: "spouseSister", sex: "F", birthOrder: 1 },
      { id: "sisterHusband", sex: "M" },
      { id: "son", sex: "M", birthOrder: 0 },
      { id: "daughter", sex: "F", birthOrder: 1 },
      { id: "sisterSon", sex: "M", birthOrder: 0 }
    ],
    unions: [
      { id: "sourceParents", partners: ["father", "mother"] },
      { id: "spouseParents", partners: ["spouseFather", "spouseMother"] },
      { id: "probandMarriage", partners: ["proband", "spouse"] },
      { id: "sisterMarriage", partners: ["sisterHusband", "spouseSister"] }
    ],
    childrenMap: [
      ["sourceParents", ["brother1", "proband", "brother2", "brother3"]],
      ["spouseParents", ["spouse", "spouseSister"]],
      ["probandMarriage", ["son", "daughter"]],
      ["sisterMarriage", ["sisterSon"]]
    ]
  });

  assertNoNodeOverlaps(result);
  assertMarriageSegmentConnects(result, "spouseSister", "sisterHusband");

  const spouse = findNode(result, "spouse");
  const spouseSister = findNode(result, "spouseSister");
  const sisterHusband = findNode(result, "sisterHusband");
  const sisterMarriage = result.relationshipSegments.find((segment) =>
    segment.unionId === "sisterMarriage" && segment.kind === "marriage"
  );

  assert.ok(sisterHusband.x < spouseSister.x);
  assert.ok(sisterHusband.x - spouse.x >= PERSON_GAP - 0.5);
  assert.equal(sisterMarriage?.points.length, 2);
});

test("normal marriage between two origin-family children separates first-generation parents", () => {
  const result = buildLayout({
    persons: [
      { id: "fatherFather", sex: "M" },
      { id: "fatherMother", sex: "F" },
      { id: "motherFather", sex: "M" },
      { id: "motherMother", sex: "F" },
      { id: "father", sex: "M", birthOrder: 0 },
      { id: "mother", sex: "F", birthOrder: 0 }
    ],
    unions: [
      { id: "fatherParents", partners: ["fatherFather", "fatherMother"] },
      { id: "motherParents", partners: ["motherFather", "motherMother"] },
      { id: "marriage", partners: ["father", "mother"] }
    ],
    childrenMap: [
      ["fatherParents", ["father"]],
      ["motherParents", ["mother"]],
      ["marriage", []]
    ]
  });

  assertNoNodeOverlaps(result);
  assertMarriageSegmentConnects(result, "father", "mother");
  assertMarriageSegmentConnects(result, "fatherFather", "fatherMother");
  assertMarriageSegmentConnects(result, "motherFather", "motherMother");
  assertGenerationOrder(result, ["fatherFather", "fatherMother", "motherFather", "motherMother"], ["father", "mother"]);

  const father = findNode(result, "father");
  const mother = findNode(result, "mother");
  const fatherMother = findNode(result, "fatherMother");
  const motherFather = findNode(result, "motherFather");
  const sourceFamilyInnerEdgeGap = Math.abs(fatherMother.x - motherFather.x) - NODE_SIZE;
  assert.ok(Math.abs(Math.abs(father.x - mother.x) - DUAL_ORIGIN_MARRIAGE_GAP) < 0.5);
  assert.ok(sourceFamilyInnerEdgeGap >= NODE_SIZE * 0.4);
});

test("normal remarriage with one child in each union keeps half-siblings separated", () => {
  const result = buildLayout({
    persons: [
      { id: "parent", sex: "U" },
      { id: "firstSpouse", sex: "U" },
      { id: "secondSpouse", sex: "U" },
      { id: "olderChild", sex: "U", birthOrder: 0 },
      { id: "youngerChild", sex: "U", birthOrder: 1 }
    ],
    unions: [
      { id: "firstMarriage", partners: ["firstSpouse", "parent"] },
      { id: "secondMarriage", partners: ["parent", "secondSpouse"] }
    ],
    childrenMap: [
      ["firstMarriage", ["olderChild"]],
      ["secondMarriage", ["youngerChild"]]
    ]
  });

  assertNoNodeOverlaps(result);
  assertMarriageSegmentConnects(result, "firstSpouse", "parent");
  assertMarriageSegmentConnects(result, "parent", "secondSpouse");
  assertChildHasVerticalSegmentToNode(result, "olderChild");
  assertChildHasVerticalSegmentToNode(result, "youngerChild");
  assertGenerationOrder(result, ["parent", "firstSpouse", "secondSpouse"], ["olderChild", "youngerChild"]);
  assertUnionHasCompleteProvenance(result, "firstMarriage", {
    parentIds: ["firstSpouse", "parent"],
    childIds: ["olderChild"]
  });
  assertUnionHasCompleteProvenance(result, "secondMarriage", {
    parentIds: ["parent", "secondSpouse"],
    childIds: ["youngerChild"]
  });

  const firstDrop = findParentDropForUnion(result, "firstMarriage");
  const secondDrop = findParentDropForUnion(result, "secondMarriage");
  assert.notEqual(firstDrop.points[0].x, secondDrop.points[0].x);
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

function assertSingleChildUsesPointSiblingLine(layout: LayoutResult, unionId: string, childId: string) {
  const parentDrop = findParentDropForUnion(layout, unionId);
  const sibling = layout.relationshipSegments.find((segment) =>
    segment.unionId === unionId && segment.kind === "sibling-line"
  );
  const childDrop = layout.relationshipSegments.find((segment) =>
    segment.unionId === unionId && segment.kind === "child-drop" && segment.personId === childId
  );
  const child = findNode(layout, childId);
  assert.ok(sibling, `missing point sibling-line for ${unionId}`);
  assert.ok(childDrop, `missing child-drop for ${childId}`);
  const parentDropEnd = parentDrop.points[parentDrop.points.length - 1];
  const [siblingStart, siblingEnd] = sibling.points;
  assert.ok(Math.abs(siblingStart.x - siblingEnd.x) < 0.5);
  assert.ok(Math.abs(siblingStart.y - siblingEnd.y) < 0.5);
  assert.ok(Math.abs(parentDropEnd.x - siblingStart.x) < 0.5);
  assert.ok(Math.abs(parentDropEnd.y - siblingStart.y) < 0.5);
  assert.ok(Math.abs(childDrop.points[0].x - siblingStart.x) < 0.5);
  assert.ok(Math.abs(childDrop.points[0].y - siblingStart.y) < 0.5);
  assert.ok(Math.abs(childDrop.points[1].x - child.x) < 0.5);
  assert.ok(Math.abs(childDrop.points[1].y - child.y) < 0.5);
}
