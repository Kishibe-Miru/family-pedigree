import { PedigreeGraph } from "../model/pedigreeGraph";
import { GENERATION_GAP, NODE_SIZE } from "../layout/boxModel";
import { OriginLink } from "../layout/familyForest";

export function validateGraph(graph: PedigreeGraph) {
  return graph;
}

export function assertLayoutInvariants(graph: PedigreeGraph, originLinks: OriginLink[] = []) {
  assertParentDropCenteredOverChildren(graph, originLinks);
  assertOriginLinks(graph, originLinks);
  assertSiblingLinesUseOneUnion(graph);
  assertSiblingBirthOrder(graph);
  assertGenerationYConsistency(graph);
  assertNoSymbolOverlap(graph);
  assertMarriageLineEndpoints(graph);
}

function assertOriginLinks(graph: PedigreeGraph, originLinks: OriginLink[]) {
  for (const link of originLinks) {
    const shared = graph.persons.get(link.sharedPersonId);
    const parentUnion = parentUnionForChild(graph, link.sharedPersonId);
    if (!shared || !parentUnion || !Number.isFinite(shared.x)) {
      throw new Error(`layout invariant failed: origin spouse drift for ${link.sharedPersonId}`);
    }

    const parentMid = parentDropX(graph, parentUnion);
    if (parentMid == null || Math.abs((shared.x ?? 0) - parentMid) >= 0.5) {
      throw new Error(`layout invariant failed: origin spouse drift for ${link.sharedPersonId}`);
    }

    const parentGenerations = parentUnion.partners
      .map((partnerId) => graph.persons.get(partnerId)?.generation)
      .filter((generation): generation is number => generation != null);
    const expectedGeneration = parentGenerations.length ? Math.max(...parentGenerations) + 1 : undefined;
    if (expectedGeneration == null || shared.generation !== expectedGeneration) {
      throw new Error(`layout invariant failed: origin spouse drift for ${link.sharedPersonId}`);
    }
  }
}

function assertSiblingBirthOrder(graph: PedigreeGraph) {
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    const placedChildren = childIds.filter((childId) => {
      const child = graph.persons.get(childId);
      return Number.isFinite(child?.x);
    });
    if (placedChildren.length < 2) continue;

    const expected = sortChildrenByBirthOrder(graph, placedChildren);
    const actual = [...placedChildren].sort((a, b) => {
      const left = graph.persons.get(a)?.x ?? 0;
      const right = graph.persons.get(b)?.x ?? 0;
      return left - right || a.localeCompare(b);
    });

    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== actual[i]) {
        throw new Error(`layout invariant failed: sibling birth order violated for ${unionId}`);
      }
    }
  }
}

function sortChildrenByBirthOrder(graph: PedigreeGraph, childIds: string[]) {
  return [...childIds].sort((a, b) => {
    const left = graph.persons.get(a)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
    const right = graph.persons.get(b)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
    return left - right || a.localeCompare(b);
  });
}

function assertSiblingLinesUseOneUnion(graph: PedigreeGraph) {
  const seenChildren = new Map<string, string>();
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    for (const childId of childIds) {
      const previousUnion = seenChildren.get(childId);
      if (previousUnion && previousUnion !== unionId) {
        throw new Error(`layout invariant failed: child ${childId} appears in multiple sibling lines`);
      }
      seenChildren.set(childId, unionId);
    }
  }
}

function assertNoSymbolOverlap(graph: PedigreeGraph) {
  const people = [...graph.persons.values()].filter((person) =>
    Number.isFinite(person.x) && Number.isFinite(person.y)
  );

  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      if (Math.abs((a.y ?? 0) - (b.y ?? 0)) >= 1) continue;
      const dx = Math.abs((a.x ?? 0) - (b.x ?? 0));
      if (dx < NODE_SIZE - 0.5) {
        throw new Error(`layout invariant failed: symbol overlap ${a.id} ${b.id} dx ${dx}`);
      }
    }
  }
}

function assertGenerationYConsistency(graph: PedigreeGraph) {
  for (const person of graph.persons.values()) {
    if (!Number.isFinite(person.y)) continue;
    const generation = person.generation ?? 0;
    const expectedY = generation * GENERATION_GAP;
    if (Math.abs((person.y ?? 0) - expectedY) >= 0.5) {
      throw new Error(`layout invariant failed: generation y mismatch ${person.id}`);
    }
  }
}

function assertMarriageLineEndpoints(graph: PedigreeGraph) {
  for (const union of graph.unions.values()) {
    if (union.partners.length !== 2) continue;
    const [leftId, rightId] = union.partners;
    const left = graph.persons.get(leftId);
    const right = graph.persons.get(rightId);
    if (
      !left ||
      !right ||
      !Number.isFinite(left.x) ||
      !Number.isFinite(right.x) ||
      !Number.isFinite(left.y) ||
      !Number.isFinite(right.y) ||
      Math.abs((left.y ?? 0) - (right.y ?? 0)) >= 0.5 ||
      Math.abs((left.x ?? 0) - (right.x ?? 0)) < NODE_SIZE
    ) {
      throw new Error(`layout invariant failed: marriage endpoints for ${union.id}`);
    }
  }
}

function assertParentDropCenteredOverChildren(graph: PedigreeGraph, originLinks: OriginLink[]) {
  const originChildByParentUnion = new Map<string, string>();
  for (const link of originLinks) {
    const parentUnion = parentUnionForChild(graph, link.sharedPersonId);
    if (parentUnion) originChildByParentUnion.set(parentUnion.id, link.sharedPersonId);
  }

  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    if (childIds.length === 0) continue;
    const union = graph.unions.get(unionId);
    if (!union) continue;
    const isOriginUnion = originChildByParentUnion.has(unionId);
    const isRootUnion = union.partners.every((partnerId) => !parentUnionForChild(graph, partnerId));
    if (!isOriginUnion && !isRootUnion) continue;

    const dropX = parentDropX(graph, union);
    const originChildId = originChildByParentUnion.get(unionId);
    const childCenter = originChildId
      ? graph.persons.get(originChildId)?.x
      : childrenCenterX(graph, childIds);
    if (dropX == null || childCenter == null || Math.abs(dropX - childCenter) >= 0.5) {
      throw new Error(`layout invariant failed: parent drop not centered over children for ${unionId}`);
    }
  }
}

function parentUnionForChild(graph: PedigreeGraph, childId: string) {
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    if (!childIds.includes(childId)) continue;
    return graph.unions.get(unionId);
  }
  return undefined;
}

function parentDropX(graph: PedigreeGraph, union: { partners: readonly string[] }): number | null {
  const xs = union.partners
    .map((partnerId) => graph.persons.get(partnerId)?.x)
    .filter((x): x is number => Number.isFinite(x));
  if (xs.length === 0) return null;
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

function childrenCenterX(graph: PedigreeGraph, childIds: string[]): number | null {
  const xs = childIds
    .map((childId) => graph.persons.get(childId)?.x)
    .filter((x): x is number => Number.isFinite(x));
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  return (Math.min(...xs) + Math.max(...xs)) / 2;
}
