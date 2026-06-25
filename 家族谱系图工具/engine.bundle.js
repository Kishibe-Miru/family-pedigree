"use strict";
(() => {
  // src/layout/layerAssigner.ts
  function assignLayers(graph) {
    for (const person of graph.persons.values()) {
      person.generation = 0;
    }
    const limit = graph.persons.size + graph.unions.size + 1;
    for (let i = 0; i < limit; i++) {
      let changed = false;
      for (const union of graph.unions.values()) {
        const partnerGenerations = union.partners.map((id) => graph.persons.get(id)?.generation ?? 0);
        const partnerGeneration = Math.max(...partnerGenerations);
        for (const partnerId of union.partners) {
          const partner = graph.persons.get(partnerId);
          if (partner && (partner.generation ?? 0) < partnerGeneration) {
            partner.generation = partnerGeneration;
            changed = true;
          }
        }
        const children = graph.childrenMap.get(union.id) ?? [];
        for (const childId of children) {
          const child = graph.persons.get(childId);
          if (!child) continue;
          const nextGeneration = partnerGeneration + 1;
          if ((child.generation ?? 0) < nextGeneration) {
            child.generation = nextGeneration;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
    return graph;
  }

  // src/layout/layoutOrder.ts
  var orders = /* @__PURE__ */ new WeakMap();
  function setGenerationOrder(graph, order) {
    orders.set(graph, order);
  }
  function getGenerationOrder(graph) {
    return orders.get(graph);
  }

  // src/layout/crossingReducer.ts
  function reduceCrossings(graph) {
    for (const [unionId, childIds] of graph.childrenMap.entries()) {
      graph.childrenMap.set(unionId, sortChildren(graph, childIds));
    }
    const order = buildSeedOrder(graph);
    minimizeByMedian(graph, order);
    setGenerationOrder(graph, order);
    return graph;
  }
  function buildSeedOrder(graph) {
    const order = /* @__PURE__ */ new Map();
    const seen = /* @__PURE__ */ new Set();
    const parentUnionByChild = buildParentUnionByChild(graph);
    const unionsByPartner = buildUnionsByPartner(graph);
    const rootUnions = [...graph.unions.values()].filter((union) => union.partners.every((partnerId) => !parentUnionByChild.has(partnerId))).sort((a, b) => unionSortKey(graph, a).localeCompare(unionSortKey(graph, b)));
    const push = (personId) => {
      if (seen.has(personId)) return;
      seen.add(personId);
      const generation = graph.persons.get(personId)?.generation ?? 0;
      if (!order.has(generation)) order.set(generation, []);
      order.get(generation)?.push(personId);
    };
    const visitUnion = (union, mainPersonId) => {
      const partners = orderPartners(graph, parentUnionByChild, union, mainPersonId);
      partners.forEach(push);
      for (const childId of sortChildren(graph, graph.childrenMap.get(union.id) ?? [])) {
        const childUnions = (unionsByPartner.get(childId) ?? []).filter((childUnion) => childUnion.id !== union.id).sort((a, b) => unionSortKey(graph, a).localeCompare(unionSortKey(graph, b)));
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
  function orderPartners(graph, parentUnionByChild, union, mainPersonId) {
    if (!mainPersonId) return [...union.partners];
    const partner = union.partners.find((id) => id !== mainPersonId);
    if (!partner) return [mainPersonId];
    return shouldPlaceOriginLeft(graph, parentUnionByChild, mainPersonId) ? [partner, mainPersonId] : [mainPersonId, partner];
  }
  function shouldPlaceOriginLeft(graph, parentUnionByChild, mainPersonId) {
    const parentUnionId = parentUnionByChild.get(mainPersonId);
    if (!parentUnionId) return false;
    const siblings = sortChildren(graph, graph.childrenMap.get(parentUnionId) ?? []);
    const index = siblings.indexOf(mainPersonId);
    if (index < 0) return false;
    return index < (siblings.length - 1) / 2;
  }
  function minimizeByMedian(graph, order) {
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
  function sweep(graph, order, direction) {
    const generations = [...order.keys()].sort((a, b) => direction * (a - b));
    const previousRankByGeneration = /* @__PURE__ */ new Map();
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
  function buildHardBlocks(graph, ids) {
    const idToIndex = new Map(ids.map((id, index) => [id, index]));
    const used = /* @__PURE__ */ new Set();
    const blocks = [];
    for (const id of ids) {
      if (used.has(id)) continue;
      const union = [...graph.unions.values()].find(
        (candidate) => candidate.partners.includes(id) && candidate.partners.every((partnerId) => idToIndex.has(partnerId)) && candidate.partners.length === 2
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
  function neighborIndexes(graph, ids, neighborRank) {
    const out = [];
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
  function median(values) {
    if (values.length === 0) return Number.POSITIVE_INFINITY;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  function rankMap(ids) {
    return new Map(ids.map((id, index) => [id, index]));
  }
  function buildParentUnionByChild(graph) {
    const parentUnionByChild = /* @__PURE__ */ new Map();
    for (const [unionId, childIds] of graph.childrenMap.entries()) {
      for (const childId of childIds) {
        if (!parentUnionByChild.has(childId)) parentUnionByChild.set(childId, unionId);
      }
    }
    return parentUnionByChild;
  }
  function buildUnionsByPartner(graph) {
    const unionsByPartner = /* @__PURE__ */ new Map();
    for (const union of graph.unions.values()) {
      for (const partnerId of union.partners) {
        if (!unionsByPartner.has(partnerId)) unionsByPartner.set(partnerId, []);
        unionsByPartner.get(partnerId)?.push(union);
      }
    }
    return unionsByPartner;
  }
  function sortChildren(graph, childIds) {
    return [...childIds].sort((a, b) => {
      const left = graph.persons.get(a)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
      const right = graph.persons.get(b)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
      return left - right || a.localeCompare(b);
    });
  }
  function unionSortKey(graph, union) {
    const generation = Math.min(...union.partners.map((id) => graph.persons.get(id)?.generation ?? 0));
    return `${generation}:${union.partners.join("|")}:${union.id}`;
  }
  function enforceSiblingBirthOrder(graph, order) {
    for (const [generation, ids] of order.entries()) {
      const constraints = /* @__PURE__ */ new Map();
      for (const id of ids) constraints.set(id, /* @__PURE__ */ new Set());
      for (const childIds of graph.childrenMap.values()) {
        const sorted = sortChildren(graph, childIds).filter((childId) => (graph.persons.get(childId)?.generation ?? 0) === generation);
        for (let i = 1; i < sorted.length; i++) {
          if (!constraints.has(sorted[i - 1]) || !constraints.has(sorted[i])) continue;
          constraints.get(sorted[i - 1])?.add(sorted[i]);
        }
      }
      order.set(generation, stableTopologicalSort(ids, constraints));
    }
  }
  function enforceOriginRootOrder(graph, order) {
    const parentUnionByChild = buildParentUnionByChild(graph);
    const unionsByPartner = buildUnionsByPartner(graph);
    for (const [generation, ids] of order.entries()) {
      const constraints = /* @__PURE__ */ new Map();
      for (const id of ids) constraints.set(id, /* @__PURE__ */ new Set());
      for (const [parentUnionId, childIds] of graph.childrenMap.entries()) {
        const sortedChildren2 = sortChildren(graph, childIds);
        for (let i = 1; i < sortedChildren2.length; i++) {
          const previousOrigin = originParentUnionForMarriedChild(
            sortedChildren2[i - 1],
            parentUnionId,
            parentUnionByChild,
            unionsByPartner
          );
          const currentOrigin = originParentUnionForMarriedChild(
            sortedChildren2[i],
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
  function enforceSpouseAdjacencyOrder(graph, order) {
    const parentUnionByChild = buildParentUnionByChild(graph);
    const unionsByPartner = buildUnionsByPartner(graph);
    for (const [generation, ids] of order.entries()) {
      const constraints = /* @__PURE__ */ new Map();
      for (const id of ids) constraints.set(id, /* @__PURE__ */ new Set());
      for (const [parentUnionId, childIds] of graph.childrenMap.entries()) {
        const sortedChildren2 = sortChildren(graph, childIds);
        for (let i = 0; i < sortedChildren2.length; i++) {
          const childId = sortedChildren2[i];
          const spouseId = spouseForMarriedChild(childId, parentUnionId, unionsByPartner);
          if (!spouseId || !constraints.has(childId) || !constraints.has(spouseId)) continue;
          if ((graph.persons.get(childId)?.generation ?? 0) !== generation) continue;
          if ((graph.persons.get(spouseId)?.generation ?? 0) !== generation) continue;
          if (shouldPlaceOriginLeft(graph, parentUnionByChild, childId)) {
            constraints.get(spouseId)?.add(childId);
            const previousSibling = sortedChildren2[i - 1];
            if (previousSibling && constraints.has(previousSibling)) {
              constraints.get(previousSibling)?.add(spouseId);
            }
          } else {
            constraints.get(childId)?.add(spouseId);
            const nextSibling = sortedChildren2[i + 1];
            if (nextSibling && constraints.has(nextSibling)) {
              constraints.get(spouseId)?.add(nextSibling);
            }
          }
        }
      }
      order.set(generation, stableTopologicalSort(ids, constraints));
    }
  }
  function spouseForMarriedChild(childId, parentUnionId, unionsByPartner) {
    for (const union of unionsByPartner.get(childId) ?? []) {
      if (union.id === parentUnionId) continue;
      return union.partners.find((partnerId) => partnerId !== childId);
    }
    return void 0;
  }
  function originParentUnionForMarriedChild(childId, parentUnionId, parentUnionByChild, unionsByPartner) {
    for (const union of unionsByPartner.get(childId) ?? []) {
      if (union.id === parentUnionId) continue;
      const spouseId = union.partners.find((partnerId) => partnerId !== childId);
      const spouseParentUnionId = spouseId ? parentUnionByChild.get(spouseId) : void 0;
      if (!spouseParentUnionId) continue;
      return [...unionsByPartner.values()].flat().find((candidate) => candidate.id === spouseParentUnionId);
    }
    return void 0;
  }
  function stableTopologicalSort(ids, constraints) {
    const originalIndex = new Map(ids.map((id, index) => [id, index]));
    const indegree = new Map(ids.map((id) => [id, 0]));
    for (const nextIds of constraints.values()) {
      for (const next of nextIds) {
        indegree.set(next, (indegree.get(next) ?? 0) + 1);
      }
    }
    const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
    const out = [];
    while (ready.length > 0) {
      ready.sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));
      const current = ready.shift();
      out.push(current);
      for (const next of constraints.get(current) ?? []) {
        indegree.set(next, (indegree.get(next) ?? 0) - 1);
        if ((indegree.get(next) ?? 0) === 0) ready.push(next);
      }
    }
    return out.length === ids.length ? out : ids;
  }

  // src/layout/boxModel.ts
  var NODE_SIZE = 44;
  var PERSON_GAP = NODE_SIZE * 2.7;
  var SLOT = PERSON_GAP;
  var MARRIAGE_GAP = NODE_SIZE * 1.6;
  var SIBLING_GAP = PERSON_GAP;
  var MIN_GAP = NODE_SIZE * 0.8;
  var GENERATION_GAP = NODE_SIZE * 3.7;
  function createPersonBox(personId, generation) {
    return {
      kind: "person",
      width: SLOT,
      cx: 0,
      gen: generation,
      members: [personId],
      mainPersonId: personId,
      anchorX(id) {
        return this.cx;
      },
      dropX() {
        return this.cx;
      }
    };
  }
  function createCoupleBox(partnerIds, generation, mainPersonId, originOf) {
    const [leftId, rightId] = partnerIds;
    const offsets = /* @__PURE__ */ new Map();
    const partnerOffset = MARRIAGE_GAP / 2;
    if (leftId) offsets.set(leftId, partnerIds.length === 1 ? 0 : -partnerOffset);
    if (rightId) offsets.set(rightId, partnerOffset);
    return {
      kind: "couple",
      width: Math.max(SLOT * partnerIds.length, MARRIAGE_GAP + SLOT),
      cx: 0,
      gen: generation,
      members: [...partnerIds],
      mainPersonId,
      originOf,
      anchorX(id) {
        return this.cx + (offsets.get(id) ?? 0);
      },
      dropX() {
        return this.cx;
      }
    };
  }
  function createFamilyBox(top, children, mainPersonId) {
    const childrenWidth = children.reduce((sum, child, index) => sum + child.width + (index === 0 ? 0 : SIBLING_GAP), 0);
    const width = Math.max(top.width, childrenWidth || top.width);
    return {
      kind: "family",
      width,
      cx: 0,
      gen: top.gen,
      members: [...top.members],
      mainPersonId: mainPersonId ?? top.mainPersonId,
      top,
      children,
      anchorX(id) {
        return top.anchorX(id);
      },
      dropX() {
        return top.dropX();
      }
    };
  }

  // src/rules/validation.ts
  var GraphValidationError = class extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "GraphValidationError";
      this.code = code;
      this.details = details;
    }
  };
  function validateGraph(graph) {
    const personIds = validatePersonIds(graph);
    validateUnions(graph, personIds);
    validateChildrenMap(graph, personIds);
    validateAcyclicParentage(graph);
    return graph;
  }
  function validatePersonIds(graph) {
    const personIds = /* @__PURE__ */ new Set();
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
  function validateUnions(graph, personIds) {
    const unionIds = /* @__PURE__ */ new Set();
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
      const partners = union.partners;
      if (partners.length !== 1 && partners.length !== 2) {
        fail(
          "GRAPH_UNION_PARTNER_COUNT",
          `union ${union.id} must have 1 or 2 partners, got ${partners.length}`,
          { unionId: union.id, partners }
        );
      }
      const seenPartners = /* @__PURE__ */ new Set();
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
  function validateChildrenMap(graph, personIds) {
    const childParentUnion = /* @__PURE__ */ new Map();
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
  function validateAcyclicParentage(graph) {
    const childIdsByParent = /* @__PURE__ */ new Map();
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
    const visited = /* @__PURE__ */ new Set();
    const visiting = /* @__PURE__ */ new Set();
    const path = [];
    const visit = (personId) => {
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
  function fail(code, message, details) {
    throw new GraphValidationError(code, message, details);
  }
  function assertLayoutInvariants(graph, originLinks = []) {
    assertParentDropCenteredOverChildren(graph, originLinks);
    assertOriginLinks(graph, originLinks);
    assertSiblingLinesUseOneUnion(graph);
    assertSiblingBirthOrder(graph);
    assertGenerationYConsistency(graph);
    assertNoSymbolOverlap(graph);
    assertMarriageLineEndpoints(graph);
  }
  function assertOriginLinks(graph, originLinks) {
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
      const parentGenerations = parentUnion.partners.map((partnerId) => graph.persons.get(partnerId)?.generation).filter((generation) => generation != null);
      const expectedGeneration = parentGenerations.length ? Math.max(...parentGenerations) + 1 : void 0;
      if (expectedGeneration == null || shared.generation !== expectedGeneration) {
        throw new Error(`layout invariant failed: origin spouse drift for ${link.sharedPersonId}`);
      }
    }
  }
  function assertSiblingBirthOrder(graph) {
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
  function sortChildrenByBirthOrder(graph, childIds) {
    return [...childIds].sort((a, b) => {
      const left = graph.persons.get(a)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
      const right = graph.persons.get(b)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
      return left - right || a.localeCompare(b);
    });
  }
  function assertSiblingLinesUseOneUnion(graph) {
    const seenChildren = /* @__PURE__ */ new Map();
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
  function assertNoSymbolOverlap(graph) {
    const people = [...graph.persons.values()].filter(
      (person) => Number.isFinite(person.x) && Number.isFinite(person.y)
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
  function assertGenerationYConsistency(graph) {
    for (const person of graph.persons.values()) {
      if (!Number.isFinite(person.y)) continue;
      const generation = person.generation ?? 0;
      const expectedY = generation * GENERATION_GAP;
      if (Math.abs((person.y ?? 0) - expectedY) >= 0.5) {
        throw new Error(`layout invariant failed: generation y mismatch ${person.id}`);
      }
    }
  }
  function assertMarriageLineEndpoints(graph) {
    for (const union of graph.unions.values()) {
      if (union.partners.length !== 2) continue;
      const [leftId, rightId] = union.partners;
      const left = graph.persons.get(leftId);
      const right = graph.persons.get(rightId);
      if (!left || !right || !Number.isFinite(left.x) || !Number.isFinite(right.x) || !Number.isFinite(left.y) || !Number.isFinite(right.y) || Math.abs((left.y ?? 0) - (right.y ?? 0)) >= 0.5 || Math.abs((left.x ?? 0) - (right.x ?? 0)) < NODE_SIZE) {
        throw new Error(`layout invariant failed: marriage endpoints for ${union.id}`);
      }
    }
  }
  function assertParentDropCenteredOverChildren(graph, originLinks) {
    const originChildByParentUnion = /* @__PURE__ */ new Map();
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
      const childCenter = originChildId ? graph.persons.get(originChildId)?.x : childrenCenterX(graph, childIds);
      if (dropX == null || childCenter == null || Math.abs(dropX - childCenter) >= 0.5) {
        throw new Error(`layout invariant failed: parent drop not centered over children for ${unionId}`);
      }
    }
  }
  function parentUnionForChild(graph, childId) {
    for (const [unionId, childIds] of graph.childrenMap.entries()) {
      if (!childIds.includes(childId)) continue;
      return graph.unions.get(unionId);
    }
    return void 0;
  }
  function parentDropX(graph, union) {
    const xs = union.partners.map((partnerId) => graph.persons.get(partnerId)?.x).filter((x) => Number.isFinite(x));
    if (xs.length === 0) return null;
    return xs.reduce((sum, x) => sum + x, 0) / xs.length;
  }
  function childrenCenterX(graph, childIds) {
    const xs = childIds.map((childId) => graph.persons.get(childId)?.x).filter((x) => Number.isFinite(x));
    if (xs.length === 0) return null;
    if (xs.length === 1) return xs[0];
    return (Math.min(...xs) + Math.max(...xs)) / 2;
  }

  // src/layout/familyForest.ts
  function buildParentUnionByChild2(graph) {
    const parentUnionByChild = /* @__PURE__ */ new Map();
    for (const [unionId, childIds] of graph.childrenMap.entries()) {
      for (const childId of childIds) {
        if (!parentUnionByChild.has(childId)) {
          parentUnionByChild.set(childId, unionId);
        }
      }
    }
    return parentUnionByChild;
  }
  function buildUnionsByPartner2(graph) {
    const unionsByPartner = /* @__PURE__ */ new Map();
    for (const union of graph.unions.values()) {
      for (const partnerId of union.partners) {
        if (!unionsByPartner.has(partnerId)) unionsByPartner.set(partnerId, []);
        unionsByPartner.get(partnerId)?.push(union);
      }
    }
    return unionsByPartner;
  }
  function sortedChildren(graph, unionId) {
    return [...graph.childrenMap.get(unionId) ?? []].sort((a, b) => {
      const left = graph.persons.get(a)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
      const right = graph.persons.get(b)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
      return left - right || a.localeCompare(b);
    });
  }
  function buildForest(graph) {
    const parentUnionByChild = buildParentUnionByChild2(graph);
    const unionsByPartner = buildUnionsByPartner2(graph);
    const visitedMainPeople = /* @__PURE__ */ new Set();
    const visitedUnions = /* @__PURE__ */ new Set();
    const roots = [];
    const pendingOriginLinks = [];
    const hasParents = (personId) => parentUnionByChild.has(personId);
    const isRootUnion = (union) => union.partners.every((partnerId) => !hasParents(partnerId));
    const unionSortKey2 = (union) => `${Math.min(...union.partners.map((id) => graph.persons.get(id)?.generation ?? 0))}:${union.partners.join("|")}:${union.id}`;
    const buildFamily = (union, mainPersonId) => {
      if (visitedUnions.has(union.id)) return null;
      visitedUnions.add(union.id);
      const partnerGeneration = Math.max(
        ...union.partners.map((id) => graph.persons.get(id)?.generation ?? 0)
      );
      const originOf = mainPersonId ? union.partners.find((partnerId) => partnerId !== mainPersonId && hasParents(partnerId)) : void 0;
      const mainId = mainPersonId ?? union.partners.find((partnerId) => !hasParents(partnerId)) ?? union.partners[0];
      const partners = orderPartnersForMain(graph, parentUnionByChild, union, mainPersonId, originOf);
      const top = union.partners.length === 2 ? createCoupleBox(partners, partnerGeneration, mainId, originOf) : createPersonBox(union.partners[0], partnerGeneration);
      if (top.originOf) {
        pendingOriginLinks.push({ couple: top, sharedPersonId: top.originOf });
      }
      if (mainPersonId) visitedMainPeople.add(mainPersonId);
      else union.partners.forEach((partnerId) => visitedMainPeople.add(partnerId));
      const children = [];
      for (const childId of sortedChildren(graph, union.id)) {
        const child = graph.persons.get(childId);
        if (!child) continue;
        const childUnions = (unionsByPartner.get(childId) ?? []).filter((childUnion) => childUnion.id !== union.id && !visitedUnions.has(childUnion.id)).sort((a, b) => unionSortKey2(a).localeCompare(unionSortKey2(b)));
        if (childUnions.length > 0 && !visitedMainPeople.has(childId)) {
          visitedMainPeople.add(childId);
          for (const childUnion of childUnions) {
            const childFamily = buildFamily(childUnion, childId);
            if (childFamily) children.push(childFamily);
          }
        } else if (!visitedMainPeople.has(childId)) {
          visitedMainPeople.add(childId);
          children.push(createPersonBox(childId, child.generation ?? 0));
        }
      }
      return createFamilyBox(top, children, mainId);
    };
    for (const union of [...graph.unions.values()].sort((a, b) => unionSortKey2(a).localeCompare(unionSortKey2(b)))) {
      if (!isRootUnion(union)) continue;
      const root = buildFamily(union);
      if (root) roots.push(root);
    }
    for (const person of graph.persons.values()) {
      const hasUnion = (unionsByPartner.get(person.id) ?? []).length > 0;
      if (!hasUnion && !hasParents(person.id) && !visitedMainPeople.has(person.id)) {
        visitedMainPeople.add(person.id);
        roots.push(createPersonBox(person.id, person.generation ?? 0));
      }
    }
    const originLinks = pendingOriginLinks.flatMap((pending) => {
      const coreRoot = rootForBox(roots, pending.couple);
      const originRoot = roots.find(
        (root) => root !== coreRoot && containsMember(root, pending.sharedPersonId)
      );
      if (!originRoot) return [];
      originRoot.exitMember = pending.sharedPersonId;
      return [{ couple: pending.couple, originRoot, sharedPersonId: pending.sharedPersonId }];
    });
    return { roots, originLinks };
  }
  function orderPartnersForMain(graph, parentUnionByChild, union, mainPersonId, originOf) {
    if (!mainPersonId || !originOf || union.partners.length !== 2) return [...union.partners];
    return shouldPlaceOriginLeft2(graph, parentUnionByChild, mainPersonId) ? [originOf, mainPersonId] : [mainPersonId, originOf];
  }
  function shouldPlaceOriginLeft2(graph, parentUnionByChild, mainPersonId) {
    const parentUnionId = parentUnionByChild.get(mainPersonId);
    if (!parentUnionId) return false;
    const siblings = sortedChildren(graph, parentUnionId);
    const index = siblings.indexOf(mainPersonId);
    if (index < 0) return false;
    return index < (siblings.length - 1) / 2;
  }
  function containsMember(box, memberId) {
    if (box.members.includes(memberId)) return true;
    if (box.top && containsMember(box.top, memberId)) return true;
    return box.children?.some((child) => containsMember(child, memberId)) ?? false;
  }
  function containsBox(box, target) {
    if (box === target) return true;
    if (box.top && containsBox(box.top, target)) return true;
    return box.children?.some((child) => containsBox(child, target)) ?? false;
  }
  function rootForBox(roots, target) {
    return roots.find((root) => root === target || containsBox(root, target)) ?? null;
  }

  // src/layout/coordinateSolver.ts
  var SYMBOL_MARGIN = NODE_SIZE * 0.3;
  var SYMBOL_CENTER_GAP = NODE_SIZE + SYMBOL_MARGIN;
  function measureBox(box) {
    if (box.kind === "person") {
      box.width = SLOT;
      return box.width;
    }
    if (box.kind === "couple") {
      box.width = MARRIAGE_GAP + SLOT;
      return box.width;
    }
    if (box.kind === "family") {
      const topW = box.top ? measureBox(box.top) : 0;
      const children = box.children ?? [];
      const childrenW = children.reduce((sum, child, index) => sum + measureBox(child) + (index === 0 ? 0 : SIBLING_GAP), 0);
      box._childrenW = childrenW;
      box._topW = topW;
      box.width = Math.max(childrenW, topW);
      return box.width;
    }
    return box.width;
  }
  function placeBox(box, centerX) {
    box.cx = centerX;
    if (box.kind === "person" || box.kind === "couple") return;
    if (box.kind !== "family") return;
    const children = box.children ?? [];
    if (children.length === 0) {
      if (box.top) placeBox(box.top, centerX);
      return;
    }
    const childrenW = box._childrenW ?? 0;
    let left = centerX - childrenW / 2;
    for (const child of children) {
      placeBox(child, left + child.width / 2);
      left += child.width + SIBLING_GAP;
    }
    const dropX = familyDropX(box);
    if (box.top) placeBox(box.top, dropX);
    assertFamilyAnchors(box, dropX);
  }
  function shiftSubtree(box, dx) {
    if (Math.abs(dx) < 0.01) return;
    box.cx += dx;
    if (box.top) shiftSubtree(box.top, dx);
    box.children?.forEach((child) => shiftSubtree(child, dx));
  }
  function reconcileOrigins(roots, originLinks) {
    let changed = reconcileOriginRounds(roots, originLinks);
    for (const link of originLinks) {
      changed = alignOriginLink(link) || changed;
    }
    return changed;
  }
  function reconcileOriginRounds(roots, originLinks) {
    let changed = false;
    for (let i = 0; i < 64; i++) {
      let roundChanged = false;
      for (const link of originLinks) {
        roundChanged = alignOriginLink(link) || roundChanged;
      }
      changed = changed || roundChanged;
      if (!roundChanged) break;
    }
    return changed;
  }
  function alignOriginLink(link) {
    let changed = false;
    const targetX = link.couple.anchorX(link.sharedPersonId);
    const currentX = memberAnchorX(link.originRoot, link.sharedPersonId);
    if (currentX != null) {
      const dx = targetX - currentX;
      if (Math.abs(dx) > 0.01) {
        shiftSubtree(link.originRoot, dx);
        changed = true;
      }
    }
    const currentGeneration = memberGeneration(link.originRoot, link.sharedPersonId);
    if (currentGeneration != null && currentGeneration !== link.couple.gen) {
      throw new Error(`layout invariant failed: origin link generation mismatch for ${link.sharedPersonId}`);
    }
    return changed;
  }
  function resolveGenerationOverlaps(roots, pinnedMovers = /* @__PURE__ */ new Set()) {
    let changed = false;
    for (let pass = 0; pass < 120; pass++) {
      let passChanged = false;
      const boxesByGeneration = /* @__PURE__ */ new Map();
      for (const entry of collectVisibleBoxes(roots)) {
        if (!boxesByGeneration.has(entry.box.gen)) boxesByGeneration.set(entry.box.gen, []);
        boxesByGeneration.get(entry.box.gen)?.push(entry);
      }
      for (const boxes of boxesByGeneration.values()) {
        boxes.sort((a, b) => leftOf(a.box) - leftOf(b.box) || a.box.cx - b.box.cx);
        for (let i = 1; i < boxes.length; i++) {
          const previous = boxes[i - 1];
          const current = boxes[i];
          if (previous.mover === current.mover) continue;
          const need = rightOf(previous.box) + MIN_GAP - leftOf(current.box);
          if (need <= 0) continue;
          if (pinnedMovers.has(current.mover) && !pinnedMovers.has(previous.mover)) {
            shiftSubtree(previous.mover, -need);
          } else if (!pinnedMovers.has(current.mover)) {
            shiftSubtree(current.mover, need);
          } else {
            continue;
          }
          changed = true;
          passChanged = true;
          break;
        }
        if (passChanged) break;
      }
      if (!passChanged) break;
    }
    return changed;
  }
  function collectBoxes(boxes) {
    const out = [];
    const visit = (box) => {
      out.push(box);
      if (box.top) visit(box.top);
      box.children?.forEach(visit);
    };
    boxes.forEach(visit);
    return out;
  }
  function collectVisibleBoxes(boxes) {
    const out = [];
    const visit = (box, mover) => {
      if (box.kind === "family") {
        out.push({ box, mover: box });
        if (box.top) visit(box.top, box);
        box.children?.forEach((child) => visit(child, child.kind === "family" ? child : box));
      } else {
        out.push({ box, mover });
      }
    };
    boxes.forEach((box) => visit(box, box));
    return out;
  }
  function memberAnchorX(box, memberId) {
    if (box.members.includes(memberId)) return box.anchorX(memberId);
    if (box.top) {
      const topX = memberAnchorX(box.top, memberId);
      if (topX != null) return topX;
    }
    for (const child of box.children ?? []) {
      const childX = memberAnchorX(child, memberId);
      if (childX != null) return childX;
    }
    return null;
  }
  function memberGeneration(box, memberId) {
    if (box.members.includes(memberId)) return box.gen;
    if (box.top) {
      const topGeneration = memberGeneration(box.top, memberId);
      if (topGeneration != null) return topGeneration;
    }
    for (const child of box.children ?? []) {
      const childGeneration = memberGeneration(child, memberId);
      if (childGeneration != null) return childGeneration;
    }
    return null;
  }
  function nearestFamilyForTop(roots, targetTop) {
    const families = collectBoxes(roots).filter((box) => box.kind === "family" && box.top);
    return families.find((family) => family.top === targetTop || containsBox2(family.top, targetTop)) ?? null;
  }
  function containsBox2(box, target) {
    if (box === target) return true;
    if (box.top && containsBox2(box.top, target)) return true;
    return box.children?.some((child) => containsBox2(child, target)) ?? false;
  }
  function leftOf(box) {
    return box.cx - box.width / 2;
  }
  function rightOf(box) {
    return box.cx + box.width / 2;
  }
  function childAnchorDropX(children) {
    if (children.length === 0) return 0;
    if (children.length === 1) return primaryAnchorX(children[0]);
    return (primaryAnchorX(children[0]) + primaryAnchorX(children[children.length - 1])) / 2;
  }
  function primaryAnchorX(box) {
    if (box.kind === "family" && box.top) return primaryAnchorX(box.top);
    const anchorMember = box.mainPersonId ?? box.members[0];
    return anchorMember ? box.anchorX(anchorMember) : box.cx;
  }
  function siblingAnchorGap(previous, current) {
    if (!requiresSiblingFamilySpace(previous) && !requiresSiblingFamilySpace(current)) return PERSON_GAP;
    const previousRight = rightOf(previous) - primaryAnchorX(previous);
    const currentLeft = primaryAnchorX(current) - leftOf(current);
    return Math.max(PERSON_GAP, previousRight + MIN_GAP + currentLeft);
  }
  function requiresSiblingFamilySpace(box) {
    return box.kind === "family" && (box.children?.length ?? 0) > 0;
  }
  function assertFamilyAnchors(box, expectedDropX) {
    if (!box.top || !box.children || box.children.length === 0) return;
    const actualDropX = box.top.dropX();
    if (Math.abs(actualDropX - expectedDropX) >= 0.5) {
      throw new Error(`family anchor mismatch: expected ${expectedDropX}, got ${actualDropX}`);
    }
  }
  function assignCoordinates(graph) {
    let nextX = 0;
    const { roots: boxes, originLinks } = buildForest(graph);
    const generationOrder = getGenerationOrder(graph);
    if (generationOrder) sortBoxesByGenerationOrder(boxes, generationOrder);
    boxes.forEach(measureBox);
    for (const box of boxes) {
      placeBox(box, nextX + box.width / 2);
      nextX += box.width + SIBLING_GAP;
    }
    resolveGenerationOverlaps(boxes);
    for (let i = 0; i < 160; i++) {
      const originChanged = reconcileOrigins(boxes, originLinks);
      if (originChanged) realignFamilyTops(boxes);
      const symbolChanged = resolvePersonSymbolOverlaps(boxes, originLinks, generationOrder);
      const compacted = compactPersonGaps(boxes, originLinks, generationOrder);
      const siblingCompacted = compactSiblingRows(boxes, originLinks);
      if (!originChanged && !symbolChanged && !compacted && !siblingCompacted) break;
    }
    compactWideSiblingRows(boxes, originLinks);
    reconcileOrigins(boxes, originLinks);
    resolvePersonSymbolOverlaps(boxes, originLinks, generationOrder);
    if (generationOrder) enforceGenerationOrder(boxes, originLinks, generationOrder);
    reconcileOrigins(boxes, originLinks);
    resolvePersonSymbolOverlaps(boxes, originLinks, generationOrder);
    if (generationOrder) enforceGenerationOrder(boxes, originLinks, generationOrder);
    reconcileOrigins(boxes, originLinks);
    resolvePersonSymbolOverlaps(boxes, originLinks, generationOrder);
    resolveActualSymbolOverlaps(boxes, originLinks);
    finalizeLayoutConstraints(graph, boxes, originLinks);
    writeBackCoordinates(graph, boxes, originLinks);
    finalizeGraphCoordinates(graph, originLinks);
    normalizeGraphToOrigin(graph);
    assertLayoutInvariants(graph, originLinks);
    return graph;
  }
  function finalizeGraphCoordinates(graph, originLinks) {
    compactWideGraphCoordinates(graph);
    for (let i = 0; i < 24; i++) {
      alignGraphParentDrops(graph, originLinks);
      alignGraphOriginLinks(graph, originLinks);
      const siblingChanged = enforceGraphSiblingBirthOrder(graph, originLinks);
      alignGraphOriginMarriagesSafely(graph, originLinks);
      const overlapChanged = repairGraphOriginOverlaps(graph, originLinks);
      if (!siblingChanged && !overlapChanged) break;
    }
    alignGraphParentDrops(graph, originLinks);
    alignGraphOriginLinks(graph, originLinks);
    enforceGraphSiblingBirthOrder(graph, originLinks);
    repairGraphOriginOverlaps(graph, originLinks);
    enforceGraphSiblingBirthOrder(graph, originLinks);
    alignGraphParentDrops(graph, originLinks);
    repairGraphSymbolOverlaps(graph);
    alignGraphOriginLinks(graph, originLinks);
    enforceGraphSiblingBirthOrder(graph, originLinks);
    alignGraphParentDrops(graph, originLinks);
    repairGraphSymbolOverlaps(graph);
    alignGraphOriginMarriagesSafely(graph, originLinks);
    repairGraphSymbolOverlaps(graph);
  }
  function enforceGraphSiblingBirthOrder(graph, originLinks) {
    let changed = false;
    for (const childIds of graph.childrenMap.values()) {
      const sorted = sortChildIdsByBirthOrder(graph, childIds);
      for (let i = 1; i < sorted.length; i++) {
        const previous = graph.persons.get(sorted[i - 1]);
        const current = graph.persons.get(sorted[i]);
        if (!previous || !current || !Number.isFinite(previous.x) || !Number.isFinite(current.x)) continue;
        const need = (previous.x ?? 0) + NODE_SIZE - (current.x ?? 0);
        if (need <= 0) continue;
        current.x = (current.x ?? 0) + need;
        changed = true;
      }
    }
    return changed;
  }
  function repairGraphSymbolOverlaps(graph) {
    for (let pass = 0; pass < 80; pass++) {
      const people = [...graph.persons.values()].filter((person) => Number.isFinite(person.x) && Number.isFinite(person.y)).sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0) || (a.x ?? 0) - (b.x ?? 0));
      let changed = false;
      for (let i = 1; i < people.length; i++) {
        const previous = people[i - 1];
        const current = people[i];
        if ((previous.generation ?? 0) !== (current.generation ?? 0)) continue;
        const need = (previous.x ?? 0) + NODE_SIZE - (current.x ?? 0);
        if (need <= 0) continue;
        current.x = (current.x ?? 0) + need;
        changed = true;
        break;
      }
      if (!changed) break;
    }
  }
  function alignGraphParentDrops(graph, originLinks = []) {
    const originChildByParentUnion = /* @__PURE__ */ new Map();
    for (const link of originLinks) {
      for (const [unionId, childIds] of graph.childrenMap.entries()) {
        if (childIds.includes(link.sharedPersonId)) originChildByParentUnion.set(unionId, link.sharedPersonId);
      }
    }
    const parentUnionByChild = /* @__PURE__ */ new Map();
    for (const [unionId, childIds] of graph.childrenMap.entries()) {
      for (const childId of childIds) parentUnionByChild.set(childId, unionId);
    }
    const childbearingUnionCount = /* @__PURE__ */ new Map();
    for (const [unionId, childIds] of graph.childrenMap.entries()) {
      if (childIds.length === 0) continue;
      const union = graph.unions.get(unionId);
      if (!union) continue;
      for (const partnerId of union.partners) {
        childbearingUnionCount.set(partnerId, (childbearingUnionCount.get(partnerId) ?? 0) + 1);
      }
    }
    for (const [unionId, childIds] of graph.childrenMap.entries()) {
      if (childIds.length === 0) continue;
      const union = graph.unions.get(unionId);
      if (!union) continue;
      const originChildId = originChildByParentUnion.get(unionId);
      const childXs = (originChildId ? [originChildId] : childIds).map((childId) => graph.persons.get(childId)?.x).filter((x) => Number.isFinite(x));
      if (childXs.length === 0) continue;
      const childCenter = childXs.length === 1 ? childXs[0] : (Math.min(...childXs) + Math.max(...childXs)) / 2;
      const parentXs = union.partners.map((partnerId) => graph.persons.get(partnerId)?.x).filter((x) => Number.isFinite(x));
      if (parentXs.length === 0) continue;
      if (union.partners.length === 2) {
        const [leftId, rightId] = union.partners;
        const left = graph.persons.get(leftId);
        const right = graph.persons.get(rightId);
        const leftHasParents = parentUnionByChild.has(leftId);
        const rightHasParents = parentUnionByChild.has(rightId);
        if (leftHasParents && rightHasParents) {
          const dx2 = computeParentCenter(graph, union.partners) - childCenter;
          if (Math.abs(dx2) >= 0.5) {
            for (const childId of childIds) {
              const child = graph.persons.get(childId);
              if (child && Number.isFinite(child.x)) child.x = (child.x ?? 0) + dx2;
            }
          }
          continue;
        }
        if (left && right && Number.isFinite(left.x) && Number.isFinite(right.x) && leftHasParents !== rightHasParents) {
          const fixed = leftHasParents ? left : right;
          const free = leftHasParents ? right : left;
          const side = (free.x ?? 0) >= (fixed.x ?? 0) ? 1 : -1;
          free.x = (fixed.x ?? 0) + side * MARRIAGE_GAP;
          const newCenter = ((fixed.x ?? 0) + (free.x ?? 0)) / 2;
          const dx2 = newCenter - childCenter;
          for (const childId of childIds) {
            const child = graph.persons.get(childId);
            if (child && Number.isFinite(child.x)) child.x = (child.x ?? 0) + dx2;
          }
          continue;
        }
        const leftShared = (childbearingUnionCount.get(leftId) ?? 0) > 1;
        const rightShared = (childbearingUnionCount.get(rightId) ?? 0) > 1;
        if (left && right && Number.isFinite(left.x) && Number.isFinite(right.x) && leftShared !== rightShared) {
          const fixed = leftShared ? left : right;
          const free = leftShared ? right : left;
          const side = (free.x ?? 0) >= (fixed.x ?? 0) ? 1 : -1;
          free.x = (fixed.x ?? 0) + side * MARRIAGE_GAP;
          const newCenter = ((fixed.x ?? 0) + (free.x ?? 0)) / 2;
          const dx2 = newCenter - childCenter;
          for (const childId of childIds) {
            const child = graph.persons.get(childId);
            if (child && Number.isFinite(child.x)) child.x = (child.x ?? 0) + dx2;
          }
          continue;
        }
      }
      const parentCenter = parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length;
      const dx = childCenter - parentCenter;
      if (Math.abs(dx) < 0.5) continue;
      for (const partnerId of union.partners) {
        const partner = graph.persons.get(partnerId);
        if (partner && Number.isFinite(partner.x)) partner.x = (partner.x ?? 0) + dx;
      }
    }
  }
  function computeParentCenter(graph, partnerIds) {
    const xs = partnerIds.map((partnerId) => graph.persons.get(partnerId)?.x).filter((x) => Number.isFinite(x));
    return xs.reduce((sum, x) => sum + x, 0) / xs.length;
  }
  function alignGraphOriginLinks(graph, originLinks) {
    for (const link of originLinks) {
      const shared = graph.persons.get(link.sharedPersonId);
      if (!shared || !Number.isFinite(shared.x)) continue;
      const parentUnion = [...graph.childrenMap.entries()].find(
        ([, childIds]) => childIds.includes(link.sharedPersonId)
      );
      if (!parentUnion) continue;
      const union = graph.unions.get(parentUnion[0]);
      if (!union) continue;
      const parentXs = union.partners.map((id) => graph.persons.get(id)?.x).filter((x) => Number.isFinite(x));
      if (parentXs.length === 0) continue;
      const parentMid = parentXs.reduce((sum, x) => sum + x, 0) / parentXs.length;
      const dx = (shared.x ?? 0) - parentMid;
      if (Math.abs(dx) < 0.5) continue;
      const moveIds = collectMemberIds(link.originRoot);
      moveIds.delete(link.sharedPersonId);
      for (const id of moveIds) {
        const person = graph.persons.get(id);
        if (person && Number.isFinite(person.x)) person.x = (person.x ?? 0) + dx;
      }
    }
  }
  function alignGraphOriginMarriagesSafely(graph, originLinks) {
    for (const link of originLinks) {
      const shared = graph.persons.get(link.sharedPersonId);
      const otherId = link.couple.members.find((id) => id !== link.sharedPersonId);
      const other = otherId ? graph.persons.get(otherId) : void 0;
      if (!shared || !other || !Number.isFinite(shared.x) || !Number.isFinite(other.x)) continue;
      if (Math.abs((shared.x ?? 0) - (other.x ?? 0)) <= 100) continue;
      const sharedIsRight = (shared.x ?? 0) >= (other.x ?? 0);
      const targetX = (other.x ?? 0) + (sharedIsRight ? MARRIAGE_GAP : -MARRIAGE_GAP);
      const dx = targetX - (shared.x ?? 0);
      const moveIds = collectMemberIds(link.originRoot);
      const before = /* @__PURE__ */ new Map();
      for (const id of moveIds) {
        const person = graph.persons.get(id);
        if (!person || !Number.isFinite(person.x)) continue;
        before.set(id, person.x ?? 0);
        person.x = (person.x ?? 0) + dx;
      }
      if (hasGraphSymbolOverlap(graph)) {
        for (const [id, x] of before.entries()) {
          const person = graph.persons.get(id);
          if (person) person.x = x;
        }
      }
    }
  }
  function hasGraphSymbolOverlap(graph) {
    const people = [...graph.persons.values()].filter(
      (person) => Number.isFinite(person.x) && Number.isFinite(person.y)
    );
    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        if ((people[i].generation ?? 0) !== (people[j].generation ?? 0)) continue;
        if (Math.abs((people[i].x ?? 0) - (people[j].x ?? 0)) < NODE_SIZE - 0.5) return true;
      }
    }
    return false;
  }
  function compactWideGraphCoordinates(graph) {
    const people = [...graph.persons.values()].filter((person) => Number.isFinite(person.x));
    if (people.length === 0) return;
    const minX = Math.min(...people.map((person) => person.x ?? 0));
    const maxX = Math.max(...people.map((person) => person.x ?? 0));
    if (maxX - minX <= 100 * PERSON_GAP) return;
    const byGeneration = /* @__PURE__ */ new Map();
    for (const person of people) {
      const generation = person.generation ?? 0;
      if (!byGeneration.has(generation)) byGeneration.set(generation, []);
      byGeneration.get(generation)?.push(person.id);
    }
    for (const ids of byGeneration.values()) {
      const ordered = stableGraphTopologicalSort(graph, ids);
      ordered.forEach((id, index) => {
        const person = graph.persons.get(id);
        if (person) person.x = index * SYMBOL_CENTER_GAP;
      });
    }
  }
  function repairGraphOriginOverlaps(graph, originLinks) {
    const originSets = originLinks.map((link) => collectMemberIds(link.originRoot));
    const originSetByPerson = /* @__PURE__ */ new Map();
    for (const ids of originSets) {
      for (const id of ids) originSetByPerson.set(id, ids);
    }
    let anyChanged = false;
    for (let pass = 0; pass < 80; pass++) {
      const people = [...graph.persons.values()].filter((person) => Number.isFinite(person.x) && Number.isFinite(person.y)).sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0) || (a.x ?? 0) - (b.x ?? 0));
      let changed = false;
      for (const ids of originSets) {
        const originPeople = [...ids].map((id) => graph.persons.get(id)).filter((person) => !!person && Number.isFinite(person.x));
        if (originPeople.length === 0) continue;
        const generations = new Set(originPeople.map((person) => person.generation ?? 0));
        for (const generation of generations) {
          const sameGeneration = originPeople.filter((person) => (person.generation ?? 0) === generation);
          if (sameGeneration.length < 2) continue;
          const left = Math.min(...sameGeneration.map((person) => person.x ?? 0));
          const right = Math.max(...sameGeneration.map((person) => person.x ?? 0));
          const intruder = people.find(
            (person) => (person.generation ?? 0) === generation && !ids.has(person.id) && (person.x ?? 0) > left - NODE_SIZE && (person.x ?? 0) < right + NODE_SIZE
          );
          if (!intruder) continue;
          const dx = (intruder.x ?? 0) + NODE_SIZE - left;
          for (const id of ids) {
            const person = graph.persons.get(id);
            if (person && Number.isFinite(person.x)) person.x = (person.x ?? 0) + dx;
          }
          changed = true;
          anyChanged = true;
          break;
        }
        if (changed) break;
      }
      if (changed) continue;
      for (let i = 1; i < people.length; i++) {
        const previous = people[i - 1];
        const current = people[i];
        if ((previous.generation ?? 0) !== (current.generation ?? 0)) continue;
        const need = (previous.x ?? 0) + NODE_SIZE - (current.x ?? 0);
        if (need <= 0) continue;
        const previousOriginSet = originSetByPerson.get(previous.id);
        const currentOriginSet = originSetByPerson.get(current.id);
        const moveSet = currentOriginSet ?? previousOriginSet ?? /* @__PURE__ */ new Set([current.id]);
        const dx = currentOriginSet || !previousOriginSet ? need : -need;
        for (const id of moveSet) {
          const person = graph.persons.get(id);
          if (person && Number.isFinite(person.x)) person.x = (person.x ?? 0) + dx;
        }
        changed = true;
        anyChanged = true;
        break;
      }
      if (!changed) break;
    }
    return anyChanged;
  }
  function collectMemberIds(box) {
    const ids = /* @__PURE__ */ new Set();
    const visit = (current) => {
      current.members.forEach((id) => ids.add(id));
      if (current.top) visit(current.top);
      current.children?.forEach(visit);
    };
    visit(box);
    return ids;
  }
  function stableGraphTopologicalSort(graph, ids) {
    const sortedIds = [...ids].sort(
      (a, b) => (graph.persons.get(a)?.x ?? 0) - (graph.persons.get(b)?.x ?? 0) || a.localeCompare(b)
    );
    const originalIndex = new Map(sortedIds.map((id, index) => [id, index]));
    const constraints = new Map(sortedIds.map((id) => [id, /* @__PURE__ */ new Set()]));
    for (const childIds of graph.childrenMap.values()) {
      const sortedChildren2 = sortChildIdsByBirthOrder(graph, childIds).filter((childId) => constraints.has(childId));
      for (let i = 1; i < sortedChildren2.length; i++) {
        constraints.get(sortedChildren2[i - 1])?.add(sortedChildren2[i]);
      }
    }
    const indegree = new Map(sortedIds.map((id) => [id, 0]));
    for (const nextIds of constraints.values()) {
      for (const next of nextIds) {
        indegree.set(next, (indegree.get(next) ?? 0) + 1);
      }
    }
    const ready = sortedIds.filter((id) => (indegree.get(id) ?? 0) === 0);
    const out = [];
    while (ready.length > 0) {
      ready.sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0));
      const current = ready.shift();
      out.push(current);
      for (const next of constraints.get(current) ?? []) {
        indegree.set(next, (indegree.get(next) ?? 0) - 1);
        if ((indegree.get(next) ?? 0) === 0) ready.push(next);
      }
    }
    return out.length === sortedIds.length ? out : sortedIds;
  }
  function finalizeLayoutConstraints(graph, roots, originLinks) {
    for (let i = 0; i < 180; i++) {
      reconcileOrigins(roots, originLinks);
      realignFamilyTops(roots);
      const coupleChanged = resolveCoupleIntrusions(roots, originLinks);
      const overlapChanged = resolveActualSymbolOverlaps(roots, originLinks);
      reconcileOrigins(roots, originLinks);
      realignFamilyTops(roots);
      const finalOverlapChanged = resolveActualSymbolOverlaps(roots, originLinks);
      if (!coupleChanged && !overlapChanged && !finalOverlapChanged) break;
    }
    for (let i = 0; i < 8; i++) {
      const siblingChanged = enforceSiblingBirthOrderCoordinates(graph, roots, originLinks);
      const compacted = compactSiblingRows(roots, originLinks) || compactWideSiblingRows(roots, originLinks);
      reconcileOrigins(roots, originLinks);
      realignFamilyTops(roots);
      const overlapChanged = resolveActualSymbolOverlaps(roots, originLinks);
      if (!siblingChanged && !compacted && !overlapChanged) break;
    }
    resolveActualSymbolOverlaps(roots, originLinks);
  }
  function compactWideSiblingRows(roots, originLinks) {
    const originByCoreFamily = /* @__PURE__ */ new Map();
    for (const link of originLinks) {
      const coreFamily = nearestFamilyForTop(roots, link.couple);
      if (coreFamily) originByCoreFamily.set(coreFamily, link.originRoot);
    }
    const visit = (box) => {
      for (const child of box.children ?? []) {
        if (visit(child)) return true;
      }
      if (box.kind !== "family" || !box.children || box.children.length < 2) return false;
      for (let i = 1; i < box.children.length; i++) {
        const previous = box.children[i - 1];
        const current = box.children[i];
        const gap = primaryAnchorX(current) - primaryAnchorX(previous);
        const desiredGap = siblingAnchorGap(previous, current);
        if (gap <= desiredGap + 2 * PERSON_GAP) continue;
        const dx = (gap - desiredGap) / 2;
        shiftSubtree(previous, dx);
        const currentMovers = [current];
        const originRoot = originByCoreFamily.get(current);
        if (originRoot) currentMovers.push(originRoot);
        const boundedDx = boundNegativeShift(roots, currentMovers, -dx);
        currentMovers.forEach((mover) => shiftSubtree(mover, boundedDx));
        realignFamilyTops(roots);
        return true;
      }
      return false;
    };
    let anyChanged = false;
    for (let i = 0; i < 80; i++) {
      let changed = false;
      for (const root of roots) {
        changed = visit(root) || changed;
        if (changed) break;
      }
      anyChanged = anyChanged || changed;
      if (!changed) break;
    }
    return anyChanged;
  }
  function compactSiblingRows(roots, originLinks) {
    const pinnedMovers = new Set(originLinks.map((link) => link.originRoot));
    const originByCoreFamily = /* @__PURE__ */ new Map();
    for (const link of originLinks) {
      const coreFamily = nearestFamilyForTop(roots, link.couple);
      if (coreFamily) originByCoreFamily.set(coreFamily, link.originRoot);
    }
    let changed = false;
    const visit = (box) => {
      for (const child of box.children ?? []) {
        if (visit(child)) return true;
      }
      if (box.kind !== "family" || !box.children || box.children.length < 2) return false;
      for (let i = 1; i < box.children.length; i++) {
        const previous = box.children[i - 1];
        const current = box.children[i];
        const gap = primaryAnchorX(current) - primaryAnchorX(previous);
        const excess = gap - siblingAnchorGap(previous, current);
        if (excess <= 0.5) continue;
        const movers = [current];
        const originRoot = originByCoreFamily.get(current);
        if (originRoot) movers.push(originRoot);
        if (movers.some((mover) => pinnedMovers.has(mover)) && !originRoot) continue;
        const boundedDx = boundNegativeShift(roots, movers, -Math.min(excess, PERSON_GAP / 2));
        if (Math.abs(boundedDx) >= 0.5) {
          movers.forEach((mover) => shiftSubtree(mover, boundedDx));
        } else {
          const fallbackDx = Math.min(excess, PERSON_GAP / 2);
          if (pinnedMovers.has(previous)) continue;
          shiftSubtree(previous, fallbackDx);
        }
        realignFamilyTops(roots);
        changed = true;
        return true;
      }
      return false;
    };
    for (const root of roots) {
      if (visit(root)) break;
    }
    if (changed) {
      reconcileOrigins(roots, originLinks);
    }
    return changed;
  }
  function sortBoxesByGenerationOrder(roots, order) {
    const rank = buildOrderRank(order);
    const boxRank = (box) => {
      const memberRanks = box.members.map((id) => rank.get(id)).filter((value) => value != null);
      if (memberRanks.length > 0) return Math.min(...memberRanks);
      if (box.top) return boxRank(box.top);
      const childRanks = (box.children ?? []).map(boxRank).filter(Number.isFinite);
      return childRanks.length ? Math.min(...childRanks) : Number.POSITIVE_INFINITY;
    };
    const visit = (box) => {
      box.children?.forEach(visit);
      if (box.children) {
        box.children.sort((a, b) => boxRank(a) - boxRank(b));
      }
    };
    roots.forEach(visit);
    roots.sort((a, b) => boxRank(a) - boxRank(b));
  }
  function enforceGenerationOrder(roots, originLinks, order) {
    const rank = buildOrderRank(order);
    const pinnedMovers = new Set(originLinks.map((link) => link.originRoot));
    const originBundleByRoot = buildOriginBundleMap(roots, originLinks);
    const originRootByCoreFamily = buildOriginRootByCoreFamily(roots, originLinks);
    for (let pass = 0; pass < 64; pass++) {
      let changed = false;
      const entries = collectOrderedPersonEntries(roots, pinnedMovers, rank);
      for (let i = 1; i < entries.length; i++) {
        const previous = entries[i - 1];
        const current = entries[i];
        if (previous.gen !== current.gen) continue;
        if (previous.id === current.id) continue;
        if (previous.mover === current.mover) continue;
        const need = previous.x + SYMBOL_CENTER_GAP - current.x;
        if (need <= 0) continue;
        const currentBundle = originBundleByRoot.get(current.mover);
        const currentOriginRoot = originRootByCoreFamily.get(current.mover);
        const previousOriginRoot = originRootByCoreFamily.get(previous.mover);
        if (currentBundle) {
          shiftSubtree(currentBundle, need);
          shiftSubtree(current.mover, need);
        } else if (currentOriginRoot) {
          shiftSubtree(current.mover, need);
          shiftSubtree(currentOriginRoot, need);
        } else if (!pinnedMovers.has(current.mover)) {
          shiftSubtree(current.mover, need);
        } else if (!pinnedMovers.has(previous.mover)) {
          shiftSubtree(previous.mover, -need);
          if (previousOriginRoot) shiftSubtree(previousOriginRoot, -need);
        } else {
          continue;
        }
        realignFamilyTops(roots);
        reconcileOrigins(roots, originLinks);
        changed = true;
        break;
      }
      if (!changed) break;
    }
  }
  function collectOrderedPersonEntries(roots, pinnedRoots, rank) {
    return collectAuthoritativePersonEntries(roots, pinnedRoots).sort(
      (a, b) => a.gen - b.gen || (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.x - b.x || a.id.localeCompare(b.id)
    );
  }
  function buildOrderRank(order) {
    const rank = /* @__PURE__ */ new Map();
    for (const ids of order.values()) {
      ids.forEach((id, index) => rank.set(id, index));
    }
    return rank;
  }
  function compactPersonGaps(roots, originLinks, order) {
    const pinnedMovers = new Set(originLinks.map((link) => link.originRoot));
    const originBundleByRoot = buildOriginBundleMap(roots, originLinks);
    const rank = order ? buildOrderRank(order) : void 0;
    const byGeneration = /* @__PURE__ */ new Map();
    for (const entry of collectAuthoritativePersonEntries(roots, pinnedMovers)) {
      if (!byGeneration.has(entry.gen)) byGeneration.set(entry.gen, []);
      byGeneration.get(entry.gen)?.push(entry);
    }
    for (const entries of byGeneration.values()) {
      entries.sort((a, b) => personEntryCompare(a, b, rank));
      for (let i = 1; i < entries.length; i++) {
        const previous = entries[i - 1];
        const current = entries[i];
        if (previous.id === current.id) continue;
        if (previous.mover === current.mover) continue;
        const gap = current.x - previous.x;
        const excess = gap - preferredGap(previous, current);
        if (excess <= PERSON_GAP) continue;
        const requestedDx = -Math.min(excess, PERSON_GAP / 2);
        const currentBundle = originBundleByRoot.get(current.mover);
        if (currentBundle) {
          const movers = [currentBundle, current.mover];
          const boundedDx = boundNegativeShift(roots, movers, requestedDx);
          if (Math.abs(boundedDx) < 0.5) continue;
          movers.forEach((mover) => shiftSubtree(mover, boundedDx));
        } else if (!pinnedMovers.has(current.mover)) {
          const boundedDx = boundNegativeShift(roots, [current.mover], requestedDx);
          if (Math.abs(boundedDx) < 0.5) continue;
          shiftSubtree(current.mover, boundedDx);
        } else {
          continue;
        }
        realignFamilyTops(roots);
        return true;
      }
    }
    return false;
  }
  function preferredGap(a, b) {
    return a.mover === b.mover ? NODE_SIZE : PERSON_GAP;
  }
  function resolvePersonSymbolOverlaps(roots, originLinks, order) {
    const pinnedMovers = new Set(originLinks.map((link) => link.originRoot));
    const originBundleByRoot = buildOriginBundleMap(roots, originLinks);
    const originRootByCoreFamily = buildOriginRootByCoreFamily(roots, originLinks);
    const rank = order ? buildOrderRank(order) : void 0;
    let changed = false;
    for (let pass = 0; pass < 24; pass++) {
      const entries = collectAuthoritativePersonEntries(roots, pinnedMovers).sort((a, b) => personEntryCompare(a, b, rank));
      let passChanged = false;
      for (let i = 1; i < entries.length; i++) {
        const previous = entries[i - 1];
        const current = entries[i];
        if (previous.gen !== current.gen) continue;
        if (previous.id === current.id) continue;
        if (previous.mover === current.mover) continue;
        const need = SYMBOL_CENTER_GAP - (current.x - previous.x);
        if (need <= 0) continue;
        const currentBundle = originBundleByRoot.get(current.mover);
        const currentOriginRoot = originRootByCoreFamily.get(current.mover);
        const previousOriginRoot = originRootByCoreFamily.get(previous.mover);
        if (primaryAnchorX(current.mover) < previous.x - 0.5 && !pinnedMovers.has(previous.mover)) {
          const dx = current.x + SYMBOL_CENTER_GAP - previous.x;
          shiftSubtree(previous.mover, dx);
          if (previousOriginRoot) shiftSubtree(previousOriginRoot, dx);
        } else if (currentBundle) {
          shiftSubtree(currentBundle, need);
          shiftSubtree(current.mover, need);
        } else if (currentOriginRoot) {
          shiftSubtree(current.mover, need);
          shiftSubtree(currentOriginRoot, need);
        } else if (!pinnedMovers.has(current.mover)) {
          shiftSubtree(current.mover, need);
        } else if (!pinnedMovers.has(previous.mover)) {
          shiftSubtree(previous.mover, -need);
          if (previousOriginRoot) shiftSubtree(previousOriginRoot, -need);
        } else {
          continue;
        }
        realignFamilyTops(roots);
        changed = true;
        passChanged = true;
        break;
      }
      if (!passChanged) break;
    }
    return changed;
  }
  function resolveActualSymbolOverlaps(roots, originLinks, generationFilter) {
    const pinnedMovers = new Set(originLinks.map((link) => link.originRoot));
    const originBundleByRoot = buildOriginBundleMap(roots, originLinks);
    const originRootByCoreFamily = buildOriginRootByCoreFamily(roots, originLinks);
    let anyChanged = false;
    for (let pass = 0; pass < 160; pass++) {
      const entries = collectAuthoritativePersonEntries(roots, pinnedMovers).sort((a, b) => a.gen - b.gen || a.x - b.x || a.id.localeCompare(b.id));
      let changed = false;
      for (let i = 1; i < entries.length; i++) {
        const previous = entries[i - 1];
        const current = entries[i];
        if (previous.gen !== current.gen) continue;
        if (generationFilter != null && current.gen !== generationFilter) continue;
        if (previous.mover === current.mover) continue;
        const need = previous.x + SYMBOL_CENTER_GAP - current.x;
        if (need <= 0) continue;
        const currentBundle = originBundleByRoot.get(current.mover);
        const currentOriginRoot = originRootByCoreFamily.get(current.mover);
        const previousOriginRoot = originRootByCoreFamily.get(previous.mover);
        if (currentBundle) {
          shiftSubtree(currentBundle, need);
          shiftSubtree(current.mover, need);
        } else if (currentOriginRoot) {
          shiftSubtree(current.mover, need);
          shiftSubtree(currentOriginRoot, need);
        } else if (!pinnedMovers.has(current.mover)) {
          shiftSubtree(current.mover, need);
        } else if (!pinnedMovers.has(previous.mover)) {
          shiftSubtree(previous.mover, -need);
          if (previousOriginRoot) shiftSubtree(previousOriginRoot, -need);
        } else {
          continue;
        }
        reconcileOrigins(roots, originLinks);
        realignFamilyTops(roots);
        changed = true;
        anyChanged = true;
        break;
      }
      if (!changed) break;
    }
    return anyChanged;
  }
  function enforceSiblingBirthOrderCoordinates(graph, roots, originLinks) {
    const pinnedMovers = new Set(originLinks.map((link) => link.originRoot));
    const originBundleByRoot = buildOriginBundleMap(roots, originLinks);
    const originRootByCoreFamily = buildOriginRootByCoreFamily(roots, originLinks);
    let changed = false;
    for (const childIds of graph.childrenMap.values()) {
      const sorted = sortChildIdsByBirthOrder(graph, childIds);
      for (let i = 1; i < sorted.length; i++) {
        const previous = findAuthoritativeEntry(roots, pinnedMovers, sorted[i - 1]);
        const current = findAuthoritativeEntry(roots, pinnedMovers, sorted[i]);
        if (!previous || !current || previous.gen !== current.gen) continue;
        const previousRight = entryFootprintRight(previous);
        const currentLeft = entryFootprintLeft(current);
        const need = previousRight + SYMBOL_CENTER_GAP - currentLeft;
        if (need <= 0) continue;
        moveEntryRight(current, need, pinnedMovers, originBundleByRoot, originRootByCoreFamily);
        changed = true;
      }
    }
    if (changed) realignFamilyTops(roots);
    return changed;
  }
  function findAuthoritativeEntry(roots, pinnedRoots, id) {
    return collectAuthoritativePersonEntries(roots, pinnedRoots).find((entry) => entry.id === id);
  }
  function sortChildIdsByBirthOrder(graph, childIds) {
    return [...childIds].sort((a, b) => {
      const left = graph.persons.get(a)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
      const right = graph.persons.get(b)?.birthOrder ?? Number.MAX_SAFE_INTEGER;
      return left - right || a.localeCompare(b);
    });
  }
  function entryFootprintLeft(entry) {
    return Math.min(...entry.box.members.map((id) => entry.box.anchorX(id)));
  }
  function entryFootprintRight(entry) {
    return Math.max(...entry.box.members.map((id) => entry.box.anchorX(id)));
  }
  function moveEntryRight(entry, dx, pinnedMovers, originBundleByRoot, originRootByCoreFamily) {
    const bundle = originBundleByRoot.get(entry.mover);
    const originRoot = originRootByCoreFamily.get(entry.mover);
    if (bundle) {
      shiftSubtree(bundle, dx);
      shiftSubtree(entry.mover, dx);
    } else if (originRoot) {
      shiftSubtree(entry.mover, dx);
      shiftSubtree(originRoot, dx);
    } else if (entry.box.kind === "person") {
      shiftSubtree(entry.box, dx);
    } else if (!pinnedMovers.has(entry.mover)) {
      shiftSubtree(entry.mover, dx);
    }
  }
  function resolveCoupleIntrusions(roots, originLinks) {
    const pinnedMovers = new Set(originLinks.map((link) => link.originRoot));
    const originBundleByRoot = buildOriginBundleMap(roots, originLinks);
    const originRootByCoreFamily = buildOriginRootByCoreFamily(roots, originLinks);
    let anyChanged = false;
    for (let pass = 0; pass < 80; pass++) {
      let changed = false;
      const entries = collectAuthoritativePersonEntries(roots, pinnedMovers);
      const couples = collectBoxes(roots).filter((box) => box.kind === "couple" && box.members.length === 2);
      for (const couple of couples) {
        const left = Math.min(...couple.members.map((id) => couple.anchorX(id)));
        const right = Math.max(...couple.members.map((id) => couple.anchorX(id)));
        for (const entry of entries) {
          if (entry.gen !== couple.gen || couple.members.includes(entry.id)) continue;
          if (entry.x <= left || entry.x >= right) continue;
          const need = right + SYMBOL_CENTER_GAP - entry.x;
          moveEntryRight(entry, need, pinnedMovers, originBundleByRoot, originRootByCoreFamily);
          reconcileOrigins(roots, originLinks);
          realignFamilyTops(roots);
          changed = true;
          anyChanged = true;
          break;
        }
        if (changed) break;
      }
      if (!changed) break;
    }
    return anyChanged;
  }
  function personEntryCompare(a, b, rank) {
    if (!rank) return a.gen - b.gen || a.x - b.x || a.id.localeCompare(b.id);
    return a.gen - b.gen || (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.x - b.x || a.id.localeCompare(b.id);
  }
  function buildOriginBundleMap(roots, originLinks) {
    const originBundleByRoot = /* @__PURE__ */ new Map();
    for (const link of originLinks) {
      const coreFamily = nearestFamilyForTop(roots, link.couple);
      if (coreFamily) originBundleByRoot.set(link.originRoot, coreFamily);
    }
    return originBundleByRoot;
  }
  function buildOriginRootByCoreFamily(roots, originLinks) {
    const originRootByCoreFamily = /* @__PURE__ */ new Map();
    for (const link of originLinks) {
      const coreFamily = nearestFamilyForTop(roots, link.couple);
      if (coreFamily) originRootByCoreFamily.set(coreFamily, link.originRoot);
    }
    return originRootByCoreFamily;
  }
  function collectPersonEntries(roots, pinnedRoots) {
    const entries = [];
    const visit = (box, mover, pinnedMover) => {
      const activeMover = pinnedMover ?? mover;
      if (box.kind === "family") {
        const nextPinned = pinnedRoots.has(box) ? box : pinnedMover;
        if (box.top) visit(box.top, box, nextPinned);
        box.children?.forEach((child) => visit(child, child, nextPinned));
        return;
      }
      for (const id of box.members) {
        entries.push({ id, x: box.anchorX(id), gen: box.gen, mover: activeMover, box });
      }
    };
    roots.forEach((root) => visit(root, root));
    return entries;
  }
  function collectAuthoritativePersonEntries(roots, pinnedRoots) {
    const byId = /* @__PURE__ */ new Map();
    for (const entry of collectPersonEntries(roots, pinnedRoots)) {
      const previous = byId.get(entry.id);
      if (!previous) {
        byId.set(entry.id, entry);
        continue;
      }
      const previousPinned = pinnedRoots.has(previous.mover);
      const currentPinned = pinnedRoots.has(entry.mover);
      if (previousPinned && !currentPinned) {
        byId.set(entry.id, entry);
      }
    }
    return [...byId.values()];
  }
  function boundNegativeShift(roots, movers, requestedDx) {
    if (requestedDx >= 0) return requestedDx;
    const entries = collectPersonEntries(roots, /* @__PURE__ */ new Set()).sort((a, b) => a.gen - b.gen || a.x - b.x);
    let allowed = Number.POSITIVE_INFINITY;
    for (let i = 0; i < entries.length; i++) {
      const current = entries[i];
      if (!isMovedEntry(current, movers)) continue;
      for (let j = i - 1; j >= 0; j--) {
        const previous = entries[j];
        if (previous.gen !== current.gen) break;
        if (isMovedEntry(previous, movers)) continue;
        allowed = Math.min(allowed, current.x - previous.x - SYMBOL_CENTER_GAP);
        break;
      }
    }
    if (!Number.isFinite(allowed)) return requestedDx;
    return -Math.max(0, Math.min(Math.abs(requestedDx), allowed));
  }
  function isMovedEntry(entry, movers) {
    return movers.some((mover) => mover === entry.box || containsBox2(mover, entry.box));
  }
  function realignFamilyTops(roots) {
    const visit = (box) => {
      box.children?.forEach(visit);
      if (box.kind !== "family" || !box.top || !box.children || box.children.length === 0) return;
      placeBox(box.top, familyDropX(box));
    };
    roots.forEach(visit);
  }
  function familyDropX(box) {
    if (box.exitMember) {
      const exitX = memberAnchorX(box, box.exitMember);
      if (exitX != null) return exitX;
    }
    return childAnchorDropX(box.children ?? []);
  }
  function writeBackCoordinates(graph, roots, originLinks = []) {
    const sharedPeople = new Set(originLinks.map((link) => link.sharedPersonId));
    const boxes = collectBoxesPostorder(roots);
    for (const box of boxes) {
      for (const memberId of box.members) {
        if (sharedPeople.has(memberId)) continue;
        const person = graph.persons.get(memberId);
        if (!person) continue;
        person.x = box.anchorX(memberId);
        person.y = box.gen * GENERATION_GAP;
      }
    }
    for (const link of originLinks) {
      const person = graph.persons.get(link.sharedPersonId);
      if (!person) continue;
      person.x = link.couple.anchorX(link.sharedPersonId);
      person.y = link.couple.gen * GENERATION_GAP;
    }
  }
  function normalizeGraphToOrigin(graph) {
    const people = [...graph.persons.values()].filter(
      (person) => Number.isFinite(person.x) && Number.isFinite(person.y)
    );
    if (people.length === 0) return;
    const minX = Math.min(...people.map((person) => person.x ?? 0));
    for (const person of people) {
      person.x = (person.x ?? 0) - minX;
    }
  }
  function collectBoxesPostorder(boxes) {
    const out = [];
    const visit = (box) => {
      if (box.top) visit(box.top);
      box.children?.forEach(visit);
      out.push(box);
    };
    boxes.forEach(visit);
    return out;
  }

  // src/layout/computeLayout.ts
  function computeLayout(graph) {
    let g = assignLayers(graph);
    g = reduceCrossings(g);
    g = assignCoordinates(g);
    return g;
  }

  // src/layout/layoutResultBuilder.ts
  var R = NODE_SIZE / 2;
  var SIBSHIP_DROP = NODE_SIZE * 1.25;
  function buildLayoutResult(graph, input) {
    const nodes = [...graph.persons.values()].map((person) => ({
      id: person.id,
      sex: person.sex,
      affected: person.affected,
      carrier: person.carrier,
      x: person.x ?? 0,
      y: person.y ?? 0,
      generation: person.generation ?? 0
    }));
    const positions = nodes.map((person) => ({
      id: person.id,
      x: person.x,
      y: person.y,
      generation: person.generation
    }));
    const inputPeople = new Map(input.persons.map((person) => [person.id, person]));
    const inputUnions = new Map(input.unions.map((union) => [union.id, union]));
    const unionAnchors = buildUnionAnchors(graph);
    const relationshipSegments = buildRelationshipSegments(graph, inputPeople, inputUnions, unionAnchors);
    const bounds = computeBounds(nodes);
    const generationLabels = buildGenerationLabels(nodes, bounds);
    return {
      nodes,
      positions,
      relationshipSegments,
      unionAnchors,
      bounds,
      generationLabels
    };
  }
  function applyManualNodePositionsToLayout(options) {
    const peopleById = new Map(options.people.map((person) => [person.id, person]));
    const nodes = options.layout.nodes.map((node) => {
      const person = peopleById.get(node.id);
      if (!person?.manual) return { ...node };
      return {
        ...node,
        x: Number.isFinite(person.x) ? person.x : node.x,
        y: Number.isFinite(person.y) ? person.y : node.y
      };
    });
    const positions = nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      generation: node.generation
    }));
    const graph = graphFromLayout(nodes, options.unions, options.childrenMap);
    validateGraph(graph);
    const inputPeople = new Map(options.people.map((person) => [person.id, person]));
    const inputUnions = new Map(options.unions.map((union) => [union.id, union]));
    const unionAnchors = buildUnionAnchors(graph);
    const relationshipSegments = buildRelationshipSegments(graph, inputPeople, inputUnions, unionAnchors);
    const bounds = computeBounds(nodes);
    const generationLabels = buildGenerationLabels(nodes, bounds);
    return {
      ...options.layout,
      nodes,
      positions,
      relationshipSegments,
      unionAnchors,
      bounds,
      generationLabels
    };
  }
  function graphFromLayout(nodes, unions, childrenMap) {
    return {
      persons: new Map(nodes.map((node) => [
        node.id,
        {
          id: node.id,
          sex: node.sex,
          generation: node.generation,
          x: node.x,
          y: node.y
        }
      ])),
      unions: new Map(unions.map((union) => [
        union.id,
        {
          id: union.id,
          partners: normalizePartners(union)
        }
      ])),
      childrenMap: new Map(childrenMap.map(([unionId, childIds]) => [unionId, [...childIds]]))
    };
  }
  function normalizePartners(union) {
    if (union.partners.length === 1) return [union.partners[0]];
    if (union.partners.length === 2) return [union.partners[0], union.partners[1]];
    throw new GraphValidationError(
      "GRAPH_UNION_PARTNER_COUNT",
      `union ${union.id} must have 1 or 2 partners, got ${union.partners.length}`,
      { unionId: union.id, partners: union.partners }
    );
  }
  function buildUnionAnchors(graph) {
    return [...graph.unions.values()].flatMap((union) => {
      const partners = union.partners.map((id) => graph.persons.get(id)).filter(hasCoordinates);
      if (partners.length === 0) return [];
      return [{
        unionId: union.id,
        partnerIds: [...union.partners],
        x: avg(partners.map((person) => person.x)),
        y: avg(partners.map((person) => person.y))
      }];
    });
  }
  function buildRelationshipSegments(graph, inputPeople, inputUnions, unionAnchors) {
    const segments = [];
    const anchors = new Map(unionAnchors.map((anchor) => [anchor.unionId, anchor]));
    for (const union of graph.unions.values()) {
      const parentIds = [...union.partners];
      const childIds = [...graph.childrenMap.get(union.id) ?? []];
      const partners = union.partners.map((id) => graph.persons.get(id)).filter(hasCoordinates);
      if (partners.length === 2) {
        const [left, right] = partners[0].x <= partners[1].x ? [partners[0], partners[1]] : [partners[1], partners[0]];
        const points = Math.abs(left.y - right.y) < 0.5 ? [{ x: left.x + R, y: left.y }, { x: right.x - R, y: right.y }] : [
          { x: left.x + R, y: left.y },
          { x: (left.x + right.x) / 2, y: left.y },
          { x: (left.x + right.x) / 2, y: right.y },
          { x: right.x - R, y: right.y }
        ];
        segments.push({
          id: `${union.id}:marriage`,
          type: "marriage",
          kind: "marriage",
          unionId: union.id,
          partnerIds: parentIds,
          parentIds,
          source: {
            unionId: union.id,
            parentIds,
            personIds: parentIds
          },
          points,
          doubleLine: !!inputUnions.get(union.id)?.consanguineous
        });
      }
      const kids = childIds.map((id) => graph.persons.get(id)).filter(hasCoordinates);
      if (kids.length === 0 || partners.length === 0) continue;
      const anchor = anchors.get(union.id);
      const dropX = anchor?.x ?? avg(partners.map((person) => person.x));
      const dropTopY = partners.length === 2 ? anchor?.y ?? avg(partners.map((person) => person.y)) : partners[0].y + R;
      const childTopY = Math.min(...kids.map((kid) => kid.y)) - R;
      const siblingY = childTopY - SIBSHIP_DROP + R;
      const sortedKids = [...kids].sort((a, b) => a.x - b.x);
      const minKidX = sortedKids[0].x;
      const maxKidX = sortedKids[sortedKids.length - 1].x;
      segments.push({
        id: `${union.id}:descent`,
        type: "descent",
        kind: "parent-drop",
        unionId: union.id,
        parentIds,
        childIds,
        source: {
          unionId: union.id,
          parentIds,
          childIds
        },
        points: [{ x: dropX, y: dropTopY }, { x: dropX, y: siblingY }]
      });
      if (kids.length > 1 || Math.abs(kids[0].x - dropX) >= 0.5) {
        segments.push({
          id: `${union.id}:sibling`,
          type: "sibling",
          kind: "sibling-line",
          unionId: union.id,
          childIds,
          source: {
            unionId: union.id,
            childIds
          },
          points: [{ x: Math.min(minKidX, dropX), y: siblingY }, { x: Math.max(maxKidX, dropX), y: siblingY }]
        });
      }
      for (const group of groupChildren(sortedKids, inputPeople)) {
        if (!group.twinGroup || group.children.length === 1) {
          for (const child of group.children) {
            segments.push({
              id: `${union.id}:${child.id}:individual`,
              type: "individual",
              kind: "child-drop",
              unionId: union.id,
              personId: child.id,
              childIds: [child.id],
              source: {
                unionId: union.id,
                childIds: [child.id],
                personIds: [child.id]
              },
              points: [{ x: child.x, y: siblingY }, { x: child.x, y: child.y - R }]
            });
          }
          continue;
        }
        const apexX = avg(group.children.map((child) => child.x));
        const forkY = siblingY + SIBSHIP_DROP * 0.55;
        for (const child of group.children) {
          segments.push({
            id: `${union.id}:${child.id}:twin`,
            type: "individual",
            kind: "twin",
            unionId: union.id,
            personId: child.id,
            childIds: [child.id],
            twinGroup: group.twinGroup,
            source: {
              unionId: union.id,
              childIds: [child.id],
              personIds: [child.id]
            },
            points: [{ x: apexX, y: siblingY }, { x: child.x, y: forkY }, { x: child.x, y: child.y - R }]
          });
        }
        if (group.twinType === "identical") {
          const xs = group.children.map((child) => child.x).sort((a, b) => a - b);
          const barY = (siblingY + forkY) / 2;
          const t = (barY - siblingY) / (forkY - siblingY);
          segments.push({
            id: `${union.id}:${group.twinGroup}:twin-bar`,
            type: "twin-bar",
            kind: "twin-bar",
            unionId: union.id,
            childIds: group.children.map((child) => child.id),
            twinGroup: group.twinGroup,
            source: {
              unionId: union.id,
              childIds: group.children.map((child) => child.id),
              personIds: group.children.map((child) => child.id)
            },
            points: [
              { x: apexX + (xs[0] - apexX) * t, y: barY },
              { x: apexX + (xs[xs.length - 1] - apexX) * t, y: barY }
            ]
          });
        }
      }
    }
    return segments;
  }
  function groupChildren(children, inputPeople) {
    const groups = [];
    const twins = /* @__PURE__ */ new Map();
    for (const child of children) {
      const meta = inputPeople.get(child.id);
      if (!meta?.twinGroup) {
        groups.push({ children: [child] });
        continue;
      }
      if (!twins.has(meta.twinGroup)) twins.set(meta.twinGroup, []);
      twins.get(meta.twinGroup)?.push(child);
    }
    for (const [twinGroup, twinChildren] of twins) {
      groups.push({
        twinGroup,
        twinType: inputPeople.get(twinChildren[0].id)?.twinType ?? "fraternal",
        children: twinChildren
      });
    }
    return groups.sort((a, b) => a.children[0].x - b.children[0].x);
  }
  function computeBounds(nodes) {
    if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    const minX = Math.min(...nodes.map((node) => node.x)) - R;
    const minY = Math.min(...nodes.map((node) => node.y)) - R;
    const maxX = Math.max(...nodes.map((node) => node.x)) + R;
    const maxY = Math.max(...nodes.map((node) => node.y)) + R;
    return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  }
  function buildGenerationLabels(nodes, bounds) {
    const rows = /* @__PURE__ */ new Map();
    for (const node of nodes) {
      if (!rows.has(node.generation)) rows.set(node.generation, []);
      rows.get(node.generation)?.push(node);
    }
    return [...rows.keys()].sort((a, b) => a - b).map((generation, index) => {
      const row = rows.get(generation) ?? [];
      return {
        generation,
        label: roman(index + 1),
        x: bounds.minX - 48,
        y: avg(row.map((node) => node.y))
      };
    });
  }
  function hasCoordinates(person) {
    return !!person && Number.isFinite(person.x) && Number.isFinite(person.y);
  }
  function avg(values) {
    return values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
  }
  function roman(n) {
    const table = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
    let out = "";
    let value = n;
    for (const [symbol, amount] of table) {
      while (value >= amount) {
        out += symbol;
        value -= amount;
      }
    }
    return out || "I";
  }

  // src/browser/entry.ts
  function layout(input) {
    try {
      validateLayoutInput(input);
      const graph = layoutInputToGraph(input);
      const validGraph = validateGraph(graph);
      const laidOutGraph = computeLayout(validGraph);
      return { ok: true, layout: buildLayoutResult(laidOutGraph, input) };
    } catch (error) {
      const failure = layoutFailure(error);
      console.error("[PedigreeEngine] layout failed:", failure.error.message, failure.error);
      return failure;
    }
  }
  function layoutResult(input) {
    const response = layout(input);
    return response.ok ? response.layout : null;
  }
  function layoutPositions(input) {
    const result = layoutResult(input);
    return result ? result.positions : null;
  }
  function legacyPositions(result) {
    return result.positions;
  }
  function validateLayoutInput(input) {
    if (!input || !Array.isArray(input.persons)) {
      throw new GraphValidationError("LAYOUT_INPUT_PERSONS_INVALID", "layout input persons must be an array", { input });
    }
    if (!Array.isArray(input.unions)) {
      throw new GraphValidationError("LAYOUT_INPUT_UNIONS_INVALID", "layout input unions must be an array", { input });
    }
    if (!Array.isArray(input.childrenMap)) {
      throw new GraphValidationError("LAYOUT_INPUT_CHILDREN_MAP_INVALID", "layout input childrenMap must be an array of [unionId, childIds] entries", { input });
    }
    assertUniqueIds(input.persons.map((person) => person.id), "person");
    assertUniqueIds(input.unions.map((union) => union.id), "union");
    validateUnionPartners(input);
    validateChildrenMapEntries(input.childrenMap);
  }
  function layoutInputToGraph(input) {
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
          partners: normalizePartners(union)
        }
      ])),
      childrenMap: new Map(input.childrenMap.map(([unionId, childIds]) => [unionId, [...childIds]]))
    };
  }
  function assertUniqueIds(ids, kind) {
    const seen = /* @__PURE__ */ new Set();
    for (const id of ids) {
      if (!id) {
        throw new GraphValidationError(
          kind === "person" ? "GRAPH_PERSON_ID_EMPTY" : "GRAPH_UNION_ID_EMPTY",
          `${kind} id must be non-empty`,
          { id }
        );
      }
      if (seen.has(id)) {
        throw new GraphValidationError(
          kind === "person" ? "GRAPH_PERSON_ID_DUPLICATE" : "GRAPH_UNION_ID_DUPLICATE",
          `duplicate ${kind} id ${id}`,
          { id }
        );
      }
      seen.add(id);
    }
  }
  function validateUnionPartners(input) {
    for (const union of input.unions) {
      if (!Array.isArray(union.partners)) {
        throw new GraphValidationError(
          "LAYOUT_INPUT_UNION_PARTNERS_INVALID",
          `union ${union.id} partners must be an array`,
          { unionId: union.id, partners: union.partners }
        );
      }
      for (const partnerId of union.partners) {
        if (!partnerId) {
          throw new GraphValidationError(
            "LAYOUT_INPUT_UNION_PARTNER_EMPTY",
            `union ${union.id} contains an empty partner id`,
            { unionId: union.id, partners: union.partners }
          );
        }
      }
    }
  }
  function validateChildrenMapEntries(childrenMap) {
    const seenUnionIds = /* @__PURE__ */ new Set();
    for (const entry of childrenMap) {
      if (!Array.isArray(entry) || entry.length !== 2 || !Array.isArray(entry[1])) {
        throw new GraphValidationError(
          "LAYOUT_INPUT_CHILDREN_MAP_ENTRY_INVALID",
          "childrenMap entries must be [unionId, childIds[]]",
          { entry }
        );
      }
      const [unionId, childIds] = entry;
      if (!unionId) {
        throw new GraphValidationError(
          "LAYOUT_INPUT_CHILDREN_MAP_UNION_EMPTY",
          "childrenMap union id must be non-empty",
          { entry }
        );
      }
      if (seenUnionIds.has(unionId)) {
        throw new GraphValidationError(
          "LAYOUT_INPUT_CHILDREN_MAP_UNION_DUPLICATE",
          `childrenMap contains duplicate union entry ${unionId}`,
          { unionId }
        );
      }
      seenUnionIds.add(unionId);
      const seenChildIds = /* @__PURE__ */ new Set();
      for (const childId of childIds) {
        if (!childId) {
          throw new GraphValidationError(
            "LAYOUT_INPUT_CHILDREN_MAP_CHILD_EMPTY",
            `childrenMap entry ${unionId} contains an empty child id`,
            { unionId, childIds }
          );
        }
        if (seenChildIds.has(childId)) {
          throw new GraphValidationError(
            "LAYOUT_INPUT_CHILDREN_MAP_CHILD_DUPLICATE",
            `childrenMap entry ${unionId} contains duplicate child id ${childId}`,
            { unionId, childId }
          );
        }
        seenChildIds.add(childId);
      }
    }
  }
  function layoutFailure(error) {
    if (error instanceof GraphValidationError) {
      return {
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          details: error.details
        }
      };
    }
    if (error instanceof Error) {
      return {
        ok: false,
        error: {
          message: error.message || "layout failed"
        }
      };
    }
    return {
      ok: false,
      error: {
        message: "layout failed",
        details: error
      }
    };
  }
  globalThis.PedigreeEngine = { layout, layoutResult, layoutPositions, applyManualNodePositionsToLayout };
})();
