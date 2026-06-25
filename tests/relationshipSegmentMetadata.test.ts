import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/browser/entry";
import { LayoutInput, LayoutResult } from "../src/model/layoutResult";
import { renderLayoutResultToSvg } from "../src/render/svgRenderer";
import {
  complexKnownProblemFamily,
  halfSiblingsThroughMultipleUnions,
  multiChildSiblingGroup,
  simpleNuclearFamily,
  spouseWithOriginFamily
} from "./fixtures/complexPedigrees";
import {
  assertNoSegmentMixesUnrelatedUnions,
  assertSegmentBelongsToUnion,
  assertUnionHasCompleteProvenance,
  findChildDropForPerson,
  findMarriageSegmentForUnion,
  findParentDropForUnion,
  findSegmentsForUnion,
  findSiblingLineForUnion
} from "./helpers/layoutAssertions";

test("simple nuclear family segments include provenance metadata", () => {
  const result = buildLayout(simpleNuclearFamily.input);

  const marriage = findMarriageSegmentForUnion(result, "uAB");
  assert.deepEqual(marriage.partnerIds, ["A", "B"]);
  assert.deepEqual(marriage.parentIds, ["A", "B"]);
  assert.equal(marriage.source?.unionId, "uAB");

  const parentDrop = findParentDropForUnion(result, "uAB");
  assert.deepEqual(parentDrop.parentIds, ["A", "B"]);
  assert.deepEqual(parentDrop.childIds, ["C"]);

  const childDrop = findChildDropForPerson(result, "C");
  assertSegmentBelongsToUnion(childDrop, "uAB");
  assert.deepEqual(childDrop.childIds, ["C"]);
  assert.equal(childDrop.personId, "C");

  assertUnionHasCompleteProvenance(result, "uAB", {
    parentIds: ["A", "B"],
    childIds: ["C"]
  });
});

test("multi-child sibling group segments preserve child provenance", () => {
  const result = buildLayout(multiChildSiblingGroup.input);

  const siblingLine = findSiblingLineForUnion(result, "uAB");
  assert.deepEqual(siblingLine.childIds, ["C", "D", "E"]);
  for (const childId of ["C", "D", "E"]) {
    const childDrop = findChildDropForPerson(result, childId);
    assertSegmentBelongsToUnion(childDrop, "uAB");
    assert.deepEqual(childDrop.childIds, [childId]);
  }
  assertUnionHasCompleteProvenance(result, "uAB", {
    parentIds: ["A", "B"],
    childIds: ["C", "D", "E"]
  });
});

test("half siblings metadata remains separated by union", () => {
  const result = buildLayout(halfSiblingsThroughMultipleUnions.input);

  assertSegmentBelongsToUnion(findChildDropForPerson(result, "C"), "uAB");
  assertSegmentBelongsToUnion(findChildDropForPerson(result, "E"), "uAD");
  assertUnionHasCompleteProvenance(result, "uAB", {
    parentIds: ["A", "B"],
    childIds: ["C"]
  });
  assertUnionHasCompleteProvenance(result, "uAD", {
    parentIds: ["A", "D"],
    childIds: ["E"]
  });
  assertNoSegmentMixesUnrelatedUnions(result, "uAB", "uAD");
});

test("spouse origin family metadata stays separate from core family", () => {
  const result = buildLayout(spouseWithOriginFamily.input);

  assertSegmentBelongsToUnion(findParentDropForUnion(result, "uPQ"), "uPQ");
  assertSegmentBelongsToUnion(findParentDropForUnion(result, "uAB"), "uAB");
  assertSegmentBelongsToUnion(findChildDropForPerson(result, "B"), "uPQ");
  assertSegmentBelongsToUnion(findChildDropForPerson(result, "C"), "uAB");
  assertNoSegmentMixesUnrelatedUnions(result, "uPQ", "uAB");

  assertUnionHasCompleteProvenance(result, "uPQ", {
    parentIds: ["P", "Q"],
    childIds: ["B"]
  });
  assertUnionHasCompleteProvenance(result, "uAB", {
    parentIds: ["A", "B"],
    childIds: ["C"]
  });
  assertParentDropStaysWithinSourceParents(result, "uPQ", ["P", "Q"], ["B"]);
  assertCoreUnionDoesNotMixOriginParents(result, "uAB", ["P", "Q"]);
});

