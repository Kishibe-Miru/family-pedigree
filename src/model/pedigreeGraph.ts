import { Person } from "./person";
import { UnionNode } from "./union";

export interface PedigreeGraph {
  persons: Map<string, Person>;
  unions: Map<string, UnionNode>;
  childrenMap: Map<string, string[]>;
}
