const AUTOSAVE_KEY = "psychiatric-pedigree-v2-autosave";
const SVG_NS = "http://www.w3.org/2000/svg";
const NODE_SIZE = 44;
const NODE_RADIUS = NODE_SIZE / 2;
const PERSON_GAP = NODE_SIZE * 3.2;
const GENERATION_GAP = NODE_SIZE * 3.9;
const MIN_NODE_GAP = NODE_SIZE * 3.05;
const LINE_NODE_PADDING = NODE_SIZE * 1.15;
const FAMILY_TRACK_STEP = NODE_SIZE * 0.38;
const SIBSHIP_LINE_OFFSET = NODE_SIZE * 1.15;
const LABEL_OFFSET = NODE_SIZE * 0.78;
const DIAGNOSIS_OFFSET = NODE_SIZE * 1.2;
const CANVAS_CENTER_X = 560;
const FIRST_GENERATION_Y = 120;

const state = {
  project: createProject(),
  selectedPersonId: null,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: null
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheElements();
  bindEvents();
  const restored = restoreAutosave();
  if (!restored) {
    setStatus("新项目已创建");
  }
  updateControls();
  renderAll();
}

function cacheElements() {
  [
    "projectMeta", "newProjectBtn", "saveJsonBtn", "loadJsonInput", "exportPngBtn",
    "addPersonBtn", "setProbandBtn", "deletePersonBtn", "addFatherBtn", "addMotherBtn",
    "addPartnerBtn", "addChildBtn", "addSiblingBtn", "autoLayoutBtn", "zoomInBtn",
    "zoomOutBtn", "resetViewBtn", "projectTitleInput", "statusLine", "canvasWrap",
    "pedigreeSvg", "emptySelection", "personForm", "personName", "personSex",
    "personAge", "personBirthYear", "personAffectedStatus", "diagnosisSelect",
    "diagnosisTags", "personDeceased", "personProband", "personNotes"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.newProjectBtn.addEventListener("click", newProject);
  els.saveJsonBtn.addEventListener("click", saveProjectJson);
  els.loadJsonInput.addEventListener("change", loadProjectJson);
  els.exportPngBtn.addEventListener("click", exportPng);
  els.addPersonBtn.addEventListener("click", () => addPerson());
  els.setProbandBtn.addEventListener("click", setSelectedAsProband);
  els.deletePersonBtn.addEventListener("click", deleteSelectedPerson);
  els.addFatherBtn.addEventListener("click", () => addParent("male"));
  els.addMotherBtn.addEventListener("click", () => addParent("female"));
  els.addPartnerBtn.addEventListener("click", addPartner);
  els.addChildBtn.addEventListener("click", addChild);
  els.addSiblingBtn.addEventListener("click", addSibling);
  els.autoLayoutBtn.addEventListener("click", () => {
    clearManualPositions();
    autoLayout(true);
    commitChange("已自动排版");
  });
  els.zoomInBtn.addEventListener("click", () => setZoom(state.scale + 0.12));
  els.zoomOutBtn.addEventListener("click", () => setZoom(state.scale - 0.12));
  els.resetViewBtn.addEventListener("click", resetView);
  els.projectTitleInput.addEventListener("input", () => {
    state.project.title = els.projectTitleInput.value.trim() || "未命名家系图";
    commitChange("项目名称已更新", false);
  });

  [
    "personName", "personSex", "personAge", "personBirthYear",
    "personAffectedStatus", "personNotes"
  ].forEach((id) => {
    els[id].addEventListener("input", updateSelectedFromForm);
  });

  els.personDeceased.addEventListener("change", updateSelectedFromForm);
  els.personProband.addEventListener("change", updateSelectedFromForm);
  els.diagnosisSelect.addEventListener("change", addDiagnosisFromSelect);
  els.pedigreeSvg.addEventListener("pointermove", onPointerMove);
  els.pedigreeSvg.addEventListener("pointerup", endDrag);
  els.pedigreeSvg.addEventListener("pointerleave", endDrag);
  els.canvasWrap.addEventListener("wheel", onCanvasWheel, { passive: false });
}

function createProject() {
  const now = new Date().toISOString();
  return {
    version: "2.0",
    title: "未命名家系图",
    createdAt: now,
    updatedAt: now,
    people: [],
    relationships: [],
    settings: {
      showNames: true,
      showDiagnoses: true,
      showLegend: true
    },
    viewport: {
      scale: 1,
      offsetX: 0,
      offsetY: 0
    }
  };
}

function makeId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function createPerson(overrides = {}) {
  const index = state.project.people.length + 1;
  return {
    id: makeId("p"),
    name: overrides.name || `成员${index}`,
    sex: overrides.sex || "unknown",
    age: "",
    birthYear: "",
    affectedStatus: "unknown",
    diagnoses: [],
    deceased: false,
    proband: false,
    notes: "",
    x: 0,
    y: 0,
    manualPosition: false,
    layoutOrder: index,
    ...overrides
  };
}

function addPerson(overrides = {}) {
  const person = createPerson(overrides);
  const wrap = els.canvasWrap.getBoundingClientRect();
  person.x = (wrap.width / 2 - state.offsetX) / state.scale;
  person.y = (wrap.height / 2 - state.offsetY) / state.scale;
  state.project.people.push(person);
  state.selectedPersonId = person.id;
  if (state.project.people.length === 1) {
    person.proband = true;
    person.name = "先证者";
  }
  commitChange("已添加成员");
  return person;
}

function addRelationship(relationship) {
  state.project.relationships.push({
    id: makeId("r"),
    ...relationship
  });
}

function selectedPerson() {
  return state.project.people.find((person) => person.id === state.selectedPersonId) || null;
}

function requireSelection() {
  const person = selectedPerson();
  if (!person) {
    setStatus("请先选择一个成员");
    return null;
  }
  return person;
}

function addParent(sex) {
  const child = requireSelection();
  if (!child) return;
  const basePersonId = child.id;
  const parent = createPerson({
    sex,
    name: sex === "male" ? "父亲" : "母亲",
    x: child.x + (sex === "male" ? -56 : 56),
    y: child.y - GENERATION_GAP
  });
  state.project.people.push(parent);
  addRelationship({ type: "parentChild", parent: parent.id, child: child.id });
  findParents(child.id)
    .filter((existingParent) => existingParent.id !== parent.id)
    .forEach((existingParent) => {
      if (!hasPartnerRelationship(parent.id, existingParent.id)) {
        addRelationship({ type: "partner", person1: parent.id, person2: existingParent.id, status: "current" });
      }
    });
  state.selectedPersonId = basePersonId;
  autoLayout(true);
  commitChange(`已添加${sex === "male" ? "父亲" : "母亲"}`);
}

function addPartner() {
  const person = requireSelection();
  if (!person) return;
  const basePersonId = person.id;
  const partner = createPerson({
    name: "配偶",
    sex: person.sex === "male" ? "female" : person.sex === "female" ? "male" : "unknown",
    x: person.x + PERSON_GAP,
    y: person.y
  });
  state.project.people.push(partner);
  addRelationship({ type: "partner", person1: person.id, person2: partner.id, status: "current" });
  state.selectedPersonId = basePersonId;
  autoLayout(true);
  commitChange("已添加配偶");
}

function addChild() {
  const parent = requireSelection();
  if (!parent) return;
  const basePersonId = parent.id;
  const child = createPerson({
    name: "子女",
    x: parent.x,
    y: parent.y + GENERATION_GAP
  });
  state.project.people.push(child);
  addRelationship({ type: "parentChild", parent: parent.id, child: child.id });
  const partner = findPartners(parent.id)[0];
  if (partner) {
      addRelationship({ type: "parentChild", parent: partner.id, child: child.id });
  }
  state.selectedPersonId = basePersonId;
  autoLayout(true);
  commitChange("已添加子女");
}

function addSibling() {
  const person = requireSelection();
  if (!person) return;
  const basePersonId = person.id;
  const sibling = createPerson({
    name: "兄弟姐妹",
    sex: "unknown",
    x: person.x + PERSON_GAP,
    y: person.y
  });
  state.project.people.push(sibling);
  const parents = findParents(person.id);
  parents.forEach((parent) => {
    addRelationship({ type: "parentChild", parent: parent.id, child: sibling.id });
  });
  state.selectedPersonId = basePersonId;
  autoLayout(true);
  commitChange("已添加兄弟姐妹");
}

function deleteSelectedPerson() {
  const person = requireSelection();
  if (!person) return;
  state.project.people = state.project.people.filter((item) => item.id !== person.id);
  state.project.relationships = state.project.relationships.filter((rel) => !relationshipHasPerson(rel, person.id));
  state.selectedPersonId = null;
  commitChange("已删除成员");
}

function relationshipHasPerson(rel, id) {
  return rel.parent === id || rel.child === id || rel.person1 === id || rel.person2 === id;
}

function hasPartnerRelationship(idA, idB) {
  return state.project.relationships.some((rel) => {
    if (rel.type !== "partner") return false;
    return (rel.person1 === idA && rel.person2 === idB) || (rel.person1 === idB && rel.person2 === idA);
  });
}

function setSelectedAsProband() {
  const person = requireSelection();
  if (!person) return;
  state.project.people.forEach((item) => {
    item.proband = item.id === person.id;
  });
  commitChange("已设置先证者");
}

function updateSelectedFromForm() {
  const person = selectedPerson();
  if (!person) return;
  person.name = els.personName.value.trim() || "未命名";
  person.sex = els.personSex.value;
  person.age = els.personAge.value.trim();
  person.birthYear = els.personBirthYear.value.trim();
  person.affectedStatus = els.personAffectedStatus.value;
  person.deceased = els.personDeceased.checked;
  person.notes = els.personNotes.value;
  if (els.personProband.checked) {
    state.project.people.forEach((item) => {
      item.proband = item.id === person.id;
    });
  } else {
    person.proband = false;
  }
  commitChange("成员属性已更新", false);
}

function addDiagnosisFromSelect() {
  const person = selectedPerson();
  const value = els.diagnosisSelect.value;
  if (!person || !value) return;
  if (!person.diagnoses.includes(value)) {
    person.diagnoses.push(value);
  }
  els.diagnosisSelect.value = "";
  commitChange("诊断标签已更新");
}

function removeDiagnosis(value) {
  const person = selectedPerson();
  if (!person) return;
  person.diagnoses = person.diagnoses.filter((item) => item !== value);
  commitChange("诊断标签已移除");
}

function commitChange(message, rerender = true) {
  state.project.updatedAt = new Date().toISOString();
  state.project.viewport = {
    scale: state.scale,
    offsetX: state.offsetX,
    offsetY: state.offsetY
  };
  autosave();
  updateControls();
  if (rerender) {
    renderAll();
  } else {
    renderAll();
  }
  setStatus(message);
}

function updateControls() {
  const hasSelection = Boolean(selectedPerson());
  [
    els.setProbandBtn, els.deletePersonBtn, els.addFatherBtn, els.addMotherBtn,
    els.addPartnerBtn, els.addChildBtn, els.addSiblingBtn
  ].forEach((button) => {
    button.disabled = !hasSelection;
  });
  els.projectTitleInput.value = state.project.title;
  els.projectMeta.textContent = `${state.project.title} · ${state.project.people.length} 名成员`;
  renderForm();
}

function renderForm() {
  const person = selectedPerson();
  els.emptySelection.hidden = Boolean(person);
  els.personForm.hidden = !person;
  if (!person) return;
  els.personName.value = person.name || "";
  els.personSex.value = person.sex || "unknown";
  els.personAge.value = person.age || "";
  els.personBirthYear.value = person.birthYear || "";
  els.personAffectedStatus.value = person.affectedStatus || "unknown";
  els.personDeceased.checked = Boolean(person.deceased);
  els.personProband.checked = Boolean(person.proband);
  els.personNotes.value = person.notes || "";
  els.diagnosisTags.innerHTML = "";
  person.diagnoses.forEach((diagnosis) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = diagnosis;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "x";
    button.title = "移除诊断";
    button.addEventListener("click", () => removeDiagnosis(diagnosis));
    tag.appendChild(button);
    els.diagnosisTags.appendChild(tag);
  });
}

