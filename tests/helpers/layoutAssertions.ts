import assert from "node:assert/strict";
import { NODE_SIZE } from "../../src/layout/boxModel";
import { LayoutNode, LayoutResult, RelationshipSegment, RelationshipSegmentKind } from "../../src/model/layoutResult";

const TOLERANCE = 0.5;

export function findNode(layout: LayoutResult, id: string): LayoutNode {
  const node = layout.nodes.find((candidate) => candidate.id === id);
  assert.ok(node, `missing node ${id}`);
  return node;
}

export function findSegmentsByKind(
  layout: LayoutResult,
  kind: RelationshipSegment["type"] | RelationshipSegmentKind
): RelationshipSegment[] {
  return layout.relationshipSegments.filter((segment) => segment.type === kind || segment.kind === kind);
}

export function findSegmentsForUnion(layout: LayoutResult, unionId: string): RelationshipSegment[] {
  return layout.relationshipSegments.filter((segment) => segment.unionId === unionId);
}

export function findSegmentsForPerson(layout: LayoutResult, personId: string): RelationshipSegment[] {
  return layout.relationshipSegments.filter((segment) =>
    segment.personId === personId ||
    segment.childIds?.includes(personId) ||
    segment.partnerIds?.includes(personId) ||
    segment.parentIds?.includes(personId) ||
    segment.source?.personIds?.includes(personId)
  );
}

export function findMarriageSegmentForUnion(layout: LayoutResult, unionId: string): RelationshipSegment {
  const segment = findSegmentsForUnion(layout, unionId).find((candidate) => candidate.kind === "marriage");
  assert.ok(segment, `missing marriage segment for union ${unionId}`);
  return segment;
}

export function findParentDropForUnion(layout: LayoutResult, unionId: string): RelationshipSegment {
  const segment = findSegmentsForUnion(layout, unionId).find((candidate) => candidate.kind === "parent-drop");
  assert.ok(segment, `missing parent-drop segment for union ${unionId}`);
  return segment;
}

export function findSiblingLineForUnion(layout: LayoutResult, unionId: string): RelationshipSegment {
  const segment = findSegmentsForUnion(layout, unionId).find((candidate) => candidate.kind === "sibling-line");
  assert.ok(segment, `missing sibling-line segment for union ${unionId}`);
  return segment;
}

export function findChildDropForPerson(layout: LayoutResult, personId: string): RelationshipSegment {
  const segment = layout.relationshipSegments.find((candidate) =>
    (candidate.kind === "child-drop" || candidate.kind === "twin") && candidate.personId === personId
  );
  assert.ok(segment, `missing child-drop segment for person ${personId}`);
  return segment;
}

export function assertSegmentBelongsToUnion(segment: RelationshipSegment, unionId: string) {
  assert.equal(segment.unionId, unionId, `expected segment ${segment.id} to belong to union ${unionId}`);
  assert.equal(segment.source?.unionId ?? segment.unionId, unionId, `expected segment ${segment.id} source to belong to union ${unionId}`);
}

export function assertSegmentDoesNotBelongToUnion(segment: RelationshipSegment, unionId: string) {
  assert.notEqual(segment.unionId, unionId, `expected segment ${segment.id} not to belong to union ${unionId}`);
  assert.notEqual(segment.source?.unionId, unionId, `expected segment ${segment.id} source not to belong to union ${unionId}`);
}

export function assertUnionHasCompleteProvenance(
  layout: LayoutResult,
  unionId: string,
  expected: { parentIds: string[]; childIds: string[]; hasMarriage?: boolean }
) {
  const unionSegments = findSegmentsForUnion(layout, unionId);
  assert.ok(unionSegments.length > 0, `missing segments for union ${unionId}`);
  if (expected.hasMarriage !== false && expected.parentIds.length === 2) {
    const marriage = findMarriageSegmentForUnion(layout, unionId);
    assertSameMembers(marriage.partnerIds, expected.parentIds, `marriage partnerIds for ${unionId}`);
    assertSameMembers(marriage.parentIds, expected.parentIds, `marriage parentIds for ${unionId}`);
  }

  if (expected.childIds.length > 0) {
    const parentDrop = findParentDropForUnion(layout, unionId);
    assertSameMembers(parentDrop.parentIds, expected.parentIds, `parent-drop parentIds for ${unionId}`);
    assertSameMembers(parentDrop.childIds, expected.childIds, `parent-drop childIds for ${unionId}`);
  }

  const sibling = unionSegments.find((segment) => segment.kind === "sibling-line");
  if (sibling) assertSameMembers(sibling.childIds, expected.childIds, `sibling-line childIds for ${unionId}`);

  for (const childId of expected.childIds) {
    const childDrop = findChildDropForPerson(layout, childId);
    assertSegmentBelongsToUnion(childDrop, unionId);
    assertSameMembers(childDrop.childIds, [childId], `child-drop childIds for ${childId}`);
  }
}

