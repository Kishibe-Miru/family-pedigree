"use strict";

/* global window */

window.PedigreeDomain = window.PedigreeDomain || {};

/**
 * Union is the explicit partnership / reproductive unit.
 * Children attach to a Parentage that points at one Union.
 *
 * @typedef {Object} Union
 * @property {string} id
 * @property {string[]} partnerIds
 * @property {"partner"|"separated"|"divorced"|"terminated"|"single-parent"} status
 * @property {number} order
 */

function unionKey(partnerIds) {
  return [...new Set(partnerIds)].sort().join("|") || "single-parent";
}

function normalizeUnion(input) {
  return {
    id: input.id,
    partnerIds: [...new Set(input.partnerIds || [])],
    status: input.status || ((input.partnerIds || []).length === 1 ? "single-parent" : "partner"),
    order: Number.isFinite(input.order) ? input.order : 0
  };
}

window.PedigreeDomain.unionKey = unionKey;
window.PedigreeDomain.normalizeUnion = normalizeUnion;
