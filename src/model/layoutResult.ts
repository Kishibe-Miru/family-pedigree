import { Sex } from "./person";

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
  affected?: boolean;
  carrier?: boolean;
}

export type RelationshipSegmentKind =
  | "marriage"
  | "parent-drop"
  | "sibling-line"
  | "child-drop"
  | "twin"
  | "twin-bar"
  | "unknown";

export interface RelationshipSegment {
  id: string;
  type: "marriage" | "descent" | "sibling" | "individual" | "twin-bar";
  kind: RelationshipSegmentKind;
  unionId?: string;
  personId?: string;
  partnerIds?: string[];
  parentIds?: string[];
  childIds?: string[];
  twinGroup?: string;
  points: Array<{ x: number; y: number }>;
  doubleLine?: boolean;
  source?: {
    unionId?: string;
    parentIds?: string[];
    childIds?: string[];
    personIds?: string[];
  };
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
