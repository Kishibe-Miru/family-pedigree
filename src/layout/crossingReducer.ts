import { PedigreeGraph } from "../model/pedigreeGraph";
import { UnionNode } from "../model/union";
import { sortChildrenForLayout } from "./childOrdering";
import { GenerationOrder, setGenerationOrder } from "./layoutOrder";

export function reduceCrossings(graph: PedigreeGraph) {
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    graph.childrenMap.set(unionId, sortChildren(graph, childIds));
  }

  const order = buildSeedOrder(graph);
  minimizeByMedian(graph, order);
  setGenerationOrder(graph, order);
  return graph;
}

function buildSeedOrder(graph: PedigreeGraph): GenerationOrder {
  const order: GenerationOrder = new Map();
  const seen = new Set<string>();
  const parentUnionByChild = buildParentUnionByChild(graph);
  const unionsByPartner = buildUnionsByPartner(graph);
  const rootUnions = [...graph.unions.values()]
    .filter((union) => union.partners.every((partnerId) => !parentUnionByChild.has(partnerId)))
    .sort((a, b) => unionSortKey(graph, a).localeCompare(unionSortKey(graph, b)));

  const push = (personId: string) => {
    if (seen.has(personId)) return;
    seen.add(personId);
    const generation = graph.persons.get(personId)?.generation ?? 0;
    if (!order.has(generation)) order.set(generation, []);
    order.get(generation)?.push(personId);
  };

  const visitUnion = (union: UnionNode, mainPersonId?: string) => {
    const partners = orderPartners(graph, parentUnionByChild, union, mainPersonId);
    partners.forEach(push);

    for (const childId of sortChildren(graph, graph.childrenMap.get(union.id) ?? [])) {
      const childUnions = (unionsByPartner.get(childId) ?? [])
        .filter((childUnion) => childUnion.id !== union.id)
        .sort((a, b) => unionSortKey(graph, a).localeCompare(unionSortKey(graph, b)));

      if (childUnions.length === 0) {
        push(childId);
        continue;
      }

      for (const childUnion of childUnions) {
        visitUnion(childUnion, childId);
      }
    }
  };

  rootUnions.forEach((union) => visitUnion(union));

  for (const person of graph.persons.values()) {
    push(person.id);
  }

  return order;
}

function orderPartners(
  graph: PedigreeGraph,
  parentUnionByChild: Map<string, string>,
  union: UnionNode,
  mainPersonId?: string
): string[] {
  if (!mainPersonId) return [...union.partners];
  const partner = union.partners.find((id) => id !== mainPersonId);
  if (!partner) return [mainPersonId];
  return shouldPlaceOriginLeft(graph, parentUnionByChild, mainPersonId)
    ? [partner, mainPersonId]
    : [mainPersonId, partner];
}

function shouldPlaceOriginLeft(
  graph: PedigreeGraph,
  parentUnionByChild: Map<string, string>,
  mainPersonId: string
): boolean {
  const parentUnionId = parentUnionByChild.get(mainPersonId);
  if (!parentUnionId) return false;
  const siblings = sortChildren(graph, graph.childrenMap.get(parentUnionId) ?? []);
  const index = siblings.indexOf(mainPersonId);
  if (index < 0) return false;
  return index < (siblings.length - 1) / 2;
}

function minimizeByMedian(graph: PedigreeGraph, order: GenerationOrder) {
  for (let i = 0; i < 8; i++) {
    sweep(graph, order, 1);
    enforceSiblingBirthOrder(graph, order);
    enforceSpouseAdjacencyOrder(graph, order);
    enforceOriginRootOrder(graph, order);
    sweep(graph, order, -1);
    enforceSiblingBirthOrder(graph, order);
    enforceSpouseAdjacencyOrder(graph, order);
    enforceOriginRootOrder(graph, order);
  }
  enforceSiblingBirthOrder(graph, order);
  enforceSpouseAdjacencyOrder(graph, order);
  enforceOriginRootOrder(graph, order);
}

function sweep(graph: PedigreeGraph, order: GenerationOrder, direction: 1 | -1) {
  const generations = [...order.keys()].sort((a, b) => direction * (a - b));
  const previousRankByGeneration = new Map<number, Map<string, number>>();
  for (const generation of generations) {
    const ids = order.get(generation) ?? [];
    previousRankByGeneration.set(generation, rankMap(ids));
  }

  for (const generation of generations) {
    const ids = order.get(generation);
    if (!ids) continue;
    const neighborGeneration = generation - direction;
    const neighborRank = previousRankByGeneration.get(neighborGeneration);
    if (!neighborRank) continue;

    const blocks = buildHardBlocks(graph, ids);
    blocks.sort((a, b) => {
      const left = median(neighborIndexes(graph, a.ids, neighborRank));
      const right = median(neighborIndexes(graph, b.ids, neighborRank));
      return left - right || a.index - b.index;
    });
    order.set(generation, blocks.flatMap((block) => block.ids));
  }
}

