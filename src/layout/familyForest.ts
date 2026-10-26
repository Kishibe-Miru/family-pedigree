import { PedigreeGraph } from "../model/pedigreeGraph";
import { UnionNode } from "../model/union";
import {
  BASE_MARRIAGE_GAP,
  BRANCHED_MARRIAGE_GAP,
  DUAL_ORIGIN_MARRIAGE_GAP,
  Box,
  HubInfo,
  createCoupleBox,
  createFamilyBox,
  createHubFamilyBox,
  createHubTopBox,
  createPersonBox
} from "./boxModel";
import { sortChildrenForLayout } from "./childOrdering";

export interface OriginLink {
  couple: Box;
  originRoot: Box;
  sharedPersonId: string;
}

export interface ForestBuildResult {
  roots: Box[];
  originLinks: OriginLink[];
}

function buildParentUnionByChild(graph: PedigreeGraph): Map<string, string> {
  const parentUnionByChild = new Map<string, string>();
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    for (const childId of childIds) {
      if (!parentUnionByChild.has(childId)) {
        parentUnionByChild.set(childId, unionId);
      }
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

function sortedChildren(graph: PedigreeGraph, unionId: string): string[] {
  return sortChildrenForLayout(graph, graph.childrenMap.get(unionId) ?? []);
}

export function buildForest(graph: PedigreeGraph): ForestBuildResult {
  const parentUnionByChild = buildParentUnionByChild(graph);
  const unionsByPartner = buildUnionsByPartner(graph);
  const visitedMainPeople = new Set<string>();
  const visitedUnions = new Set<string>();
  const roots: Box[] = [];
  const pendingOriginLinks: Array<{ couple: Box; sharedPersonId: string }> = [];

  const hasParents = (personId: string) => parentUnionByChild.has(personId);
  const isRootUnion = (union: UnionNode) => union.partners.every((partnerId) => !hasParents(partnerId));
  const unionSortKey = (union: UnionNode) =>
    `${Math.min(...union.partners.map((id) => graph.persons.get(id)?.generation ?? 0))}:${union.partners.join("|")}:${union.id}`;

  // 婚姻枢纽：出现在 ≥2 段双人婚姻中的人。其全部婚姻由一个枢纽盒子统一排布，
  // 不再各自生成家庭块（否则同一个人会落在两个块里）。
  const coupleUnionsOf = (personId: string) =>
    (unionsByPartner.get(personId) ?? []).filter((union) => union.partners.length === 2);
  const hubPeople = new Set(
    [...graph.persons.keys()].filter((personId) => coupleUnionsOf(personId).length >= 2)
  );
  const hubUnionSortKey = (union: UnionNode) =>
    `${String(union.order ?? Number.MAX_SAFE_INTEGER).padStart(12, "0")}:${union.id}`;
  // 某段婚姻是否应留给对方（枢纽）来构建
  const reservedForHub = (union: UnionNode, personId: string) =>
    union.partners.length === 2 &&
    !hubPeople.has(personId) &&
    union.partners.some((partnerId) => partnerId !== personId && hubPeople.has(partnerId));

  const buildChildBoxes = (union: UnionNode): Box[] => {
    const children: Box[] = [];
    for (const childId of sortedChildren(graph, union.id)) {
      const child = graph.persons.get(childId);
      if (!child) continue;

      const childUnions = (unionsByPartner.get(childId) ?? [])
        .filter((childUnion) =>
          childUnion.id !== union.id &&
          !visitedUnions.has(childUnion.id) &&
          !reservedForHub(childUnion, childId)
        )
        .sort((a, b) => unionSortKey(a).localeCompare(unionSortKey(b)));
      if (childUnions.length > 0 && !visitedMainPeople.has(childId)) {
        visitedMainPeople.add(childId);
        if (hubPeople.has(childId) && childUnions.filter((u) => u.partners.length === 2).length >= 2) {
          const hubFamily = buildHub(childId, childUnions);
          if (hubFamily) children.push(hubFamily);
          continue;
        }
        for (const childUnion of childUnions) {
          const childFamily = buildFamily(childUnion, childId);
          if (childFamily) children.push(childFamily);
        }
      } else if (!visitedMainPeople.has(childId)) {
        visitedMainPeople.add(childId);
        children.push(createPersonBox(childId, child.generation ?? 0));
      }
    }
    return children;
  };

  const buildFamily = (union: UnionNode, mainPersonId?: string): Box | null => {
    if (visitedUnions.has(union.id)) return null;
    visitedUnions.add(union.id);

    const partnerGeneration = Math.max(
      ...union.partners.map((id) => graph.persons.get(id)?.generation ?? 0)
    );
    const originOf = mainPersonId
      ? union.partners.find((partnerId) => partnerId !== mainPersonId && hasParents(partnerId))
      : undefined;
    const mainId = mainPersonId ?? union.partners.find((partnerId) => !hasParents(partnerId)) ?? union.partners[0];
    const partners = orderPartnersForMain(graph, parentUnionByChild, union, mainPersonId, originOf);
    const marriageGap = marriageGapForUnion(graph, parentUnionByChild, union, originOf);
    const top = union.partners.length === 2
      ? createCoupleBox(partners, partnerGeneration, mainId, originOf, marriageGap)
      : createPersonBox(union.partners[0], partnerGeneration);
    if (top.originOf) {
      pendingOriginLinks.push({ couple: top, sharedPersonId: top.originOf });
    }

    if (mainPersonId) visitedMainPeople.add(mainPersonId);
    else union.partners.forEach((partnerId) => visitedMainPeople.add(partnerId));

    return createFamilyBox(top, buildChildBoxes(union), mainId);
  };

  const buildHub = (personId: string, unions: UnionNode[]): Box | null => {
    const hubUnions = unions
      .filter((union) => union.partners.length === 2 && !visitedUnions.has(union.id))
      .sort((a, b) => hubUnionSortKey(a).localeCompare(hubUnionSortKey(b)));
    if (hubUnions.length < 2) return null;
    hubUnions.forEach((union) => visitedUnions.add(union.id));
    visitedMainPeople.add(personId);

    const generation = Math.max(
      ...hubUnions.flatMap((union) => union.partners.map((id) => graph.persons.get(id)?.generation ?? 0))
    );
    const spouses = hubUnions.map((union) => union.partners.find((partnerId) => partnerId !== personId) as string);
    // 只支持一位有原生家庭的配偶挂 origin link；其余有父母的配偶仍按共享成员处理（已知限制）
    const originOf = spouses.find((spouseId) => hasParents(spouseId));
    spouses.forEach((spouseId) => { if (!hasParents(spouseId)) visitedMainPeople.add(spouseId); });

    const hub: HubInfo = {
      personId,
      unions: hubUnions.map((union, index) => ({
        unionId: union.id,
        partnerId: spouses[index],
        marriageGap: marriageGapForUnion(graph, parentUnionByChild, union, spouses[index] === originOf ? originOf : undefined),
        children: [] as Box[]
      }))
    };
    const top = createHubTopBox(hub, generation, originOf);
    if (top.originOf) {
      pendingOriginLinks.push({ couple: top, sharedPersonId: top.originOf });
    }
    hub.unions.forEach((group, index) => {
      group.children = buildChildBoxes(hubUnions[index]);
    });
    return createHubFamilyBox(top, hub);
  };

  // 根级枢纽（本人没有父母）先于普通根婚姻构建，避免其中某段婚姻被当成普通根家庭
  const rootHubPeople = [...hubPeople]
    .filter((personId) => !hasParents(personId))
    .sort((a, b) =>
      (graph.persons.get(a)?.generation ?? 0) - (graph.persons.get(b)?.generation ?? 0) || a.localeCompare(b)
    );
  for (const personId of rootHubPeople) {
    const root = buildHub(personId, coupleUnionsOf(personId));
    if (root) roots.push(root);
  }

  for (const union of [...graph.unions.values()].sort((a, b) => unionSortKey(a).localeCompare(unionSortKey(b)))) {
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
    const originRoot = roots.find((root) =>
      root !== coreRoot && containsMember(root, pending.sharedPersonId)
    );
    if (!originRoot) return [];
    originRoot.exitMember = pending.sharedPersonId;
    return [{ couple: pending.couple, originRoot, sharedPersonId: pending.sharedPersonId }];
  });

  return { roots, originLinks };
}

export function formatForest(boxes: Box[], depth = 0): string {
  const indent = "  ".repeat(depth);
  return boxes.map((box) => {
    const label = `${indent}${box.hub ? "hub" : box.kind} [${box.members.join(", ")}] width=${box.width}`;
    const origin = box.originOf ? ` originOf=${box.originOf}` : "";
    const children = box.children?.length ? `\n${formatForest(box.children, depth + 1)}` : "";
    const top = box.top ? `\n${formatForest([box.top], depth + 1)}` : "";
    return `${label}${origin}${top}${children}`;
  }).join("\n");
}

function marriageGapForUnion(
  graph: PedigreeGraph,
  parentUnionByChild: Map<string, string>,
  union: UnionNode,
  originOf?: string
) {
  if (union.partners.length === 2 && union.partners.every((partnerId) => parentUnionByChild.has(partnerId))) {
    return DUAL_ORIGIN_MARRIAGE_GAP;
  }
  const hasChildren = (graph.childrenMap.get(union.id) ?? []).length > 0;
  const hasOriginPartner = !!originOf || union.partners.some((partnerId) => parentUnionByChild.has(partnerId));
  return hasChildren || hasOriginPartner ? BRANCHED_MARRIAGE_GAP : BASE_MARRIAGE_GAP;
}

function orderPartnersForMain(
  graph: PedigreeGraph,
  parentUnionByChild: Map<string, string>,
  union: UnionNode,
  mainPersonId?: string,
  originOf?: string
): string[] {
  if (!mainPersonId || !originOf || union.partners.length !== 2) return [...union.partners];
  const sexOrdered = orderPartnersBySex(graph, mainPersonId, originOf);
  if (sexOrdered) return sexOrdered;
  return shouldPlaceOriginLeft(graph, parentUnionByChild, mainPersonId)
    ? [originOf, mainPersonId]
    : [mainPersonId, originOf];
}

function orderPartnersBySex(graph: PedigreeGraph, mainPersonId: string, originOf: string): string[] | null {
  const main = graph.persons.get(mainPersonId);
  const origin = graph.persons.get(originOf);
  if (!main || !origin || main.sex === origin.sex) return null;
  if (main.sex === "M" && origin.sex !== "M") return [mainPersonId, originOf];
  if (origin.sex === "M" && main.sex !== "M") return [originOf, mainPersonId];
  if (main.sex === "F" && origin.sex !== "F") return [originOf, mainPersonId];
  if (origin.sex === "F" && main.sex !== "F") return [mainPersonId, originOf];
  return null;
}

function shouldPlaceOriginLeft(
  graph: PedigreeGraph,
  parentUnionByChild: Map<string, string>,
  mainPersonId: string
): boolean {
  const parentUnionId = parentUnionByChild.get(mainPersonId);
  if (!parentUnionId) return false;
  const siblings = sortedChildren(graph, parentUnionId);
  const index = siblings.indexOf(mainPersonId);
  if (index < 0) return false;
  return index > (siblings.length - 1) / 2;
}

function containsMember(box: Box, memberId: string): boolean {
  if (box.members.includes(memberId)) return true;
  if (box.top && containsMember(box.top, memberId)) return true;
  return box.children?.some((child) => containsMember(child, memberId)) ?? false;
}

function containsBox(box: Box, target: Box): boolean {
  if (box === target) return true;
  if (box.top && containsBox(box.top, target)) return true;
  return box.children?.some((child) => containsBox(child, target)) ?? false;
}

function rootForBox(roots: Box[], target: Box): Box | null {
  return roots.find((root) => root === target || containsBox(root, target)) ?? null;
}
