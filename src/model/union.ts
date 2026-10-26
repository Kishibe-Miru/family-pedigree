export interface UnionNode {
  id: string;
  partners: [string] | [string, string];
  /** 同一人多段婚姻的先后（越小越早），用于婚姻枢纽盒子的左右排序 */
  order?: number;
}
