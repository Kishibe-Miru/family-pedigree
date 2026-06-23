"use strict";

/* ============================================================
   精神科遗传家族谱系图绘制工具 4.3
   纯前端、本地优先。本版新增：双胞胎（同卵/异卵）、携带者圆点、
   近亲婚配自动双线、拖动自由摆放开关、一键生成家族史文字。
   4.1：连线 T 形修复；新增"与已选成员结婚"连接已有节点为配偶；
        家族史不再把占位默认名当真名；删除孪生后清理孤立 twinGroup。
   4.2：固定同胞出生顺序；同胞小家庭整体平移；多配偶/半同胞婚配线避让。
   4.3：显式 familyUnit 运行时模型；父母组合、子女分组、多配偶/半同胞统一从家庭单元绘制。
   ============================================================ */

const AUTOSAVE_KEY = "psychiatric-pedigree-v3-autosave";
const SVG_NS = "http://www.w3.org/2000/svg";
const VERSION = "4.3";

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
  genMap: new Map(),
  numberMap: new Map(),
  familyUnits: []
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
    "diagnosisSelect", "diagnosisTags", "personNotes", "setProbandBtn", "deletePersonBtn",
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
    version: VERSION,
    title: "家族谱系图",
    createdAt: now,
    updatedAt: now,
    people: [],
    relationships: [],
    familyUnits: [],
    settings: {
      showNumber: true, showName: true, showDiagnosis: true,
      showAge: false, showLegend: true, showTitle: true, snapDrag: true
    }
  };
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function createPerson(overrides = {}) {
  const order = state.project.people.length + 1;
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

function addRelationship(rel) { state.project.relationships.push({ id: makeId("r"), ...rel }); }

function findParents(id) {
  return state.project.relationships
    .filter((r) => r.type === "parentChild" && r.child === id)
    .map((r) => getPerson(r.parent)).filter(Boolean);
}
function findChildren(id) {
  return state.project.relationships
    .filter((r) => r.type === "parentChild" && r.parent === id)
    .map((r) => getPerson(r.child)).filter(Boolean);
}
function findPartners(id) {
  return state.project.relationships
    .filter((r) => r.type === "partner" && (r.person1 === id || r.person2 === id))
    .map((r) => getPerson(r.person1 === id ? r.person2 : r.person1)).filter(Boolean);
}
function hasPartner(a, b) {
  return state.project.relationships.some((r) =>
    r.type === "partner" && ((r.person1 === a && r.person2 === b) || (r.person1 === b && r.person2 === a)));
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
  addRelationship({ type: "parentChild", parent: parent.id, child: child.id });
  // 与已有的另一位父母自动建立配偶关系
  existing.forEach((other) => { if (!hasPartner(parent.id, other.id)) addRelationship({ type: "partner", person1: parent.id, person2: other.id }); });
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
  addRelationship({ type: "partner", person1: person.id, person2: partner.id });
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
  addRelationship({ type: "partner", person1: aId, person2: bId });
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
  pushHistory();
  const label = sex === "male" ? "儿子" : sex === "female" ? "女儿" : "子女";
  const child = createPerson({ name: label, sex: sex || "unknown" });
  state.project.people.push(child);
  addRelationship({ type: "parentChild", parent: parent.id, child: child.id });
  const partner = findPartners(parent.id)[0];
  if (partner) addRelationship({ type: "parentChild", parent: partner.id, child: child.id });
  state.selectedId = parent.id; // 光标保持在父/母，便于连续添加
  autoLayout(); refresh(); fitView();
  setStatus(`已添加${label}`);
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
    addRelationship({ type: "partner", person1: dad.id, person2: mom.id });
    [person, sib].forEach((c) => { addRelationship({ type: "parentChild", parent: dad.id, child: c.id }); addRelationship({ type: "parentChild", parent: mom.id, child: c.id }); });
    setStatus(`已添加${label}并自动补充父母`);
  } else {
    parents.forEach((p) => addRelationship({ type: "parentChild", parent: p.id, child: sib.id }));
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
    addRelationship({ type: "partner", person1: dad.id, person2: mom.id });
    [person, twin].forEach((c) => { addRelationship({ type: "parentChild", parent: dad.id, child: c.id }); addRelationship({ type: "parentChild", parent: mom.id, child: c.id }); });
    setStatus(`已添加${label}并自动补充父母`);
  } else {
    parents.forEach((p) => addRelationship({ type: "parentChild", parent: p.id, child: twin.id }));
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
  state.project.relationships = state.project.relationships.filter((r) =>
    r.parent !== p.id && r.child !== p.id && r.person1 !== p.id && r.person2 !== p.id);
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

function addDiagnosisFromSelect() {
  const p = selectedPerson();
  const v = els.diagnosisSelect.value;
  if (!p || !v) return;
  if (!p.diagnoses.includes(v)) p.diagnoses.push(v);
  els.diagnosisSelect.value = "";
  refresh();
  autosave();
}
function removeDiagnosis(v) {
  const p = selectedPerson();
  if (!p) return;
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
  const pcs = state.project.relationships.filter((r) => r.type === "parentChild");
  const partners = state.project.relationships.filter((r) => r.type === "partner");
  const limit = state.project.people.length + 5;
  for (let i = 0; i < limit; i++) {
    let changed = false;
    pcs.forEach((r) => {
      if (!gen.has(r.parent) || !gen.has(r.child)) return;
      const g = gen.get(r.parent) + 1;
      if (g > gen.get(r.child)) { gen.set(r.child, g); changed = true; }
    });
    partners.forEach((r) => {
      if (!gen.has(r.person1) || !gen.has(r.person2)) return;
      const m = Math.max(gen.get(r.person1), gen.get(r.person2));
      if (gen.get(r.person1) !== m) { gen.set(r.person1, m); changed = true; }
      if (gen.get(r.person2) !== m) { gen.set(r.person2, m); changed = true; }
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

function normalizeFamilyParents(parents) {
  if (parents.length >= 2) {
    const male = parents.find((p) => p.sex === "male");
    const female = parents.find((p) => p.sex === "female");
    const ids = (male && female) ? [male.id, female.id] : [parents[0].id, parents[1].id];
    return orderCouple(ids[0], ids[1]);
  }
  return parents.length === 1 ? [parents[0].id] : [];
}

function buildFamilyUnitsFromRelationships() {
  const groups = new Map();
  state.project.people.forEach((child) => {
    const parents = normalizeFamilyParents(findParents(child.id));
    if (parents.length === 0) return;
    const key = coupleKey(parents);
    if (!groups.has(key)) {
      groups.set(key, {
        id: familyUnitId(parents),
        parentKey: key,
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
  const units = buildFamilyUnitsFromRelationships();
  state.familyUnits = units;
  state.project.familyUnits = units.map((u) => ({
    id: u.id,
    parentKey: u.parentKey,
    parentIds: [...u.parentIds],
    childIds: [...u.childIds]
  }));
  return units;
}

function collectFamilyUnits() {
  return syncFamilyUnits();
}

/* ============================================================
   可靠的递归自动排版（family-forest tidy tree）
   ============================================================ */
/*
  排版采用「节点级重心法」(layered barycenter)：
  - 把每对配偶合并为一个夫妻超级节点，单身者为单节点；
  - 按代际分层，节点之间用父代/子代重心反复排序，再顺序打包（天然无重叠）；
  - 由于夫妻节点可同时挂在双方父母之下，双方的兄弟姐妹会被分别排到夫妻两侧，
    从而避免「父母双方的兄弟姐妹连线相互交叉」的问题；
  - 最后自底向上把父母对齐到子女重心，保证下降竖线对准同胞横线中点。
*/
function autoLayout() {
  const people = state.project.people;
  if (people.length === 0) return;
  const gen = computeGenerations();
  state.genMap = gen;
  const familyUnits = syncFamilyUnits();
  // 记录手动摆放节点的位置，排版结束后还原（自由摆放不被自动布局覆盖）
  const manualPos = new Map();
  people.forEach((p) => { if (p.manual) manualPos.set(p.id, { x: p.x, y: p.y }); });

  const SUB_GAP = PERSON_GAP * 0.35;
  const singleW = PERSON_GAP;
  const coupleW = PERSON_GAP * 2;

  /* 1. 构建节点：夫妻超级节点 or 单节点 */
  const nodeOf = new Map();
  const nodes = [];
  const assigned = new Set();
  people.forEach((p) => {
    if (assigned.has(p.id)) return;
    const partner = findPartners(p.id).find((q) => !assigned.has(q.id));
    if (partner) {
      const [l, r] = orderCouple(p.id, partner.id);
      const node = { members: [l, r], gen: gen.get(l), cx: 0, width: coupleW };
      nodes.push(node); nodeOf.set(l, node); nodeOf.set(r, node);
      assigned.add(l); assigned.add(r);
    } else {
      const node = { members: [p.id], gen: gen.get(p.id), cx: 0, width: singleW };
      nodes.push(node); nodeOf.set(p.id, node); assigned.add(p.id);
    }
  });

  /* 2. 节点级父子边（去重，允许一个节点有多个父节点） */
  const parentsOf = new Map(); nodes.forEach((n) => parentsOf.set(n, new Set()));
  const childrenOf = new Map(); nodes.forEach((n) => childrenOf.set(n, new Set()));
  familyUnits.forEach((u) => {
    const parentNodes = [...new Set(u.parentIds.map((id) => nodeOf.get(id)).filter(Boolean))];
    const childNodes = [...new Set(u.childIds.map((id) => nodeOf.get(id)).filter(Boolean))];
    parentNodes.forEach((pn) => {
      childNodes.forEach((cn) => {
        if (pn && cn && pn !== cn) { parentsOf.get(cn).add(pn); childrenOf.get(pn).add(cn); }
      });
    });
  });

  /* 3. 分代 */
  const maxGen = Math.max(...nodes.map((n) => n.gen));
  const genNodes = [];
  for (let g = 0; g <= maxGen; g++) genNodes[g] = [];
  nodes.forEach((n) => genNodes[n.gen].push(n));
  const baseOrder = (n) => Math.min(...n.members.map((id) => getPerson(id).order));
  genNodes.forEach((arr) => arr.sort((a, b) => baseOrder(a) - baseOrder(b)));

  const pack = (g) => {
    let x = 0;
    genNodes[g].forEach((n) => { n.cx = x + n.width / 2; x += n.width + SUB_GAP; });
    // 将该代整体居中到 0，使各代坐标可跨代比较（重心法的前提）
    const m = avg(genNodes[g].map((n) => n.cx));
    genNodes[g].forEach((n) => { n.cx -= m; });
  };
  const baryParents = (n) => { const a = [...parentsOf.get(n)]; return a.length ? avg(a.map((p) => p.cx)) : null; };
  const baryChildren = (n) => { const a = [...childrenOf.get(n)]; return a.length ? avg(a.map((c) => c.cx)) : null; };

  for (let g = 0; g <= maxGen; g++) pack(g);

  // 夫妻节点向其血缘一侧轻微偏置：让该成员的兄弟姐妹排到该成员的外侧，
  // 避免「同胞连线穿过配偶」（如先证者同时有配偶和同胞时）。
  const SIDE_BIAS = 0.5;
  const sideBias = (n) => {
    if (n.members.length !== 2) return 0;
    const [l, r] = n.members;
    const lp = findParents(l).length > 0, rp = findParents(r).length > 0;
    if (lp && !rp) return SIDE_BIAS;   // 血缘在左 → 夫妻排到其同胞右侧
    if (rp && !lp) return -SIDE_BIAS;  // 血缘在右 → 夫妻排到其同胞左侧
    return 0;
  };
  const keyDown = (n) => (baryParents(n) == null ? n.cx : baryParents(n)) + sideBias(n);
  // 上行排序：有子女用子女重心；叶节点改用父代重心（而非 cx），
  // 防止兄弟叶节点以自身位置作 key 时排到「兄弟+配偶」夫妻节点右侧
  const keyUp = (n) => {
    const bc = baryChildren(n), bp = baryParents(n);
    return (bc != null ? bc : bp != null ? bp : n.cx) + sideBias(n);
  };

  /* 4. 重心迭代：下行按父代重心、上行按子代重心，反复排序+打包 */
  for (let iter = 0; iter < 6; iter++) {
    for (let g = 1; g <= maxGen; g++) { genNodes[g].sort((a, b) => keyDown(a) - keyDown(b) || baseOrder(a) - baseOrder(b)); pack(g); }
    for (let g = maxGen - 1; g >= 0; g--) { genNodes[g].sort((a, b) => keyUp(a) - keyUp(b) || baseOrder(a) - baseOrder(b)); pack(g); }
  }

  /* 5. 固定步骤4确定的左右顺序，先按序均匀打包，再做带约束的重心松弛：
        每个节点向「父代+子代重心」靠拢，但被左右相邻节点夹住，既对中又不重叠、不改顺序。 */
  for (let g = 0; g <= maxGen; g++) pack(g);
  const minGap = (a, b) => a.width / 2 + SUB_GAP + b.width / 2;
  for (let iter = 0; iter < 10; iter++) {
    for (let g = 0; g <= maxGen; g++) {
      const arr = genNodes[g];
      for (let i = 0; i < arr.length; i++) {
        const n = arr[i];
        const bp = baryParents(n), bc = baryChildren(n);
        let target = null;
        if (bp != null && bc != null) target = (bp + bc) / 2;
        else if (bp != null) target = bp;
        else if (bc != null) target = bc;
        if (target == null) continue;
        const lo = i > 0 ? arr[i - 1].cx + minGap(arr[i - 1], n) : -Infinity;
        const hi = i < arr.length - 1 ? arr[i + 1].cx - minGap(n, arr[i + 1]) : Infinity;
        n.cx = clamp(target, lo, hi);
      }
    }
  }

  /* 5c. 从上往下显式居中：将每个父节点的子节点整体平移至以父节点为中心。
         补偿步骤5单向扫描产生的偏置——子女重心偏离父母连线中点（L形下降线）。*/
  for (let g = 0; g < maxGen; g++) {
    genNodes[g].forEach((parentNode) => {
      const chArr = [...childrenOf.get(parentNode)];
      if (chArr.length === 0) return;
      const childCentroid = avg(chArr.map((c) => c.cx));
      const diff = parentNode.cx - childCentroid;
      if (Math.abs(diff) < 0.1) return;
      chArr.forEach((c) => { c.cx += diff; });
    });
  }

  enforceSiblingBirthOrder(nodes, nodeOf, childrenOf);

  /* 6. 写回成员坐标 */
  nodes.forEach((n) => {
    const y = n.gen * GENERATION_GAP;
    if (n.members.length === 2) {
      const [l, r] = n.members;
      getPerson(l).x = n.cx - PERSON_GAP / 2; getPerson(l).y = y;
      getPerson(r).x = n.cx + PERSON_GAP / 2; getPerson(r).y = y;
    } else {
      const p = getPerson(n.members[0]);
      p.x = n.cx; p.y = y;
    }
  });

  resolveOverlaps(gen);
  // 还原手动摆放位置（在归一化前还原，使其与其他节点一同平移，保持相对关系）
  manualPos.forEach((pos, id) => { const p = getPerson(id); if (p) { p.x = pos.x; p.y = pos.y; } });
  normalizeToOrigin();
  computeNumbering(gen);
}

function anchorXForMemberNode(node, memberId) {
  if (!node || node.members.length === 1) return node ? node.cx : 0;
  const [l, r] = node.members;
  if (memberId === l) return node.cx - PERSON_GAP / 2;
  if (memberId === r) return node.cx + PERSON_GAP / 2;
  return node.cx;
}

function setMemberAnchorX(node, memberId, targetX) {
  if (!node) return;
  if (node.members.length === 1) { node.cx = targetX; return; }
  const [l, r] = node.members;
  if (memberId === l) node.cx = targetX + PERSON_GAP / 2;
  else if (memberId === r) node.cx = targetX - PERSON_GAP / 2;
  else node.cx = targetX;
}

function shiftDescendantNodes(node, dx, childrenOf, seen = new Set()) {
  const kids = [...(childrenOf.get(node) || [])];
  kids.forEach((childNode) => {
    if (seen.has(childNode)) return;
    seen.add(childNode);
    childNode.cx += dx;
    shiftDescendantNodes(childNode, dx, childrenOf, seen);
  });
}

function moveNodeWithDescendants(node, dx, childrenOf) {
  if (!node || Math.abs(dx) < 0.1) return;
  node.cx += dx;
  shiftDescendantNodes(node, dx, childrenOf);
}

function enforceSiblingBirthOrder(nodes, nodeOf, childrenOf) {
  const units = collectFamilyUnits();
  const applied = new Set();

  units.forEach((u) => {
    const items = u.children
      .map((child) => ({ child, node: nodeOf.get(child.id) }))
      .filter((item) => item.node);
    if (items.length < 2) return;

    const uniqueNodes = new Set(items.map((item) => item.node));
    if (uniqueNodes.size !== items.length) return;

    const currentSlots = items
      .map((item) => anchorXForMemberNode(item.node, item.child.id))
      .sort((a, b) => a - b);
    const ordered = [...items].sort((a, b) => a.child.order - b.child.order);

    ordered.forEach((item, idx) => {
      const key = `${u.parentIds.join("|")}→${item.child.id}`;
      if (applied.has(key)) return;
      applied.add(key);
      const before = item.node.cx;
      setMemberAnchorX(item.node, item.child.id, currentSlots[idx]);
      const dx = item.node.cx - before;
      shiftDescendantNodes(item.node, dx, childrenOf);
    });
  });

  // Repack each generation after slot permutation, moving whole couple nodes together.
  const rows = new Map();
  nodes.forEach((n) => {
    if (!rows.has(n.gen)) rows.set(n.gen, []);
    rows.get(n.gen).push(n);
  });
  rows.forEach((row) => {
    row.sort((a, b) => a.cx - b.cx);
    for (let i = 1; i < row.length; i++) {
      const prev = row[i - 1], cur = row[i];
      const minGap = prev.width / 2 + PERSON_GAP * 0.35 + cur.width / 2;
      const minCx = prev.cx + minGap;
      if (cur.cx < minCx) moveNodeWithDescendants(cur, minCx - cur.cx, childrenOf);
    }
  });
}

function resolveOverlaps(gen) {
  const rows = new Map();
  state.project.people.forEach((p) => {
    const g = gen.get(p.id) ?? 0;
    if (!rows.has(g)) rows.set(g, []);
    rows.get(g).push(p);
  });
  rows.forEach((row) => {
    row.sort((a, b) => a.x - b.x || a.order - b.order);
    const minGap = PERSON_GAP * 0.96;
    for (let i = 1; i < row.length; i++) {
      const gapNeed = row[i - 1].x + minGap;
      if (row[i].x < gapNeed) {
        const shift = gapNeed - row[i].x;
        // 整块右推：当前及其右侧全部平移，保持右侧家庭内部对齐不被破坏
        for (let j = i; j < row.length; j++) row[j].x += shift;
      }
    }
  });
}

function normalizeToOrigin() {
  const xs = state.project.people.map((p) => p.x);
  const ys = state.project.people.map((p) => p.y);
  if (xs.length === 0) return;
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const padX = 120, padY = 120;
  state.project.people.forEach((p) => { p.x = p.x - minX + padX; p.y = p.y - minY + padY; });
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
    rows.get(g).sort((a, b) => a.x - b.x || a.order - b.order).forEach((p, pi) => {
      map.set(p.id, `${roman(gi + 1)}-${pi + 1}`);
    });
  });
  state.numberMap = map;
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
  const svg = els.pedigreeSvg;
  svg.innerHTML = "";
  const rect = els.canvasWrap.getBoundingClientRect();
  const W = Math.max(rect.width, 600), H = Math.max(rect.height, 400);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.appendChild(buildDefs());

  const root = svgEl("g", { transform: `translate(${state.offsetX},${state.offsetY}) scale(${state.scale})` });
  svg.appendChild(root);

  if (state.project.people.length === 0) {
    root.appendChild(svgEl("text", { x: W / 2, y: H / 2, class: "empty-canvas-text" }, "点击左侧「添加先证者」开始绘制"));
    return;
  }

  const s = state.project.settings;
  drawGenerationLabels(root);
  drawRelationships(root);
  state.project.people.forEach((p) => drawPerson(root, p));
  if (s.showTitle) drawTitle(root);
  if (s.showLegend) drawLegend(root);
}

function buildDefs() {
  const defs = svgEl("defs");
  const pat = svgEl("pattern", { id: "suspectedPattern", width: 7, height: 7, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  pat.appendChild(svgEl("rect", { width: 7, height: 7, fill: "#fff" }));
  pat.appendChild(svgEl("rect", { width: 3.5, height: 7, fill: "#2f3a42" }));
  defs.appendChild(pat);
  const mk = svgEl("marker", { id: "arrow", markerWidth: 9, markerHeight: 9, refX: 7, refY: 3, orient: "auto", markerUnits: "strokeWidth" });
  mk.appendChild(svgEl("path", { d: "M0,0 L0,6 L8,3 z", fill: "#2f3a42" }));
  defs.appendChild(mk);
  return defs;
}

function drawGenerationLabels(root) {
  const gen = state.genMap;
  const rows = new Map();
  state.project.people.forEach((p) => {
    const g = gen.get(p.id) ?? 0;
    if (!rows.has(g)) rows.set(g, []);
    rows.get(g).push(p);
  });
  const minX = Math.min(...state.project.people.map((p) => p.x));
  [...rows.keys()].sort((a, b) => a - b).forEach((g, gi) => {
    const y = avg(rows.get(g).map((p) => p.y));
    root.appendChild(svgEl("text", { x: minX - 70, y, class: "generation-label" }, roman(gi + 1)));
  });
}

function drawRelationships(root) {
  const units = collectFamilyUnits();
  const partnerRoutes = computePartnerRoutes();

  // 配偶线：同排水平连接；近亲婚配画双线；若两人不同高（被拖动过）画台阶折线
  state.project.relationships.filter((r) => r.type === "partner").forEach((r) => {
    const a = getPerson(r.person1), b = getPerson(r.person2);
    if (!a || !b) return;
    const route = partnerRoutes.get(coupleKey([a.id, b.id]));
    const consang = areConsanguineous(a.id, b.id);
    if (route && route.kind === "line") {
      root.appendChild(svgEl("line", { x1: route.x1, y1: route.y, x2: route.x2, y2: route.y, class: "marriage-line" }));
      if (consang) root.appendChild(svgEl("line", { x1: route.x1, y1: route.y + 3, x2: route.x2, y2: route.y + 3, class: "marriage-line" }));
    } else if (route && route.kind === "path") {
      root.appendChild(svgEl("path", { d: route.d, class: "marriage-line" }));
      if (consang) root.appendChild(svgEl("path", { d: route.d2, class: "marriage-line" }));
    } else {
      const [l, rt] = a.x <= b.x ? [a, b] : [b, a];
      const mx = (l.x + rt.x) / 2;
      root.appendChild(svgEl("path", { d: `M ${l.x + R} ${l.y} H ${mx} V ${rt.y} H ${rt.x - R}`, class: "marriage-line" }));
      if (consang) root.appendChild(svgEl("path", { d: `M ${l.x + R} ${l.y + 3} H ${mx + 3} V ${rt.y} H ${rt.x - R}`, class: "marriage-line" }));
    }
  });

  /* 家庭单元连线（双亲与单亲统一处理）：
     - 同胞横线的范围强制覆盖下降点 dropX，无论子女如何错位，线都保持连通；
     - 独生子女偏离下降点时，同样补一段水平线连到下降竖线；
     - 同一子代行内，水平范围重叠的不同家庭横线自动错开高度，避免混成一条。 */
  const fams = units.map((u) => {
    const pa = getPerson(u.parentIds[0]);
    const pb = u.parentIds.length === 2 ? getPerson(u.parentIds[1]) : null;
    if (!pa || (u.parentIds.length === 2 && !pb)) return null;
    const route = pb ? partnerRoutes.get(coupleKey([pa.id, pb.id])) : null;
    const dropX = pb ? (pa.x + pb.x) / 2 : pa.x;
    const dropTopY = pb ? (route ? route.childY : (pa.y + pb.y) / 2) : pa.y + R;
    const childTopY = Math.min(...u.children.map((c) => c.y)) - R;
    const xs = u.children.map((c) => c.x);
    const lo = Math.min(...xs, dropX), hi = Math.max(...xs, dropX);
    return { u, dropX, dropTopY, childTopY, lo, hi, level: 0 };
  }).filter(Boolean);

  // 按子代行分组，行内做区间错层（贪心着色）
  const rows = new Map();
  fams.forEach((f) => {
    const key = Math.round(f.childTopY / GENERATION_GAP);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(f);
  });
  const CLEAR = 14;       // 同高横线之间需保持的水平净距
  const LEVEL_STEP = 10;  // 相邻错层的高度差
  rows.forEach((arr) => {
    arr.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
    const placed = [];
    arr.forEach((f) => {
      let lvl = 0;
      while (placed.some((g) => g.level === lvl && f.lo < g.hi + CLEAR && g.lo < f.hi + CLEAR)) lvl++;
      f.level = lvl;
      placed.push(f);
    });
  });

  fams.forEach((f) => {
    const sibY = f.childTopY - SIBSHIP_DROP + R - f.level * LEVEL_STEP;
    root.appendChild(svgEl("line", { x1: f.dropX, y1: f.dropTopY, x2: f.dropX, y2: sibY, class: "descent-line" }));
    if (f.hi - f.lo > 0.5) {
      root.appendChild(svgEl("line", { x1: f.lo, y1: sibY, x2: f.hi, y2: sibY, class: "sibling-line" }));
    }
    // 将子女按 twinGroup 分组：单胎从横线垂直下降；双胎从同一顶点斜线分叉
    const singles = [], twinGroups = new Map();
    f.u.children.forEach((c) => {
      if (c.twinGroup) {
        if (!twinGroups.has(c.twinGroup)) twinGroups.set(c.twinGroup, []);
        twinGroups.get(c.twinGroup).push(c);
      } else singles.push(c);
    });
    singles.forEach((c) => root.appendChild(svgEl("line", { x1: c.x, y1: sibY, x2: c.x, y2: c.y - R, class: "individual-line" })));
    twinGroups.forEach((kids) => {
      if (kids.length === 1) { const c = kids[0]; root.appendChild(svgEl("line", { x1: c.x, y1: sibY, x2: c.x, y2: c.y - R, class: "individual-line" })); return; }
      const apexX = avg(kids.map((c) => c.x));
      const apexY = sibY;
      const forkY = sibY + SIBSHIP_DROP * 0.55;  // 斜线汇聚点
      kids.forEach((c) => {
        root.appendChild(svgEl("line", { x1: apexX, y1: apexY, x2: c.x, y2: forkY, class: "individual-line" }));
        root.appendChild(svgEl("line", { x1: c.x, y1: forkY, x2: c.x, y2: c.y - R, class: "individual-line" }));
      });
      // 同卵双胎：两斜线之间加一条水平连接杆
      if (kids[0].twinType === "identical") {
        const xs = kids.map((c) => c.x).sort((a, b) => a - b);
        const barY = (apexY + forkY) / 2;
        const t = (barY - apexY) / (forkY - apexY);
        const lx = apexX + (xs[0] - apexX) * t, rx = apexX + (xs[xs.length - 1] - apexX) * t;
        root.appendChild(svgEl("line", { x1: lx, y1: barY, x2: rx, y2: barY, class: "twin-bar" }));
      }
    });
  });
}

function computePartnerRoutes() {
  const routes = new Map();
  const rels = state.project.relationships.filter((r) => r.type === "partner");
  const sameRow = [];

  rels.forEach((r) => {
    const a = getPerson(r.person1), b = getPerson(r.person2);
    if (!a || !b) return;
    const [l, rt] = a.x <= b.x ? [a, b] : [b, a];
    const key = coupleKey([a.id, b.id]);
    if (Math.abs(l.y - rt.y) < 1) {
      const y = l.y;
      const x1 = l.x + R, x2 = rt.x - R;
      const blocked = state.project.people.some((p) =>
        p.id !== l.id && p.id !== rt.id &&
        Math.abs(p.y - y) < 1 &&
        p.x - R < x2 && p.x + R > x1);
      sameRow.push({ key, l, rt, y, x1, x2, blocked });
    } else {
      const mx = (l.x + rt.x) / 2;
      routes.set(key, {
        kind: "path",
        childY: (l.y + rt.y) / 2,
        d: `M ${l.x + R} ${l.y} H ${mx} V ${rt.y} H ${rt.x - R}`,
        d2: `M ${l.x + R} ${l.y + 3} H ${mx + 3} V ${rt.y} H ${rt.x - R}`,
      });
    }
  });

  const laneUse = new Map();
  sameRow
    .sort((a, b) => a.y - b.y || a.x1 - b.x1 || a.x2 - b.x2)
    .forEach((r) => {
      if (!r.blocked) {
        routes.set(r.key, { kind: "line", childY: r.y, x1: r.x1, x2: r.x2, y: r.y });
        return;
      }

      const rowKey = Math.round(r.y);
      const used = laneUse.get(rowKey) || [];
      let lane = 0;
      while (used.some((u) => u.lane === lane && r.x1 < u.x2 + 12 && u.x1 < r.x2 + 12)) lane++;
      used.push({ lane, x1: r.x1, x2: r.x2 });
      laneUse.set(rowKey, used);

      const laneY = r.y - R - 18 - lane * 12;
      const d = `M ${r.x1} ${r.y} V ${laneY} H ${r.x2} V ${r.y}`;
      const d2 = `M ${r.x1 + 3} ${r.y} V ${laneY + 4} H ${r.x2 - 3} V ${r.y}`;
      routes.set(r.key, { kind: "path", childY: laneY, d, d2 });
    });

  return routes;
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

function drawPerson(root, p) {
  const g = svgEl("g", { class: "node-hit", "data-id": p.id });
  const s = state.project.settings;

  // 先证者箭头（左下指向符号）
  if (p.proband) {
    const ax = p.x - R - 26, ay = p.y + R + 26;
    g.appendChild(svgEl("line", { x1: ax, y1: ay, x2: p.x - R * 0.78, y2: p.y + R * 0.78, class: "proband-arrow", "marker-end": "url(#arrow)" }));
    g.appendChild(svgEl("text", { x: ax - 4, y: ay + 12, class: "proband-label" }, "P"));
  }

  // 选中环
  if (state.selectedId === p.id) {
    g.appendChild(svgEl("rect", { x: p.x - R - 8, y: p.y - R - 8, width: NODE_SIZE + 16, height: NODE_SIZE + 16, rx: 8, class: "selected-ring" }));
  }

  const cls = `person-symbol ${p.affectedStatus || "unaffected"}`;
  if (p.sex === "female") {
    g.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: R, class: cls }));
  } else if (p.sex === "male") {
    g.appendChild(svgEl("rect", { x: p.x - R, y: p.y - R, width: NODE_SIZE, height: NODE_SIZE, class: cls }));
  } else {
    g.appendChild(svgEl("polygon", { points: `${p.x},${p.y - R} ${p.x + R},${p.y} ${p.x},${p.y + R} ${p.x - R},${p.y}`, class: cls }));
  }

  // 携带者：符号中心实心圆点
  if (p.affectedStatus === "carrier") {
    g.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r: 5, class: "carrier-dot" }));
  }

  if (p.deceased) {
    g.appendChild(svgEl("line", { x1: p.x - R * 1.25, y1: p.y + R * 1.25, x2: p.x + R * 1.25, y2: p.y - R * 1.25, class: "deceased-line" }));
  }

  // 世代编号（符号左上角，避开顶部下降竖线）
  if (s.showNumber) {
    g.appendChild(svgEl("text", { x: p.x - R - 5, y: p.y - R + 2, class: "id-label" }, state.numberMap.get(p.id) || ""));
  }

  // 名称 / 年龄 / 诊断（符号下方依次堆叠）
  let ty = p.y + LABEL_OFFSET;
  if (s.showName && p.name) { g.appendChild(svgEl("text", { x: p.x, y: ty, class: "person-label" }, p.name)); ty += 15; }
  if (s.showAge) {
    const meta = [p.age && `${p.age}岁`, p.birthYear && `b.${p.birthYear}`].filter(Boolean).join(" ");
    if (meta) { g.appendChild(svgEl("text", { x: p.x, y: ty, class: "meta-label" }, meta)); ty += 14; }
  }
  if (s.showDiagnosis && p.diagnoses.length) {
    p.diagnoses.slice(0, 3).forEach((d) => { g.appendChild(svgEl("text", { x: p.x, y: ty, class: "diagnosis-label" }, d)); ty += 14; });
  }

  root.appendChild(g);
}

function drawTitle(root) {
  const b = contentBounds();
  root.appendChild(svgEl("text", { x: (b.minX + b.maxX) / 2, y: b.minY - 56, class: "title-text" }, state.project.title || "家族谱系图"));
}

function drawLegend(root) {
  const b = contentBounds();
  const x = b.maxX + 56;
  const y = b.minY;
  const rowH = 30;
  const items = [
    { kind: "rect", fill: "#fff", text: "男性 · 未患病" },
    { kind: "circle", fill: "#fff", text: "女性 · 未患病" },
    { kind: "diamond", fill: "#e2e8ec", text: "性别未知" },
    { kind: "rect", fill: "#2f3a42", text: "患病" },
    { kind: "rect", fill: "url(#suspectedPattern)", text: "疑似" },
    { kind: "carrier", text: "携带者（中心点）" },
    { kind: "deceased", text: "已故（／）" },
    { kind: "proband", text: "先证者（箭头 P）" },
    { kind: "twin", text: "双胞胎（同卵带横杆）" },
    { kind: "consang", text: "近亲婚配（双线）" }
  ];
  const boxW = 188, boxH = items.length * rowH + 36;
  const g = svgEl("g");
  g.appendChild(svgEl("rect", { x, y, width: boxW, height: boxH, rx: 8, class: "legend-box" }));
  g.appendChild(svgEl("text", { x: x + 14, y: y + 24, class: "legend-title" }, "图例"));
  items.forEach((it, i) => {
    const cy = y + 48 + i * rowH;
    const sx = x + 24;
    const r = 9;
    if (it.kind === "rect") g.appendChild(svgEl("rect", { x: sx - r, y: cy - r, width: r * 2, height: r * 2, fill: it.fill, stroke: "#2f3a42", "stroke-width": 2 }));
    else if (it.kind === "circle") g.appendChild(svgEl("circle", { cx: sx, cy, r, fill: it.fill, stroke: "#2f3a42", "stroke-width": 2 }));
    else if (it.kind === "diamond") g.appendChild(svgEl("polygon", { points: `${sx},${cy - r} ${sx + r},${cy} ${sx},${cy + r} ${sx - r},${cy}`, fill: it.fill, stroke: "#2f3a42", "stroke-width": 2 }));
    else if (it.kind === "deceased") {
      g.appendChild(svgEl("rect", { x: sx - r, y: cy - r, width: r * 2, height: r * 2, fill: "#fff", stroke: "#2f3a42", "stroke-width": 2 }));
      g.appendChild(svgEl("line", { x1: sx - r - 3, y1: cy + r + 3, x2: sx + r + 3, y2: cy - r - 3, stroke: "#2f3a42", "stroke-width": 2 }));
    } else if (it.kind === "proband") {
      g.appendChild(svgEl("rect", { x: sx - r, y: cy - r, width: r * 2, height: r * 2, fill: "#fff", stroke: "#2f3a42", "stroke-width": 2 }));
      g.appendChild(svgEl("line", { x1: sx - r - 12, y1: cy + r + 8, x2: sx - r + 1, y2: cy + r - 1, stroke: "#2f3a42", "stroke-width": 2, "marker-end": "url(#arrow)" }));
    } else if (it.kind === "carrier") {
      g.appendChild(svgEl("circle", { cx: sx, cy, r, fill: "#fff", stroke: "#2f3a42", "stroke-width": 2 }));
      g.appendChild(svgEl("circle", { cx: sx, cy, r: 3, fill: "#2f3a42" }));
    } else if (it.kind === "twin") {
      g.appendChild(svgEl("line", { x1: sx, y1: cy - r, x2: sx - r, y2: cy + r, stroke: "#2f3a42", "stroke-width": 2 }));
      g.appendChild(svgEl("line", { x1: sx, y1: cy - r, x2: sx + r, y2: cy + r, stroke: "#2f3a42", "stroke-width": 2 }));
      g.appendChild(svgEl("line", { x1: sx - r * 0.5, y1: cy, x2: sx + r * 0.5, y2: cy, stroke: "#2f3a42", "stroke-width": 2 }));
    } else if (it.kind === "consang") {
      g.appendChild(svgEl("line", { x1: sx - r, y1: cy - 2, x2: sx + r, y2: cy - 2, stroke: "#2f3a42", "stroke-width": 2 }));
      g.appendChild(svgEl("line", { x1: sx - r, y1: cy + 2, x2: sx + r, y2: cy + 2, stroke: "#2f3a42", "stroke-width": 2 }));
    }
    g.appendChild(svgEl("text", { x: x + 44, y: cy, class: "legend-text" }, it.text));
  });
  root.appendChild(g);
}

function contentBounds() {
  const people = state.project.people;
  if (people.length === 0) return { minX: 0, minY: 0, maxX: 600, maxY: 400, width: 600, height: 400 };
  const xs = people.map((p) => p.x), ys = people.map((p) => p.y);
  return {
    minX: Math.min(...xs), minY: Math.min(...ys),
    maxX: Math.max(...xs), maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
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
  const s = state.project.settings;
  const padL = 110, padR = s.showLegend ? 280 : 110, padT = s.showTitle ? 110 : 90, padB = 110;
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
  state.offsetX = cw / 2 - centerX * scale + (s.showLegend ? -70 * scale : 0);
  state.offsetY = ch / 2 - centerY * scale + (s.showTitle ? 18 * scale : 0);
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
  if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "z") { evt.preventDefault(); undo(); return; }
  if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === "y") { evt.preventDefault(); redo(); return; }
  if ((evt.ctrlKey || evt.metaKey) && evt.shiftKey && evt.key.toLowerCase() === "z") { evt.preventDefault(); redo(); return; }
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
function snapshot() { syncFamilyUnits(); return JSON.stringify(state.project); }
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
  try { localStorage.setItem(AUTOSAVE_KEY, snapshot()); } catch (e) { /* ignore */ }
}
function restoreAutosave() {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return false;
  try {
    const proj = normalizeProject(JSON.parse(raw));
    state.project = proj;
    state.selectedId = null;
    applySettingsToUI();
    autoLayout();
    setStatus("已恢复上次自动保存");
    return true;
  } catch (e) { localStorage.removeItem(AUTOSAVE_KEY); return false; }
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
  syncFamilyUnits();
  const blob = new Blob([JSON.stringify(state.project, null, 2)], { type: "application/json" });
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
    } catch (err) { setStatus("加载失败：文件格式不正确"); }
    finally { evt.target.value = ""; }
  };
  reader.readAsText(file, "utf-8");
}

function normalizeProject(proj) {
  if (!proj || !Array.isArray(proj.people) || !Array.isArray(proj.relationships)) throw new Error("invalid");
  const base = createProject();
  return {
    ...base,
    ...proj,
    settings: { ...base.settings, ...(proj.settings || {}) },
    people: proj.people.map((p, i) => ({
      ...createPerson(),
      ...p,
      diagnoses: Array.isArray(p.diagnoses) ? p.diagnoses : [],
      order: Number.isFinite(p.order) ? p.order : i + 1
    })),
    relationships: proj.relationships,
    familyUnits: Array.isArray(proj.familyUnits) ? proj.familyUnits : []
  };
}

/* ============================================================
   导出 PNG / SVG
   ============================================================ */
function buildExportSvg() {
  const b = contentBounds();
  const s = state.project.settings;
  const padL = 90, padT = s.showTitle ? 100 : 70, padB = 90;
  const padR = s.showLegend ? 280 : 90;
  const vbX = b.minX - padL;
  const vbY = b.minY - padT;
  const W = b.width + padL + padR;
  const Hh = b.height + padT + padB;

  const svg = svgEl("svg", {
    xmlns: SVG_NS, width: W, height: Hh, viewBox: `${vbX} ${vbY} ${W} ${Hh}`
  });
  svg.appendChild(svgEl("rect", { x: vbX, y: vbY, width: W, height: Hh, fill: "#ffffff" }));
  svg.appendChild(buildDefs());
  const style = svgEl("style");
  style.textContent = exportStyles();
  svg.appendChild(style);
  const g = svgEl("g");
  svg.appendChild(g);
  drawGenerationLabels(g);
  drawRelationships(g);
  state.project.people.forEach((p) => drawPersonStatic(g, p));
  if (s.showTitle) drawTitle(g);
  if (s.showLegend) drawLegend(g);
  return { svg, W, H: Hh };
}

function drawPersonStatic(root, p) {
  // 与 drawPerson 相同，但不含选中环
  const saved = state.selectedId;
  state.selectedId = null;
  drawPerson(root, p);
  state.selectedId = saved;
}

function exportStyles() {
  return `
  .marriage-line,.descent-line,.sibling-line,.individual-line{stroke:#2f3a42;stroke-width:2.2;fill:none;stroke-linecap:square}
  .person-symbol{stroke:#2f3a42;stroke-width:2.8}
  .person-symbol.unaffected{fill:#fff}
  .person-symbol.affected{fill:#2f3a42}
  .person-symbol.suspected{fill:url(#suspectedPattern)}
  .person-symbol.unknown{fill:#e2e8ec}
  .person-symbol.carrier{fill:#fff}
  .carrier-dot{fill:#2f3a42}
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
    state.project.relationships.filter((r) => r.type === "parentChild").forEach((r) => {
      if (adj.has(r.parent) && adj.has(r.child)) { adj.get(r.parent).add(r.child); adj.get(r.child).add(r.parent); }
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
    if (parentSibs.includes(id)) return (side ? side : "") + sexWord("叔伯", "姑姨", "二级亲属");
    return (side ? side : "") + sexWord("二级男性亲属", "二级女性亲属", "二级亲属");
  }
  return (side ? side : "") + `${degree}级亲属`;
}

function buildFamilyHistory() {
  const proband = state.project.people.find((p) => p.proband) || state.project.people[0];
  if (!proband) return "（暂无成员）";
  const affected = state.project.people
    .map((p) => ({ p, deg: p.id === proband.id ? 0 : clinicalDegree(proband.id, p.id) }))
    .filter((o) => o.p.id !== proband.id && o.deg != null &&
      (o.p.affectedStatus === "affected" || o.p.affectedStatus === "suspected"));
  const total = state.project.people.length;
  const lines = [];
  const pRealName = realName(proband);
  const pName = pRealName ? `（${pRealName}）` : "";
  const pDx = proband.diagnoses && proband.diagnoses.length ? proband.diagnoses.join("、") : (proband.affectedStatus === "affected" ? "（诊断未填写）" : "");
  lines.push(`先证者${pName}${pDx ? "，临床诊断" + pDx : ""}。家系共纳入 ${total} 名成员。`);
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
    lines.push(`家系内除先证者外共 ${affected.length} 名亲属受累，提示家族聚集性，建议结合遗传咨询进一步评估。`);
  }
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