function buildHardBlocks(graph: PedigreeGraph, ids: string[]) {
  const idToIndex = new Map(ids.map((id, index) => [id, index]));
  const used = new Set<string>();
  const blocks: Array<{ ids: string[]; index: number }> = [];

  for (const id of ids) {
    if (used.has(id)) continue;
    const union = [...graph.unions.values()].find((candidate) =>
      candidate.partners.includes(id) &&
      candidate.partners.every((partnerId) => idToIndex.has(partnerId)) &&
      candidate.partners.length === 2
    );
    if (union) {
      const partners = [...union.partners].sort((a, b) => (idToIndex.get(a) ?? 0) - (idToIndex.get(b) ?? 0));
      partners.forEach((partnerId) => used.add(partnerId));
      blocks.push({ ids: partners, index: Math.min(...partners.map((partnerId) => idToIndex.get(partnerId) ?? 0)) });
    } else {
      used.add(id);
      blocks.push({ ids: [id], index: idToIndex.get(id) ?? 0 });
    }
  }

  return blocks.sort((a, b) => a.index - b.index);
}

function neighborIndexes(graph: PedigreeGraph, ids: string[], neighborRank: Map<string, number>): number[] {
  const out: number[] = [];
  const idSet = new Set(ids);

  for (const union of graph.unions.values()) {
    const partnersInBlock = union.partners.some((partnerId) => idSet.has(partnerId));
    if (partnersInBlock) {
      for (const childId of graph.childrenMap.get(union.id) ?? []) {
        const rank = neighborRank.get(childId);
        if (rank != null) out.push(rank);
      }
    }

    const childrenInBlock = (graph.childrenMap.get(union.id) ?? []).some((childId) => idSet.has(childId));
    if (childrenInBlock) {
      for (const partnerId of union.partners) {
        const rank = neighborRank.get(partnerId);
        if (rank != null) out.push(rank);
      }
    }
  }

  return out;
}

function median(values: number[]): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function rankMap(ids: string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, index]));
}

function buildParentUnionByChild(graph: PedigreeGraph): Map<string, string> {
  const parentUnionByChild = new Map<string, string>();
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    for (const childId of childIds) {
      if (!parentUnionByChild.has(childId)) parentUnionByChild.set(childId, unionId);
    }
  }
  return parentUnionByChild;
}

function buildUnionsByPartner(graph: PedigreeGraph): Map<string, UnionNode[]> {
  const unionsByPartner = new Map<string, UnionNode[]>();
  for (const union of graph.unions.values()) {
    for (const partnerId of union.partners) {
      if (!unionsByPartner.has(partnerId)) unionsByPartner.set(partnerId, []);
      unionsByPartner.get(partnerId)?.push(union);
    }
  }
  return unionsByPartner;
}

function sortChildren(graph: PedigreeGraph, childIds: string[]): string[] {
  return sortChildrenForLayout(graph, childIds);
}

function unionSortKey(graph: PedigreeGraph, union: UnionNode): string {
  const generation = Math.min(...union.partners.map((id) => graph.persons.get(id)?.generation ?? 0));
  return `${generation}:${union.partners.join("|")}:${union.id}`;
}

function enforceSiblingBirthOrder(graph: PedigreeGraph, order: GenerationOrder) {
  for (const [generation, ids] of order.entries()) {
    const constraints = new Map<string, Set<string>>();
    for (const id of ids) constraints.set(id, new Set());

    for (const childIds of graph.childrenMap.values()) {
      const sorted = sortChildren(graph, childIds)
        .filter((childId) => (graph.persons.get(childId)?.generation ?? 0) === generation);
      for (let i = 1; i < sorted.length; i++) {
        if (!constraints.has(sorted[i - 1]) || !constraints.has(sorted[i])) continue;
        constraints.get(sorted[i - 1])?.add(sorted[i]);
      }
    }

    order.set(generation, stableTopologicalSort(ids, constraints));
  }
}

