import { PedigreeGraph } from "../model/pedigreeGraph";
import { assertLayoutInvariants } from "../rules/validation";
import { Box, createPersonBox, GENERATION_GAP, MARRIAGE_GAP, MIN_GAP, NODE_SIZE, PERSON_GAP, SIBLING_GAP, SLOT } from "./boxModel";
import { sortChildrenForLayout } from "./childOrdering";
import { buildForest, OriginLink } from "./familyForest";
import { buildLayoutPlan, LayoutPlan } from "./layoutPlan";
import { GenerationOrder, getGenerationOrder } from "./layoutOrder";

const SYMBOL_MARGIN = NODE_SIZE * 0.3;
const SYMBOL_CENTER_GAP = NODE_SIZE + SYMBOL_MARGIN;

export function buildInitialPersonBoxes(graph: PedigreeGraph): Box[] {
  return [...graph.persons.values()].map((person) =>
    createPersonBox(person.id, person.generation ?? 0)
  );
}

export function measureBox(box: Box): number {
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
    const childrenW = children.reduce((sum, child, index) =>
      sum + measureBox(child) + (index === 0 ? 0 : SIBLING_GAP), 0);
    box._childrenW = childrenW;
    box._topW = topW;
    box.width = Math.max(childrenW, topW);
    return box.width;
  }

  return box.width;
}

