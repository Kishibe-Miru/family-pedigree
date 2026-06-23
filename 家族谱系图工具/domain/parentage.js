"use strict";

/* global window */

window.PedigreeDomain = window.PedigreeDomain || {};

/**
 * @typedef {Object} Parentage
 * @property {string} id
 * @property {string} unionId
 * @property {string[]} parentIds
 * @property {string} childId
 * @property {"biological"|"adoptive"|"donor"|"surrogate"|"unknown"} kind
 */

function normalizeParentage(input) {
  return {
    id: input.id,
    unionId: input.unionId || "",
    parentIds: [...new Set(input.parentIds || [])],
    childId: input.childId,
    kind: input.kind || "biological"
  };
}

window.PedigreeDomain.normalizeParentage = normalizeParentage;
