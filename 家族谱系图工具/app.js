"use strict";

/* ============================================================
   精神科遗传家族谱系图绘制工具 5.1
   纯前端、本地优先。本版新增：双胞胎（同卵/异卵）、携带者圆点、
   近亲婚配自动双线、拖动自由摆放开关、一键生成家族史文字。
   4.1：连线 T 形修复；新增"与已选成员结婚"连接已有节点为配偶；
        家族史不再把占位默认名当真名；删除孪生后清理孤立 twinGroup。
   4.2：固定同胞出生顺序；同胞小家庭整体平移；多配偶/半同胞婚配线避让。
   4.7：婚配线固定同代水平连接；同胞线仅覆盖子女范围并使用线路层避让。
   4.8：稳定性修复：多配偶子女归属选择、独生子女断线、校验与撤销/存储修复。
   5.0：显式领域模型：Union / Parentage / Phenotype / GeneticFinding / Layout。
   5.1：建立 graph engine 分层骨架，移除旧 person-person edge 与 tree layout 主体。
   ============================================================ */

const AUTOSAVE_KEY = "psychiatric-pedigree-v3-autosave";
const SVG_NS = "http://www.w3.org/2000/svg";
const VERSION = "5.1";

// 自动生成时使用的占位名（非用户真实输入），家族史等场景应视为"无名"
const PLACEHOLDER_NAMES = new Set([
  "先证者", "父", "母", "兄弟", "姐妹", "儿子", "女儿", "子女", "同胞",
  "配偶", "孪生兄弟", "孪生姐妹"
]);
function realName(p) {
  if (!p || !p.name) return "";
  return PLACEHOLDER_NAMES.has(p.name.trim()) ? "" : p.name.trim();
}

/* ---- 比例常量（以符号尺寸为基准，参考 NSGC/Bennett 规则）---- */
const NODE_SIZE = 44;
const R = NODE_SIZE / 2;
const PERSON_GAP = NODE_SIZE * 2.7;      // 同代相邻个体中心距
const GENERATION_GAP = NODE_SIZE * 3.7;  // 代际中心距
const SIBSHIP_DROP = NODE_SIZE * 1.25;   // 同胞横线距子女符号顶部
const LABEL_OFFSET = R + 14;             // 名称距符号中心
const ID_OFFSET = R + 8;                 // 编号在符号上方
const MAX_SCALE = 2.4;
const MIN_SCALE = 0.3;

/* ---- 全局状态 ---- */
const state = {
  project: createProject(),
  selectedId: null,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  drag: null,        // 拖动节点
  pan: null,         // 平移画布
  linkMode: null,    // 连接配偶模式：{ sourceId }
  history: [],
  future: [],
  formEditSnapshot: null,
  storageFailed: false,
  genMap: new Map(),
  numberMap: new Map(),
  layoutResult: null,
  layoutFamilyUnits: []
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheElements();
  bindEvents();
  if (!restoreAutosave()) setStatus("欢迎使用 · 点击「添加先证者」开始");
  refresh(false);
  fitView();
}

/* ============================================================
   元素与事件
   ============================================================ */
function cacheElements() {
  const ids = [
    "projectMeta", "undoBtn", "redoBtn", "newProjectBtn", "saveJsonBtn",
    "loadJsonInput", "exportPngBtn", "exportSvgBtn", "addProbandBtn", "addPersonBtn",
    "addFatherBtn", "addMotherBtn", "addPartnerBtn", "addBrotherBtn", "addSisterBtn",
    "addSonBtn", "addDaughterBtn", "autoLayoutBtn", "zoomInBtn", "zoomOutBtn", "resetViewBtn", "zoomLabel",
    "optShowNumber", "optShowName", "optShowDiagnosis", "optShowAge", "optShowLegend",
    "optShowTitle", "canvasArea", "canvasWrap", "pedigreeSvg", "statusLine",
    "emptySelection", "personForm", "personName", "personSex", "personAffectedStatus",
    "personAge", "personBirthYear", "personDeceased", "personProband",
    "diagnosisSelect", "diagnosisTags", "personNotes", "setProbandBtn", "clearManualBtn", "deletePersonBtn",
    "addTwinBrotherBtn", "addTwinSisterBtn", "linkPartnerBtn", "optSnapDrag", "familyHistoryBtn",
    "historyDialog", "historyText", "copyHistoryBtn", "closeHistoryBtn",
    "identicalRow", "personIdentical"
  ];
  ids.forEach((id) => (els[id] = document.getElementById(id)));
}

function bindEvents() {
  els.addProbandBtn.addEventListener("click", addProband);
  els.addPersonBtn.addEventListener("click", () => addPerson());
  els.addFatherBtn.addEventListener("click", () => addParent("male"));
  els.addMotherBtn.addEventListener("click", () => addParent("female"));
  els.addPartnerBtn.addEventListener("click", addPartner);
  els.addBrotherBtn.addEventListener("click", () => addSibling("male"));
  els.addSisterBtn.addEventListener("click", () => addSibling("female"));
  els.addSonBtn.addEventListener("click", () => addChild("male"));
  els.addDaughterBtn.addEventListener("click", () => addChild("female"));
  els.addTwinBrotherBtn.addEventListener("click", () => addTwin("male"));
  els.addTwinSisterBtn.addEventListener("click", () => addTwin("female"));
  els.linkPartnerBtn.addEventListener("click", toggleLinkPartner);
  els.familyHistoryBtn.addEventListener("click", showFamilyHistory);
  els.copyHistoryBtn.addEventListener("click", copyFamilyHistory);
  els.closeHistoryBtn.addEventListener("click", () => els.historyDialog.close());
  els.optSnapDrag.addEventListener("change", () => { syncSettings(); });
  els.personIdentical.addEventListener("change", () => updateTwinType());
  els.setProbandBtn.addEventListener("click", setSelectedAsProband);
  els.clearManualBtn.addEventListener("click", clearSelectedManualPosition);
  els.deletePersonBtn.addEventListener("click", deleteSelected);

  els.autoLayoutBtn.addEventListener("click", () => { pushHistory(); autoLayout(); refresh(); fitView(); setStatus("已自动排版"); });
  els.undoBtn.addEventListener("click", undo);
  els.redoBtn.addEventListener("click", redo);
  els.newProjectBtn.addEventListener("click", newProject);
  els.saveJsonBtn.addEventListener("click", saveJson);
  els.loadJsonInput.addEventListener("change", loadJson);
  els.exportPngBtn.addEventListener("click", () => exportImage("png"));
  els.exportSvgBtn.addEventListener("click", () => exportImage("svg"));

  els.zoomInBtn.addEventListener("click", () => zoomBy(0.15));
  els.zoomOutBtn.addEventListener("click", () => zoomBy(-0.15));
  els.resetViewBtn.addEventListener("click", fitView);

  ["optShowNumber", "optShowName", "optShowDiagnosis", "optShowAge", "optShowLegend", "optShowTitle"]
    .forEach((id) => els[id].addEventListener("change", () => { syncSettings(); refresh(); }));

  ["personName", "personAge", "personBirthYear", "personNotes"]
    .forEach((id) => els[id].addEventListener("input", () => updateFromForm(false)));
  ["personSex", "personAffectedStatus"].forEach((id) => els[id].addEventListener("change", () => updateFromForm(true)));
  els.personDeceased.addEventListener("change", () => updateFromForm(false));
  els.personProband.addEventListener("change", () => updateFromForm(false));
  els.diagnosisSelect.addEventListener("change", addDiagnosisFromSelect);
  els.personForm.addEventListener("focusin", beginFormEdit);
  els.personForm.addEventListener("focusout", commitFormEdit);

  // 画布交互
  els.pedigreeSvg.addEventListener("pointerdown", onCanvasPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  els.canvasWrap.addEventListener("wheel", onWheel, { passive: false });

  document.addEventListener("keydown", onKeyDown);
}

/* ============================================================
   数据模型
   ============================================================ */
function createProject() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    version: VERSION,
    title: "家族谱系图",
    createdAt: now,
    updatedAt: now,
    people: [],
    unions: [],
    parentages: [],
    phenotypes: [],
    geneticFindings: [],
    pregnancies: [],
    layout: { positions: {} },
    settings: {
      showNumber: true, showName: true, showDiagnosis: true,
      showAge: false, showLegend: true, showTitle: true, snapDrag: true
    }
  };
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function nextPersonOrder() {
  return state.project.people.reduce((max, p) => Math.max(max, Number.isFinite(p.order) ? p.order : 0), 0) + 1;
}

