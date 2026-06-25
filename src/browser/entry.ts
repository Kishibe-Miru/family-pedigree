import { GENERATION_GAP, NODE_SIZE } from "../layout/boxModel";
import { assignCoordinates } from "../layout/coordinateSolver";
import { reduceCrossings } from "../layout/crossingReducer";
import { assignLayers } from "../layout/layerAssigner";
import { PedigreeGraph } from "../model/pedigreeGraph";
import { Sex } from "../model/person";

export interface LayoutInput {
  persons: Array<{ id: string; sex: Sex; birthOrder?: number; twinGroup?: string; twinType?: "fraternal" | "identical" }>;
  unions: Array<{ id: string; partners: string[]; consanguineous?: boolean }>;
  childrenMap: Array<[string, string[]]>;
}

export interface LayoutPosition {
  id: string;
  x: number;
  y: number;
  generation: number;
}

export interface LayoutNode extends LayoutPosition {
  sex: Sex;
}

export interface RelationshipSegment {
  id: string;
  type: "marriage" | "descent" | "sibling" | "individual" | "twin-bar";
  unionId?: string;
  personId?: string;
  twinGroup?: string;
  points: Array<{ x: number; y: number }>;
  doubleLine?: boolean;
}

export interface UnionAnchor {
  unionId: string;
  partnerIds: string[];
  x: number;
  y: number;
}

export interface LayoutBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface GenerationLabel {
  generation: number;
  label: string;
  x: number;
  y: number;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  positions: LayoutPosition[];
  relationshipSegments: RelationshipSegment[];
  unionAnchors: UnionAnchor[];
  bounds: LayoutBounds;
  generationLabels: GenerationLabel[];
}

declare global {
  var PedigreeEngine: { layout: typeof layout };
}

export function layout(input: LayoutInput): LayoutResult | null {
  try {
    const graph: PedigreeGraph = {
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
          partners: union.partners as [string] | [string, string]
        }
      ])),
      childrenMap: new Map(input.childrenMap)
    };

    assignLayers(graph);
    reduceCrossings(graph);
    assignCoordinates(graph);

    return buildLayoutResult(graph, input);
  } catch {
    return null;
  }
}

function buildLayoutResult(graph: PedigreeGraph, input: LayoutInput): LayoutResult {
  const nodes = [...graph.persons.values()].map((person) => ({
    id: person.id,
    sex: person.sex,
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
  inputPeople: Map<string, LayoutInput["persons"][number]>,
  inputUnions: Map<string, LayoutInput["unions"][number]>,
  unionAnchors: UnionAnchor[]
): RelationshipSegment[] {
  const segments: RelationshipSegment[] = [];
  const anchors = new Map(unionAnchors.map((anchor) => [anchor.unionId, anchor]));

  for (const union of graph.unions.values()) {
    const partners = union.partners
      .map((id) => graph.persons.get(id))
      .filter(hasCoordinates);

    if (partners.length === 2) {
      const [left, right] = partners[0].x <= partners[1].x
        ? [partners[0], partners[1]]
        : [partners[1], partners[0]];
      const points = Math.abs(left.y - right.y) < 0.5
        ? [{ x: left.x + R, y: left.y }, { x: right.x - R, y: right.y }]
        : [
            { x: left.x + R, y: left.y },
            { x: (left.x + right.x) / 2, y: left.y },
            { x: (left.x + right.x) / 2, y: right.y },
            { x: right.x - R, y: right.y }
          ];
      segments.push({
        id: `${union.id}:marriage`,
        type: "marriage",
        unionId: union.id,
        points,
        doubleLine: !!inputUnions.get(union.id)?.consanguineous
      });
    }

    const kids = (graph.childrenMap.get(union.id) ?? [])
      .map((id) => graph.persons.get(id))
      .filter(hasCoordinates);
    if (kids.length === 0 || partners.length === 0) continue;

    const anchor = anchors.get(union.id);
    const dropX = anchor?.x ?? avg(partners.map((person) => person.x));
    const dropTopY = partners.length === 2
      ? (anchor?.y ?? avg(partners.map((person) => person.y)))
      : partners[0].y + R;
    const childTopY = Math.min(...kids.map((kid) => kid.y)) - R;
    const siblingY = childTopY - SIBSHIP_DROP + R;
    const sortedKids = [...kids].sort((a, b) => a.x - b.x);
    const minKidX = sortedKids[0].x;
    const maxKidX = sortedKids[sortedKids.length - 1].x;

    segments.push({
      id: `${union.id}:descent`,
      type: "descent",
      unionId: union.id,
      points: [{ x: dropX, y: dropTopY }, { x: dropX, y: siblingY }]
    });

    if (kids.length > 1 || Math.abs(kids[0].x - dropX) >= 0.5) {
      segments.push({
        id: `${union.id}:sibling`,
        type: "sibling",
        unionId: union.id,
        points: [{ x: Math.min(minKidX, dropX), y: siblingY }, { x: Math.max(maxKidX, dropX), y: siblingY }]
      });
    }

    for (const group of groupChildren(sortedKids, inputPeople)) {
      if (!group.twinGroup || group.children.length === 1) {
        for (const child of group.children) {
          segments.push({
            id: `${union.id}:${child.id}:individual`,
            type: "individual",
            unionId: union.id,
            personId: child.id,
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
          unionId: union.id,
          personId: child.id,
          twinGroup: group.twinGroup,
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
          unionId: union.id,
          twinGroup: group.twinGroup,
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

function groupChildren(
  children: PersonWithCoordinates[],
  inputPeople: Map<string, LayoutInput["persons"][number]>
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

const R = NODE_SIZE / 2;
const SIBSHIP_DROP = NODE_SIZE * 1.25;

export function legacyPositions(result: LayoutResult): LayoutPosition[] {
  return result.positions;
}

export function layoutPositions(input: LayoutInput): LayoutPosition[] | null {
  const result = layout(input);
  return result ? result.positions : null;
}

globalThis.PedigreeEngine = { layout };