export function placeBox(box: Box, centerX: number) {
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

export function shiftSubtree(box: Box, dx: number) {
  if (Math.abs(dx) < 0.01) return;
  box.cx += dx;
  if (box.top) shiftSubtree(box.top, dx);
  box.children?.forEach((child) => shiftSubtree(child, dx));
}

export function shiftSubtreeY(box: Box, generationDelta: number) {
  if (generationDelta !== 0) {
    throw new Error("layout invariant failed: coordinate solver must not change generation");
  }
}

export function reconcileOrigins(roots: Box[], originLinks: OriginLink[]) {
  let changed = reconcileOriginRounds(roots, originLinks);

  for (const link of originLinks) {
    changed = alignOriginLink(link) || changed;
  }

  return changed;
}

function reconcileOriginRounds(roots: Box[], originLinks: OriginLink[]) {
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

function alignOriginLink(link: OriginLink) {
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

export function resolveGenerationOverlaps(roots: Box[], pinnedMovers = new Set<Box>()) {
  let changed = false;
  for (let pass = 0; pass < 120; pass++) {
    let passChanged = false;
    const boxesByGeneration = new Map<number, VisibleBox[]>();
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

function collectBoxes(boxes: Box[]): Box[] {
  const out: Box[] = [];
  const visit = (box: Box) => {
    out.push(box);
    if (box.top) visit(box.top);
    box.children?.forEach(visit);
  };
  boxes.forEach(visit);
  return out;
}

interface VisibleBox {
  box: Box;
  mover: Box;
}

function collectVisibleBoxes(boxes: Box[]): VisibleBox[] {
  const out: VisibleBox[] = [];
  const visit = (box: Box, mover: Box) => {
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

function memberAnchorX(box: Box, memberId: string): number | null {
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

function memberGeneration(box: Box, memberId: string): number | null {
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

function nearestFamilyForTop(roots: Box[], targetTop: Box): Box | null {
  const families = collectBoxes(roots).filter((box) => box.kind === "family" && box.top);
  return families.find((family) => family.top === targetTop || containsBox(family.top!, targetTop)) ?? null;
}

function containsBox(box: Box, target: Box): boolean {
  if (box === target) return true;
  if (box.top && containsBox(box.top, target)) return true;
  return box.children?.some((child) => containsBox(child, target)) ?? false;
}

function leftOf(box: Box): number {
  return box.cx - box.width / 2;
}

function rightOf(box: Box): number {
  return box.cx + box.width / 2;
}

function childAnchorDropX(children: Box[]): number {
  if (children.length === 0) return 0;
  if (children.length === 1) return primaryAnchorX(children[0]);
  return (primaryAnchorX(children[0]) + primaryAnchorX(children[children.length - 1])) / 2;
}

function primaryAnchorX(box: Box): number {
  if (box.kind === "family" && box.top) return primaryAnchorX(box.top);
  const anchorMember = box.mainPersonId ?? box.members[0];
  return anchorMember ? box.anchorX(anchorMember) : box.cx;
}

function siblingAnchorGap(previous: Box, current: Box): number {
  if (!requiresSiblingFamilySpace(previous) && !requiresSiblingFamilySpace(current)) return PERSON_GAP;
  const previousRight = rightOf(previous) - primaryAnchorX(previous);
  const currentLeft = primaryAnchorX(current) - leftOf(current);
  return Math.max(PERSON_GAP, previousRight + MIN_GAP + currentLeft);
}

function requiresSiblingFamilySpace(box: Box): boolean {
  return box.kind === "family" && (box.children?.length ?? 0) > 0;
}

function assertFamilyAnchors(box: Box, expectedDropX: number) {
  if (!box.top || !box.children || box.children.length === 0) return;
  const actualDropX = box.top.dropX();
  if (Math.abs(actualDropX - expectedDropX) >= 0.5) {
    throw new Error(`family anchor mismatch: expected ${expectedDropX}, got ${actualDropX}`);
  }
}

export function assignCoordinates(graph: PedigreeGraph) {
  let nextX = 0;
  const { roots: boxes, originLinks } = buildForest(graph);
  const layoutPlan = buildLayoutPlan(graph);
  const generationOrder = getGenerationOrder(graph);
  if (generationOrder) sortBoxesByGenerationOrder(boxes, generationOrder);
  boxes.forEach(measureBox);

  for (const box of boxes) {
    placeBox(box, nextX + box.width / 2);
    nextX += box.width + SIBLING_GAP;
  }
  const originContext = buildOriginLayoutContext(boxes, originLinks);
  resolveGenerationOverlaps(boxes);
  for (let i = 0; i < 160; i++) {
    const originChanged = reconcileOrigins(boxes, originLinks);
    if (originChanged) realignFamilyTops(boxes);
    const symbolChanged = resolvePersonSymbolOverlaps(boxes, originLinks, originContext, generationOrder);
    const compacted = compactPersonGaps(boxes, originContext, generationOrder);
    const siblingCompacted = compactSiblingRows(boxes, originLinks, originContext, layoutPlan);
    if (!originChanged && !symbolChanged && !compacted && !siblingCompacted) break;
  }
  compactWideSiblingRows(boxes, originContext, layoutPlan);
  reconcileOrigins(boxes, originLinks);
  resolvePersonSymbolOverlaps(boxes, originLinks, originContext, generationOrder);
  if (generationOrder) enforceGenerationOrder(boxes, originLinks, originContext, generationOrder);
  reconcileOrigins(boxes, originLinks);
  resolvePersonSymbolOverlaps(boxes, originLinks, originContext, generationOrder);
  if (generationOrder) enforceGenerationOrder(boxes, originLinks, originContext, generationOrder);
  reconcileOrigins(boxes, originLinks);
  resolvePersonSymbolOverlaps(boxes, originLinks, originContext, generationOrder);
  resolveActualSymbolOverlaps(boxes, originLinks, originContext);
  finalizeLayoutConstraints(graph, boxes, originLinks, originContext, layoutPlan);
  writeBackCoordinates(graph, boxes, originLinks);
  finalizeGraphCoordinates(graph, originLinks, layoutPlan);
  normalizeGraphToOrigin(graph);
  assertLayoutInvariants(graph, originLinks);

  return graph;
}

function finalizeGraphCoordinates(graph: PedigreeGraph, originLinks: OriginLink[], layoutPlan: LayoutPlan) {
  compactWideGraphCoordinates(graph);
  for (let i = 0; i < 24; i++) {
    alignGraphParentDrops(graph, originLinks, layoutPlan);
    alignGraphOriginLinks(graph, originLinks, layoutPlan);
    const siblingChanged = enforceGraphSiblingBirthOrder(graph, layoutPlan);
    alignGraphOriginMarriagesSafely(graph, originLinks);
    const overlapChanged = repairGraphOriginOverlaps(graph, originLinks);
    if (!siblingChanged && !overlapChanged) break;
  }
  alignGraphParentDrops(graph, originLinks, layoutPlan);
  alignGraphOriginLinks(graph, originLinks, layoutPlan);
  enforceGraphSiblingBirthOrder(graph, layoutPlan);
  repairGraphOriginOverlaps(graph, originLinks);
  enforceGraphSiblingBirthOrder(graph, layoutPlan);
  alignGraphParentDrops(graph, originLinks, layoutPlan);
  repairGraphSymbolOverlaps(graph);
  alignGraphOriginLinks(graph, originLinks, layoutPlan);
  enforceGraphSiblingBirthOrder(graph, layoutPlan);
  alignGraphParentDrops(graph, originLinks, layoutPlan);
  repairGraphSymbolOverlaps(graph);
  alignGraphOriginMarriagesSafely(graph, originLinks);
  repairGraphSymbolOverlaps(graph);
}

function enforceGraphSiblingBirthOrder(graph: PedigreeGraph, layoutPlan: LayoutPlan) {
  let changed = false;
  for (const siblingGroup of layoutPlan.siblingGroups) {
    const sorted = siblingGroup.orderedChildIds;
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

function repairGraphSymbolOverlaps(graph: PedigreeGraph) {
  for (let pass = 0; pass < 80; pass++) {
    const people = [...graph.persons.values()]
      .filter((person) => Number.isFinite(person.x) && Number.isFinite(person.y))
      .sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0) || (a.x ?? 0) - (b.x ?? 0));
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

function alignGraphParentDrops(graph: PedigreeGraph, originLinks: OriginLink[] = [], layoutPlan?: LayoutPlan) {
  const originChildByParentUnion = new Map<string, string>();
  if (layoutPlan) {
    const sharedOriginPeople = new Set(originLinks.map((link) => link.sharedPersonId));
    for (const separation of layoutPlan.originSeparations) {
      if (!sharedOriginPeople.has(separation.sharedPersonId)) continue;
      originChildByParentUnion.set(separation.originUnionId, separation.sharedPersonId);
    }
  } else {
    for (const link of originLinks) {
      for (const [unionId, childIds] of graph.childrenMap.entries()) {
        if (childIds.includes(link.sharedPersonId)) originChildByParentUnion.set(unionId, link.sharedPersonId);
      }
    }
  }

  const parentUnionByChild = new Map<string, string>();
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    for (const childId of childIds) parentUnionByChild.set(childId, unionId);
  }

  const childbearingUnionCount = new Map<string, number>();
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
    const childXs = (originChildId ? [originChildId] : childIds)
      .map((childId) => graph.persons.get(childId)?.x)
      .filter((x): x is number => Number.isFinite(x));
    if (childXs.length === 0) continue;

    const childCenter = childXs.length === 1
      ? childXs[0]
      : (Math.min(...childXs) + Math.max(...childXs)) / 2;
    const parentXs = union.partners
      .map((partnerId) => graph.persons.get(partnerId)?.x)
      .filter((x): x is number => Number.isFinite(x));
    if (parentXs.length === 0) continue;

    if (union.partners.length === 2) {
      const [leftId, rightId] = union.partners;
      const left = graph.persons.get(leftId);
      const right = graph.persons.get(rightId);
      const leftHasParents = parentUnionByChild.has(leftId);
      const rightHasParents = parentUnionByChild.has(rightId);
      if (leftHasParents && rightHasParents) {
        const dx = computeParentCenter(graph, union.partners) - childCenter;
        if (Math.abs(dx) >= 0.5) {
          for (const childId of childIds) {
            const child = graph.persons.get(childId);
            if (child && Number.isFinite(child.x)) child.x = (child.x ?? 0) + dx;
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
        const dx = newCenter - childCenter;
        for (const childId of childIds) {
          const child = graph.persons.get(childId);
          if (child && Number.isFinite(child.x)) child.x = (child.x ?? 0) + dx;
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
        const dx = newCenter - childCenter;
        for (const childId of childIds) {
          const child = graph.persons.get(childId);
          if (child && Number.isFinite(child.x)) child.x = (child.x ?? 0) + dx;
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

function computeParentCenter(graph: PedigreeGraph, partnerIds: readonly string[]): number {
  const xs = partnerIds
    .map((partnerId) => graph.persons.get(partnerId)?.x)
    .filter((x): x is number => Number.isFinite(x));
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

function alignGraphOriginLinks(graph: PedigreeGraph, originLinks: OriginLink[], layoutPlan: LayoutPlan) {
  const originUnionBySharedPerson = new Map(
    layoutPlan.originSeparations.map((separation) => [separation.sharedPersonId, separation.originUnionId])
  );
  for (const link of originLinks) {
    const shared = graph.persons.get(link.sharedPersonId);
    if (!shared || !Number.isFinite(shared.x)) continue;

    const originUnionId = originUnionBySharedPerson.get(link.sharedPersonId);
    if (!originUnionId) continue;
    const union = graph.unions.get(originUnionId);
    if (!union) continue;
    const parentXs = union.partners
      .map((id) => graph.persons.get(id)?.x)
      .filter((x): x is number => Number.isFinite(x));
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

function alignGraphOriginMarriagesSafely(graph: PedigreeGraph, originLinks: OriginLink[]) {
  for (const link of originLinks) {
    const shared = graph.persons.get(link.sharedPersonId);
    const otherId = link.couple.members.find((id) => id !== link.sharedPersonId);
    const other = otherId ? graph.persons.get(otherId) : undefined;
    if (!shared || !other || !Number.isFinite(shared.x) || !Number.isFinite(other.x)) continue;
    if (Math.abs((shared.x ?? 0) - (other.x ?? 0)) <= 100) continue;

    const sharedIsRight = (shared.x ?? 0) >= (other.x ?? 0);
    const targetX = (other.x ?? 0) + (sharedIsRight ? MARRIAGE_GAP : -MARRIAGE_GAP);
    const dx = targetX - (shared.x ?? 0);
    const moveIds = collectMemberIds(link.originRoot);
    const before = new Map<string, number>();
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

function hasGraphSymbolOverlap(graph: PedigreeGraph) {
  const people = [...graph.persons.values()].filter((person) =>
    Number.isFinite(person.x) && Number.isFinite(person.y)
  );
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      if ((people[i].generation ?? 0) !== (people[j].generation ?? 0)) continue;
      if (Math.abs((people[i].x ?? 0) - (people[j].x ?? 0)) < NODE_SIZE - 0.5) return true;
    }
  }
  return false;
}

function compactWideGraphCoordinates(graph: PedigreeGraph) {
  const people = [...graph.persons.values()].filter((person) => Number.isFinite(person.x));
  if (people.length === 0) return;
  const minX = Math.min(...people.map((person) => person.x ?? 0));
  const maxX = Math.max(...people.map((person) => person.x ?? 0));
  if (maxX - minX <= 100 * PERSON_GAP) return;

  const byGeneration = new Map<number, string[]>();
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

function repairGraphOriginOverlaps(graph: PedigreeGraph, originLinks: OriginLink[]) {
  const originSets = originLinks.map((link) => collectMemberIds(link.originRoot));
  const originSetByPerson = new Map<string, Set<string>>();
  for (const ids of originSets) {
    for (const id of ids) originSetByPerson.set(id, ids);
  }

  let anyChanged = false;
  for (let pass = 0; pass < 80; pass++) {
    const people = [...graph.persons.values()]
      .filter((person) => Number.isFinite(person.x) && Number.isFinite(person.y))
      .sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0) || (a.x ?? 0) - (b.x ?? 0));
    let changed = false;

    for (const ids of originSets) {
      const originPeople = [...ids]
        .map((id) => graph.persons.get(id))
        .filter((person): person is NonNullable<typeof person> => !!person && Number.isFinite(person.x));
      if (originPeople.length === 0) continue;
      const generations = new Set(originPeople.map((person) => person.generation ?? 0));
      for (const generation of generations) {
        const sameGeneration = originPeople.filter((person) => (person.generation ?? 0) === generation);
        if (sameGeneration.length < 2) continue;
        const left = Math.min(...sameGeneration.map((person) => person.x ?? 0));
        const right = Math.max(...sameGeneration.map((person) => person.x ?? 0));
        const intruder = people.find((person) =>
          (person.generation ?? 0) === generation &&
          !ids.has(person.id) &&
          (person.x ?? 0) > left - NODE_SIZE &&
          (person.x ?? 0) < right + NODE_SIZE
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
      const moveSet = currentOriginSet ?? previousOriginSet ?? new Set([current.id]);
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

function collectMemberIds(box: Box): Set<string> {
  const ids = new Set<string>();
  const visit = (current: Box) => {
    current.members.forEach((id) => ids.add(id));
    if (current.top) visit(current.top);
    current.children?.forEach(visit);
  };
  visit(box);
  return ids;
}

function stableGraphTopologicalSort(graph: PedigreeGraph, ids: string[]) {
  const sortedIds = [...ids].sort((a, b) =>
    (graph.persons.get(a)?.x ?? 0) - (graph.persons.get(b)?.x ?? 0) || a.localeCompare(b)
  );
  const originalIndex = new Map(sortedIds.map((id, index) => [id, index]));
  const constraints = new Map(sortedIds.map((id) => [id, new Set<string>()]));

  for (const childIds of graph.childrenMap.values()) {
    const sortedChildren = sortChildIdsByBirthOrder(graph, childIds).filter((childId) => constraints.has(childId));
    for (let i = 1; i < sortedChildren.length; i++) {
      constraints.get(sortedChildren[i - 1])?.add(sortedChildren[i]);
    }
  }

  const indegree = new Map(sortedIds.map((id) => [id, 0]));
  for (const nextIds of constraints.values()) {
    for (const next of nextIds) {
      indegree.set(next, (indegree.get(next) ?? 0) + 1);
    }
  }

  const ready = sortedIds.filter((id) => (indegree.get(id) ?? 0) === 0);
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

  return out.length === sortedIds.length ? out : sortedIds;
}

function finalizeLayoutConstraints(
  graph: PedigreeGraph,
  roots: Box[],
  originLinks: OriginLink[],
  originContext: OriginLayoutContext,
  layoutPlan: LayoutPlan
) {
  for (let i = 0; i < 180; i++) {
    reconcileOrigins(roots, originLinks);
    realignFamilyTops(roots);
    const coupleChanged = resolveCoupleIntrusions(roots, originLinks, originContext);
    const overlapChanged = resolveActualSymbolOverlaps(roots, originLinks, originContext);
    reconcileOrigins(roots, originLinks);
    realignFamilyTops(roots);
    const finalOverlapChanged = resolveActualSymbolOverlaps(roots, originLinks, originContext);
    if (!coupleChanged && !overlapChanged && !finalOverlapChanged) break;
  }

  for (let i = 0; i < 8; i++) {
    const siblingChanged = enforceSiblingBirthOrderCoordinates(graph, roots, originContext, layoutPlan);
    const compacted = compactSiblingRows(roots, originLinks, originContext, layoutPlan) ||
      compactWideSiblingRows(roots, originContext, layoutPlan);
    reconcileOrigins(roots, originLinks);
    realignFamilyTops(roots);
    const overlapChanged = resolveActualSymbolOverlaps(roots, originLinks, originContext);
    if (!siblingChanged && !compacted && !overlapChanged) break;
  }
  resolveActualSymbolOverlaps(roots, originLinks, originContext);
}

function compactWideSiblingRows(roots: Box[], originContext: OriginLayoutContext, layoutPlan: LayoutPlan) {
  const siblingFamilies = siblingFamilyBoxes(roots, layoutPlan);

  const visit = (box: Box): boolean => {
    if (!siblingFamilies.includes(box)) return false;
    if (!box.children || box.children.length < 2) return false;

    for (let i = 1; i < box.children.length; i++) {
      const previous = box.children[i - 1];
      const current = box.children[i];
      const gap = primaryAnchorX(current) - primaryAnchorX(previous);
      const desiredGap = siblingAnchorGap(previous, current);
      if (gap <= desiredGap + 2 * PERSON_GAP) continue;

      const dx = (gap - desiredGap) / 2;
      shiftSubtree(previous, dx);
      const currentMovers = [current];
      const originRoot = originContext.originRootByCoreFamily.get(current);
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
    for (const family of siblingFamilies) {
      changed = visit(family) || changed;
      if (changed) break;
    }
    anyChanged = anyChanged || changed;
    if (!changed) break;
  }
  return anyChanged;
}

function compactSiblingRows(
  roots: Box[],
  originLinks: OriginLink[],
  originContext: OriginLayoutContext,
  layoutPlan: LayoutPlan
) {
  let changed = false;
  const siblingFamilies = siblingFamilyBoxes(roots, layoutPlan);

  const visit = (box: Box): boolean => {
    if (!siblingFamilies.includes(box)) return false;
    if (!box.children || box.children.length < 2) return false;

    for (let i = 1; i < box.children.length; i++) {
      const previous = box.children[i - 1];
      const current = box.children[i];
      const gap = primaryAnchorX(current) - primaryAnchorX(previous);
      const excess = gap - siblingAnchorGap(previous, current);
      if (excess <= 0.5) continue;

      const movers = [current];
      const originRoot = originContext.originRootByCoreFamily.get(current);
      if (originRoot) movers.push(originRoot);
      if (movers.some((mover) => originContext.pinnedMovers.has(mover)) && !originRoot) continue;

      const boundedDx = boundNegativeShift(roots, movers, -Math.min(excess, PERSON_GAP / 2));
      if (Math.abs(boundedDx) >= 0.5) {
        movers.forEach((mover) => shiftSubtree(mover, boundedDx));
      } else {
        const fallbackDx = Math.min(excess, PERSON_GAP / 2);
        if (originContext.pinnedMovers.has(previous)) continue;
        shiftSubtree(previous, fallbackDx);
      }
      realignFamilyTops(roots);
      changed = true;
      return true;
    }
    return false;
  };

  for (const family of siblingFamilies) {
    if (visit(family)) break;
  }

  if (changed) {
    reconcileOrigins(roots, originLinks);
  }
  return changed;
}

function siblingFamilyBoxes(roots: Box[], layoutPlan: LayoutPlan): Box[] {
  const families = collectBoxes(roots).filter((box) => box.kind === "family" && box.children && box.children.length > 1);
  return layoutPlan.siblingGroups.flatMap((siblingGroup) =>
    families.filter((family) => familyMatchesSiblingGroup(family, siblingGroup.parentIds, siblingGroup.childIds))
  );
}

function familyMatchesSiblingGroup(family: Box, parentIds: string[], childIds: string[]): boolean {
  if (!sameMembers(family.top?.members ?? family.members, parentIds)) return false;
  const familyChildIds = (family.children ?? [])
    .map((child) => child.mainPersonId ?? child.members[0])
    .filter((id): id is string => !!id);
  return sameMembers(familyChildIds, childIds);
}

function sameMembers(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return right.every((id) => leftSet.has(id));
}

function sortBoxesByGenerationOrder(roots: Box[], order: GenerationOrder) {
  const rank = buildOrderRank(order);
  const boxRank = (box: Box): number => {
    const memberRanks = box.members
      .map((id) => rank.get(id))
      .filter((value): value is number => value != null);
    if (memberRanks.length > 0) return Math.min(...memberRanks);
    if (box.top) return boxRank(box.top);
    const childRanks = (box.children ?? []).map(boxRank).filter(Number.isFinite);
    return childRanks.length ? Math.min(...childRanks) : Number.POSITIVE_INFINITY;
  };

  const visit = (box: Box) => {
    box.children?.forEach(visit);
    if (box.children) {
      box.children.sort((a, b) => boxRank(a) - boxRank(b));
    }
  };

  roots.forEach(visit);
  roots.sort((a, b) => boxRank(a) - boxRank(b));
}

function enforceGenerationOrder(
  roots: Box[],
  originLinks: OriginLink[],
  originContext: OriginLayoutContext,
  order: GenerationOrder
) {
  const rank = buildOrderRank(order);

  for (let pass = 0; pass < 64; pass++) {
    let changed = false;
    const entries = collectOrderedPersonEntries(roots, originContext.pinnedMovers, rank);
    for (let i = 1; i < entries.length; i++) {
      const previous = entries[i - 1];
      const current = entries[i];
      if (previous.gen !== current.gen) continue;
      if (previous.id === current.id) continue;
      if (previous.mover === current.mover) continue;

      const need = previous.x + SYMBOL_CENTER_GAP - current.x;
      if (need <= 0) continue;

      const currentBundle = originContext.originBundleByRoot.get(current.mover);
      const currentOriginRoot = originContext.originRootByCoreFamily.get(current.mover);
      const previousOriginRoot = originContext.originRootByCoreFamily.get(previous.mover);
      if (currentBundle) {
        shiftSubtree(currentBundle, need);
        shiftSubtree(current.mover, need);
      } else if (currentOriginRoot) {
        shiftSubtree(current.mover, need);
        shiftSubtree(currentOriginRoot, need);
      } else if (!originContext.pinnedMovers.has(current.mover)) {
        shiftSubtree(current.mover, need);
      } else if (!originContext.pinnedMovers.has(previous.mover)) {
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

function collectOrderedPersonEntries(roots: Box[], pinnedRoots: Set<Box>, rank: Map<string, number>): PersonEntry[] {
  return collectAuthoritativePersonEntries(roots, pinnedRoots).sort((a, b) =>
    a.gen - b.gen ||
    (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
    a.x - b.x ||
    a.id.localeCompare(b.id)
  );
}

function buildOrderRank(order: GenerationOrder) {
  const rank = new Map<string, number>();
  for (const ids of order.values()) {
    ids.forEach((id, index) => rank.set(id, index));
  }
  return rank;
}

function compactPersonGaps(roots: Box[], originContext: OriginLayoutContext, order?: GenerationOrder) {
  const rank = order ? buildOrderRank(order) : undefined;
  const byGeneration = new Map<number, PersonEntry[]>();
  for (const entry of collectAuthoritativePersonEntries(roots, originContext.pinnedMovers)) {
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
      const currentBundle = originContext.originBundleByRoot.get(current.mover);
      if (currentBundle) {
        const movers = [currentBundle, current.mover];
        const boundedDx = boundNegativeShift(roots, movers, requestedDx);
        if (Math.abs(boundedDx) < 0.5) continue;
        movers.forEach((mover) => shiftSubtree(mover, boundedDx));
      } else if (!originContext.pinnedMovers.has(current.mover)) {
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

function preferredGap(a: PersonEntry, b: PersonEntry): number {
  return a.mover === b.mover ? NODE_SIZE : PERSON_GAP;
}

function resolvePersonSymbolOverlaps(
  roots: Box[],
  originLinks: OriginLink[],
  originContext: OriginLayoutContext,
  order?: GenerationOrder
) {
  const rank = order ? buildOrderRank(order) : undefined;
  let changed = false;

  for (let pass = 0; pass < 24; pass++) {
    const entries = collectAuthoritativePersonEntries(roots, originContext.pinnedMovers).sort((a, b) => personEntryCompare(a, b, rank));
    let passChanged = false;

    for (let i = 1; i < entries.length; i++) {
      const previous = entries[i - 1];
      const current = entries[i];
      if (previous.gen !== current.gen) continue;
      if (previous.id === current.id) continue;
      if (previous.mover === current.mover) continue;
      const need = SYMBOL_CENTER_GAP - (current.x - previous.x);
      if (need <= 0) continue;

      const currentBundle = originContext.originBundleByRoot.get(current.mover);
      const currentOriginRoot = originContext.originRootByCoreFamily.get(current.mover);
      const previousOriginRoot = originContext.originRootByCoreFamily.get(previous.mover);
      if (primaryAnchorX(current.mover) < previous.x - 0.5 && !originContext.pinnedMovers.has(previous.mover)) {
        const dx = current.x + SYMBOL_CENTER_GAP - previous.x;
        shiftSubtree(previous.mover, dx);
        if (previousOriginRoot) shiftSubtree(previousOriginRoot, dx);
      } else if (currentBundle) {
        shiftSubtree(currentBundle, need);
        shiftSubtree(current.mover, need);
      } else if (currentOriginRoot) {
        shiftSubtree(current.mover, need);
        shiftSubtree(currentOriginRoot, need);
      } else if (!originContext.pinnedMovers.has(current.mover)) {
        shiftSubtree(current.mover, need);
      } else if (!originContext.pinnedMovers.has(previous.mover)) {
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

function resolveActualSymbolOverlaps(
  roots: Box[],
  originLinks: OriginLink[],
  originContext: OriginLayoutContext,
  generationFilter?: number
) {
  let anyChanged = false;

  for (let pass = 0; pass < 160; pass++) {
    const entries = collectAuthoritativePersonEntries(roots, originContext.pinnedMovers)
      .sort((a, b) => a.gen - b.gen || a.x - b.x || a.id.localeCompare(b.id));
    let changed = false;

    for (let i = 1; i < entries.length; i++) {
      const previous = entries[i - 1];
      const current = entries[i];
      if (previous.gen !== current.gen) continue;
      if (generationFilter != null && current.gen !== generationFilter) continue;
      if (previous.mover === current.mover) continue;

      const need = previous.x + SYMBOL_CENTER_GAP - current.x;
      if (need <= 0) continue;

      const currentBundle = originContext.originBundleByRoot.get(current.mover);
      const currentOriginRoot = originContext.originRootByCoreFamily.get(current.mover);
      const previousOriginRoot = originContext.originRootByCoreFamily.get(previous.mover);
      if (currentBundle) {
        shiftSubtree(currentBundle, need);
        shiftSubtree(current.mover, need);
      } else if (currentOriginRoot) {
        shiftSubtree(current.mover, need);
        shiftSubtree(currentOriginRoot, need);
      } else if (!originContext.pinnedMovers.has(current.mover)) {
        shiftSubtree(current.mover, need);
      } else if (!originContext.pinnedMovers.has(previous.mover)) {
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

function enforceSiblingBirthOrderCoordinates(
  graph: PedigreeGraph,
  roots: Box[],
  originContext: OriginLayoutContext,
  layoutPlan: LayoutPlan
) {
  let changed = false;

  for (const siblingGroup of layoutPlan.siblingGroups) {
    const sorted = siblingGroup.orderedChildIds;
    for (let i = 1; i < sorted.length; i++) {
      const previous = findAuthoritativeEntry(roots, originContext.pinnedMovers, sorted[i - 1]);
      const current = findAuthoritativeEntry(roots, originContext.pinnedMovers, sorted[i]);
      if (!previous || !current || previous.gen !== current.gen) continue;

      const previousRight = entryFootprintRight(previous);
      const currentLeft = entryFootprintLeft(current);
      const need = previousRight + SYMBOL_CENTER_GAP - currentLeft;
      if (need <= 0) continue;
      moveEntryRight(current, need, originContext);
      changed = true;
    }
  }

  if (changed) realignFamilyTops(roots);
  return changed;
}

function findAuthoritativeEntry(roots: Box[], pinnedRoots: Set<Box>, id: string): PersonEntry | undefined {
  return collectAuthoritativePersonEntries(roots, pinnedRoots).find((entry) => entry.id === id);
}

function sortChildIdsByBirthOrder(graph: PedigreeGraph, childIds: string[]) {
  return sortChildrenForLayout(graph, childIds);
}

function entryFootprintLeft(entry: PersonEntry): number {
  return Math.min(...entry.box.members.map((id) => entry.box.anchorX(id)));
}

function entryFootprintRight(entry: PersonEntry): number {
  return Math.max(...entry.box.members.map((id) => entry.box.anchorX(id)));
}

function moveEntryRight(
  entry: PersonEntry,
  dx: number,
  originContext: OriginLayoutContext
) {
  const bundle = originContext.originBundleByRoot.get(entry.mover);
  const originRoot = originContext.originRootByCoreFamily.get(entry.mover);
  if (bundle) {
    shiftSubtree(bundle, dx);
    shiftSubtree(entry.mover, dx);
  } else if (originRoot) {
    shiftSubtree(entry.mover, dx);
    shiftSubtree(originRoot, dx);
  } else if (entry.box.kind === "person") {
    shiftSubtree(entry.box, dx);
  } else if (!originContext.pinnedMovers.has(entry.mover)) {
    shiftSubtree(entry.mover, dx);
  }
}

function resolveCoupleIntrusions(roots: Box[], originLinks: OriginLink[], originContext: OriginLayoutContext) {
  let anyChanged = false;

  for (let pass = 0; pass < 80; pass++) {
    let changed = false;
    const entries = collectAuthoritativePersonEntries(roots, originContext.pinnedMovers);
    const couples = collectBoxes(roots).filter((box) => box.kind === "couple" && box.members.length === 2);

    for (const couple of couples) {
      const left = Math.min(...couple.members.map((id) => couple.anchorX(id)));
      const right = Math.max(...couple.members.map((id) => couple.anchorX(id)));
      for (const entry of entries) {
        if (entry.gen !== couple.gen || couple.members.includes(entry.id)) continue;
        if (entry.x <= left || entry.x >= right) continue;
        const need = right + SYMBOL_CENTER_GAP - entry.x;
        moveEntryRight(entry, need, originContext);
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

function personEntryCompare(a: PersonEntry, b: PersonEntry, rank?: Map<string, number>): number {
  if (!rank) return a.gen - b.gen || a.x - b.x || a.id.localeCompare(b.id);
  return a.gen - b.gen ||
    (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
    a.x - b.x ||
    a.id.localeCompare(b.id);
}

function buildOriginLayoutContext(roots: Box[], originLinks: OriginLink[]): OriginLayoutContext {
  return {
    pinnedMovers: new Set(originLinks.map((link) => link.originRoot)),
    originBundleByRoot: buildOriginBundleMap(roots, originLinks),
    originRootByCoreFamily: buildOriginRootByCoreFamily(roots, originLinks)
  };
}

function buildOriginBundleMap(roots: Box[], originLinks: OriginLink[]) {
  const originBundleByRoot = new Map<Box, Box>();
  for (const link of originLinks) {
    const coreFamily = nearestFamilyForTop(roots, link.couple);
    if (coreFamily) originBundleByRoot.set(link.originRoot, coreFamily);
  }
  return originBundleByRoot;
}

function buildOriginRootByCoreFamily(roots: Box[], originLinks: OriginLink[]) {
  const originRootByCoreFamily = new Map<Box, Box>();
  for (const link of originLinks) {
    const coreFamily = nearestFamilyForTop(roots, link.couple);
    if (coreFamily) originRootByCoreFamily.set(coreFamily, link.originRoot);
  }
  return originRootByCoreFamily;
}

interface OriginLayoutContext {
  pinnedMovers: Set<Box>;
  originBundleByRoot: Map<Box, Box>;
  originRootByCoreFamily: Map<Box, Box>;
}

interface PersonEntry {
  id: string;
  x: number;
  gen: number;
  mover: Box;
  box: Box;
}

function collectPersonEntries(roots: Box[], pinnedRoots: Set<Box>): PersonEntry[] {
  const entries: PersonEntry[] = [];
  const visit = (box: Box, mover: Box, pinnedMover?: Box) => {
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

function collectAuthoritativePersonEntries(roots: Box[], pinnedRoots: Set<Box>): PersonEntry[] {
  const byId = new Map<string, PersonEntry>();

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

function boundNegativeShift(roots: Box[], movers: Box[], requestedDx: number): number {
  if (requestedDx >= 0) return requestedDx;
  const entries = collectPersonEntries(roots, new Set()).sort((a, b) => a.gen - b.gen || a.x - b.x);
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

function isMovedEntry(entry: PersonEntry, movers: Box[]): boolean {
  return movers.some((mover) => mover === entry.box || containsBox(mover, entry.box));
}

function realignFamilyTops(roots: Box[]) {
  const visit = (box: Box) => {
    box.children?.forEach(visit);
    if (box.kind !== "family" || !box.top || !box.children || box.children.length === 0) return;
    placeBox(box.top, familyDropX(box));
  };
  roots.forEach(visit);
}

function familyDropX(box: Box): number {
  if (box.exitMember) {
    const exitX = memberAnchorX(box, box.exitMember);
    if (exitX != null) return exitX;
  }
  return childAnchorDropX(box.children ?? []);
}

export function writeBackCoordinates(graph: PedigreeGraph, roots: Box[], originLinks: OriginLink[] = []) {
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

export function normalizeGraphToOrigin(graph: PedigreeGraph) {
  const people = [...graph.persons.values()].filter((person) =>
    Number.isFinite(person.x) && Number.isFinite(person.y)
  );
  if (people.length === 0) return;
  const minX = Math.min(...people.map((person) => person.x ?? 0));
  for (const person of people) {
    person.x = (person.x ?? 0) - minX;
  }
}

function collectBoxesPostorder(boxes: Box[]): Box[] {
  const out: Box[] = [];
  const visit = (box: Box) => {
    if (box.top) visit(box.top);
    box.children?.forEach(visit);
    out.push(box);
  };
  boxes.forEach(visit);
  return out;
}