test("complex spouse-origin parent drops stay within source family groups", () => {
  const result = buildLayout(complexKnownProblemFamily.input);

  assertParentDropStaysWithinSourceParents(result, "uA", ["A1", "A2"], ["K1", "K2"]);
  assertParentDropStaysWithinSourceParents(result, "uB", ["B1", "B2"], ["S1"]);
  assertParentDropStaysWithinSourceParents(result, "uC", ["C1", "C2"], ["S2"]);
  assertParentDropStaysWithinSourceParents(result, "uK1S1", ["K1", "S1"], ["G1"]);
  assertCoreUnionDoesNotMixOriginParents(result, "uK1S1", ["A1", "A2", "B1", "B2"]);
  assertCoreUnionDoesNotMixOriginParents(result, "uK2S2", ["A1", "A2", "C1", "C2"]);
});

test("SVG renderer emits relationship segment data attributes", () => {
  const result = buildLayout(simpleNuclearFamily.input);
  const svg = renderLayoutResultToSvg(result);

  assert.match(svg, /data-kind="marriage"/);
  assert.match(svg, /data-kind="parent-drop"/);
  assert.match(svg, /data-union-id="uAB"/);
  assert.match(svg, /data-person-id="C"/);
});

test("segments for a union do not mix child provenance", () => {
  const result = buildLayout(multiChildSiblingGroup.input);
  for (const segment of findSegmentsForUnion(result, "uAB")) {
    assert.equal(segment.source?.unionId ?? segment.unionId, "uAB");
  }
});

function buildLayout(input: LayoutInput): LayoutResult {
  const response = layout(input);
  assert.ok(response.ok);
  return response.layout;
}

function assertParentDropStaysWithinSourceParents(
  result: LayoutResult,
  unionId: string,
  parentIds: string[],
  childIds: string[]
) {
  const parentDrop = findParentDropForUnion(result, unionId);
  assertSegmentBelongsToUnion(parentDrop, unionId);
  assert.deepEqual([...(parentDrop.parentIds ?? [])].sort(), [...parentIds].sort());
  assert.deepEqual([...(parentDrop.childIds ?? [])].sort(), [...childIds].sort());
  const parentXs = parentIds.map((personId) => nodeX(result, personId));
  const dropX = parentDrop.points[0]?.x;
  assert.equal(typeof dropX, "number", `missing parent-drop x for ${unionId}`);
  assert.ok(dropX >= Math.min(...parentXs) - 1, `${unionId} parent drop exits left of source parents`);
  assert.ok(dropX <= Math.max(...parentXs) + 1, `${unionId} parent drop exits right of source parents`);
}

function assertCoreUnionDoesNotMixOriginParents(
  result: LayoutResult,
  coreUnionId: string,
  originParentIds: string[]
) {
  for (const segment of findSegmentsForUnion(result, coreUnionId)) {
    for (const parentId of originParentIds) {
      assert.equal(segment.parentIds?.includes(parentId) ?? false, false, `${segment.id} parentIds mixes ${parentId}`);
      assert.equal(segment.childIds?.includes(parentId) ?? false, false, `${segment.id} childIds mixes ${parentId}`);
      assert.equal(segment.source?.parentIds?.includes(parentId) ?? false, false, `${segment.id} source.parentIds mixes ${parentId}`);
      assert.equal(segment.source?.childIds?.includes(parentId) ?? false, false, `${segment.id} source.childIds mixes ${parentId}`);
    }
  }
}

function nodeX(result: LayoutResult, personId: string): number {
  const node = result.nodes.find((candidate) => candidate.id === personId);
  assert.ok(node, `missing node ${personId}`);
  return node.x;
}