function createPerson(overrides = {}) {
  const order = Number.isFinite(overrides.order) ? overrides.order : nextPersonOrder();
  return {
    id: makeId("p"),
    name: "",
    sex: "unknown",
    affectedStatus: "unaffected",
    age: "",
    birthYear: "",
    diagnoses: [],
    deceased: false,
    proband: false,
    twinGroup: "",          // 双胞胎组 id；同组成员从同一点分叉
    twinType: "fraternal",  // fraternal 异卵 / identical 同卵
    notes: "",
    x: 0,
    y: 0,
    manual: false,   // 自由摆放：true 时自动排版跳过该节点
    order,
    ...overrides
  };
}

function getPerson(id) { return state.project.people.find((p) => p.id === id) || null; }
function selectedPerson() { return getPerson(state.selectedId); }

function requireSelection() {
  const p = selectedPerson();
  if (!p) { setStatus("请先在画布中选择一个成员"); return null; }
  return p;
}

function ensureDomainArrays() {
  state.project.unions = Array.isArray(state.project.unions) ? state.project.unions : [];
  state.project.parentages = Array.isArray(state.project.parentages) ? state.project.parentages : [];
  state.project.phenotypes = Array.isArray(state.project.phenotypes) ? state.project.phenotypes : [];
  state.project.geneticFindings = Array.isArray(state.project.geneticFindings) ? state.project.geneticFindings : [];
  state.project.pregnancies = Array.isArray(state.project.pregnancies) ? state.project.pregnancies : [];
  state.project.layout = state.project.layout || { positions: {} };
  state.project.layout.positions = state.project.layout.positions || {};
}

function unionKeyFor(partnerIds) { return PedigreeDomain.unionKey(partnerIds); }

function findUnionByPartners(partnerIds) {
  const key = unionKeyFor(partnerIds);
  return state.project.unions.find((u) => unionKeyFor(u.partnerIds) === key) || null;
}

function ensureUnion(partnerIds) {
  ensureDomainArrays();
  const unique = [...new Set(partnerIds)].filter(Boolean);
  const ids = unique.length === 2 ? orderCouple(unique[0], unique[1]) : unique;
  const existing = findUnionByPartners(ids);
  if (existing) return existing;
  const union = {
    id: makeId("u"),
    partnerIds: [...new Set(ids)],
    status: ids.length === 1 ? "single-parent" : "partner",
    order: state.project.unions.length + 1
  };
  state.project.unions.push(union);
  return union;
}

function addParentage(parentIds, childId, unionId = "") {
  ensureDomainArrays();
  const unique = [...new Set(parentIds)].filter(Boolean);
  const ids = unique.length === 2 ? orderCouple(unique[0], unique[1]) : unique;
  const union = unionId ? state.project.unions.find((u) => u.id === unionId) : ensureUnion(ids);
  const existing = state.project.parentages.find((pa) => pa.childId === childId && pa.unionId === union.id);
  if (existing) {
    existing.parentIds = orderCouple(...[...new Set([...existing.parentIds, ...ids])]);
    return existing;
  }
  const parentage = {
    id: makeId("pa"),
    unionId: union.id,
    parentIds: ids,
    childId,
    kind: "biological"
  };
  state.project.parentages.push(parentage);
  return parentage;
}

function setBiologicalParentage(childId, parentIds) {
  ensureDomainArrays();
  const unique = [...new Set(parentIds)].filter(Boolean);
  const ordered = unique.length === 2 ? orderCouple(unique[0], unique[1]) : unique;
  const union = ensureUnion(ordered);
  state.project.parentages = state.project.parentages.filter((pa) => !(pa.childId === childId && pa.kind === "biological"));
  return addParentage(ordered, childId, union.id);
}

function findParents(id) {
  ensureDomainArrays();
  return state.project.parentages
    .filter((pa) => pa.childId === id)
    .flatMap((pa) => parentIdsForParentage(pa))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .map((parentId) => getPerson(parentId)).filter(Boolean);
}
function findChildren(id) {
  ensureDomainArrays();
  return state.project.parentages
    .filter((pa) => parentIdsForParentage(pa).includes(id))
    .map((pa) => getPerson(pa.childId)).filter(Boolean);
}
function findPartners(id) {
  ensureDomainArrays();
  return state.project.unions
    .filter((u) => u.partnerIds.includes(id) && u.partnerIds.length === 2)
    .map((u) => getPerson(u.partnerIds.find((partnerId) => partnerId !== id))).filter(Boolean);
}
function hasPartner(a, b) {
  return Boolean(findUnionByPartners([a, b]));
}

function getUnion(unionId) {
  ensureDomainArrays();
  return state.project.unions.find((u) => u.id === unionId) || null;
}

function parentIdsForParentage(parentage) {
  const union = getUnion(parentage.unionId);
  return union ? union.partnerIds : [];
}

function partnerUnions() {
  ensureDomainArrays();
  return state.project.unions.filter((u) => u.partnerIds.length === 2);
}

/* ============================================================
   录入动作
   ============================================================ */
function addProband() {
  if (state.project.people.some((p) => p.proband)) {
    setStatus("已存在先证者，可在右侧勾选其他成员改设");
  }
  pushHistory();
  const p = createPerson({ name: "先证者", sex: "unknown", proband: !state.project.people.some((x) => x.proband) });
  state.project.people.push(p);
  state.selectedId = p.id;
  autoLayout(); refresh(); fitView();
  setStatus("已添加先证者");
}

function addPerson() {
  pushHistory();
  const p = createPerson({ name: "成员" });
  if (state.project.people.length === 0) { p.proband = true; p.name = "先证者"; }
  state.project.people.push(p);
  state.selectedId = p.id;
  autoLayout(); refresh(); fitView();
  setStatus("已添加成员");
}

function addParent(sex) {
  const child = requireSelection();
  if (!child) return;
  const existing = findParents(child.id);
  if (existing.some((p) => p.sex === sex)) { setStatus(sex === "male" ? "已存在父亲" : "已存在母亲"); return; }
  if (existing.length >= 2) { setStatus("该成员已有两位父母"); return; }
  pushHistory();
  const parent = createPerson({ sex, name: sex === "male" ? "父" : "母" });
  state.project.people.push(parent);
  setBiologicalParentage(child.id, [...existing.map((p) => p.id), parent.id]);
  state.selectedId = child.id;
  autoLayout(); refresh(); fitView();
  setStatus(sex === "male" ? "已添加父亲" : "已添加母亲");
}

function addPartner() {
  const person = requireSelection();
  if (!person) return;
  pushHistory();
  const partner = createPerson({
    name: "配偶",
    sex: person.sex === "male" ? "female" : person.sex === "female" ? "male" : "unknown"
  });
  state.project.people.push(partner);
  ensureUnion([person.id, partner.id]);
  state.selectedId = person.id;
  autoLayout(); refresh(); fitView();
  setStatus("已添加配偶");
}

// 进入/退出「连接已有成员为配偶」模式：点亮后点击另一节点即建立配偶关系
function toggleLinkPartner() {
  if (state.linkMode) { state.linkMode = null; setStatus("已取消连接配偶"); refresh(false); return; }
  const person = requireSelection();
  if (!person) { setStatus("请先选中一位成员，再连接其配偶"); return; }
  state.linkMode = { sourceId: person.id };
  setStatus("连接配偶：请在画布中点击另一位成员（再次点击按钮取消）");
  refresh(false);
}

