import { PedigreeGraph } from "./model/pedigreeGraph";
import { buildPedigree } from "./core/engine";

export { buildPedigree };

export function renderPedigree(graph: PedigreeGraph): string {
  return buildPedigree(graph);
}

export default buildPedigree;
