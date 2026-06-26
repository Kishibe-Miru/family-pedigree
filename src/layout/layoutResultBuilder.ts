import { NODE_SIZE } from "./boxModel";
import {
  GenerationLabel,
  LayoutBounds,
  LayoutInput,
  LayoutNode,
  LayoutResult,
  RelationshipSegment,
  UnionAnchor
} from "../model/layoutResult";
import { PedigreeGraph } from "../model/pedigreeGraph";
import { GraphValidationError, validateGraph } from "../rules/validation";

const R = NODE_SIZE / 2;
const SIBSHIP_DROP = NODE_SIZE * 1.25;
const ROUTED_MARRIAGE_DROP = NODE_SIZE * 1.65;
const MIN_PARENT_DROP = NODE_SIZE * 0.65;

export interface FinalizeLayoutPerson {
  id: string;
  x?: number;
  y?: number;
  manual?: boolean;
  twinGroup?: string;
  twinType?: "fraternal" | "identical";
}

export interface FinalizeLayoutOptions {
  layout: LayoutResult;
  people: FinalizeLayoutPerson[];
  unions: LayoutInput["unions"];
  childrenMap: LayoutInput["childrenMap"];
}

export function buildLayoutResult(graph: PedigreeGraph, input: LayoutInput): LayoutResult {
  const displayGraph = graphForDisplayRouting(graph);
  const nodes = [...displayGraph.persons.values()].map((person) => ({
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
  const unionAnchors = buildUnionAnchors(displayGraph);
  const relationshipSegments = buildRelationshipSegments(displayGraph, inputPeople, inputUnions, unionAnchors);
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

export function applyManualNodePositionsToLayout(options: FinalizeLayoutOptions): LayoutResult {
  const peopleById = new Map(options.people.map((person) => [person.id, person]));
  const nodes = options.layout.nodes.map((node) => {
    const person = peopleById.get(node.id);
    if (!person?.manual) return { ...node };
    return {
      ...node,
      x: Number.isFinite(person.x) ? person.x as number : node.x,
      y: Number.isFinite(person.y) ? person.y as number : node.y
    };
  });
  const graph = graphFromLayout(nodes, options.unions, options.childrenMap);
  validateGraph(graph);
  const displayGraph = graphForDisplayRouting(graph);
  const displayNodes = [...displayGraph.persons.values()].map((person) => ({
    id: person.id,
    sex: person.sex,
    affected: person.affected,
    carrier: person.carrier,
    x: person.x ?? 0,
    y: person.y ?? 0,
    generation: person.generation ?? 0
  }));

  const inputPeople = new Map(options.people.map((person) => [person.id, person]));
  const inputUnions = new Map(options.unions.map((union) => [union.id, union]));
  const unionAnchors = buildUnionAnchors(displayGraph);
  const relationshipSegments = buildRelationshipSegments(displayGraph, inputPeople, inputUnions, unionAnchors);
  const bounds = computeBounds(displayNodes);
  const generationLabels = buildGenerationLabels(displayNodes, bounds);

  return {
    ...options.layout,
    nodes: displayNodes,
    positions: displayNodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      generation: node.generation
    })),
    relationshipSegments,
    unionAnchors,
    bounds,
    generationLabels
  };
}

export function graphFromLayout(
  nodes: LayoutNode[],
  unions: LayoutInput["unions"],
  childrenMap: LayoutInput["childrenMap"]
): PedigreeGraph {
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

function graphForDisplayRouting(graph: PedigreeGraph): PedigreeGraph {
  const displayGraph: PedigreeGraph = {
    persons: new Map([...graph.persons.entries()].map(([id, person]) => [id, { ...person }])),
    unions: new Map([...graph.unions.entries()].map(([id, union]) => [id, { ...union, partners: [...union.partners] }])),
    childrenMap: new Map([...graph.childrenMap.entries()].map(([unionId, childIds]) => [unionId, [...childIds]]))
  };
  moveDisplayOriginFamiliesOutsideSourceSiblingRails(displayGraph);
  return displayGraph;
}

function moveDisplayOriginFamiliesOutsideSourceSiblingRails(graph: PedigreeGraph) {
  const parentUnionByChild = new Map<string, string>();
  for (const [unionId, childIds] of graph.childrenMap.entries()) {
    for (const childId of childIds) {
      if (!parentUnionByChild.has(childId)) parentUnionByChild.set(childId, unionId);
    }
  }

  for (const union of graph.unions.values()) {
    if (union.partners.length !== 2 || (graph.childrenMap.get(union.id) ?? []).length > 0) continue;
    const [firstId, secondId] = union.partners;
    const firstParentUnionId = parentUnionByChild.get(firstId);
    const secondParentUnionId = parentUnionByChild.get(secondId);
    if (!firstParentUnionId || !secondParentUnionId) continue;

    const firstSiblingCount = graph.childrenMap.get(firstParentUnionId)?.length ?? 0;
    const secondSiblingCount = graph.childrenMap.get(secondParentUnionId)?.length ?? 0;
    if (Math.max(firstSiblingCount, secondSiblingCount) < 2 || firstSiblingCount === secondSiblingCount) continue;

    const sourceId = firstSiblingCount > secondSiblingCount ? firstId : secondId;
    const originId = sourceId === firstId ? secondId : firstId;
    const sourceParentUnionId = sourceId === firstId ? firstParentUnionId : secondParentUnionId;
    const originParentUnionId = originId === firstId ? firstParentUnionId : secondParentUnionId;
    moveDisplayOriginFamilyOutsideSiblingRail(graph, sourceParentUnionId, originParentUnionId, originId);
  }
}

function moveDisplayOriginFamilyOutsideSiblingRail(
  graph: PedigreeGraph,
  sourceParentUnionId: string,
  originParentUnionId: string,
  originId: string
) {
  const origin = graph.persons.get(originId);
  if (!origin || !Number.isFinite(origin.x)) return;
  const siblingXs = (graph.childrenMap.get(sourceParentUnionId) ?? [])
    .map((id) => graph.persons.get(id)?.x)
    .filter((x): x is number => Number.isFinite(x));
  if (siblingXs.length < 2) return;

  const minX = Math.min(...siblingXs);
  const maxX = Math.max(...siblingXs);
  const originX = origin.x ?? 0;
  if (originX <= minX || originX >= maxX) return;

  const targetX = originX - minX <= maxX - originX
    ? minX - NODE_SIZE * 1.3
    : maxX + NODE_SIZE * 1.3;
  const dx = targetX - originX;
  for (const id of displayOriginFamilyIds(graph, originParentUnionId)) {
    const person = graph.persons.get(id);
    if (person && Number.isFinite(person.x)) person.x = (person.x ?? 0) + dx;
  }
}

function displayOriginFamilyIds(graph: PedigreeGraph, originParentUnionId: string) {
  const ids = new Set<string>();
  const union = graph.unions.get(originParentUnionId);
  union?.partners.forEach((id) => ids.add(id));
  (graph.childrenMap.get(originParentUnionId) ?? []).forEach((id) => ids.add(id));
  return ids;
}

export function normalizePartners(union: LayoutInput["unions"][number]): [string] | [string, string] {
  if (union.partners.length === 1) return [union.partners[0]];
  if (union.partners.length === 2) return [union.partners[0], union.partners[1]];
  throw new GraphValidationError(
    "GRAPH_UNION_PARTNER_COUNT",
    `union ${union.id} must have 1 or 2 partners, got ${union.partners.length}`,
    { unionId: union.id, partners: union.partners }
  );
}

function buildUnionAnchors(graph: PedigreeGraph): UnionAnchor[] {
  return [...graph.unions.values()].flatMap((union) => {
    const partners = union.partners
      .map((id) => graph.persons.get(id))
      .filter(hasCoordinates);
    if (partners.length === 0) return [];
    return [{
      unionId: union.id,
      partnerIds: [...union.partners],
      x: avg(partners.map((person) => person.x)),
      y: avg(partners.map((person) => person.y))
    }];
  });
}

function buildRelationshipSegments(
  graph: PedigreeGraph,
  inputPeople: Map<string, RelationshipPersonMeta>,
  inputUnions: Map<string, LayoutInput["unions"][number]>,
  unionAnchors: UnionAnchor[]
): RelationshipSegment[] {
  const segments: RelationshipSegment[] = [];
  const anchors = new Map(unionAnchors.map((anchor) => [anchor.unionId, anchor]));
  const marriageLines = new Map<string, Array<{ x: number; y: number }>>();

  for (const union of graph.unions.values()) {
    const parentIds = [...union.partners];
    const childIds = [...(graph.childrenMap.get(union.id) ?? [])];
    const partners = union.partners
      .map((id) => graph.persons.get(id))
      .filter(hasCoordinates);

    if (partners.length === 2) {
      const [left, right] = partners[0].x <= partners[1].x
        ? [partners[0], partners[1]]
        : [partners[1], partners[0]];
      const points = marriageLinePoints(graph, left, right, parentIds, childIds);
      marriageLines.set(union.id, points);
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

    const kids = childIds
      .map((id) => graph.persons.get(id))
      .filter(hasCoordinates);
    if (kids.length === 0 || partners.length === 0) continue;

    const anchor = anchors.get(union.id);
    const descentStart = marriageDescentStart(marriageLines.get(union.id));
    const dropX = descentStart?.x ?? anchor?.x ?? avg(partners.map((person) => person.x));
    const dropTopY = descentStart?.y ?? (partners.length === 2
      ? (anchor?.y ?? avg(partners.map((person) => person.y)))
      : partners[0].y);
    const childTopY = Math.min(...kids.map((kid) => kid.y)) - R;
    const defaultSiblingY = childTopY - SIBSHIP_DROP + R;
    const lowestSiblingY = childTopY - NODE_SIZE * 0.25;
    const siblingY = Math.min(lowestSiblingY, Math.max(defaultSiblingY, dropTopY + MIN_PARENT_DROP));
    const sortedKids = [...kids].sort((a, b) => a.x - b.x);
    const minKidX = sortedKids[0].x;
    const maxKidX = sortedKids[sortedKids.length - 1].x;
    const singleChild = kids.length === 1;

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

    if (singleChild) {
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
        points: [{ x: dropX, y: siblingY }, { x: dropX, y: siblingY }]
      });
    } else {
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
            points: [{ x: child.x, y: siblingY }, { x: child.x, y: child.y }]
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
          points: [{ x: apexX, y: siblingY }, { x: child.x, y: forkY }, { x: child.x, y: child.y }]
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

  return applyParentDropDetours(segments);
}

function marriageDescentStart(points?: Array<{ x: number; y: number }>) {
  if (!points || points.length < 2) return undefined;
  const horizontalSegments = [];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    const current = points[i];
    if (Math.abs(previous.y - current.y) < 0.5) {
      horizontalSegments.push({ previous, current });
    }
  }
  const segment = horizontalSegments[horizontalSegments.length - 1];
  if (!segment) return undefined;
  return {
    x: (segment.previous.x + segment.current.x) / 2,
    y: segment.previous.y
  };
}

function marriageLinePoints(
  graph: PedigreeGraph,
  left: PersonWithCoordinates,
  right: PersonWithCoordinates,
  partnerIds: string[],
  childIds: string[] = []
) {
  const start = { x: left.x, y: left.y };
  const end = { x: right.x, y: right.y };
  if (Math.abs(left.y - right.y) >= 0.5) {
    const mx = (left.x + right.x) / 2;
    return [start, { x: mx, y: left.y }, { x: mx, y: right.y }, end];
  }

  const blockers = [...graph.persons.values()].filter((person) =>
    hasCoordinates(person) &&
    !partnerIds.includes(person.id) &&
    Math.abs(person.y - left.y) < 0.5 &&
    person.x > start.x &&
    person.x < end.x
  );
  if (blockers.length === 0 && !requiresLoweredChildbearingMarriage(graph, partnerIds, childIds)) return [start, end];

  const routeY = left.y + ROUTED_MARRIAGE_DROP;
  return [start, { x: start.x, y: routeY }, { x: end.x, y: routeY }, end];
}

function requiresLoweredChildbearingMarriage(
  graph: PedigreeGraph,
  partnerIds: string[],
  childIds: string[]
) {
  if (childIds.length === 0 || partnerIds.length !== 2) return false;
  const parentUnionByChild = new Set<string>();
  for (const ids of graph.childrenMap.values()) {
    for (const id of ids) parentUnionByChild.add(id);
  }
  return partnerIds.every((id) => parentUnionByChild.has(id));
}

function applyParentDropDetours(segments: RelationshipSegment[]): RelationshipSegment[] {
  const siblingLines = segments.filter((segment) =>
    segment.kind === "sibling-line" && isHorizontal(segment.points)
  );
  const removedSegmentIds = new Set<string>();

  const routed = segments.map((segment) => {
    if (segment.kind !== "parent-drop" || !isVertical(segment.points) || (segment.childIds ?? []).length !== 1) {
      return segment;
    }

    const blockers = siblingLines.filter((line) =>
      line.unionId !== segment.unionId &&
      !sharesAny(line.childIds ?? [], segment.childIds ?? []) &&
      verticalCrossesSiblingLine(segment.points, line)
    );
    if (blockers.length === 0) return segment;

    const childDrop = segments.find((candidate) =>
      candidate.kind === "child-drop" &&
      candidate.unionId === segment.unionId &&
      candidate.childIds?.[0] === segment.childIds?.[0] &&
      candidate.points.length >= 2
    );
    if (!childDrop) return segment;

    removedSegmentIds.add(childDrop.id);
    return { ...segment, points: detourParentDropPoints(segment.points, childDrop.points[childDrop.points.length - 1], blockers) };
  });

  return routed.filter((segment) => !removedSegmentIds.has(segment.id));
}

function isHorizontal(points: Array<{ x: number; y: number }>) {
  return points.length === 2 && Math.abs(points[0].y - points[1].y) < 0.5;
}

function isVertical(points: Array<{ x: number; y: number }>) {
  return points.length === 2 && Math.abs(points[0].x - points[1].x) < 0.5;
}

function verticalCrossesSiblingLine(
  points: Array<{ x: number; y: number }>,
  siblingLine: RelationshipSegment
) {
  const [start, end] = siblingLine.points;
  const x = points[0].x;
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const y = start.y;
  const minY = Math.min(points[0].y, points[1].y);
  const maxY = Math.max(points[0].y, points[1].y);
  return x > minX + 0.5 && x < maxX - 0.5 && y >= minY - 0.5 && y <= maxY + 0.5;
}

function detourParentDropPoints(
  points: Array<{ x: number; y: number }>,
  target: { x: number; y: number },
  blockers: RelationshipSegment[]
) {
  const [start] = points;
  const clearance = Math.max(10, R * 0.45);
  const blockerBounds = blockers.map((line) => {
    const [a, b] = line.points;
    return {
      minX: Math.min(a.x, b.x),
      maxX: Math.max(a.x, b.x),
      y: a.y
    };
  });
  const minX = Math.min(...blockerBounds.map((blocker) => blocker.minX));
  const maxX = Math.max(...blockerBounds.map((blocker) => blocker.maxX));
  const topY = Math.min(...blockerBounds.map((blocker) => blocker.y)) - clearance;
  const bottomY = Math.max(...blockerBounds.map((blocker) => blocker.y)) + clearance;
  const detourX = target.x - minX <= maxX - target.x
    ? minX - NODE_SIZE
    : maxX + NODE_SIZE;

  return dedupePoints([
    start,
    { x: start.x, y: topY },
    { x: detourX, y: topY },
    { x: detourX, y: bottomY },
    { x: target.x, y: bottomY },
    target
  ]);
}

function dedupePoints(points: Array<{ x: number; y: number }>) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || Math.abs(previous.x - point.x) >= 0.5 || Math.abs(previous.y - point.y) >= 0.5;
  });
}