// 将两个已存在成员连为配偶（带校验）
function connectPartners(aId, bId) {
  if (!aId || !bId || aId === bId) { setStatus("无法与自己结婚"); return false; }
  const a = getPerson(aId), b = getPerson(bId);
  if (!a || !b) return false;
  if (hasPartner(aId, bId)) { setStatus("两人已是配偶"); return false; }
  // 不允许直系亲属（父母/子女）成为配偶
  const aAnc = ancestorsWithDepth(aId), bAnc = ancestorsWithDepth(bId);
  if (aAnc.has(bId) || bAnc.has(aId)) { setStatus("直系亲属（父母/子女）不能连为配偶"); return false; }
  pushHistory();
  ensureUnion([aId, bId]);
  state.linkMode = null;
  state.selectedId = aId;
  autoLayout(); refresh(); fitView();
  const consang = areConsanguineous(aId, bId);
  setStatus(consang ? "已连接配偶（检测到近亲，已画双线）" : "已连接配偶");
  return true;
}

function addChild(sex) {
  const parent = requireSelection();
  if (!parent) return;
  const coParent = chooseCoParentForChild(parent);
  if (coParent === undefined) return;
  pushHistory();
  const label = sex === "male" ? "儿子" : sex === "female" ? "女儿" : "子女";
  const child = createPerson({ name: label, sex: sex || "unknown" });
  state.project.people.push(child);
  const parentIds = coParent ? [parent.id, coParent.id] : [parent.id];
  const union = ensureUnion(parentIds);
  addParentage(parentIds, child.id, union.id);
  state.selectedId = parent.id; // 光标保持在父/母，便于连续添加
  autoLayout(); refresh(); fitView();
  setStatus(coParent ? `已添加${label}，共同父母为 ${displayPersonName(parent)} 与 ${displayPersonName(coParent)}` : `已添加${label}（单亲 / 未知另一方）`);
}

function chooseCoParentForChild(parent) {
  const partners = findPartners(parent.id);
  if (partners.length === 0) return null;
  if (partners.length === 1) return partners[0];
  const choices = partners.map((p, i) => `${i + 1}. ${displayPersonName(p)}`).join("\n");
  const answer = prompt(
    `请选择新子女的共同父母：\n\n0. 单亲 / 未知另一方\n${choices}`,
    "1"
  );
  if (answer === null) {
    setStatus("已取消添加子女");
    return undefined;
  }
  const n = Number(answer.trim());
  if (n === 0) return null;
  if (Number.isInteger(n) && n >= 1 && n <= partners.length) return partners[n - 1];
  setStatus("共同父母选择无效，未添加子女");
  return undefined;
}

function displayPersonName(p) {
  if (!p) return "未知";
  return realName(p) || p.name || state.numberMap.get(p.id) || p.id;
}

function addSibling(sex) {
  const person = requireSelection();
  if (!person) return;
  const parents = findParents(person.id);
  pushHistory();
  const label = sex === "male" ? "兄弟" : sex === "female" ? "姐妹" : "同胞";
  const sib = createPerson({ name: label, sex: sex || "unknown" });
  state.project.people.push(sib);
  if (parents.length === 0) {
    // 自动补一对未知父母，保证同胞共享父母
    const dad = createPerson({ sex: "male", name: "父" });
    const mom = createPerson({ sex: "female", name: "母" });
    state.project.people.push(dad, mom);
    const union = ensureUnion([dad.id, mom.id]);
    [person, sib].forEach((c) => addParentage([dad.id, mom.id], c.id, union.id));
    setStatus(`已添加${label}并自动补充父母`);
  } else {
    const parentIds = parents.map((p) => p.id);
    const union = ensureUnion(parentIds);
    addParentage(parentIds, sib.id, union.id);
    setStatus(`已添加${label}`);
  }
  state.selectedId = person.id; // 光标保持在原成员，不随新同胞变更
  autoLayout(); refresh(); fitView();
}

// 添加孪生同胞：与选中成员共享父母，并同属一个 twinGroup（从同一点分叉）
function addTwin(sex) {
  const person = requireSelection();
  if (!person) return;
  const parents = findParents(person.id);
  pushHistory();
  const label = sex === "male" ? "孪生兄弟" : "孪生姐妹";
  // 复用/新建 twinGroup
  let group = person.twinGroup;
  if (!group) { group = makeId("tw"); person.twinGroup = group; if (!person.twinType) person.twinType = "fraternal"; }
  const twin = createPerson({ name: label, sex: sex || "unknown", twinGroup: group, twinType: person.twinType || "fraternal" });
  state.project.people.push(twin);
  if (parents.length === 0) {
    const dad = createPerson({ sex: "male", name: "父" });
    const mom = createPerson({ sex: "female", name: "母" });
    state.project.people.push(dad, mom);
    const union = ensureUnion([dad.id, mom.id]);
    [person, twin].forEach((c) => addParentage([dad.id, mom.id], c.id, union.id));
    setStatus(`已添加${label}并自动补充父母`);
  } else {
    const parentIds = parents.map((p) => p.id);
    const union = ensureUnion(parentIds);
    addParentage(parentIds, twin.id, union.id);
    setStatus(`已添加${label}`);
  }
  state.selectedId = person.id;
  autoLayout(); refresh(); fitView();
}

function updateTwinType() {
  const p = selectedPerson();
  if (!p || !p.twinGroup) return;
  const t = els.personIdentical.checked ? "identical" : "fraternal";
  state.project.people.forEach((x) => { if (x.twinGroup === p.twinGroup) x.twinType = t; });
  refresh(); autosave();
}

function deleteSelected() {
  const p = requireSelection();
  if (!p) return;
  pushHistory();
  const delGroup = p.twinGroup;
  state.project.people = state.project.people.filter((x) => x.id !== p.id);
  state.project.parentages = state.project.parentages
    .filter((pa) => pa.childId !== p.id && !pa.parentIds.includes(p.id))
    .map((pa) => ({ ...pa, parentIds: pa.parentIds.filter((id) => id !== p.id) }))
    .filter((pa) => pa.parentIds.length > 0);
  state.project.unions = state.project.unions
    .map((u) => ({ ...u, partnerIds: u.partnerIds.filter((id) => id !== p.id) }))
    .filter((u) => u.partnerIds.length > 0);
  // 清理孤立 twinGroup：同组若只剩 1 人，则该人不再是双胞胎
  if (delGroup) {
    const rest = state.project.people.filter((x) => x.twinGroup === delGroup);
    if (rest.length <= 1) rest.forEach((x) => { delete x.twinGroup; delete x.twinType; });
  }
  state.selectedId = null;
  autoLayout(); refresh(); fitView();
  setStatus("已删除成员");
}

function setSelectedAsProband() {
  const p = requireSelection();
  if (!p) return;
  pushHistory();
  state.project.people.forEach((x) => (x.proband = x.id === p.id));
  refresh();
  setStatus("已设置先证者");
}

function clearSelectedManualPosition() {
  const p = requireSelection();
  if (!p) return;
  if (!p.manual) { setStatus("当前成员未固定手动位置"); return; }
  pushHistory();
  p.manual = false;
  autoLayout(); refresh(); fitView();
  setStatus("已取消该成员的固定位置");
}

function updateFromForm(relayout) {
  const p = selectedPerson();
  if (!p) return;
  p.name = els.personName.value;
  p.sex = els.personSex.value;
  p.affectedStatus = els.personAffectedStatus.value;
  p.age = els.personAge.value.trim();
  p.birthYear = els.personBirthYear.value.trim();
  p.deceased = els.personDeceased.checked;
  p.notes = els.personNotes.value;
  if (els.personProband.checked) state.project.people.forEach((x) => (x.proband = x.id === p.id));
  else p.proband = false;
  if (relayout) { autoLayout(); }
  refresh();
  autosave();
}

function beginFormEdit() {
  if (!selectedPerson() || state.formEditSnapshot) return;
  state.formEditSnapshot = snapshot();
}

function commitFormEdit() {
  if (!state.formEditSnapshot) return;
  const before = state.formEditSnapshot;
  state.formEditSnapshot = null;
  if (before === snapshot()) return;
  state.history.push(before);
  if (state.history.length > 60) state.history.shift();
  state.future = [];
  updateButtons();
}

