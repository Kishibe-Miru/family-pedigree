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
 *   partner 在婚；separated 分居（婚配线 1 道斜杠）；divorced 离婚（2 道斜杠）。
 *   terminated 保留未用；single-parent 单亲。
 * @property {number} order 创建顺序，同一人的多段婚姻按此区分先后
 * @property {string} [startYear] 结婚年份（可选，自由文本）
 * @property {string} [endYear] 分居 / 离婚年份（可选，自由文本）
 */

const UNION_STATUSES = new Set(["partner", "separated", "divorced", "terminated", "single-parent"]);

function unionKey(partnerIds) {
  return [...new Set(partnerIds)].sort().join("|") || "single-parent";
}

function normalizeUnionStatus(status, partnerCount) {
  if (partnerCount === 1) return "single-parent";
  return UNION_STATUSES.has(status) && status !== "single-parent" ? status : "partner";
}

function normalizeYear(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeUnion(input) {
  const partnerIds = [...new Set(input.partnerIds || [])];
  const union = {
    id: input.id,
    partnerIds,
    status: normalizeUnionStatus(input.status, partnerIds.length),
    order: Number.isFinite(input.order) ? input.order : 0
  };
  const startYear = normalizeYear(input.startYear);
  const endYear = normalizeYear(input.endYear);
  if (startYear) union.startYear = startYear;
  if (endYear) union.endYear = endYear;
  return union;
}

window.PedigreeDomain.unionKey = unionKey;
window.PedigreeDomain.normalizeUnion = normalizeUnion;
window.PedigreeDomain.normalizeUnionStatus = normalizeUnionStatus;
