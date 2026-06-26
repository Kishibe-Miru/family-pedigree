import { PedigreeGraph } from "../model/pedigreeGraph";
import { UnionNode } from "../model/union";
import { Box, createCoupleBox, createFamilyBox, createPersonBox } from "./boxModel";
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
    const top = union.partners.length === 2
      ? createCoupleBox(partners, partnerGeneration, mainId, originOf)
      : createPersonBox(union.partners[0], partnerGeneration);
    if (top.originOf) {
      pendingOriginLinks.push({ couple: top, sharedPersonId: top.originOf });
    }

    if (mainPersonId) visitedMainPeople.add(mainPersonId);
    else union.partners.forEach((partnerId) => visitedMainPeople.add(partnerId));

    const children: Box[] = [];
    for (const childId of sortedChildren(graph, union.id)) {
      const child = graph.persons.get(childId);
      if (!child) continue;

      const childUnions = (unionsByPartner.get(childId) ?? [])
        .filter((childUnion) => childUnion.id !== union.id && !visitedUnions.has(childUnion.id))
        .sort((a, b) => unionSortKey(a).localeCompare(unionSortKey(b)));
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
    const label = `${indent}${box.kind} [${box.members.join(", ")}] width=${box.width}`;
    const origin = box.originOf ? ` originOf=${box.originOf}` : "";
    const children = box.children?.length ? `\n${formatForest(box.children, depth + 1)}` : "";
    const top = box.top ? `\n${formatForest([box.top], depth + 1)}` : "";
    return `${label}${origin}${top}${children}`;
  }).join("\n");
}

function orderPartnersForMain(
  graph: PedigreeGraph,
  parentUnionByChild: Map<string, string>,
  union: UnionNode,
  mainPersonId?: string,
  originOf?: string
): string[] {
  if (!mainPersonId || !originOf || union.partners.length !== 2) return [...union.partners];
  return shouldPlaceOriginLeft(graph, parentUnionByChild, mainPersonId)
    ? [originOf, mainPersonId]
    : [mainPersonId, originOf];
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
  return index < (siblings.length - 1) / 2;
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