function addDiagnosisFromSelect() {
  const p = selectedPerson();
  const v = els.diagnosisSelect.value;
  if (!p || !v) return;
  state.formEditSnapshot = null;
  pushHistory();
  if (!p.diagnoses.includes(v)) p.diagnoses.push(v);
  els.diagnosisSelect.value = "";
  refresh();
  autosave();
}
function removeDiagnosis(v) {
  const p = selectedPerson();
  if (!p) return;
  state.formEditSnapshot = null;
  pushHistory();
  p.diagnoses = p.diagnoses.filter((d) => d !== v);
  refresh();
  autosave();
}

/* ============================================================
   世代计算（最长路径分层：祖辈在上，子辈在下）
   ============================================================ */
function computeGenerations() {
  const gen = new Map();
  state.project.people.forEach((p) => gen.set(p.id, 0));
  const limit = state.project.people.length + 5;
  for (let i = 0; i < limit; i++) {
    let changed = false;
    state.project.parentages.forEach((parentage) => {
      const childId = parentage.childId;
      parentIdsForParentage(parentage).forEach((parentId) => {
        if (!gen.has(parentId) || !gen.has(childId)) return;
        const g = gen.get(parentId) + 1;
        if (g > gen.get(childId)) { gen.set(childId, g); changed = true; }
      });
    });
    partnerUnions().forEach((union) => {
      const [aId, bId] = union.partnerIds;
      if (!gen.has(aId) || !gen.has(bId)) return;
      const m = Math.max(gen.get(aId), gen.get(bId));
      if (gen.get(aId) !== m) { gen.set(aId, m); changed = true; }
      if (gen.get(bId) !== m) { gen.set(bId, m); changed = true; }
    });
    if (!changed) break;
  }
  return gen;
}

/* ============================================================
   家庭单元（用于渲染连线）
   ============================================================ */
function orderCouple(aId, bId) {
  // 男左女右；其余按创建顺序
  const a = getPerson(aId), b = getPerson(bId);
  if (!a || !b) return [aId, bId];
  if (a.sex === "male" && b.sex !== "male") return [aId, bId];
  if (b.sex === "male" && a.sex !== "male") return [bId, aId];
  if (a.sex === "female" && b.sex !== "female") return [bId, aId];
  if (b.sex === "female" && a.sex !== "female") return [aId, bId];
  return a.order <= b.order ? [aId, bId] : [bId, aId];
}

function coupleKey(ids) { return [...ids].sort().join("|"); }

function familyUnitId(parentIds) {
  const key = parentIds.length ? coupleKey(parentIds) : "founders";
  return `fu:${key}`;
}

function marriageNodeId(parentIds) {
  const key = parentIds.length ? coupleKey(parentIds) : "single";
  return `mn:${key}`;
}

function normalizeFamilyParents(parents) {
  if (parents.length >= 2) {
    const male = parents.find((p) => p.sex === "male");
    const female = parents.find((p) => p.sex === "female");
    const ids = (male && female) ? [male.id, female.id] : [parents[0].id, parents[1].id];
    return orderCouple(ids[0], ids[1]);
  }
  return parents.length === 1 ? [parents[0].id] : [];
}

function buildFamilyUnitsFromParentages() {
  const groups = new Map();
  ensureDomainArrays();
  state.project.parentages.forEach((pa) => {
    const child = getPerson(pa.childId);
    const union = getUnion(pa.unionId);
    if (!child || !union || union.partnerIds.length === 0) return;
    const parents = normalizeFamilyParents(union.partnerIds.map((id) => getPerson(id)).filter(Boolean));
    const key = union.id;
    if (!groups.has(key)) {
      groups.set(key, {
        id: `fu:${union.id}`,
        marriageNodeId: `mn:${union.id}`,
        parentKey: union.id,
        unionId: union.id,
        parentIds: parents,
        childIds: []
      });
    }
    groups.get(key).childIds.push(child.id);
  });

  return [...groups.values()]
    .map((u) => {
      const childIds = [...new Set(u.childIds)]
        .map((id) => getPerson(id))
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
        .map((p) => p.id);
      return {
        id: u.id,
        marriageNodeId: u.marriageNodeId,
        parentKey: u.parentKey,
        parentIds: u.parentIds,
        childIds,
        children: childIds.map((id) => getPerson(id)).filter(Boolean),
        parents: u.parentIds.map((id) => getPerson(id)).filter(Boolean)
      };
    })
    .sort((a, b) => {
      const ao = Math.min(...a.parentIds.map((id) => getPerson(id)?.order ?? 999999));
      const bo = Math.min(...b.parentIds.map((id) => getPerson(id)?.order ?? 999999));
      return ao - bo || a.id.localeCompare(b.id);
    });
}

function syncFamilyUnits() {
  const units = buildFamilyUnitsFromParentages();
  state.layoutFamilyUnits = units;
  return units;
}

function collectFamilyUnits() {
  return syncFamilyUnits();
}

/* ============================================================
   旧 tree layout 已移除
   ============================================================ */
function autoLayout() {
  const gen = computeGenerations();
  state.genMap = gen;
  syncFamilyUnits();
  const engineGen = applyEngineLayout();
  if (engineGen) state.genMap = engineGen;
  computeNumbering(state.genMap);
}

function sexToEngine(sex) {
  if (sex === "male") return "M";
  if (sex === "female") return "F";
  return "U";
}

function applyEngineLayout() {
  const engine = window.PedigreeEngine;
  if (!engine || typeof engine.layout !== "function") { state.layoutResult = null; return null; }

  ensureDomainArrays();
  const childrenByUnion = new Map();
  state.project.parentages.forEach((parentage) => {
    if (!parentage.unionId || !getUnion(parentage.unionId)) return;
    if (!childrenByUnion.has(parentage.unionId)) childrenByUnion.set(parentage.unionId, []);
    childrenByUnion.get(parentage.unionId).push(parentage.childId);
  });

  const positions = engine.layout({
    persons: state.project.people.map((person) => ({
      id: person.id,
      sex: sexToEngine(person.sex),
      birthOrder: Number.isFinite(person.order) ? person.order : undefined,
      twinGroup: person.twinGroup || undefined,
      twinType: person.twinType || undefined
    })),
    unions: state.project.unions.map((union) => ({
      id: union.id,
      partners: [...union.partnerIds],
      consanguineous: union.partnerIds.length === 2 ? areConsanguineous(union.partnerIds[0], union.partnerIds[1]) : false
    })),
    childrenMap: [...childrenByUnion.entries()]
  });

  if (!positions || !Array.isArray(positions.nodes)) { state.layoutResult = null; return null; }
  state.layoutResult = positions;

  const engineGen = new Map();
  positions.nodes.forEach((position) => {
    const person = getPerson(position.id);
    if (!person) return;
    engineGen.set(position.id, position.generation);
    if (person.manual) return;
    if (Number.isFinite(position.x)) person.x = position.x;
    if (Number.isFinite(position.y)) person.y = position.y;
  });

  return engineGen;
}

function normalizeToOrigin() {
  // 坐标归一化属于旧 tree layout 后处理，已从 legacy 入口移除。
}

function computeNumbering(gen) {
  const map = new Map();
  const rows = new Map();
  state.project.people.forEach((p) => {
    const g = gen.get(p.id) ?? 0;
    if (!rows.has(g)) rows.set(g, []);
    rows.get(g).push(p);
  });
  [...rows.keys()].sort((a, b) => a - b).forEach((g, gi) => {
    rows.get(g).sort((a, b) => numberingRank(a, b, g)).forEach((p, pi) => {
      map.set(p.id, `${roman(gi + 1)}-${pi + 1}`);
    });
  });
  state.numberMap = map;
}

function numberingRank(a, b, generation) {
  const rank = generationNumberingRank(generation);
  const ar = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
  const br = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
  return ar - br || a.order - b.order || a.x - b.x;
}

