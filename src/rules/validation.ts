import { PedigreeGraph } from "../model/pedigreeGraph";
import { GENERATION_GAP, NODE_SIZE } from "../layout/boxModel";
import { OriginLink } from "../layout/familyForest";

export class GraphValidationError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "GraphValidationError";
    this.code = code;
    this.details = details;
  }
}

export function validateGraph(graph: PedigreeGraph): PedigreeGraph {
  const personIds = validatePersonIds(graph);
  validateUnions(graph, personIds);
  validateChildrenMap(graph, personIds);
  validateAcyclicParentage(graph);

  return graph;
}

function validatePersonIds(graph: PedigreeGraph): Set<string> {
  const personIds = new Set<string>();
  for (const [personId, person] of graph.persons.entries()) {
    if (!personId) {
      fail("GRAPH_PERSON_ID_EMPTY", "person id must be non-empty", { personId });
    }
    if (!person.id) {
      fail("GRAPH_PERSON_ID_EMPTY", `person stored at ${personId} has an empty id`, { personId, person });
    }
    if (person.id !== personId) {
      fail(
        "GRAPH_PERSON_ID_MISMATCH",
        `person map key ${personId} does not match person id ${person.id}`,
        { personId, person }
      );
    }
    if (personIds.has(person.id)) {
      fail("GRAPH_PERSON_ID_DUPLICATE", `duplicate person id ${person.id}`, { personId: person.id });
    }
    personIds.add(person.id);
  }
  return personIds;
}

function validateUnions(graph: PedigreeGraph, personIds: Set<string>) {
  const unionIds = new Set<string>();
  for (const [unionId, union] of graph.unions.entries()) {
    if (!unionId) {
      fail("GRAPH_UNION_ID_EMPTY", "union id must be non-empty", { unionId });
    }
    if (!union.id) {
      fail("GRAPH_UNION_ID_EMPTY", `union stored at ${unionId} has an empty id`, { unionId, union });
    }
    if (union.id !== unionId) {
      fail(
        "GRAPH_UNION_ID_MISMATCH",
        `union map key ${unionId} does not match union id ${union.id}`,
        { unionId, union }
      );
    }
    if (unionIds.has(union.id)) {
      fail("GRAPH_UNION_ID_DUPLICATE", `duplicate union id ${union.id}`, { unionId: union.id });
    }
    unionIds.add(union.id);

    const partners: readonly string[] = union.partners;
    if (partners.length !== 1 && partners.length !== 2) {
      fail(
        "GRAPH_UNION_PARTNER_COUNT",
        `union ${union.id} must have 1 or 2 partners, got ${partners.length}`,
        { unionId: union.id, partners }
      );
    }

    const seenPartners = new Set<string>();
    for (const partnerId of partners) {
      if (!personIds.has(partnerId)) {
        fail(
          "GRAPH_UNION_PARTNER_MISSING",
          `union ${union.id} references missing partner ${partnerId}`,
          { unionId: union.id, partnerId }
        );
      }
      if (seenPartners.has(partnerId)) {
        fail(
          "GRAPH_UNION_PARTNER_DUPLICATE",
          `union ${union.id} lists partner ${partnerId} more than once`,
          { unionId: union.id, partnerId }
        );
      }
      seenPartners.add(partnerId);
    }
  }
}

function validateChildrenMap(graph: PedigreeGraph, personIds: Set<string>) {
  const childParentUnion = new Map<string, string>();
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    if (!graph.unions.has(unionId)) {
      fail(
        "GRAPH_CHILDREN_UNION_MISSING",
        `childrenMap references missing union ${unionId}`,
        { unionId, childIds }
      );
    }

    for (const childId of childIds) {
      if (!personIds.has(childId)) {
        fail(
          "GRAPH_CHILD_MISSING",
          `childrenMap for union ${unionId} references missing child ${childId}`,
          { unionId, childId }
        );
      }

      const previousUnion = childParentUnion.get(childId);
      if (previousUnion && previousUnion !== unionId) {
        fail(
          "GRAPH_CHILD_MULTIPLE_PARENT_UNIONS",
          `child ${childId} belongs to multiple parent unions: ${previousUnion} and ${unionId}`,
          { childId, previousUnionId: previousUnion, unionId }
        );
      }
      if (previousUnion === unionId) {
        fail(
          "GRAPH_CHILD_DUPLICATE_IN_UNION",
          `child ${childId} appears more than once in childrenMap for union ${unionId}`,
          { childId, unionId }
        );
      }
      childParentUnion.set(childId, unionId);
    }
  }
}

function validateAcyclicParentage(graph: PedigreeGraph) {
  const childIdsByParent = new Map<string, string[]>();

  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    const union = graph.unions.get(unionId);
    if (!union) continue;
    for (const parentId of union.partners) {
      for (const childId of childIds) {
        if (parentId === childId) {
          fail(
            "GRAPH_SELF_PARENTAGE",
            `person ${parentId} cannot be their own parent or child`,
            { personId: parentId, unionId }
          );
        }
        if (!childIdsByParent.has(parentId)) childIdsByParent.set(parentId, []);
        childIdsByParent.get(parentId)?.push(childId);
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  const visit = (personId: string) => {
    if (visiting.has(personId)) {
      const cycleStart = path.indexOf(personId);
      const cycle = [...path.slice(cycleStart), personId];
      fail(
        "GRAPH_PARENT_CHILD_CYCLE",
        `parent-child cycle detected: ${cycle.join(" -> ")}`,
        { cycle }
      );
    }
    if (visited.has(personId)) return;

    visiting.add(personId);
    path.push(personId);
    for (const childId of childIdsByParent.get(personId) ?? []) {
      visit(childId);
    }
    path.pop();
    visiting.delete(personId);
    visited.add(personId);
  };

  for (const personId of graph.persons.keys()) {
    visit(personId);
  }
}

function fail(code: string, message: string, details?: unknown): never {
  throw new GraphValidationError(code, message, details);
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
