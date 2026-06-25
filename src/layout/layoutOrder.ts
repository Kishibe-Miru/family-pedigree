import { PedigreeGraph } from "../model/pedigreeGraph";

export type GenerationOrder = Map<number, string[]>;

const orders = new WeakMap<PedigreeGraph, GenerationOrder>();

export function setGenerationOrder(graph: PedigreeGraph, order: GenerationOrder) {
  orders.set(graph, order);
}

export function getGenerationOrder(graph: PedigreeGraph): GenerationOrder | undefined {
  return orders.get(graph);
}