function generationNumberingRank(generation) {
  const rank = new Map();
  let next = 0;
  const append = (id) => {
    const p = getPerson(id);
    if (!p || (state.genMap.get(id) ?? 0) !== generation || rank.has(id)) return;
    rank.set(id, next++);
  };

  const childGroups = new Map();
  state.project.parentages.forEach((parentage) => {
    const union = getUnion(parentage.unionId);
    if (!union) return;
    if (!childGroups.has(union.id)) childGroups.set(union.id, []);
    childGroups.get(union.id).push(parentage.childId);
  });

  [...childGroups.entries()]
    .sort((a, b) => familyOrder(a[0]) - familyOrder(b[0]) || a[0].localeCompare(b[0]))
    .forEach(([, childIds]) => {
      childIds
        .map((id) => getPerson(id))
        .filter(Boolean)
        .sort((a, b) => a.order - b.order)
        .forEach((child) => {
          append(child.id);
          findPartners(child.id).sort((a, b) => a.order - b.order).forEach((partner) => append(partner.id));
        });
    });

  state.project.people
    .filter((p) => (state.genMap.get(p.id) ?? 0) === generation)
    .sort((a, b) => a.order - b.order)
    .forEach((p) => append(p.id));
  return rank;
}

function familyOrder(unionId) {
  const union = getUnion(unionId);
  if (!union) return Number.MAX_SAFE_INTEGER;
  return Math.min(...union.partnerIds.map((id) => getPerson(id)?.order ?? Number.MAX_SAFE_INTEGER));
}

