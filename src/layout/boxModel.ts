export const NODE_SIZE = 44;
export const PERSON_GAP = NODE_SIZE * 2.7;
export const SLOT = PERSON_GAP;
export const BASE_MARRIAGE_GAP = NODE_SIZE * 2.1;
export const BRANCHED_MARRIAGE_GAP = NODE_SIZE * 2.25;
export const MARRIAGE_GAP = BRANCHED_MARRIAGE_GAP;
export const SIBLING_GAP = PERSON_GAP;
export const MIN_GAP = NODE_SIZE * 0.8;
export const GENERATION_GAP = NODE_SIZE * 3.7;

export type BoxKind = "person" | "couple" | "family";

export interface Box {
  kind: BoxKind;
  width: number;
  cx: number;
  gen: number;
  members: string[];
  anchorX(id: string): number;
  dropX(): number;
  children?: Box[];
  top?: Box;
  mainPersonId?: string;
  originOf?: string;
  exitMember?: string;
  marriageGap?: number;
  _childrenW?: number;
  _topW?: number;
}

export function createPersonBox(personId: string, generation: number): Box {
  return {
    kind: "person",
    width: SLOT,
    cx: 0,
    gen: generation,
    members: [personId],
    mainPersonId: personId,
    anchorX(id: string) {
      return this.cx;
    },
    dropX() {
      return this.cx;
    }
  };
}

export function createCoupleBox(
  partnerIds: string[],
  generation: number,
  mainPersonId?: string,
  originOf?: string,
  marriageGap = BASE_MARRIAGE_GAP
): Box {
  const [leftId, rightId] = partnerIds;
  const offsets = new Map<string, number>();
  const partnerOffset = marriageGap / 2;
  if (leftId) offsets.set(leftId, partnerIds.length === 1 ? 0 : -partnerOffset);
  if (rightId) offsets.set(rightId, partnerOffset);

  return {
    kind: "couple",
    width: Math.max(SLOT * partnerIds.length, marriageGap + SLOT),
    cx: 0,
    gen: generation,
    members: [...partnerIds],
    mainPersonId,
    originOf,
    marriageGap,
    anchorX(id: string) {
      return this.cx + (offsets.get(id) ?? 0);
    },
    dropX() {
      return this.cx;
    }
  };
}

export function createFamilyBox(top: Box, children: Box[], mainPersonId?: string): Box {
  const childrenWidth = children.reduce((sum, child, index) =>
    sum + child.width + (index === 0 ? 0 : SIBLING_GAP), 0);
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
    anchorX(id: string) {
      return top.anchorX(id);
    },
    dropX() {
      return top.dropX();
    }
  };
}