function enforceOriginRootOrder(graph: PedigreeGraph, order: GenerationOrder) {
  const parentUnionByChild = buildParentUnionByChild(graph);
  const unionsByPartner = buildUnionsByPartner(graph);

  for (const [generation, ids] of order.entries()) {
    const constraints = new Map<string, Set<string>>();
    for (const id of ids) constraints.set(id, new Set());

    for (const [parentUnionId, childIds] of graph.childrenMap.entries()) {
      const sortedChildren = sortChildren(graph, childIds);
      for (let i = 1; i < sortedChildren.length; i++) {
        const previousOrigin = originParentUnionForMarriedChild(
          sortedChildren[i - 1],
          parentUnionId,
          parentUnionByChild,
          unionsByPartner
        );
        const currentOrigin = originParentUnionForMarriedChild(
          sortedChildren[i],
          parentUnionId,
          parentUnionByChild,
          unionsByPartner
        );
        if (!previousOrigin || !currentOrigin || previousOrigin.id === currentOrigin.id) continue;

        for (const left of previousOrigin.partners) {
          if ((graph.persons.get(left)?.generation ?? 0) !== generation || !constraints.has(left)) continue;
          for (const right of currentOrigin.partners) {
            if ((graph.persons.get(right)?.generation ?? 0) !== generation || !constraints.has(right)) continue;
            constraints.get(left)?.add(right);
          }
        }
      }
    }

    order.set(generation, stableTopologicalSort(ids, constraints));
  }
}

function enforceSpouseAdjacencyOrder(graph: PedigreeGraph, order: GenerationOrder) {
  const parentUnionByChild = buildParentUnionByChild(graph);
  const unionsByPartner = buildUnionsByPartner(graph);

  for (const [generation, ids] of order.entries()) {
    const constraints = new Map<string, Set<string>>();
    for (const id of ids) constraints.set(id, new Set());

    for (const [parentUnionId, childIds] of graph.childrenMap.entries()) {
      const sortedChildren = sortChildren(graph, childIds);
      for (let i = 0; i < sortedChildren.length; i++) {
        const childId = sortedChildren[i];
        const spouseId = spouseForMarriedChild(childId, parentUnionId, unionsByPartner);
        if (!spouseId || !constraints.has(childId) || !constraints.has(spouseId)) continue;
        if ((graph.persons.get(childId)?.generation ?? 0) !== generation) continue;
        if ((graph.persons.get(spouseId)?.generation ?? 0) !== generation) continue;

        if (shouldPlaceOriginLeft(graph, parentUnionByChild, childId)) {
          constraints.get(spouseId)?.add(childId);
          const previousSibling = sortedChildren[i - 1];
          if (previousSibling && constraints.has(previousSibling)) {
            constraints.get(previousSibling)?.add(spouseId);
          }
        } else {
          constraints.get(childId)?.add(spouseId);
          const nextSibling = sortedChildren[i + 1];
          if (nextSibling && constraints.has(nextSibling)) {
            constraints.get(spouseId)?.add(nextSibling);
          }
        }
      }
    }

    order.set(generation, stableTopologicalSort(ids, constraints));
  }
}

function spouseForMarriedChild(
  childId: string,
  parentUnionId: string,
  unionsByPartner: Map<string, UnionNode[]>
): string | undefined {
  for (const union of unionsByPartner.get(childId) ?? []) {
    if (union.id === parentUnionId) continue;
    return union.partners.find((partnerId) => partnerId !== childId);
  }
  return undefined;
}

function originParentUnionForMarriedChild(
  childId: string,
  parentUnionId: string,
  parentUnionByChild: Map<string, string>,
  unionsByPartner: Map<string, UnionNode[]>
): UnionNode | undefined {
  for (const union of unionsByPartner.get(childId) ?? []) {
    if (union.id === parentUnionId) continue;
    const spouseId = union.partners.find((partnerId) => partnerId !== childId);
    const spouseParentUnionId = spouseId ? parentUnionByChild.get(spouseId) : undefined;
    if (!spouseParentUnionId) continue;
    return [...unionsByPartner.values()]
      .flat()
      .find((candidate) => candidate.id === spouseParentUnionId);
  }
  return undefined;
}

function stableTopologicalSort(ids: string[], constraints: Map<string, Set<string>>): string[] {
  const originalIndex = new Map(ids.map((id, index) => [id, index]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const nextIds of constraints.values()) {
    for (const next of nextIds) {
      indegree.set(next, (indegree.get(next) ?? 0) + 1);
    }
  }

  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const out: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));
    const current = ready.shift()!;
    out.push(current);
    for (const next of constraints.get(current) ?? []) {
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if ((indegree.get(next) ?? 0) === 0) ready.push(next);
    }
  }

  return out.length === ids.length ? out : ids;
}