function roman(n) {
  const t = [["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]];
  let r = "", x = n;
  t.forEach(([s, v]) => { while (x >= v) { r += s; x -= v; } });
  return r || "I";
}

/* ============================================================
   渲染
   ============================================================ */
function svgEl(tag, attrs = {}, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  if (text !== undefined) n.textContent = text;
  return n;
}

function refresh(doAutosave = true) {
  syncHeader();
  renderForm();
  renderSvg();
  updateButtons();
  if (doAutosave) autosave();
}

function renderSvg() {
  window.PedigreeUI.renderSvg(canvasContext());
}

function canvasContext() {
  return {
    state,
    els,
    buildDefs,
    exportStyles,
    roman
  };
}

function buildDefs() {
  const defs = svgEl("defs");
  const pat = svgEl("pattern", { id: "suspectedPattern", width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pat.appendChild(svgEl("rect", { width: 7, height: 7, fill: "#fff" }));
  pat.appendChild(svgEl("rect", { width: 3.5, height: 7, fill: "#2f3a42" }));
  defs.appendChild(pat);
  const carrierPat = svgEl("pattern", { id: "carrierPattern", width: 8, height: 8, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  carrierPat.appendChild(svgEl("rect", { width: 8, height: 8, fill: "#fff" }));
  carrierPat.appendChild(svgEl("rect", { width: 2.4, height: 8, fill: "#2f3a42" }));
  defs.appendChild(carrierPat);
  const mk = svgEl("marker", { id: "arrow", markerWidth: 9, markerHeight: 9, refX: 7, refY: 3, orient: "auto", markerUnits: "strokeWidth" });
  mk.appendChild(svgEl("path", { d: "M0,0 L0,6 L8,3 z", fill: "#2f3a42" }));
  defs.appendChild(mk);
  return defs;
}

// 是否近亲婚配：两人有共同祖先（向上 4 代内）
function areConsanguineous(aId, bId) {
  if (!aId || !bId || aId === bId) return false;
  const anc = (id, depth, acc) => {
    if (depth > 4) return;
    findParents(id).forEach((p) => { acc.add(p.id); anc(p.id, depth + 1, acc); });
  };
  const A = new Set(); anc(aId, 0, A);
  if (A.size === 0) return false;
  const B = new Set(); anc(bId, 0, B);
  for (const id of A) if (B.has(id)) return true;
  return false;
}

function contentBounds() {
  return window.PedigreeUI.contentBounds(canvasContext());
}

/* ============================================================
   头部 / 表单 / 按钮状态
   ============================================================ */
function syncHeader() {
  els.projectMeta.textContent = `${state.project.title} · ${state.project.people.length} 名成员`;
}

function syncSettings() {
  const s = state.project.settings;
  s.showNumber = els.optShowNumber.checked;
  s.showName = els.optShowName.checked;
  s.showDiagnosis = els.optShowDiagnosis.checked;
  s.showAge = els.optShowAge.checked;
  s.showLegend = els.optShowLegend.checked;
  s.showTitle = els.optShowTitle.checked;
  s.snapDrag = els.optSnapDrag.checked;
  autosave();
}

function applySettingsToUI() {
  const s = state.project.settings;
  els.optShowNumber.checked = s.showNumber;
  els.optShowName.checked = s.showName;
  els.optShowDiagnosis.checked = s.showDiagnosis;
  els.optShowAge.checked = s.showAge;
  els.optShowLegend.checked = s.showLegend;
  els.optShowTitle.checked = s.showTitle;
  els.optSnapDrag.checked = s.snapDrag !== false;
}

function renderForm() {
  const p = selectedPerson();
  els.emptySelection.hidden = Boolean(p);
  els.personForm.hidden = !p;
  if (!p) return;
  els.personName.value = p.name || "";
  els.personSex.value = p.sex || "unknown";
  els.personAffectedStatus.value = p.affectedStatus || "unaffected";
  els.personAge.value = p.age || "";
  els.personBirthYear.value = p.birthYear || "";
  els.personDeceased.checked = !!p.deceased;
  els.personProband.checked = !!p.proband;
  els.identicalRow.hidden = !p.twinGroup;
  els.personIdentical.checked = p.twinType === "identical";
  els.personNotes.value = p.notes || "";
  els.clearManualBtn.disabled = !p.manual;
  els.diagnosisTags.innerHTML = "";
  p.diagnoses.forEach((d) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = d;
    const btn = document.createElement("button");
    btn.type = "button"; btn.textContent = "×";
    btn.addEventListener("click", () => removeDiagnosis(d));
    tag.appendChild(btn);
    els.diagnosisTags.appendChild(tag);
  });
}

function updateButtons() {
  const has = Boolean(selectedPerson());
  [els.addFatherBtn, els.addMotherBtn, els.addPartnerBtn, els.addBrotherBtn, els.addSisterBtn,
   els.addSonBtn, els.addDaughterBtn, els.addTwinBrotherBtn, els.addTwinSisterBtn, els.linkPartnerBtn]
    .forEach((b) => (b.disabled = !has));
  if (els.linkPartnerBtn) els.linkPartnerBtn.classList.toggle("accent", Boolean(state.linkMode));
  if (els.clearManualBtn) els.clearManualBtn.disabled = !has || !selectedPerson()?.manual;
  els.undoBtn.disabled = state.history.length === 0;
  els.redoBtn.disabled = state.future.length === 0;
  els.zoomLabel.textContent = `${Math.round(state.scale * 100)}%`;
}

/* ============================================================
   选择 / 拖动 / 平移 / 缩放
   ============================================================ */
function svgPoint(evt) {
  const rect = els.pedigreeSvg.getBoundingClientRect();
  return {
    x: (evt.clientX - rect.left - state.offsetX) / state.scale,
    y: (evt.clientY - rect.top - state.offsetY) / state.scale
  };
}

function onCanvasPointerDown(evt) {
  const target = evt.target.closest(".node-hit");
  // 连接配偶模式：点击目标节点即建立关系
  if (state.linkMode) {
    if (target) {
      connectPartners(state.linkMode.sourceId, target.getAttribute("data-id"));
    } else {
      state.linkMode = null; setStatus("已取消连接配偶"); refresh(false);
    }
    return;
  }
  if (target) {
    const id = target.getAttribute("data-id");
    state.selectedId = id;
    const pt = svgPoint(evt);
    const p = getPerson(id);
    state.drag = { id, dx: pt.x - p.x, dy: pt.y - p.y, moved: false, snapshotTaken: false };
    refresh(false);
  } else {
    // 空白：平移画布
    state.pan = { startX: evt.clientX, startY: evt.clientY, ox: state.offsetX, oy: state.offsetY };
    els.canvasWrap.classList.add("panning");
    state.selectedId = null;
    refresh(false);
  }
}

function onPointerMove(evt) {
  if (state.drag) {
    const p = getPerson(state.drag.id);
    if (!p) return;
    if (!state.drag.snapshotTaken) { pushHistory(); state.drag.snapshotTaken = true; }
    const pt = svgPoint(evt);
    p.x = pt.x - state.drag.dx;
    p.y = pt.y - state.drag.dy;
    state.drag.moved = true;
    renderSvg();
  } else if (state.pan) {
    state.offsetX = state.pan.ox + (evt.clientX - state.pan.startX);
    state.offsetY = state.pan.oy + (evt.clientY - state.pan.startY);
    renderSvg();
  }
}

function onPointerUp() {
  if (state.drag) {
    if (!state.drag.moved) {
      // 仅点击：取消刚才（未发生的）快照不需要
    } else if (state.project.settings.snapDrag !== false) {
      // 拖动后按同代 x 重排顺序并吸附回标准布局
      reorderByX(state.drag.id);
      autoLayout();
      fitKeep();
    } else {
      // 自由摆放：标记该节点为手动位置，自动排版时跳过；连线自动跟随
      const moved = getPerson(state.drag.id);
      if (moved) moved.manual = true;
      computeNumbering(computeGenerations());
      fitKeep();
    }
    const id = state.drag.id;
    state.drag = null;
    state.selectedId = id;
    refresh();
  }
  if (state.pan) {
    state.pan = null;
    els.canvasWrap.classList.remove("panning");
  }
}

function reorderByX(id) {
  const gen = computeGenerations();
  const g = gen.get(id);
  if (g === undefined) return;
  state.project.people
    .filter((p) => gen.get(p.id) === g)
    .sort((a, b) => a.x - b.x)
    .forEach((p, i) => (p.order = (gen.get(p.id) * 1000) + i));
  // 归一 order 为整数序列，保持全局稳定
  state.project.people
    .slice().sort((a, b) => a.order - b.order)
    .forEach((p, i) => (p.order = i + 1));
}

function onWheel(evt) {
  evt.preventDefault();
  const factor = evt.deltaY > 0 ? -0.1 : 0.1;
  zoomAt(evt.clientX, evt.clientY, factor);
}

function zoomAt(clientX, clientY, delta) {
  const rect = els.pedigreeSvg.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top;
  const wx = (px - state.offsetX) / state.scale;
  const wy = (py - state.offsetY) / state.scale;
  const newScale = clamp(state.scale + delta, MIN_SCALE, MAX_SCALE);
  state.offsetX = px - wx * newScale;
  state.offsetY = py - wy * newScale;
  state.scale = newScale;
  renderSvg();
  updateButtons();
}

function zoomBy(delta) {
  const rect = els.pedigreeSvg.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, delta);
}

function fitView() {
  if (state.project.people.length === 0) { state.scale = 1; state.offsetX = 0; state.offsetY = 0; renderSvg(); updateButtons(); return; }
  const b = contentBounds();
  const padL = 110, padR = 110, padT = 90, padB = 110;
  const rect = els.canvasWrap.getBoundingClientRect();
  const cw = rect.width || 800, ch = rect.height || 600;
  const worldW = b.width + padL + padR;
  const worldH = b.height + padT + padB;
  const scale = clamp(Math.min(cw / worldW, ch / worldH), MIN_SCALE, 1.4);
  state.scale = scale;
  state.offsetX = (cw - (b.width) * scale) / 2 - (b.minX - padL * 0 - (padL - padR) / 2) * scale;
  // 简化：直接居中内容包围盒中心
  const centerX = (b.minX + b.maxX) / 2;
  const centerY = (b.minY + b.maxY) / 2;
  state.offsetX = cw / 2 - centerX * scale;
  state.offsetY = ch / 2 - centerY * scale;
  renderSvg();
  updateButtons();
}

function fitKeep() { renderSvg(); }

/* ============================================================
   键盘快捷键
   ============================================================ */
function onKeyDown(evt) {
  const tag = (evt.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select";
  if ((evt.ctrlKey || evt.metaKey) && evt.shiftKey && evt.key.toLowerCase() === "z") { evt.preventDefault(); commitFormEdit(); redo(); return; }
  if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "z") { evt.preventDefault(); commitFormEdit(); undo(); return; }
  if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "y") { evt.preventDefault(); commitFormEdit(); redo(); return; }
  if (typing) return;
  const k = evt.key.toLowerCase();
  if (k === "f") { evt.preventDefault(); addParent("male"); }
  else if (k === "m") { evt.preventDefault(); addParent("female"); }
  else if (k === "e") { evt.preventDefault(); addPartner(); }
  else if (k === "c") { evt.preventDefault(); addChild("male"); }
  else if (k === "d") { evt.preventDefault(); addChild("female"); }
  else if (k === "b") { evt.preventDefault(); addSibling("male"); }
  else if (k === "s") { evt.preventDefault(); addSibling("female"); }
  else if (evt.key === "Delete" || evt.key === "Backspace") { if (selectedPerson()) { evt.preventDefault(); deleteSelected(); } }
}

/* ============================================================
   撤销 / 重做
   ============================================================ */
function snapshot() { return JSON.stringify(projectForStorage()); }
function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > 60) state.history.shift();
  state.future = [];
}
function undo() {
  if (state.history.length === 0) return;
  state.future.push(snapshot());
  state.project = normalizeProject(JSON.parse(state.history.pop()));
  state.selectedId = null;
  applySettingsToUI();
  computeGenerations();
  autoLayout(); refresh(); fitView();
  setStatus("已撤销");
}
function redo() {
  if (state.future.length === 0) return;
  state.history.push(snapshot());
  state.project = normalizeProject(JSON.parse(state.future.pop()));
  state.selectedId = null;
  applySettingsToUI();
  autoLayout(); refresh(); fitView();
  setStatus("已重做");
}

/* ============================================================
   存档 / 读取 / 自动保存
   ============================================================ */
function autosave() {
  try {
    localStorage.setItem(AUTOSAVE_KEY, snapshot());
    state.storageFailed = false;
  } catch (e) {
    if (!state.storageFailed) setStatus("自动保存失败：浏览器本地存储不可用或容量不足，请手动保存 JSON");
    state.storageFailed = true;
  }
}
function restoreAutosave() {
  let raw = null;
  try {
    raw = localStorage.getItem(AUTOSAVE_KEY);
  } catch (e) {
    setStatus("自动恢复不可用：浏览器本地存储被禁用");
    return false;
  }
  if (!raw) return false;
  try {
    const proj = normalizeProject(JSON.parse(raw));
    state.project = proj;
    state.selectedId = null;
    applySettingsToUI();
    autoLayout();
    setStatus("已恢复上次自动保存");
    return true;
  } catch (e) {
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch (removeErr) { /* ignore */ }
    setStatus("自动恢复数据无效，已跳过");
    return false;
  }
}

function newProject() {
  if (state.project.people.length > 0 && !confirm("新建会清空当前家系图，是否继续？")) return;
  pushHistory();
  state.project = createProject();
  state.selectedId = null;
  applySettingsToUI();
  refresh(); fitView();
  setStatus("已新建空白家系图");
}

function saveJson() {
  state.project.updatedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify(projectForStorage(), null, 2)], { type: "application/json" });
  download(blob, `${safeName(state.project.title)}_${stamp()}.json`);
  setStatus("项目已保存为 JSON");
}

function loadJson(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const proj = normalizeProject(JSON.parse(reader.result));
      pushHistory();
      state.project = proj;
      state.selectedId = null;
      applySettingsToUI();
      autoLayout(); refresh(); fitView();
      setStatus("项目已加载");
    } catch (err) { setStatus(`加载失败：${err.message || "文件格式不正确"}`); }
    finally { evt.target.value = ""; }
  };
  reader.readAsText(file, "utf-8");
}

function syncLayoutModel() {
  ensureDomainArrays();
  state.project.layout.positions = Object.fromEntries(state.project.people.map((p) => [p.id, { x: p.x || 0, y: p.y || 0, manual: !!p.manual }]));
}

