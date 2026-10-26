export const NODE_SIZE = 44;
export const PERSON_GAP = NODE_SIZE * 2.7;
export const SLOT = PERSON_GAP;
export const BASE_MARRIAGE_GAP = NODE_SIZE * 2.1;
export const BRANCHED_MARRIAGE_GAP = NODE_SIZE * 2.25;
export const DUAL_ORIGIN_MARRIAGE_GAP = BRANCHED_MARRIAGE_GAP + NODE_SIZE * 1.45;
export const MARRIAGE_GAP = BRANCHED_MARRIAGE_GAP;
export const SIBLING_GAP = PERSON_GAP;
export const MIN_GAP = NODE_SIZE * 0.8;
export const GENERATION_GAP = NODE_SIZE * 3.45;

export type BoxKind = "person" | "couple" | "family";

/** 婚姻枢纽：一个人（personId）的多段婚姻，按先后排列；每段婚姻各自带子女组 */
export interface HubUnionGroup {
  unionId: string;
  partnerId: string;
  marriageGap: number;
  children: Box[];
}

export interface HubInfo {
  personId: string;
  unions: HubUnionGroup[];
}

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
  /** 枢纽家庭盒子（kind = family）：top 为枢纽顶部盒子，children 为各段婚姻子女组的拼接 */
  hub?: HubInfo;
  /** 枢纽顶部盒子（kind = couple）：成员相对 cx 的偏移，由求解器按子女组宽度算出 */
  offsets?: Map<string, number>;
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

/**
 * 枢纽顶部盒子：成员顺序为 [配偶1, 枢纽本人, 配偶2, 配偶3, …]。
 * 偏移初值按婚配间距排布，正式位置在求解器 placeBox 中按子女组宽度重算。
 */
export function createHubTopBox(hub: HubInfo, generation: number, originOf?: string): Box {
  const [first, ...rest] = hub.unions;
  const members = [first.partnerId, hub.personId, ...rest.map((union) => union.partnerId)];
  const offsets = new Map<string, number>();
  offsets.set(first.partnerId, -first.marriageGap);
  offsets.set(hub.personId, 0);
  let x = 0;
  rest.forEach((union, index) => {
    x += index === 0 ? union.marriageGap : PERSON_GAP;
    offsets.set(union.partnerId, x);
  });
  const marriageGap = Math.max(...hub.unions.map((union) => union.marriageGap));

  return {
    kind: "couple",
    width: offsets.get(members[members.length - 1])! - offsets.get(members[0])! + SLOT,
    cx: 0,
    gen: generation,
    members,
    mainPersonId: hub.personId,
    originOf,
    marriageGap,
    offsets,
    anchorX(id: string) {
      return this.cx + (this.offsets?.get(id) ?? 0);
    },
    dropX() {
      return this.cx;
    }
  };
}

export function createHubFamilyBox(top: Box, hub: HubInfo): Box {
  const children = hub.unions.flatMap((union) => union.children);
  return {
    kind: "family",
    width: top.width,
    cx: 0,
    gen: top.gen,
    members: [...top.members],
    mainPersonId: hub.personId,
    top,
    children,
    hub,
    anchorX(id: string) {
      return top.anchorX(id);
    },
    dropX() {
      return top.dropX();
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