function sharesAny(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return left.some((id) => rightSet.has(id));
}

function groupChildren(
  children: PersonWithCoordinates[],
  inputPeople: Map<string, RelationshipPersonMeta>
) {
  const groups: Array<{ twinGroup?: string; twinType?: "fraternal" | "identical"; children: PersonWithCoordinates[] }> = [];
  const twins = new Map<string, PersonWithCoordinates[]>();
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

function computeBounds(nodes: LayoutNode[]): LayoutBounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const minX = Math.min(...nodes.map((node) => node.x)) - R;
  const minY = Math.min(...nodes.map((node) => node.y)) - R;
  const maxX = Math.max(...nodes.map((node) => node.x)) + R;
  const maxY = Math.max(...nodes.map((node) => node.y)) + R;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function buildGenerationLabels(nodes: LayoutNode[], bounds: LayoutBounds): GenerationLabel[] {
  const rows = new Map<number, LayoutNode[]>();
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

type PersonWithCoordinates = NonNullable<ReturnType<typeof getPersonWithCoordinates>>;

type RelationshipPersonMeta = {
  id: string;
  twinGroup?: string;
  twinType?: "fraternal" | "identical";
};

function getPersonWithCoordinates(id: string, graph: PedigreeGraph) {
  const person = graph.persons.get(id);
  return hasCoordinates(person) ? person : undefined;
}

function hasCoordinates<T extends { x?: number; y?: number }>(person: T | undefined): person is T & { x: number; y: number } {
  return !!person && Number.isFinite(person.x) && Number.isFinite(person.y);
}

function avg(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
}

function roman(n: number): string {
  const table: Array<[string, number]> = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
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