function syncClinicalModels() {
  ensureDomainArrays();
  state.project.phenotypes = state.project.people.map((p) => ({
    id: `ph_${p.id}`,
    personId: p.id,
    status: p.affectedStatus === "carrier" ? "unaffected" : (p.affectedStatus || "unaffected"),
    diagnoses: Array.isArray(p.diagnoses) ? [...p.diagnoses] : [],
    ageOfOnset: "",
    source: ""
  }));
  state.project.geneticFindings = state.project.people
    .filter((p) => p.affectedStatus === "carrier")
    .map((p) => ({
      id: `gf_${p.id}`,
      personId: p.id,
      status: "carrier",
      gene: "",
      variant: "",
      source: ""
    }));
}

function applyLayoutPositions(project) {
  const positions = project.layout?.positions || {};
  project.people.forEach((p) => {
    const pos = positions[p.id];
    p.x = Number.isFinite(pos?.x) ? pos.x : Number.isFinite(p.x) ? p.x : 0;
    p.y = Number.isFinite(pos?.y) ? pos.y : Number.isFinite(p.y) ? p.y : 0;
    p.manual = !!(pos?.manual ?? p.manual);
  });
}

function applyClinicalViewCache(project) {
  const phenotypes = new Map((project.phenotypes || []).map((ph) => [ph.personId, ph]));
  const carriers = new Set((project.geneticFindings || []).filter((gf) => gf.status === "carrier").map((gf) => gf.personId));
  project.people.forEach((p) => {
    const ph = phenotypes.get(p.id);
    p.affectedStatus = carriers.has(p.id) ? "carrier" : (ph?.status || p.affectedStatus || "unaffected");
    p.diagnoses = Array.isArray(ph?.diagnoses) ? [...ph.diagnoses] : Array.isArray(p.diagnoses) ? p.diagnoses : [];
  });
}

function projectForStorage() {
  syncLayoutModel();
  syncClinicalModels();
  const cleanPeople = state.project.people.map(({ x, y, manual, affectedStatus, diagnoses, ...p }) => ({ ...p }));
  return {
    ...state.project,
    schemaVersion: 2,
    version: VERSION,
    people: cleanPeople,
    unions: state.project.unions.map((u) => ({ ...u, partnerIds: [...u.partnerIds] })),
    parentages: state.project.parentages.map((pa) => ({ ...pa, parentIds: [...pa.parentIds] })),
    phenotypes: state.project.phenotypes.map((ph) => ({ ...ph, diagnoses: [...ph.diagnoses] })),
    geneticFindings: state.project.geneticFindings.map((gf) => ({ ...gf })),
    pregnancies: state.project.pregnancies.map((pg) => ({ ...pg, childIds: [...pg.childIds] })),
    layout: { positions: { ...state.project.layout.positions } }
  };
}

function normalizeProject(proj) {
  const migrated = PedigreeApplication.migrateProjectToSchema2(proj, makeId);
  PedigreeApplication.validateDomainProject(migrated);
  const base = createProject();
  const migratedFrom = migrated.version && migrated.version !== VERSION ? migrated.version : migrated.migratedFrom;
  const normalized = {
    ...base,
    ...migrated,
    schemaVersion: 2,
    version: VERSION,
    ...(migratedFrom ? { migratedFrom } : {}),
    settings: { ...base.settings, ...(migrated.settings || {}) },
    people: migrated.people.map((p, i) => ({
      ...createPerson({ order: i + 1 }),
      ...p,
      diagnoses: Array.isArray(p.diagnoses) ? p.diagnoses : [],
      order: Number.isFinite(p.order) ? p.order : i + 1
    })),
    unions: migrated.unions.map((u) => PedigreeDomain.normalizeUnion(u)),
    parentages: migrated.parentages.map((pa) => PedigreeDomain.normalizeParentage(pa)),
    phenotypes: migrated.phenotypes.map((ph) => PedigreeDomain.normalizePhenotype(ph)),
    geneticFindings: migrated.geneticFindings.map((gf) => PedigreeDomain.normalizeGeneticFinding(gf)),
    pregnancies: migrated.pregnancies.map((pg) => PedigreeDomain.normalizePregnancy(pg)),
    layout: migrated.layout || { positions: {} }
  };
  applyLayoutPositions(normalized);
  applyClinicalViewCache(normalized);
  return normalized;
}

function validateProjectData(proj) {
  PedigreeApplication.validateDomainProject(PedigreeApplication.migrateProjectToSchema2(proj, makeId));
}

/* ============================================================
   导出 PNG / SVG
   ============================================================ */
function buildExportSvg() {
  return window.PedigreeUI.buildExportSvg(canvasContext());
}

function exportStyles() {
  return `
  .marriage-line,.descent-line,.sibling-line,.individual-line{stroke:#2f3a42;stroke-width:2.2;fill:none;stroke-linecap:square}
  .person-symbol{stroke:#2f3a42;stroke-width:2.8}
  .person-symbol.unaffected{fill:#fff}
  .person-symbol.affected{fill:#2f3a42}
  .person-symbol.suspected{fill:url(#suspectedPattern)}
  .person-symbol.unknown{fill:#e2e8ec}
  .person-symbol.carrier{fill:url(#carrierPattern)}
  .twin-bar{stroke:#2f3a42;stroke-width:2.2}
  .person-label{font:13px "Microsoft YaHei",sans-serif;fill:#172026;text-anchor:middle;dominant-baseline:hanging}
  .id-label{font:600 12px "Microsoft YaHei",sans-serif;fill:#3a444c;text-anchor:end;dominant-baseline:hanging}
  .diagnosis-label{font:11px "Microsoft YaHei",sans-serif;fill:#5a6b8c;text-anchor:middle;dominant-baseline:hanging}
  .meta-label{font:11px "Microsoft YaHei",sans-serif;fill:#65717b;text-anchor:middle;dominant-baseline:hanging}
  .generation-label{font:700 14px "Microsoft YaHei",sans-serif;fill:#9aa6b0;text-anchor:middle;dominant-baseline:middle}
  .deceased-line{stroke:#2f3a42;stroke-width:2.6;stroke-linecap:round}
  .proband-arrow{stroke:#2f3a42;stroke-width:2.2;fill:none;stroke-linecap:round}
  .proband-label{font:700 12px "Microsoft YaHei",sans-serif;fill:#2f3a42;text-anchor:middle}
  .title-text{font:700 20px "Microsoft YaHei",sans-serif;fill:#1b2329;text-anchor:middle}
  .legend-box{fill:#fff;stroke:#d8dde2;stroke-width:1.2}
  .legend-title{font:700 12px "Microsoft YaHei",sans-serif;fill:#3a444c}
  .legend-text{font:11.5px "Microsoft YaHei",sans-serif;fill:#4a5560;dominant-baseline:middle}
  .selected-ring{display:none}
  `;
}

