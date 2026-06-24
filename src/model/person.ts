export type Sex = "M" | "F" | "U";

export interface Person {
  id: string;
  sex: Sex;
  affected?: boolean;
  carrier?: boolean;

  generation?: number;
  birthOrder?: number;
}