function renderAll() {
  const svg = els.pedigreeSvg;
  svg.innerHTML = "";
  const wrap = els.canvasWrap.getBoundingClientRect();
  svg.setAttribute("viewBox", `0 0 ${Math.max(wrap.width, 800)} ${Math.max(wrap.height, 560)}`);
  svg.appendChild(createDefs());

  const graph = svgEl("g", {
    transform: `translate(${state.offsetX}, ${state.offsetY}) scale(${state.scale})`
  });
  svg.appendChild(graph);

  if (state.project.people.length === 0) {
    graph.appendChild(svgEl("text", {
      x: Math.max(wrap.width, 800) / 2,
      y: Math.max(wrap.height, 560) / 2,
      class: "empty-canvas-text"
    }, "点击左侧“添加成员”开始"));
    return;
  }

  renderGenerationLabels(graph);
  renderRelationships(graph);
  state.project.people.forEach((person) => renderPerson(graph, person));
}

function createDefs() {
  const defs = svgEl("defs");
  const pattern = svgEl("pattern", {
    id: "suspectedPattern",
    width: 8,
    height: 8,
    patternUnits: "userSpaceOnUse",
    patternTransform: "rotate(45)"
  });
  pattern.appendChild(svgEl("rect", { width: 8, height: 8, fill: "#fff" }));
  pattern.appendChild(svgEl("rect", { width: 4, height: 8, fill: "#2f3a42" }));
  defs.appendChild(pattern);

  const marker = svgEl("marker", {
    id: "arrowHead",
    markerWidth: 10,
    markerHeight: 10,
    refX: 8,
    refY: 3,
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  marker.appendChild(svgEl("path", { d: "M0,0 L0,6 L9,3 z", fill: "#b42318" }));
  defs.appendChild(marker);
  return defs;
}

function renderRelationships(graph) {
  const familyUnits = collectFamilyUnits();
  const childrenInTwoParentFamilies = new Set(
    familyUnits.flatMap((unit) => unit.children.map((child) => child.id))
  );
  const renderedPartnerKeys = new Set();

  state.project.relationships
    .filter((rel) => rel.type === "partner")
    .forEach((rel) => {
      const p1 = getPerson(rel.person1);
      const p2 = getPerson(rel.person2);
      if (!p1 || !p2) return;
      renderPartnerLine(graph, p1, p2);
      renderedPartnerKeys.add(parentKey([p1.id, p2.id]));
    });

  familyUnits.forEach((entry, index) => {
    const [parentA, parentB] = entry.parents;
    const key = parentKey([parentA.id, parentB.id]);
    if (!renderedPartnerKeys.has(key)) {
      renderPartnerLine(graph, parentA, parentB);
      renderedPartnerKeys.add(key);
    }
    const midX = (parentA.x + parentB.x) / 2;
    const marriageY = (parentA.y + parentB.y) / 2;
    const childTopY = Math.min(...entry.children.map((child) => child.y)) - LINE_NODE_PADDING;
    const baseSibshipY = childTopY - FAMILY_TRACK_STEP;
    const childXs = entry.children.map((child) => child.x);
    const sibshipY = routeHorizontalLineY(baseSibshipY, Math.min(...childXs), Math.max(...childXs), entry.children, index);
    const descentX = routeVerticalLineX(midX, marriageY, sibshipY, entry.parents.concat(entry.children), index);
    graph.appendChild(svgEl("line", { x1: midX, y1: marriageY, x2: descentX, y2: marriageY, class: "descent-line" }));
    graph.appendChild(svgEl("line", { x1: descentX, y1: marriageY, x2: descentX, y2: sibshipY, class: "descent-line" }));
    graph.appendChild(svgEl("line", { x1: descentX, y1: sibshipY, x2: midX, y2: sibshipY, class: "descent-line" }));
    if (entry.children.length > 1) {
      graph.appendChild(svgEl("line", {
        x1: Math.min(...childXs),
        y1: sibshipY,
        x2: Math.max(...childXs),
        y2: sibshipY,
        class: "sibling-line"
      }));
    }
    entry.children.forEach((child) => {
      graph.appendChild(svgEl("line", { x1: child.x, y1: sibshipY, x2: child.x, y2: child.y - NODE_RADIUS, class: "individual-line" }));
    });
  });

  state.project.relationships
    .filter((rel) => rel.type === "parentChild")
    .forEach((rel, index) => {
      if (childrenInTwoParentFamilies.has(rel.child)) return;
      const parent = getPerson(rel.parent);
      const child = getPerson(rel.child);
      if (!parent || !child) return;
      const baseDescentY = child.y - LINE_NODE_PADDING;
      const descentY = routeHorizontalLineY(baseDescentY, Math.min(parent.x, child.x), Math.max(parent.x, child.x), [child], index);
      const descentX = routeVerticalLineX(parent.x, parent.y, descentY, [parent, child], index);
      graph.appendChild(svgEl("line", { x1: parent.x, y1: parent.y + NODE_RADIUS, x2: descentX, y2: parent.y + NODE_RADIUS, class: "descent-line" }));
      graph.appendChild(svgEl("line", { x1: descentX, y1: parent.y + NODE_RADIUS, x2: descentX, y2: descentY, class: "descent-line" }));
      if (descentX !== child.x) {
        graph.appendChild(svgEl("line", { x1: descentX, y1: descentY, x2: child.x, y2: descentY, class: "sibling-line" }));
      }
      graph.appendChild(svgEl("line", { x1: child.x, y1: descentY, x2: child.x, y2: child.y - NODE_RADIUS, class: "individual-line" }));
    });
}

function renderPartnerLine(graph, p1, p2) {
  graph.appendChild(svgEl("line", {
    x1: p1.x,
    y1: (p1.y + p2.y) / 2,
    x2: p2.x,
    y2: (p1.y + p2.y) / 2,
    class: "marriage-line"
  }));
}

function routeHorizontalLineY(baseY, x1, x2, attachedPeople, trackIndex) {
  let y = baseY - (trackIndex % 4) * FAMILY_TRACK_STEP;
  let attempts = 0;
  while (attempts < 8 && horizontalLineIntersectsAnyNode(x1, x2, y, attachedPeople)) {
    y -= FAMILY_TRACK_STEP;
    attempts += 1;
  }
  return y;
}

function routeVerticalLineX(baseX, y1, y2, attachedPeople, trackIndex) {
  let x = baseX;
  let attempts = 0;
  while (attempts < 8 && verticalLineIntersectsAnyNode(x, y1, y2, attachedPeople)) {
    const direction = attempts % 2 === 0 ? 1 : -1;
    const distance = Math.ceil((attempts + 1) / 2) * FAMILY_TRACK_STEP;
    x = baseX + direction * distance;
    attempts += 1;
  }
  return x;
}

function horizontalLineIntersectsAnyNode(x1, x2, y, attachedPeople) {
  const attachedIds = new Set(attachedPeople.map((person) => person.id));
  const left = Math.min(x1, x2) - LINE_NODE_PADDING;
  const right = Math.max(x1, x2) + LINE_NODE_PADDING;
  return state.project.people.some((person) => {
    if (attachedIds.has(person.id)) return false;
    const insideX = person.x > left && person.x < right;
    const tooCloseY = Math.abs(person.y - y) < LINE_NODE_PADDING;
    return insideX && tooCloseY;
  });
}

function verticalLineIntersectsAnyNode(x, y1, y2, attachedPeople) {
  const attachedIds = new Set(attachedPeople.map((person) => person.id));
  const top = Math.min(y1, y2);
  const bottom = Math.max(y1, y2);
  return state.project.people.some((person) => {
    if (attachedIds.has(person.id)) return false;
    const insideY = person.y > top - LINE_NODE_PADDING && person.y < bottom + LINE_NODE_PADDING;
    const tooCloseX = Math.abs(person.x - x) < LINE_NODE_PADDING;
    return insideY && tooCloseX;
  });
}

function renderGenerationLabels(graph) {
  const generations = computeGenerations();
  const rows = new Map();
  state.project.people.forEach((person) => {
    const generation = generations.get(person.id) ?? 0;
    if (!rows.has(generation)) rows.set(generation, []);
    rows.get(generation).push(person);
  });
  rows.forEach((people, generation) => {
    const y = average(people.map((person) => person.y));
    const minX = Math.min(...state.project.people.map((person) => person.x));
    graph.appendChild(svgEl("text", {
      x: minX - 92,
      y,
      class: "generation-label"
    }, romanNumeral(generation + 1)));
  });
}

function renderPerson(graph, person) {
  const group = svgEl("g", {
    class: "node-hit",
    "data-person-id": person.id,
    tabindex: "0"
  });
  group.addEventListener("pointerdown", (event) => startDrag(event, person.id));
  group.addEventListener("click", (event) => {
    event.stopPropagation();
    selectPerson(person.id);
  });

  if (person.proband) {
    group.appendChild(svgEl("path", {
      d: `M ${person.x - NODE_SIZE * 1.65} ${person.y + NODE_SIZE * 0.95} L ${person.x - NODE_SIZE * 0.72} ${person.y + NODE_SIZE * 0.38}`,
      class: "proband-arrow",
      "marker-end": "url(#arrowHead)"
    }));
  }

  if (state.selectedPersonId === person.id) {
    group.appendChild(svgEl("circle", {
      cx: person.x,
      cy: person.y,
      r: NODE_RADIUS + NODE_SIZE * 0.28,
      class: "selected-ring"
    }));
  }

  const className = `person-symbol ${person.affectedStatus || "unknown"}`;
  if (person.sex === "female") {
    group.appendChild(svgEl("circle", { cx: person.x, cy: person.y, r: NODE_RADIUS, class: className }));
  } else if (person.sex === "male") {
    group.appendChild(svgEl("rect", {
      x: person.x - NODE_RADIUS,
      y: person.y - NODE_RADIUS,
      width: NODE_SIZE,
      height: NODE_SIZE,
      rx: 2,
      class: className
    }));
  } else {
    const d = `${person.x},${person.y - NODE_RADIUS} ${person.x + NODE_RADIUS},${person.y} ${person.x},${person.y + NODE_RADIUS} ${person.x - NODE_RADIUS},${person.y}`;
    group.appendChild(svgEl("polygon", { points: d, class: className }));
  }

  if (person.deceased) {
    group.appendChild(svgEl("line", {
      x1: person.x - NODE_RADIUS * 1.15,
      y1: person.y + NODE_RADIUS * 1.15,
      x2: person.x + NODE_RADIUS * 1.15,
      y2: person.y - NODE_RADIUS * 1.15,
      class: "deceased-line"
    }));
  }

  group.appendChild(svgEl("text", {
    x: person.x,
    y: person.y + LABEL_OFFSET,
    class: "person-label"
  }, person.name || "未命名"));

  if (person.diagnoses.length > 0) {
    group.appendChild(svgEl("text", {
      x: person.x,
      y: person.y + DIAGNOSIS_OFFSET,
      class: "diagnosis-label"
    }, person.diagnoses.slice(0, 2).join("、")));
  }

  graph.appendChild(group);
}

function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function getPerson(id) {
  return state.project.people.find((person) => person.id === id) || null;
}

function findParents(personId) {
  return state.project.relationships
    .filter((rel) => rel.type === "parentChild" && rel.child === personId)
    .map((rel) => getPerson(rel.parent))
    .filter(Boolean);
}

function findPartners(personId) {
  return state.project.relationships
    .filter((rel) => rel.type === "partner" && (rel.person1 === personId || rel.person2 === personId))
    .map((rel) => getPerson(rel.person1 === personId ? rel.person2 : rel.person1))
    .filter(Boolean);
}

function collectFamilyUnits() {
  const grouped = new Map();
  state.project.people.forEach((child) => {
    const parents = findParents(child.id).sort(compareProjectOrder);
    if (parents.length < 2) return;
    const primaryParents = choosePrimaryParents(parents);
    const key = parentKey(primaryParents.map((parent) => parent.id));
    if (!grouped.has(key)) {
      grouped.set(key, { parents: primaryParents, children: [] });
    }
    grouped.get(key).children.push(child);
  });
  return [...grouped.values()].map((unit) => ({
    parents: orderPartnerPeople(unit.parents[0], unit.parents[1]),
    children: unit.children.sort(compareLayoutOrder)
  }));
}

function choosePrimaryParents(parents) {
  const male = parents.find((parent) => parent.sex === "male");
  const female = parents.find((parent) => parent.sex === "female");
  if (male && female) return [male, female];
  return parents.slice(0, 2);
}

function parentKey(ids) {
  return [...ids].sort().join("|");
}

function orderPartnerPeople(personA, personB) {
  return orderPartnerIds(personA.id, personB.id).map((id) => getPerson(id)).filter(Boolean);
}

function orderPartnerIds(idA, idB) {
  const personA = getPerson(idA);
  const personB = getPerson(idB);
  if (personA?.sex === "male" && personB?.sex !== "male") return [idA, idB];
  if (personB?.sex === "male" && personA?.sex !== "male") return [idB, idA];
  if (personA?.sex !== "female" && personB?.sex === "female") return [idA, idB];
  if (personB?.sex !== "female" && personA?.sex === "female") return [idB, idA];
  return [idA, idB].sort((a, b) => projectOrder(a) - projectOrder(b));
}

function compareProjectOrder(a, b) {
  return projectOrder(a.id) - projectOrder(b.id);
}

function compareLayoutOrder(a, b) {
  const orderA = Number.isFinite(a.layoutOrder) ? a.layoutOrder : projectOrder(a.id);
  const orderB = Number.isFinite(b.layoutOrder) ? b.layoutOrder : projectOrder(b.id);
  if (orderA !== orderB) return orderA - orderB;
  return projectOrder(a.id) - projectOrder(b.id);
}

function projectOrder(id) {
  return state.project.people.findIndex((person) => person.id === id);
}

function selectPerson(id) {
  state.selectedPersonId = id;
  updateControls();
  renderAll();
}

function autoLayout(resetManual) {
  if (state.project.people.length === 0) return;
  if (resetManual) {
    clearManualPositions();
  }
  const generations = computeGenerations();
  const grouped = new Map();
  state.project.people.forEach((person) => {
    const generation = generations.get(person.id) ?? 0;
    if (!grouped.has(generation)) grouped.set(generation, []);
    grouped.get(generation).push(person);
  });

  const sortedGenerations = [...grouped.keys()].sort((a, b) => a - b);
  const centerX = CANVAS_CENTER_X;
  sortedGenerations.forEach((generation, generationIndex) => {
    const people = grouped.get(generation);
    people.sort(compareLayoutOrder);
    const startX = centerX - ((people.length - 1) * PERSON_GAP) / 2;
    people.forEach((person, index) => {
      if (!resetManual && person.manualPosition) return;
      person.x = startX + index * PERSON_GAP;
      person.y = FIRST_GENERATION_Y + generationIndex * GENERATION_GAP;
    });
  });

  for (let pass = 0; pass < 4; pass += 1) {
    alignPartnerPairs(resetManual);
    alignFamilyUnits(resetManual);
    alignSingleParentChildren(resetManual);
    avoidNodeCollisionsByGeneration();
  }
  avoidNodeCollisionsByGeneration();
}

function alignPartnerPairs(resetManual) {
  state.project.relationships
    .filter((rel) => rel.type === "partner")
    .forEach((rel) => {
      const [leftId, rightId] = orderPartnerIds(rel.person1, rel.person2);
      const left = getPerson(leftId);
      const right = getPerson(rightId);
      if (!left || !right) return;
      const centerX = (left.x + right.x) / 2;
      const centerY = (left.y + right.y) / 2;
      if (resetManual || !left.manualPosition) {
        left.x = centerX - PERSON_GAP / 2;
        left.y = centerY;
      }
      if (resetManual || !right.manualPosition) {
        right.x = centerX + PERSON_GAP / 2;
        right.y = centerY;
      }
    });
}

function alignFamilyUnits(resetManual) {
  collectFamilyUnits().forEach((unit) => {
    const [leftParent, rightParent] = unit.parents;
    const children = unit.children;
    if (!leftParent || !rightParent || children.length === 0) return;

    const parentCenter = (leftParent.x + rightParent.x) / 2;
    const centerX = parentCenter;
    const parentY = Math.min(leftParent.y, rightParent.y);
    const childY = parentY + GENERATION_GAP;
    const childStartX = centerX - ((children.length - 1) * PERSON_GAP) / 2;

    if (resetManual || !leftParent.manualPosition) {
      leftParent.x = centerX - PERSON_GAP / 2;
      leftParent.y = parentY;
    }
    if (resetManual || !rightParent.manualPosition) {
      rightParent.x = centerX + PERSON_GAP / 2;
      rightParent.y = parentY;
    }
    children.forEach((child, index) => {
      if (resetManual || !child.manualPosition) {
        child.x = childStartX + index * PERSON_GAP;
        child.y = childY;
      }
    });
  });
}

function alignSingleParentChildren(resetManual) {
  const twoParentChildren = new Set(
    collectFamilyUnits().flatMap((unit) => unit.children.map((child) => child.id))
  );
  state.project.people.forEach((child) => {
    if (twoParentChildren.has(child.id)) return;
    const parents = findParents(child.id);
    if (parents.length !== 1) return;
    const parent = parents[0];
    if (resetManual || !child.manualPosition) {
      child.x = parent.x;
      child.y = parent.y + GENERATION_GAP;
    }
  });
}

function clearManualPositions() {
  state.project.people.forEach((person) => {
    person.manualPosition = false;
  });
}

function avoidNodeCollisionsByGeneration() {
  const generations = computeGenerations();
  const groups = new Map();
  state.project.people.forEach((person) => {
    const generation = generations.get(person.id) ?? 0;
    if (!groups.has(generation)) groups.set(generation, []);
    groups.get(generation).push(person);
  });

  groups.forEach((people) => {
    const ordered = people.sort((a, b) => a.x - b.x || compareLayoutOrder(a, b));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const minX = previous.x + MIN_NODE_GAP;
      if (current.x < minX) {
        current.x = minX;
      }
    }
    const center = average(ordered.map((person) => person.x));
    const targetCenter = CANVAS_CENTER_X;
    const shift = targetCenter - center;
    ordered.forEach((person) => {
      person.x += shift;
    });
  });
}

function average(values) {
  if (values.length === 0) return NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function romanNumeral(value) {
  const table = [
    ["X", 10],
    ["IX", 9],
    ["V", 5],
    ["IV", 4],
    ["I", 1]
  ];
  let remaining = value;
  let result = "";
  table.forEach(([symbol, amount]) => {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  });
  return result || "I";
}

function computeGenerations() {
  const map = new Map();
  const proband = state.project.people.find((person) => person.proband) || state.project.people[0];
  if (!proband) return map;
  map.set(proband.id, 0);

  let changed = true;
  while (changed) {
    changed = false;
    state.project.relationships.forEach((rel) => {
      if (rel.type === "parentChild") {
        const parentGen = map.get(rel.parent);
        const childGen = map.get(rel.child);
        if (childGen !== undefined && parentGen === undefined) {
          map.set(rel.parent, childGen - 1);
          changed = true;
        } else if (parentGen !== undefined && childGen === undefined) {
          map.set(rel.child, parentGen + 1);
          changed = true;
        }
      }
      if (rel.type === "partner") {
        const gen1 = map.get(rel.person1);
        const gen2 = map.get(rel.person2);
        if (gen1 !== undefined && gen2 === undefined) {
          map.set(rel.person2, gen1);
          changed = true;
        } else if (gen2 !== undefined && gen1 === undefined) {
          map.set(rel.person1, gen2);
          changed = true;
        }
      }
    });
  }

  state.project.people.forEach((person) => {
    if (!map.has(person.id)) map.set(person.id, 0);
  });

  const min = Math.min(...map.values());
  if (min < 0) {
    map.forEach((value, key) => map.set(key, value - min));
  }
  return map;
}

function startDrag(event, personId) {
  event.preventDefault();
  state.selectedPersonId = personId;
  updateControls();
  const point = svgPoint(event);
  const person = getPerson(personId);
  state.dragging = {
    personId,
    dx: point.x - person.x,
    dy: point.y - person.y
  };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!state.dragging) return;
  const person = getPerson(state.dragging.personId);
  if (!person) return;
  const point = svgPoint(event);
  person.x = point.x - state.dragging.dx;
  person.y = point.y - state.dragging.dy;
  person.manualPosition = true;
  renderAll();
}

function endDrag() {
  if (!state.dragging) return;
  const draggedPersonId = state.dragging.personId;
  state.dragging = null;
  reorderGenerationByCurrentX(draggedPersonId);
  autoLayout(true);
  state.selectedPersonId = draggedPersonId;
  commitChange("同代顺序已调整");
}

function reorderGenerationByCurrentX(personId) {
  const generations = computeGenerations();
  const generation = generations.get(personId);
  if (generation === undefined) return;
  state.project.people
    .filter((person) => generations.get(person.id) === generation)
    .sort((a, b) => a.x - b.x || projectOrder(a.id) - projectOrder(b.id))
    .forEach((person, index) => {
      person.layoutOrder = index + 1;
      person.manualPosition = false;
    });
}

function svgPoint(event) {
  const rect = els.pedigreeSvg.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.offsetX) / state.scale,
    y: (event.clientY - rect.top - state.offsetY) / state.scale
  };
}

