export type Sex = "M" | "F" | "U";

export interface Person {
  id: string;
  sex: Sex;
  affected?: boolean;
  carrier?: boolean;
  twinGroup?: string;
  twinType?: "fraternal" | "identical";

  generation?: number;
  birthOrder?: number;
  x?: number;
  y?: number;
}