export function assertNoSegmentMixesUnrelatedUnions(layout: LayoutResult, unionA: string, unionB: string) {
  for (const segment of findSegmentsForUnion(layout, unionA)) {
    assertSegmentDoesNotBelongToUnion(segment, unionB);
  }
  for (const segment of findSegmentsForUnion(layout, unionB)) {
    assertSegmentDoesNotBelongToUnion(segment, unionA);
  }
}

export function assertNoNodeOverlaps(layout: LayoutResult, tolerance = TOLERANCE) {
  for (let i = 0; i < layout.nodes.length; i++) {
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const a = layout.nodes[i];
      const b = layout.nodes[j];
      if (Math.abs(a.y - b.y) >= tolerance) continue;
      assert.ok(
        Math.abs(a.x - b.x) >= NODE_SIZE - tolerance,
        `nodes ${a.id} and ${b.id} overlap on generation ${a.generation}`
      );
    }
  }
}

export function assertGenerationOrder(layout: LayoutResult, olderIds: string[], youngerIds: string[]) {
  for (const olderId of olderIds) {
    for (const youngerId of youngerIds) {
      const older = findNode(layout, olderId);
      const younger = findNode(layout, youngerId);
      assert.ok(
        older.y < younger.y - TOLERANCE,
        `expected ${olderId} to be above ${youngerId}`
      );
      assert.ok(
        older.generation < younger.generation,
        `expected ${olderId} generation to precede ${youngerId}`
      );
    }
  }
}

export function assertMarriageSegmentConnects(layout: LayoutResult, leftId: string, rightId: string) {
  const left = findNode(layout, leftId);
  const right = findNode(layout, rightId);
  const segment = findSegmentsByKind(layout, "marriage").find((candidate) =>
    pointNearNode(candidate.points[0], left) && pointNearNode(candidate.points[candidate.points.length - 1], right) ||
    pointNearNode(candidate.points[0], right) && pointNearNode(candidate.points[candidate.points.length - 1], left)
  );
  assert.ok(segment, `missing marriage segment between ${leftId} and ${rightId}`);
}

export function assertChildHasVerticalSegmentToNode(layout: LayoutResult, childId: string) {
  const child = findNode(layout, childId);
  const segment = findSegmentsByKind(layout, "individual").find((candidate) => {
    if (candidate.personId !== childId) return false;
    const end = candidate.points[candidate.points.length - 1];
    return Math.abs(end.x - child.x) <= TOLERANCE && Math.abs(end.y - child.y) <= TOLERANCE;
  });
  assert.ok(segment, `missing individual child segment ending at ${childId}`);
}

export function assertChildrenShareSiblingLine(layout: LayoutResult, childIds: string[]) {
  const unionIds = childIds.map((childId) => individualUnionId(layout, childId));
  assert.equal(new Set(unionIds).size, 1, `children ${childIds.join(", ")} do not share one parent union`);
  const unionId = unionIds[0];
  const siblingSegments = findSegmentsByKind(layout, "sibling").filter((segment) => segment.unionId === unionId);
  assert.equal(siblingSegments.length, 1, `expected one sibling line for union ${unionId}`);
}

export function assertChildrenDoNotShareSiblingLine(layout: LayoutResult, childGroupA: string[], childGroupB: string[]) {
  const groupAUnionIds = new Set(childGroupA.map((childId) => individualUnionId(layout, childId)));
  const groupBUnionIds = new Set(childGroupB.map((childId) => individualUnionId(layout, childId)));
  for (const unionId of groupAUnionIds) {
    assert.equal(groupBUnionIds.has(unionId), false, `expected child groups to use different sibling unions`);
  }
}

export function assertNodeUsesFinalCoordinate(
  layout: LayoutResult,
  personId: string,
  expected: { x: number; y: number }
) {
  const node = findNode(layout, personId);
  assert.ok(Math.abs(node.x - expected.x) <= TOLERANCE, `${personId} x does not match final coordinate`);
  assert.ok(Math.abs(node.y - expected.y) <= TOLERANCE, `${personId} y does not match final coordinate`);
}

export function assertUnionSegmentsAreSeparate(layout: LayoutResult, unionIds: string[]) {
  for (const unionId of unionIds) {
    assert.ok(
      layout.relationshipSegments.some((segment) => segment.unionId === unionId),
      `missing relationship segments for union ${unionId}`
    );
  }
  assert.equal(new Set(unionIds).size, unionIds.length, "fixture expected distinct union ids");
}

function individualUnionId(layout: LayoutResult, childId: string): string {
  const segment = findChildDropForPerson(layout, childId);
  assert.ok(segment?.unionId, `missing individual segment union id for child ${childId}`);
  return segment.unionId;
}

function assertSameMembers(actual: string[] | undefined, expected: string[], label: string) {
  assert.deepEqual([...(actual ?? [])].sort(), [...expected].sort(), label);
}

function pointNearNode(point: { x: number; y: number } | undefined, node: LayoutNode) {
  if (!point) return false;
  return Math.abs(point.y - node.y) <= TOLERANCE &&
    Math.abs(point.x - node.x) <= TOLERANCE;
}