function onCanvasWheel(event) {
  event.preventDefault();
  const delta = event.deltaY > 0 ? -0.08 : 0.08;
  setZoom(state.scale + delta);
}

function setZoom(value) {
  state.scale = Math.min(1.8, Math.max(0.45, value));
  commitChange(`缩放 ${Math.round(state.scale * 100)}%`);
}

function resetView() {
  state.scale = 1;
  state.offsetX = 0;
  state.offsetY = 0;
  commitChange("视图已重置");
}

function autosave() {
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.project));
}

function restoreAutosave() {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (!raw) return false;
  try {
    const project = JSON.parse(raw);
    validateProject(project);
    state.project = normalizeProject(project);
    state.scale = state.project.viewport?.scale || 1;
    state.offsetX = state.project.viewport?.offsetX || 0;
    state.offsetY = state.project.viewport?.offsetY || 0;
    state.selectedPersonId = state.project.people[0]?.id || null;
    setStatus("已恢复自动保存");
    return true;
  } catch {
    localStorage.removeItem(AUTOSAVE_KEY);
    return false;
  }
}

function saveProjectJson() {
  const content = JSON.stringify(state.project, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  downloadBlob(blob, `${safeFileName(state.project.title)}_${timeStamp()}.json`);
  setStatus("JSON 已保存");
}

function loadProjectJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const project = JSON.parse(reader.result);
      validateProject(project);
      state.project = normalizeProject(project);
      state.selectedPersonId = state.project.people[0]?.id || null;
      state.scale = state.project.viewport?.scale || 1;
      state.offsetX = state.project.viewport?.offsetX || 0;
      state.offsetY = state.project.viewport?.offsetY || 0;
      commitChange("JSON 已加载");
    } catch (error) {
      setStatus(`加载失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

function validateProject(project) {
  if (!project || !Array.isArray(project.people) || !Array.isArray(project.relationships)) {
    throw new Error("不是有效的项目文件");
  }
}

function normalizeProject(project) {
  return {
    ...createProject(),
    ...project,
    settings: { ...createProject().settings, ...(project.settings || {}) },
    viewport: { ...createProject().viewport, ...(project.viewport || {}) },
    people: project.people.map((person, index) => ({
      ...createPerson(),
      ...person,
      diagnoses: Array.isArray(person.diagnoses) ? person.diagnoses : [],
      layoutOrder: Number.isFinite(person.layoutOrder) ? person.layoutOrder : index + 1
    }))
  };
}

async function exportPng() {
  try {
    const sourceSvg = els.pedigreeSvg.cloneNode(true);
    const bounds = getContentBounds();
    const padding = 70;
    const width = Math.max(600, bounds.width + padding * 2);
    const height = Math.max(420, bounds.height + padding * 2);
    sourceSvg.setAttribute("width", width);
    sourceSvg.setAttribute("height", height);
    sourceSvg.setAttribute("viewBox", `${bounds.x - padding} ${bounds.y - padding} ${width} ${height}`);
    sourceSvg.insertBefore(svgEl("rect", {
      x: bounds.x - padding,
      y: bounds.y - padding,
      width,
      height,
      fill: "#ffffff"
    }), sourceSvg.firstChild);

    const style = document.createElement("style");
    style.textContent = collectExportStyles();
    sourceSvg.insertBefore(style, sourceSvg.firstChild);

    const svgText = new XMLSerializer().serializeToString(sourceSvg);
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * 2;
      canvas.height = height * 2;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((pngBlob) => {
        downloadBlob(pngBlob, `${safeFileName(state.project.title)}_${timeStamp()}.png`);
        setStatus("PNG 已导出");
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("PNG 导出失败");
    };
    image.src = url;
  } catch (error) {
    setStatus(`导出失败：${error.message}`);
  }
}

function getContentBounds() {
  if (state.project.people.length === 0) {
    return { x: 0, y: 0, width: 600, height: 420 };
  }
  const xs = state.project.people.map((person) => person.x);
  const ys = state.project.people.map((person) => person.y);
  return {
    x: Math.min(...xs) - 60,
    y: Math.min(...ys) - 70,
    width: Math.max(...xs) - Math.min(...xs) + 120,
    height: Math.max(...ys) - Math.min(...ys) + 150
  };
}

function collectExportStyles() {
  return `
    .link-line,.descent-line,.individual-line,.marriage-line,.sibling-line{stroke:#2f3a42;stroke-width:2.2;fill:none;stroke-linecap:square}
    .person-symbol{stroke:#2f3a42;stroke-width:2.8}
    .person-symbol.unaffected{fill:#fff}
    .person-symbol.affected{fill:#2f3a42}
    .person-symbol.suspected{fill:url(#suspectedPattern)}
    .person-symbol.unknown{fill:#e2e8ec}
    .person-label{font:13px "Microsoft YaHei", Arial, sans-serif;fill:#172026;text-anchor:middle;dominant-baseline:hanging}
    .diagnosis-label{font:11px "Microsoft YaHei", Arial, sans-serif;fill:#65717b;text-anchor:middle;dominant-baseline:hanging}
    .generation-label{font:700 15px "Microsoft YaHei", Arial, sans-serif;fill:#65717b;text-anchor:middle;dominant-baseline:middle}
    .selected-ring{display:none}
    .deceased-line{stroke:#b42318;stroke-width:2.4;stroke-linecap:round}
    .proband-arrow{stroke:#b42318;stroke-width:2.4;fill:none;stroke-linecap:round}
    .empty-canvas-text{font:18px "Microsoft YaHei", Arial, sans-serif;fill:#65717b;text-anchor:middle}
  `;
}

function downloadBlob(blob, fileName) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function newProject() {
  if (state.project.people.length > 0 && !confirm("新建项目会清空当前画布，是否继续？")) {
    return;
  }
  state.project = createProject();
  state.selectedPersonId = null;
  state.scale = 1;
  state.offsetX = 0;
  state.offsetY = 0;
  commitChange("新项目已创建");
}

function safeFileName(value) {
  return (value || "家系图").replace(/[\\/:*?"<>|]/g, "_");
}

function timeStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function setStatus(message) {
  els.statusLine.textContent = message;
}