function exportImage(kind) {
  if (state.project.people.length === 0) { setStatus("画布为空，无法导出"); return; }
  const { svg, W, H } = buildExportSvg();
  const xml = new XMLSerializer().serializeToString(svg);
  if (kind === "svg") {
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n` + xml], { type: "image/svg+xml;charset=utf-8" });
    download(blob, `${safeName(state.project.title)}_${stamp()}.svg`);
    setStatus("SVG 已导出");
    return;
  }
  // PNG
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2.5;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((png) => { download(png, `${safeName(state.project.title)}_${stamp()}.png`); setStatus("PNG 已导出"); }, "image/png");
  };
  img.onerror = () => { URL.revokeObjectURL(url); setStatus("PNG 导出失败，请重试"); };
  img.src = url;
}

/* ============================================================
   家族史文字生成（相对先证者按亲缘级别归纳）
   ============================================================ */
// 某人的全部祖先及其代数（含本人，深度 0）
function ancestorsWithDepth(id) {
  const out = new Map([[id, 0]]);
  const walk = (cur, d) => {
    findParents(cur).forEach((p) => {
      if (!out.has(p.id) || out.get(p.id) > d + 1) { out.set(p.id, d + 1); walk(p.id, d + 1); }
    });
  };
  walk(id, 0);
  return out;
}

// 亲缘系数 r（共享基因比例）：一级≈0.5，二级≈0.25，三级≈0.125
function relCoefficient(aId, bId) {
  if (aId === bId) return 1;
  const A = ancestorsWithDepth(aId), B = ancestorsWithDepth(bId);
  let common = [...A.keys()].filter((k) => B.has(k));
  // 仅保留「最近共同祖先」：剔除那些是其他共同祖先之祖先的节点，避免重复计入
  const isAncestorOf = (x, y) => x !== y && ancestorsWithDepth(y).has(x);
  common = common.filter((c) => !common.some((o) => o !== c && isAncestorOf(c, o)));
  let r = 0;
  common.forEach((c) => { r += Math.pow(0.5, A.get(c) + B.get(c)); });
  return r;
}

// 临床亲缘级别（1/2/3…）；无血缘返回 null
function clinicalDegree(probandId, id) {
  const r = relCoefficient(probandId, id);
  if (r >= 0.5) return 1;
  if (r >= 0.25) return 2;
  if (r >= 0.125) return 3;
  if (r >= 0.0625) return 4;
  return r > 0 ? 5 : null;
}

// 判断 relative 属父系还是母系：看从先证者出发第一步经过父亲还是母亲
function lineageSide(probandId, relativeId) {
  const father = findParents(probandId).find((p) => p.sex === "male");
  const mother = findParents(probandId).find((p) => p.sex === "female");
    const reach = (startId, blockId) => {
    if (!startId) return false;
    const adj = new Map();
    state.project.people.forEach((p) => adj.set(p.id, new Set()));
    state.project.parentages.forEach((parentage) => {
      const childId = parentage.childId;
      parentIdsForParentage(parentage).forEach((parentId) => {
        if (adj.has(parentId) && adj.has(childId)) {
          adj.get(parentId).add(childId);
          adj.get(childId).add(parentId);
        }
      });
    });
    const seen = new Set([probandId, blockId].filter(Boolean));
    const q = [startId]; seen.add(startId);
    while (q.length) { const c = q.shift(); if (c === relativeId) return true; adj.get(c).forEach((nb) => { if (!seen.has(nb)) { seen.add(nb); q.push(nb); } }); }
    return false;
  };
  const viaFather = father && reach(father.id, mother && mother.id);
  const viaMother = mother && reach(mother.id, father && father.id);
  if (viaFather && !viaMother) return "父系";
  if (viaMother && !viaFather) return "母系";
  return "";
}

function relationTerm(probandId, id, degree) {
  const p = getPerson(id);
  const sexWord = (m, f, u) => (p.sex === "male" ? m : p.sex === "female" ? f : u);
  if (degree === 1) {
    const parents = findParents(probandId).map((x) => x.id);
    const children = findChildren(probandId).map((x) => x.id);
    if (parents.includes(id)) return sexWord("父亲", "母亲", "父/母");
    if (children.includes(id)) return sexWord("儿子", "女儿", "子女");
    return sexWord("兄弟", "姐妹", "同胞");
  }
  const side = lineageSide(probandId, id);
  if (degree === 2) {
    // 祖辈：本人祖父母 / 外祖父母
    const grandparents = findParents(probandId).flatMap((par) => findParents(par.id)).map((x) => x.id);
    if (grandparents.includes(id)) {
      if (side === "父系") return sexWord("祖父", "祖母", "祖辈");
      if (side === "母系") return sexWord("外祖父", "外祖母", "外祖辈");
      return sexWord("祖父/外祖父", "祖母/外祖母", "祖辈");
    }
    // 孙辈：本人子女的子女
    const grandchildren = findChildren(probandId).flatMap((c) => findChildren(c.id)).map((x) => x.id);
    if (grandchildren.includes(id)) return sexWord("孙子/外孙", "孙女/外孙女", "孙辈");
    // 父母的同胞 = 叔伯姑舅姨
    const parentSibs = findParents(probandId).flatMap((par) =>
      findParents(par.id).flatMap((gp) => findChildren(gp.id))).map((x) => x.id);
    if (parentSibs.includes(id)) {
      if (side === "父系") return sexWord("叔伯", "姑母", "父系二级亲属");
      if (side === "母系") return sexWord("舅父", "姨母", "母系二级亲属");
      return sexWord("叔伯/舅父", "姑姨", "二级亲属");
    }
    return (side ? side : "") + sexWord("二级男性亲属", "二级女性亲属", "二级亲属");
  }
  return (side ? side : "") + `${degree}级亲属`;
}

function buildFamilyHistory() {
  const probands = state.project.people.filter((p) => p.proband);
  if (state.project.people.length === 0) return "（暂无成员）";
  if (probands.length !== 1) return "（请先设置且仅设置一名先证者后，再生成家族史结构化草稿。）";
  const proband = probands[0];
  const affected = state.project.people
    .map((p) => ({ p, deg: p.id === proband.id ? 0 : clinicalDegree(proband.id, p.id) }))
    .filter((o) => o.p.id !== proband.id && o.deg != null &&
      (o.p.affectedStatus === "affected" || o.p.affectedStatus === "suspected"));
  const total = state.project.people.length;
  const lines = [];
  const pRealName = realName(proband);
  const pName = pRealName ? `（${pRealName}）` : "";
  const pDx = proband.diagnoses && proband.diagnoses.length ? proband.diagnoses.join("、") : (proband.affectedStatus === "affected" ? "（诊断未填写）" : "");
  lines.push(`家族史结构化草稿：先证者${pName}${pDx ? "，临床诊断" + pDx : ""}。家系共纳入 ${total} 名成员。`);
  if (affected.length === 0) {
    lines.push("除先证者外，家系内其余成员未记录精神障碍患病信息。");
  } else {
    const byDeg = new Map();
    affected.forEach((o) => { if (!byDeg.has(o.deg)) byDeg.set(o.deg, []); byDeg.get(o.deg).push(o.p); });
    const degName = { 1: "一级亲属", 2: "二级亲属", 3: "三级亲属", 4: "四级亲属", 5: "远亲" };
    [...byDeg.keys()].sort((a, b) => a - b).forEach((d) => {
      const parts = byDeg.get(d).map((p) => {
        const term = relationTerm(proband.id, p.id, d);
        const dx = p.diagnoses && p.diagnoses.length ? p.diagnoses.join("、") : "精神障碍";
        const sus = p.affectedStatus === "suspected" ? "（疑似）" : "";
        const dec = p.deceased ? "，已故" : "";
        const rn = realName(p);
        const nm = rn && rn !== term ? `${rn}（${term}）` : term;
        return `${nm}患${dx}${sus}${dec}`;
      });
      lines.push(`${degName[d] || d + "级亲属"}中，${parts.join("；")}。`);
    });
    lines.push(`家系内除先证者外共 ${affected.length} 名亲属记录为患病或疑似。是否符合家族聚集性，需结合诊断依据、信息来源、发病年龄及临床人员复核后判断。`);
  }
  lines.push("注：本段为结构化草稿，不替代临床复核；请补充信息来源、诊断依据、发病年龄、病程和资料缺失情况。");
  return lines.join("\n");
}

function showFamilyHistory() {
  els.historyText.value = buildFamilyHistory();
  if (typeof els.historyDialog.showModal === "function") els.historyDialog.showModal();
  else els.historyDialog.setAttribute("open", "");
}
function copyFamilyHistory() {
  els.historyText.select();
  navigator.clipboard?.writeText(els.historyText.value).then(
    () => setStatus("家族史已复制到剪贴板"),
    () => { document.execCommand("copy"); setStatus("家族史已复制"); }
  );
}

/* ============================================================
   工具函数
   ============================================================ */
function download(blob, name) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function safeName(v) { return (v || "家系图").replace(/[\\/:*?"<>|]/g, "_"); }
function stamp() {
  const d = new Date(), pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
function setStatus(msg) { els.statusLine.textContent = msg; }
function avg(a) { return a.reduce((s, v) => s + v, 0) / (a.length || 1); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
