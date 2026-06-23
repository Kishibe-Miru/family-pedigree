const svg = document.getElementById("pedigreeSvg");
const nodeLayer = document.getElementById("nodeLayer");
const relationshipLayer = document.getElementById("relationshipLayer");
const canvasWrap = document.getElementById("canvasWrap");
const statusText = document.getElementById("statusText");
const nodeContextMenu = document.getElementById("nodeContextMenu");
let contextMenuPersonId = null;
let submenuCloseTimer = null;

const form = {
  label: document.getElementById("personLabel"),
  sex: document.getElementById("personSex"),
  age: document.getElementById("personAge"),
  disease: document.getElementById("personDisease"),
  onset: document.getElementById("personOnset"),
  mental: document.getElementById("personMental"),
  suicide: document.getElementById("personSuicide"),
  substance: document.getElementById("personSubstance"),
  status: document.getElementById("personStatus"),
  generation: document.getElementById("personGeneration"),
  deceased: document.getElementById("personDeceased"),
  proband: document.getElementById("personProband"),
  notes: document.getElementById("personNotes"),
};

const layoutControls = {
  nodeSize: document.getElementById("nodeSizeRange"),
  nodeSizeValue: document.getElementById("nodeSizeValue"),
  generationSpacing: document.getElementById("generationSpacingRange"),
  generationSpacingValue: document.getElementById("generationSpacingValue"),
  siblingSpacing: document.getElementById("siblingSpacingRange"),
  siblingSpacingValue: document.getElementById("siblingSpacingValue"),
  layoutSpacing: document.getElementById("layoutSpacingRange"),
  layoutSpacingValue: document.getElementById("layoutSpacingValue"),
};

const DEFAULT_LAYOUT = {
  nodeSize: 56,
  generationSpacing: 200,
  siblingSpacing: 180,
  layoutSpacing: 190,
};

const state = {
  people: [],
  relationships: [],
  selectedPersonId: null,
  selectedRelationshipId: null,
  connectMode: false,
  pendingConnectionId: null,
  relationType: "partner",
  nextPersonNumber: 1,
  layout: { ...DEFAULT_LAYOUT },
};

const STORAGE_KEY = "local-pedigree-mvp";
const NS = "http://www.w3.org/2000/svg";
const GENERATIONS = [
  { index: 0, label: "I", name: "祖辈" },
  { index: 1, label: "II", name: "父母辈" },
  { index: 2, label: "III", name: "先证者/同胞" },
  { index: 3, label: "IV", name: "子代" },
  { index: 4, label: "V", name: "后代" },
];
const MIN_NODE_X = 180;
const MAX_NODE_X = 2200;
const CANVAS_WIDTH = 2400;
const CANVAS_HEIGHT = 1300;

function createSvgElement(tag, attrs = {}) {
  const element = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      element.setAttribute(key, String(value));
    }
  });
  return element;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;
  try {
    const parsed = JSON.parse(saved);
    Object.assign(state, parsed);
    state.layout = { ...DEFAULT_LAYOUT, ...(parsed.layout || {}) };
    state.connectMode = false;
    state.pendingConnectionId = null;
    state.people.forEach((person) => {
      person.mental = Boolean(person.mental);
      person.suicide = Boolean(person.suicide);
      person.substance = Boolean(person.substance);
      if (!Number.isInteger(person.generation)) {
        person.generation = generationFromY(person.y);
      }
      person.y = generationY(person.generation);
    });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function updateStatus(text) {
  statusText.textContent = text;
}

function getMousePosition(event) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(svg.getScreenCTM().inverse());
}

function addPerson(sex, x, y, fields = {}) {
  const generation = Number.isInteger(fields.generation) ? fields.generation : generationFromY(y);
  const person = {
    id: crypto.randomUUID(),
    label: fields.label || `成员 ${state.nextPersonNumber}`,
    sex,
    age: fields.age || "",
    disease: fields.disease || "",
    onset: fields.onset || "",
    mental: Boolean(fields.mental),
    suicide: Boolean(fields.suicide),
    substance: Boolean(fields.substance),
    status: fields.status || "unaffected",
    deceased: Boolean(fields.deceased),
    proband: Boolean(fields.proband),
    notes: fields.notes || "",
    generation,
    x: clampX(x),
    y: generationY(generation),
  };
  state.nextPersonNumber += 1;
  if (person.proband) {
    state.people.forEach((item) => {
      item.proband = false;
    });
  }
  state.people.push(person);
  selectPerson(person.id);
  refreshKinshipLabels();
  saveState();
  render();
}

function createPerson(sex, x, generation, fields = {}) {
  const person = {
    id: crypto.randomUUID(),
    label: fields.label || `成员 ${state.nextPersonNumber}`,
    sex,
    age: fields.age || "",
    disease: fields.disease || "",
    onset: fields.onset || "",
    mental: Boolean(fields.mental),
    suicide: Boolean(fields.suicide),
    substance: Boolean(fields.substance),
    status: fields.status || "unaffected",
    deceased: Boolean(fields.deceased),
    proband: Boolean(fields.proband),
    notes: fields.notes || "",
    generation: clampGeneration(generation),
    x: clampX(x),
    y: generationY(generation),
  };
  state.nextPersonNumber += 1;
  if (person.proband) {
    state.people.forEach((item) => {
      item.proband = false;
    });
  }
  state.people.push(person);
  return person;
}

function addRelationship(sourceId, targetId, type = state.relationType) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const added = addRelationshipRecord(sourceId, targetId, type);
  if (!added) {
    updateStatus("这两个人已经存在相同关系");
    return;
  }
  refreshLayoutAfterRelationship(type);
  normalizeSiblingSpacing();
  refreshKinshipLabels();
  state.pendingConnectionId = null;
  state.connectMode = false;
  updateConnectButton();
  saveState();
  render();
  updateStatus("已建立关系线");
}

function addRelationshipRecord(sourceId, targetId, type) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  normalizeGenerationsForRelationship(sourceId, targetId, type);
  const exists = state.relationships.some(
    (relation) =>
      relation.type === type &&
      ((relation.sourceId === sourceId && relation.targetId === targetId) ||
        (relation.sourceId === targetId && relation.targetId === sourceId)),
  );
  if (exists) return false;
  state.relationships.push({
    id: crypto.randomUUID(),
    sourceId,
    targetId,
    type,
  });
  return true;
}

function addRelative(personId, relativeType) {
  const person = getPerson(personId);
  if (!person) return;
  if (relativeType === "markProband") {
    markAsProband(person.id);
    return;
  }
  if (relativeType === "father") {
    addParentForPerson(person, "male", "父亲");
  }
  if (relativeType === "mother") {
    addParentForPerson(person, "female", "母亲");
  }
  if (relativeType === "husband") {
    addSpouseForPerson(person, "male", "丈夫");
  }
  if (relativeType === "wife") {
    addSpouseForPerson(person, "female", "妻子");
  }
  if (relativeType === "brother") {
    addSiblingForPerson(person, "male", "兄弟");
  }
  if (relativeType === "sister") {
    addSiblingForPerson(person, "female", "姐妹");
  }
  if (relativeType === "son") {
    addChildForPerson(person, "male", "儿子");
  }
  if (relativeType === "daughter") {
    addChildForPerson(person, "female", "女儿");
  }
  layoutFamilyGroups();
  normalizeSiblingSpacing();
  resolveLayoutConflicts();
  enforcePedigreeLineRules();
  refreshKinshipLabels();
  centerDiagramOnCanvas();
  saveState();
  render();
  scrollDiagramIntoView();
}

function markAsProband(personId) {
  const person = getPerson(personId);
  if (!person) return;
  state.people.forEach((item) => {
    item.proband = item.id === personId;
  });
  refreshKinshipLabels();
  selectPerson(personId);
  saveState();
  render();
  updateStatus(`已将${person.label}标记为先证者`);
}

function addParentForPerson(person, sex, label) {
  const parentGeneration = clampGeneration((person.generation ?? generationFromY(person.y)) - 1);
  const offset = sex === "male" ? -state.layout.siblingSpacing / 2 : state.layout.siblingSpacing / 2;
  const parent = createPerson(sex, person.x + offset, parentGeneration, { label });
  addRelationshipRecord(parent.id, person.id, "parentChild");
  connectCoParentIfPresent(parent, person);
  selectPerson(parent.id);
  updateStatus(`已添加${label}并建立亲子关系`);
}

function connectCoParentIfPresent(parent, child) {
  const coParents = state.relationships
    .filter((relation) => relation.type === "parentChild" && relation.targetId === child.id && relation.sourceId !== parent.id)
    .map((relation) => getPerson(relation.sourceId))
    .filter(Boolean)
    .filter((candidate) => candidate.generation === parent.generation);
  const oppositeSex = coParents.find((candidate) => candidate.sex !== parent.sex);
  if (oppositeSex) {
    addRelationshipRecord(oppositeSex.id, parent.id, "partner");
  }
}

function addSpouseForPerson(person, sex, label) {
  const direction = chooseSpouseDirection(person, sex);
  const spouse = createPerson(
    sex,
    person.x + direction * state.layout.siblingSpacing,
    person.generation ?? generationFromY(person.y),
    { label },
  );
  addRelationshipRecord(person.id, spouse.id, "partner");
  selectPerson(spouse.id);
  updateStatus(`已添加${label}并建立配偶关系`);
}

function chooseSpouseDirection(person, spouseSex) {
  const preferred = spouseSex === "male" ? -1 : 1;
  const generation = person.generation ?? generationFromY(person.y);
  const sameGeneration = state.people.filter(
    (candidate) => candidate.id !== person.id && (candidate.generation ?? generationFromY(candidate.y)) === generation,
  );
  const preferredBlocked = sameGeneration.some(
    (candidate) => Math.abs(candidate.x - (person.x + preferred * state.layout.siblingSpacing)) < state.layout.siblingSpacing * 0.7,
  );
  if (!preferredBlocked) return preferred;
  const alternate = -preferred;
  const alternateBlocked = sameGeneration.some(
    (candidate) => Math.abs(candidate.x - (person.x + alternate * state.layout.siblingSpacing)) < state.layout.siblingSpacing * 0.7,
  );
  return alternateBlocked ? preferred : alternate;
}

function addSiblingForPerson(person, sex, label) {
  const sibling = createPerson(
    sex,
    person.x + state.layout.siblingSpacing,
    person.generation ?? generationFromY(person.y),
    { label },
  );
  const parentRelations = state.relationships.filter(
    (relation) => relation.type === "parentChild" && relation.targetId === person.id,
  );
  parentRelations.forEach((relation) => {
    addRelationshipRecord(relation.sourceId, sibling.id, "parentChild");
  });
  addRelationshipRecord(person.id, sibling.id, "sibling");
  selectPerson(sibling.id);
  updateStatus(`已添加${label}并建立同胞关系`);
}

function addChildForPerson(person, sex, label) {
  const child = createPerson(
    sex,
    person.x,
    clampGeneration((person.generation ?? generationFromY(person.y)) + 1),
    { label },
  );
  addRelationshipRecord(person.id, child.id, "parentChild");
  const spouses = getPartners(person.id);
  spouses.forEach((spouse) => {
    addRelationshipRecord(spouse.id, child.id, "parentChild");
  });
  selectPerson(child.id);
  updateStatus(`已添加${label}并建立亲子关系`);
}

function getPartners(personId) {
  return state.relationships
    .filter((relation) => relation.type === "partner" && (relation.sourceId === personId || relation.targetId === personId))
    .map((relation) => getPerson(relation.sourceId === personId ? relation.targetId : relation.sourceId))
    .filter(Boolean);
}

function refreshLayoutAfterRelationship(type) {
  if (type === "partner" || type === "parentChild") {
    layoutFamilyGroups();
  }
  if (type === "sibling") {
    normalizeSiblingSpacing();
    centerChildrenUnderParents();
  }
  resolveLayoutConflicts();
  enforcePedigreeLineRules();
}

function normalizeGenerationsForRelationship(sourceId, targetId, type) {
  const source = getPerson(sourceId);
  const target = getPerson(targetId);
  if (!source || !target) return;
  const sourceGeneration = source.generation ?? generationFromY(source.y);
  if (type === "partner" || type === "sibling") {
    target.generation = sourceGeneration;
  }
  if (type === "parentChild") {
    target.generation = clampGeneration(sourceGeneration + 1);
  }
  source.y = generationY(source.generation ?? sourceGeneration);
  target.y = generationY(target.generation);
}

function getPerson(id) {
  return state.people.find((person) => person.id === id);
}

function selectPerson(id) {
  state.selectedPersonId = id;
  state.selectedRelationshipId = null;
  fillInspector();
  render();
}

function selectRelationship(id) {
  state.selectedRelationshipId = id;
  state.selectedPersonId = null;
  fillInspector();
  render();
}

function fillInspector() {
  const person = getPerson(state.selectedPersonId);
  const disabled = !person;
  Object.values(form).forEach((input) => {
    input.disabled = disabled;
  });
  if (!person) {
    form.label.value = "";
    form.sex.value = "unknown";
    form.age.value = "";
    form.disease.value = "";
    form.onset.value = "";
    form.mental.checked = false;
    form.suicide.checked = false;
    form.substance.checked = false;
    form.status.value = "unaffected";
    form.generation.value = "2";
    form.deceased.checked = false;
    form.proband.checked = false;
    form.notes.value = "";
    return;
  }
  form.label.value = person.label;
  form.sex.value = person.sex;
  form.age.value = person.age;
  form.disease.value = person.disease;
  form.onset.value = person.onset;
  form.mental.checked = Boolean(person.mental);
  form.suicide.checked = Boolean(person.suicide);
  form.substance.checked = Boolean(person.substance);
  form.status.value = person.status;
  form.generation.value = String(person.generation ?? generationFromY(person.y));
  form.deceased.checked = person.deceased;
  form.proband.checked = person.proband;
  form.notes.value = person.notes;
}

function updateSelectedPerson() {
  const person = getPerson(state.selectedPersonId);
  if (!person) return;
  person.label = form.label.value.trim() || "未命名";
  person.sex = form.sex.value;
  person.age = form.age.value.trim();
  person.disease = form.disease.value.trim();
  person.onset = form.onset.value.trim();
  person.mental = form.mental.checked;
  person.suicide = form.suicide.checked;
  person.substance = form.substance.checked;
  person.status = form.status.value;
  person.generation = Number(form.generation.value);
  person.y = generationY(person.generation);
  person.deceased = form.deceased.checked;
  if (form.proband.checked) {
    state.people.forEach((item) => {
      item.proband = item.id === person.id;
    });
  } else {
    person.proband = false;
  }
  person.notes = form.notes.value.trim();
  const activeId = document.activeElement?.id;
  if (["personProband", "personSex", "personGeneration"].includes(activeId)) {
    refreshKinshipLabels();
  }
  saveState();
  render();
}

function render() {
  relationshipLayer.replaceChildren();
  nodeLayer.replaceChildren();
  renderGenerationGuides();
  renderRelationships();
  state.people.forEach(renderPerson);
}

function renderGenerationGuides() {
  GENERATIONS.forEach((generation, index) => {
    const y = generationY(generation.index);
    const bandY = index === 0 ? 40 : (generationY(index - 1) + y) / 2;
    const next = GENERATIONS[index + 1];
    const bandHeight = next ? (generationY(next.index) + y) / 2 - bandY : 1040 - bandY;
    relationshipLayer.appendChild(createSvgElement("rect", {
      x: 0,
      y: bandY,
      width: CANVAS_WIDTH,
      height: bandHeight,
      class: "generation-band",
    }));
    relationshipLayer.appendChild(createSvgElement("line", {
      x1: 80,
      y1: y,
      x2: CANVAS_WIDTH - 80,
      y2: y,
      class: "generation-line",
    }));
    const label = createSvgElement("text", {
      x: 32,
      y: y + 6,
      class: "generation-label",
    });
    label.textContent = generation.label;
    relationshipLayer.appendChild(label);
  });
}

function renderRelationships() {
  const partnerRelations = state.relationships.filter((relation) => relation.type === "partner");
  const siblingRelations = state.relationships.filter((relation) => relation.type === "sibling");
  const parentChildRelations = state.relationships.filter((relation) => relation.type === "parentChild");
  const groupedChildIds = new Set();

  partnerRelations.forEach((relation) => {
    renderPartnerRelationship(relation);
    const source = getPerson(relation.sourceId);
    const target = getPerson(relation.targetId);
    if (!source || !target) return;

    const children = parentChildRelations
      .filter(
        (candidate) =>
          candidate.sourceId === source.id ||
          candidate.sourceId === target.id,
      )
      .map((candidate) => candidate.targetId)
      .filter((childId, index, ids) => ids.indexOf(childId) === index)
      .map(getPerson)
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);

    if (children.length) {
      renderChildGroup(relation, source, target, children, parentChildRelations);
      children.forEach((child) => groupedChildIds.add(child.id));
    }
  });

  parentChildRelations.forEach((relation) => {
    if (groupedChildIds.has(relation.targetId)) return;
    renderSingleParentChild(relation);
  });

  siblingRelations.forEach((relation) => {
    const hasParentGroup =
      groupedChildIds.has(relation.sourceId) &&
      groupedChildIds.has(relation.targetId);
    if (!hasParentGroup) renderSiblingRelationship(relation);
  });
}

function renderPartnerRelationship(relation) {
  const source = getPerson(relation.sourceId);
  const target = getPerson(relation.targetId);
  if (!source || !target) return;

  const line = createSvgElement("line", {
    x1: source.x,
    y1: source.y,
    x2: target.x,
    y2: target.y,
    class: `relationship-line partner ${state.selectedRelationshipId === relation.id ? "selected" : ""}`,
  });
  bindRelationshipClick(line, relation);
  relationshipLayer.appendChild(line);
}

function renderChildGroup(partnerRelation, parentA, parentB, children, parentChildRelations) {
  const metrics = getNodeMetrics();
  const midX = (parentA.x + parentB.x) / 2;
  const parentLineY = (parentA.y + parentB.y) / 2;
  const childLineY = Math.min(...children.map((child) => child.y)) - metrics.childLineOffset;
  const minChildX = Math.min(...children.map((child) => child.x));
  const maxChildX = Math.max(...children.map((child) => child.x));

  const vertical = createSvgElement("line", {
    x1: midX,
    y1: parentLineY,
    x2: midX,
    y2: childLineY,
    class: "relationship-guide",
  });
  bindRelationshipClick(vertical, partnerRelation);
  relationshipLayer.appendChild(vertical);

  const childBarStartX = children.length > 1 ? minChildX : Math.min(midX, children[0].x);
  const childBarEndX = children.length > 1 ? maxChildX : Math.max(midX, children[0].x);
  if (Math.abs(childBarStartX - childBarEndX) > 1) {
    relationshipLayer.appendChild(createSvgElement("line", {
      x1: childBarStartX,
      y1: childLineY,
      x2: childBarEndX,
      y2: childLineY,
      class: "relationship-guide",
    }));
  }

  children.forEach((child) => {
    const childRelation = parentChildRelations.find(
      (relation) =>
        relation.targetId === child.id &&
        (relation.sourceId === parentA.id || relation.sourceId === parentB.id),
    );
    const line = createSvgElement("line", {
      x1: child.x,
      y1: childLineY,
      x2: child.x,
      y2: child.y - getShapeConnectionOffset(child),
      class: `relationship-line parentChild ${state.selectedRelationshipId === childRelation?.id ? "selected" : ""}`,
    });
    if (childRelation) bindRelationshipClick(line, childRelation);
    relationshipLayer.appendChild(line);
  });
}

function renderSingleParentChild(relation) {
  const parent = getPerson(relation.sourceId);
  const child = getPerson(relation.targetId);
  if (!parent || !child) return;
  const metrics = getNodeMetrics();
  const parentOffset = getShapeConnectionOffset(parent);
  const childOffset = getShapeConnectionOffset(child);
  const elbowY = (parent.y + child.y) / 2;
  const path = createSvgElement("path", {
    d: `M ${parent.x} ${parent.y + parentOffset} V ${elbowY} H ${child.x} V ${child.y - childOffset}`,
    class: `relationship-line parentChild ${state.selectedRelationshipId === relation.id ? "selected" : ""}`,
  });
  bindRelationshipClick(path, relation);
  relationshipLayer.appendChild(path);
}

function renderSiblingRelationship(relation) {
  const source = getPerson(relation.sourceId);
  const target = getPerson(relation.targetId);
  if (!source || !target) return;
  const metrics = getNodeMetrics();
  const lineY = Math.min(source.y, target.y) - metrics.childLineOffset;
  const horizontal = createSvgElement("line", {
    x1: source.x,
    y1: lineY,
    x2: target.x,
    y2: lineY,
    class: `relationship-line sibling ${state.selectedRelationshipId === relation.id ? "selected" : ""}`,
  });
  bindRelationshipClick(horizontal, relation);
  relationshipLayer.appendChild(horizontal);
  [source, target].forEach((person) => {
    relationshipLayer.appendChild(createSvgElement("line", {
      x1: person.x,
      y1: lineY,
      x2: person.x,
      y2: person.y - getShapeConnectionOffset(person),
      class: "relationship-guide",
    }));
  });
}

function bindRelationshipClick(element, relation) {
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    selectRelationship(relation.id);
    updateStatus(`已选中${relationName(relation.type)}关系，可删除`);
  });
}

function renderPerson(person) {
  const metrics = getNodeMetrics();
  const group = createSvgElement("g", {
    class: `node-group ${state.selectedPersonId === person.id ? "selected" : ""}`,
    transform: `translate(${person.x}, ${person.y})`,
    "data-id": person.id,
  });

  const ring = createSvgElement("rect", {
    class: "selection-ring",
    x: -metrics.selectionWidth / 2,
    y: -metrics.shapeRadius - 14,
    width: metrics.selectionWidth,
    height: metrics.selectionHeight,
    rx: 8,
  });
  group.appendChild(ring);

  group.appendChild(createShape(person));

  if (person.deceased) {
    group.appendChild(createSvgElement("line", {
      class: "deceased-line",
      x1: -metrics.shapeRadius,
      y1: metrics.shapeRadius,
      x2: metrics.shapeRadius,
      y2: -metrics.shapeRadius,
    }));
  }

  if (person.proband) {
    group.appendChild(createSvgElement("line", {
      class: "proband-arrow",
      x1: -metrics.shapeRadius - 46,
      y1: metrics.shapeRadius + 20,
      x2: -metrics.shapeRadius - 8,
      y2: metrics.shapeRadius - 8,
    }));
  }

  const label = createSvgElement("text", { class: "node-label", x: 0, y: metrics.labelY });
  label.textContent = person.label;
  group.appendChild(label);

  const meta = createSvgElement("text", { class: "node-meta", x: 0, y: metrics.metaY });
  meta.textContent = buildMeta(person);
  group.appendChild(meta);

  group.addEventListener("mousedown", startDrag);
  group.addEventListener("click", handlePersonClick);
  group.addEventListener("contextmenu", handlePersonContextMenu);
  nodeLayer.appendChild(group);
}

function createShape(person) {
  const fill = getStatusFill(person);
  const metrics = getNodeMetrics();
  if (person.sex === "female") {
    return createSvgElement("circle", {
      cx: 0,
      cy: 0,
      r: metrics.shapeRadius,
      fill,
      stroke: "#172033",
      "stroke-width": 2.5,
    });
  }
  if (person.sex === "unknown") {
    return createSvgElement("rect", {
      x: -metrics.diamondHalf,
      y: -metrics.diamondHalf,
      width: metrics.diamondHalf * 2,
      height: metrics.diamondHalf * 2,
      transform: "rotate(45)",
      fill,
      stroke: "#172033",
      "stroke-width": 2.5,
    });
  }
  return createSvgElement("rect", {
    x: -metrics.shapeRadius,
    y: -metrics.shapeRadius,
    width: metrics.nodeSize,
    height: metrics.nodeSize,
    rx: 2,
    fill,
    stroke: "#172033",
    "stroke-width": 2.5,
  });
}

function getNodeMetrics() {
  const nodeSize = Number(state.layout.nodeSize) || DEFAULT_LAYOUT.nodeSize;
  const shapeRadius = nodeSize / 2;
  return {
    nodeSize,
    shapeRadius,
    diamondHalf: nodeSize * 0.38,
    connectionOffset: shapeRadius,
    childLineOffset: shapeRadius + 50,
    labelY: shapeRadius + 28,
    metaY: shapeRadius + 46,
    selectionWidth: Math.max(84, nodeSize + 42),
    selectionHeight: nodeSize + 86,
  };
}

function getShapeConnectionOffset(person) {
  const metrics = getNodeMetrics();
  if (person.sex === "unknown") {
    return metrics.diamondHalf * Math.SQRT2;
  }
  return metrics.shapeRadius;
}

function getStatusFill(person) {
  if (person.status === "affected" || person.mental || person.suicide) return "#111827";
  if (person.status === "carrier") return "#f59e0b";
  if (person.status === "unknown") return "#dbe3ee";
  return "#ffffff";
}

function buildMeta(person) {
  const parts = [];
  if (person.age) parts.push(person.age);
  const clinical = buildClinicalText(person);
  if (clinical) parts.push(clinical);
  if (person.onset) parts.push(`发病${person.onset}`);
  return parts.join(" / ");
}

function buildClinicalText(person) {
  const tags = [];
  if (person.disease) tags.push(person.disease);
  if (person.mental) tags.push("精神障碍");
  if (person.suicide) tags.push("自杀史");
  if (person.substance) tags.push("物质使用");
  return tags.slice(0, 3).join("、");
}

function relationName(type) {
  return {
    partner: "配偶",
    parentChild: "亲子",
    sibling: "同胞",
  }[type];
}

function refreshKinshipLabels() {
  const proband = state.people.find((person) => person.proband);
  if (!proband) return;
  const connectedIds = getConnectedPersonIds(proband.id);
  const graph = buildKinshipGraph();
  const labels = new Map();
  labels.set(proband.id, "先证者");

  const probandParents = graph.parentsOf(proband.id);
  const probandChildren = graph.childrenOf(proband.id);
  const probandSiblings = graph.siblingsOf(proband.id);
  const probandPartners = graph.partnersOf(proband.id);

  probandParents.forEach((parent) => {
    labels.set(parent.id, parent.sex === "female" ? "母亲" : "父亲");
  });

  probandPartners.forEach((partner) => {
    labels.set(partner.id, partner.sex === "male" ? "丈夫" : partner.sex === "female" ? "妻子" : "配偶");
  });

  probandChildren.forEach((child) => {
    labels.set(child.id, child.sex === "female" ? "女儿" : child.sex === "male" ? "儿子" : "子女");
  });

  labelSiblings(labels, proband, probandSiblings);
  labelGrandparents(labels, graph, probandParents);
  labelAuntsUnclesAndCousins(labels, graph, proband, probandParents);
  labelNiecesAndNephews(labels, graph, probandSiblings);
  labelInLaws(labels, graph, proband, probandSiblings);

  state.people.forEach((person) => {
    if (!connectedIds.has(person.id)) {
      if (isKinshipAutoLabel(person.label)) person.label = "";
      return;
    }
    const label = labels.get(person.id);
    if (label) {
      person.label = label;
    } else if (isKinshipAutoLabel(person.label)) {
      person.label = "";
    }
  });
  fillInspector();
}

function getConnectedPersonIds(startId) {
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    state.relationships.forEach((relation) => {
      let next = null;
      if (relation.sourceId === current) next = relation.targetId;
      if (relation.targetId === current) next = relation.sourceId;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    });
  }
  return seen;
}

function isKinshipAutoLabel(label) {
  if (!label) return false;
  const exact = new Set([
    "先证者", "父亲", "母亲", "祖父", "祖母", "外祖父", "外祖母",
    "丈夫", "妻子", "配偶", "儿子", "女儿", "弟弟", "妹妹",
    "年长同胞", "年幼同胞", "伯父", "叔叔", "姑姑", "舅舅", "姨妈",
    "堂亲", "表亲", "侄子", "侄女", "外甥", "外甥女", "嫂子", "弟媳", "姐夫", "妹夫",
  ]);
  if (exact.has(label)) return true;
  return /^[大二三四五六七八九十0-9]+[哥姐]$/.test(label) ||
    /^堂[兄弟姐妹]$/.test(label) ||
    /^表[兄弟姐妹]$/.test(label);
}

function buildKinshipGraph() {
  const parentChild = state.relationships.filter((relation) => relation.type === "parentChild");
  const partner = state.relationships.filter((relation) => relation.type === "partner");
  const explicitSibling = state.relationships.filter((relation) => relation.type === "sibling");
  return {
    parentsOf(personId) {
      return parentChild
        .filter((relation) => relation.targetId === personId)
        .map((relation) => getPerson(relation.sourceId))
        .filter(Boolean);
    },
    childrenOf(personId) {
      return parentChild
        .filter((relation) => relation.sourceId === personId)
        .map((relation) => getPerson(relation.targetId))
        .filter(Boolean);
    },
    partnersOf(personId) {
      return partner
        .filter((relation) => relation.sourceId === personId || relation.targetId === personId)
        .map((relation) => getPerson(relation.sourceId === personId ? relation.targetId : relation.sourceId))
        .filter(Boolean);
    },
    siblingsOf(personId) {
      const siblingIds = new Set();
      explicitSibling.forEach((relation) => {
        if (relation.sourceId === personId) siblingIds.add(relation.targetId);
        if (relation.targetId === personId) siblingIds.add(relation.sourceId);
      });
      const parentIds = parentChild
        .filter((relation) => relation.targetId === personId)
        .map((relation) => relation.sourceId);
      parentIds.forEach((parentId) => {
        parentChild
          .filter((relation) => relation.sourceId === parentId && relation.targetId !== personId)
          .forEach((relation) => siblingIds.add(relation.targetId));
      });
      return Array.from(siblingIds).map(getPerson).filter(Boolean);
    },
  };
}

function labelSiblings(labels, proband, siblings) {
  const olderBrothers = siblings
    .filter((person) => person.sex === "male" && person.x < proband.x)
    .sort((a, b) => a.x - b.x);
  const olderSisters = siblings
    .filter((person) => person.sex === "female" && person.x < proband.x)
    .sort((a, b) => a.x - b.x);
  const youngerBrothers = siblings
    .filter((person) => person.sex === "male" && person.x >= proband.x)
    .sort((a, b) => a.x - b.x);
  const youngerSisters = siblings
    .filter((person) => person.sex === "female" && person.x >= proband.x)
    .sort((a, b) => a.x - b.x);
  siblings.forEach((sibling) => {
    if (sibling.x < proband.x) {
      if (sibling.sex === "male") {
        labels.set(sibling.id, olderRankLabel(olderBrothers, sibling.id, "哥"));
      } else if (sibling.sex === "female") {
        labels.set(sibling.id, olderRankLabel(olderSisters, sibling.id, "姐"));
      } else {
        labels.set(sibling.id, "年长同胞");
      }
    } else if (sibling.sex === "male") {
      labels.set(sibling.id, youngerRankLabel(youngerBrothers, sibling.id, "弟"));
    } else if (sibling.sex === "female") {
      labels.set(sibling.id, youngerRankLabel(youngerSisters, sibling.id, "妹"));
    } else {
      labels.set(sibling.id, "年幼同胞");
    }
  });
}

function olderRankLabel(group, personId, suffix) {
  const index = group.findIndex((person) => person.id === personId);
  if (index === 0) return `大${suffix}`;
  if (index === 1) return `二${suffix}`;
  if (index === 2) return `三${suffix}`;
  return `${index + 1}${suffix}`;
}

function youngerRankLabel(group, personId, suffix) {
  if (group.length === 1) return suffix === "弟" ? "弟弟" : "妹妹";
  const index = group.findIndex((person) => person.id === personId);
  if (index === 0) return `大${suffix}`;
  if (index === 1) return `二${suffix}`;
  if (index === 2) return `三${suffix}`;
  return `${index + 1}${suffix}`;
}

function labelGrandparents(labels, graph, probandParents) {
  probandParents.forEach((parent) => {
    graph.parentsOf(parent.id).forEach((grandparent) => {
      if (parent.sex === "female") {
        labels.set(grandparent.id, grandparent.sex === "female" ? "外祖母" : "外祖父");
      } else {
        labels.set(grandparent.id, grandparent.sex === "female" ? "祖母" : "祖父");
      }
    });
  });
}

function labelAuntsUnclesAndCousins(labels, graph, proband, probandParents) {
  probandParents.forEach((parent) => {
    const parentSiblings = graph.siblingsOf(parent.id);
    parentSiblings.forEach((relative) => {
      const side = parent.sex === "female" ? "maternal" : "paternal";
      const isOlderThanParent = relative.x < parent.x;
      let relativeLabel = "";
      if (side === "paternal") {
        if (relative.sex === "male") relativeLabel = isOlderThanParent ? "伯父" : "叔叔";
        if (relative.sex === "female") relativeLabel = "姑姑";
      } else {
        if (relative.sex === "male") relativeLabel = "舅舅";
        if (relative.sex === "female") relativeLabel = "姨妈";
      }
      if (relativeLabel) labels.set(relative.id, relativeLabel);
      const cousinPrefix = side === "paternal" && relative.sex === "male" ? "堂" : "表";
      graph.childrenOf(relative.id).forEach((cousin) => {
        labels.set(cousin.id, cousinLabel(cousinPrefix, cousin, proband));
      });
    });
  });
}

function cousinLabel(prefix, cousin, proband) {
  const older = cousin.x < proband.x;
  if (cousin.sex === "male") return `${prefix}${older ? "兄" : "弟"}`;
  if (cousin.sex === "female") return `${prefix}${older ? "姐" : "妹"}`;
  return `${prefix}亲`;
}

function labelNiecesAndNephews(labels, graph, probandSiblings) {
  probandSiblings.forEach((sibling) => {
    graph.childrenOf(sibling.id).forEach((child) => {
      if (child.sex === "male") labels.set(child.id, sibling.sex === "male" ? "侄子" : "外甥");
      if (child.sex === "female") labels.set(child.id, sibling.sex === "male" ? "侄女" : "外甥女");
    });
  });
}

function labelInLaws(labels, graph, proband, probandSiblings) {
  probandSiblings.forEach((sibling) => {
    graph.partnersOf(sibling.id).forEach((partner) => {
      if (labels.has(partner.id)) return;
      if (sibling.x < proband.x) {
        labels.set(partner.id, sibling.sex === "male" ? "嫂子" : "姐夫");
      } else {
        labels.set(partner.id, sibling.sex === "male" ? "弟媳" : "妹夫");
      }
    });
  });
}

let dragState = null;

function startDrag(event) {
  if (event.button !== 0) return;
  if (state.connectMode) return;
  hideContextMenu();
  event.preventDefault();
  const group = event.currentTarget;
  const person = getPerson(group.dataset.id);
  const point = getMousePosition(event);
  dragState = {
    id: person.id,
    moved: false,
    startX: point.x,
    startY: point.y,
    dx: point.x - person.x,
    dy: point.y - person.y,
  };
  selectPerson(person.id);
  window.addEventListener("mousemove", dragPerson);
  window.addEventListener("mouseup", stopDrag);
}

function dragPerson(event) {
  if (!dragState) return;
  const person = getPerson(dragState.id);
  const point = getMousePosition(event);
  const distance = Math.hypot(point.x - dragState.startX, point.y - dragState.startY);
  if (!dragState.moved && distance < 4) return;
  dragState.moved = true;
  const proposedY = point.y - dragState.dy;
  person.generation = generationFromY(proposedY);
  person.x = snapX(point.x - dragState.dx);
  person.y = generationY(person.generation);
  render();
}

function stopDrag() {
  if (!dragState) return;
  const moved = dragState.moved;
  const id = dragState.id;
  dragState = null;
  if (moved) {
    normalizeSiblingSpacing(id);
    resolveLayoutConflicts();
    enforcePedigreeLineRules();
    refreshKinshipLabels();
    saveState();
    render();
  }
  window.removeEventListener("mousemove", dragPerson);
  window.removeEventListener("mouseup", stopDrag);
}

function handlePersonClick(event) {
  event.stopPropagation();
  hideContextMenu();
  const id = event.currentTarget.dataset.id;
  if (!state.connectMode) {
    selectPerson(id);
    updateStatus("已选中人员，可在右侧编辑");
    return;
  }
  if (!state.pendingConnectionId) {
    state.pendingConnectionId = id;
    selectPerson(id);
    updateStatus("请选择第二个人完成连线");
    return;
  }
  if (state.pendingConnectionId === id) {
    updateStatus("请选择另一个人完成连线");
    return;
  }
  addRelationship(state.pendingConnectionId, id);
}

function handlePersonContextMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.currentTarget.dataset.id;
  selectPerson(id);
  openContextMenu(id, event.clientX, event.clientY);
}

function openContextMenu(personId, clientX, clientY) {
  contextMenuPersonId = personId;
  closeRelativeSubmenu();
  nodeContextMenu.hidden = false;
  const menuWidth = nodeContextMenu.offsetWidth || 150;
  const menuHeight = nodeContextMenu.offsetHeight || 120;
  const left = Math.min(clientX, window.innerWidth - menuWidth - 12);
  const top = Math.min(clientY, window.innerHeight - menuHeight - 12);
  nodeContextMenu.style.left = `${Math.max(8, left)}px`;
  nodeContextMenu.style.top = `${Math.max(8, top)}px`;
}

function hideContextMenu() {
  nodeContextMenu.hidden = true;
  contextMenuPersonId = null;
  closeRelativeSubmenu();
}

function openRelativeSubmenu() {
  clearTimeout(submenuCloseTimer);
  nodeContextMenu.querySelector(".context-submenu")?.classList.add("open");
}

function scheduleCloseRelativeSubmenu() {
  clearTimeout(submenuCloseTimer);
  submenuCloseTimer = setTimeout(() => {
    closeRelativeSubmenu();
  }, 450);
}

function closeRelativeSubmenu() {
  clearTimeout(submenuCloseTimer);
  nodeContextMenu.querySelector(".context-submenu")?.classList.remove("open");
}

function deleteSelected() {
  if (state.selectedPersonId) {
    const id = state.selectedPersonId;
    state.people = state.people.filter((person) => person.id !== id);
    state.relationships = state.relationships.filter(
      (relation) => relation.sourceId !== id && relation.targetId !== id,
    );
    state.selectedPersonId = null;
    fillInspector();
    updateStatus("已删除人员");
  } else if (state.selectedRelationshipId) {
    state.relationships = state.relationships.filter((relation) => relation.id !== state.selectedRelationshipId);
    state.selectedRelationshipId = null;
    updateStatus("已删除关系线");
  }
  refreshKinshipLabels();
  saveState();
  render();
}

function updateConnectButton() {
  const button = document.getElementById("connectModeButton");
  button.classList.toggle("active", state.connectMode);
  button.textContent = state.connectMode ? "取消连接" : "连接两人";
}

function addTemplate() {
  state.people = [];
  state.relationships = [];
  state.nextPersonNumber = 1;
  const template = [
    ["male", 520, 160, { label: "祖父", generation: 0 }],
    ["female", 700, 160, { label: "祖母", generation: 0 }],
    ["male", 520, 360, { label: "父亲", generation: 1 }],
    ["female", 700, 360, { label: "母亲", generation: 1 }],
    ["male", 520, 560, { label: "先证者", generation: 2, proband: true, status: "affected", disease: "目标疾病" }],
    ["female", 700, 560, { label: "姐妹", generation: 2 }],
    ["unknown", 880, 560, { label: "同胞", generation: 2 }],
  ];
  template.forEach(([sex, x, y, fields]) => addPerson(sex, x, y, fields));
  const [gf, gm, father, mother, proband, sister, sibling] = state.people;
  state.relationships.push(
    { id: crypto.randomUUID(), sourceId: gf.id, targetId: gm.id, type: "partner" },
    { id: crypto.randomUUID(), sourceId: gf.id, targetId: father.id, type: "parentChild" },
    { id: crypto.randomUUID(), sourceId: gm.id, targetId: father.id, type: "parentChild" },
    { id: crypto.randomUUID(), sourceId: father.id, targetId: mother.id, type: "partner" },
    { id: crypto.randomUUID(), sourceId: father.id, targetId: proband.id, type: "parentChild" },
    { id: crypto.randomUUID(), sourceId: mother.id, targetId: proband.id, type: "parentChild" },
    { id: crypto.randomUUID(), sourceId: proband.id, targetId: sister.id, type: "sibling" },
    { id: crypto.randomUUID(), sourceId: proband.id, targetId: sibling.id, type: "sibling" },
  );
  selectPerson(proband.id);
  saveState();
  render();
  updateStatus("已生成三代示例，可继续拖拽调整");
}

function autoLayout() {
  if (!state.people.length) return;

  const proband = state.people.find((person) => person.proband) || state.people[0];
  const connectedIds = getConnectedPersonIds(proband.id);
  const generation = new Map(state.people.map((person) => [person.id, person.generation ?? 2]));
  const parentChildRelations = state.relationships.filter((relation) => relation.type === "parentChild");
  const partnerRelations = state.relationships.filter((relation) => relation.type === "partner");
  const siblingRelations = state.relationships.filter((relation) => relation.type === "sibling");
  generation.set(proband.id, 2);

  for (let pass = 0; pass < state.people.length + 2; pass += 1) {
    let changed = false;
    parentChildRelations.forEach((relation) => {
      const childGen = generation.get(relation.targetId) ?? 2;
      const parentGen = generation.get(relation.sourceId) ?? 2;
      if (parentGen !== childGen - 1) {
        generation.set(relation.sourceId, childGen - 1);
        changed = true;
      }
    });
    partnerRelations.forEach((relation) => {
      const a = generation.get(relation.sourceId) ?? 0;
      const b = generation.get(relation.targetId) ?? 0;
      const same = Math.min(a, b);
      if (a !== same) {
        generation.set(relation.sourceId, same);
        changed = true;
      }
      if (b !== same) {
        generation.set(relation.targetId, same);
        changed = true;
      }
    });
    siblingRelations.forEach((relation) => {
      const a = generation.get(relation.sourceId) ?? 0;
      const b = generation.get(relation.targetId) ?? 0;
      const same = Math.max(a, b);
      if (a !== same) {
        generation.set(relation.sourceId, same);
        changed = true;
      }
      if (b !== same) {
        generation.set(relation.targetId, same);
        changed = true;
      }
    });
    if (!changed) break;
  }

  const rows = new Map();
  state.people.filter((person) => connectedIds.has(person.id)).forEach((person) => {
    const row = clampGeneration(generation.get(person.id) ?? person.generation ?? 2);
    person.generation = row;
    person.y = generationY(row);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(person);
  });

  rows.forEach((people, row) => {
    people.sort((a, b) => {
      if (a.proband) return -1;
      if (b.proband) return 1;
      return a.x - b.x || a.label.localeCompare(b.label, "zh-CN");
    });
    const spacing = state.layout.layoutSpacing;
    const totalWidth = (people.length - 1) * spacing;
    const startX = Math.max(220, 760 - totalWidth / 2);
    people.forEach((person, index) => {
      person.x = snapX(startX + index * spacing);
      person.y = generationY(row);
    });
  });

  layoutFamilyGroups();
  resolveLayoutConflicts();
  enforcePedigreeLineRules();
  placeDisconnectedNodes(connectedIds);
  refreshKinshipLabels();
  centerDiagramOnCanvas();
  saveState();
  render();
  scrollDiagramIntoView();
  updateStatus("已按世代整理布局");
}

function placeDisconnectedNodes(connectedIds) {
  const disconnected = state.people.filter((person) => !connectedIds.has(person.id));
  if (!disconnected.length) return;
  disconnected
    .sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0) || a.x - b.x)
    .forEach((person, index) => {
      person.x = alignX(CANVAS_WIDTH - 360);
      person.y = generationY(Math.min(index, GENERATIONS.length - 1));
    });
}

function layoutFamilyGroups() {
  normalizeSiblingSpacing();
  placeSpousesAroundCoreMembers();
  centerChildrenUnderParents();
  normalizeSiblingSpacing();
  placeSpousesAroundCoreMembers();
  centerChildrenUnderParents();
  resolveGenerationCollisions();
}

function enforcePedigreeLineRules() {
  placeSpousesAroundCoreMembers();
  centerChildrenUnderParents();
  normalizeSiblingSpacing();
  centerChildrenUnderParents();
}

function resolveLayoutConflicts() {
  for (let pass = 0; pass < 4; pass += 1) {
    const movedNodes = resolveNodeOverlaps();
    const movedLines = resolveLineNodeConflicts();
    if (!movedNodes && !movedLines) break;
    centerChildrenUnderParents();
  }
}

function resolveNodeOverlaps() {
  const metrics = getNodeMetrics();
  const minGap = metrics.nodeSize + 34;
  let moved = false;
  const rows = groupPeopleByGeneration();
  rows.forEach((people) => {
    people.sort((a, b) => a.x - b.x);
    for (let index = 1; index < people.length; index += 1) {
      const previous = people[index - 1];
      const current = people[index];
      if (current.x - previous.x < minGap) {
        current.x = alignX(previous.x + minGap);
        moved = true;
      }
    }
  });
  return moved;
}

function resolveLineNodeConflicts() {
  let moved = false;
  const metrics = getNodeMetrics();
  const nodeRadius = metrics.shapeRadius + 18;
  const relationships = state.relationships.slice();
  relationships.forEach((relation) => {
    const source = getPerson(relation.sourceId);
    const target = getPerson(relation.targetId);
    if (!source || !target) return;
    if (relation.type === "partner") {
      const minX = Math.min(source.x, target.x);
      const maxX = Math.max(source.x, target.x);
      state.people.forEach((person) => {
        if (person.id === source.id || person.id === target.id) return;
        if ((person.generation ?? generationFromY(person.y)) !== (source.generation ?? generationFromY(source.y))) return;
        if (person.x > minX + nodeRadius && person.x < maxX - nodeRadius) {
          person.x = alignX(maxX + nodeRadius + state.layout.siblingSpacing / 2);
          moved = true;
        }
      });
    }
    if (relation.type === "parentChild") {
      const minY = Math.min(source.y, target.y);
      const maxY = Math.max(source.y, target.y);
      state.people.forEach((person) => {
        if (person.id === source.id || person.id === target.id) return;
        const sameVertical = Math.abs(person.x - target.x) < nodeRadius;
        const betweenGenerations = person.y > minY + nodeRadius && person.y < maxY - nodeRadius;
        if (sameVertical && betweenGenerations) {
          person.x = alignX(person.x + state.layout.siblingSpacing);
          moved = true;
        }
      });
    }
  });
  if (moved) resolveNodeOverlaps();
  return moved;
}

function groupPeopleByGeneration() {
  const rows = new Map();
  state.people.forEach((person) => {
    const row = person.generation ?? generationFromY(person.y);
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(person);
  });
  return rows;
}

function getDiagramBounds() {
  if (!state.people.length) return null;
  const metrics = getNodeMetrics();
  const paddingX = metrics.selectionWidth / 2 + 30;
  const paddingTop = metrics.shapeRadius + 40;
  const paddingBottom = metrics.selectionHeight - metrics.shapeRadius + 30;
  return state.people.reduce((bounds, person) => {
    bounds.minX = Math.min(bounds.minX, person.x - paddingX);
    bounds.maxX = Math.max(bounds.maxX, person.x + paddingX);
    bounds.minY = Math.min(bounds.minY, person.y - paddingTop);
    bounds.maxY = Math.max(bounds.maxY, person.y + paddingBottom);
    return bounds;
  }, {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  });
}

function centerDiagramOnCanvas() {
  const bounds = getDiagramBounds();
  if (!bounds) return;
  const desiredCenterX = CANVAS_WIDTH / 2;
  const currentCenterX = (bounds.minX + bounds.maxX) / 2;
  const shiftX = desiredCenterX - currentCenterX;
  state.people.forEach((person) => {
    person.x = alignX(person.x + shiftX);
  });
  const shiftedBounds = getDiagramBounds();
  if (!shiftedBounds) return;
  let correctionX = 0;
  if (shiftedBounds.minX < 40) correctionX = 40 - shiftedBounds.minX;
  if (shiftedBounds.maxX > CANVAS_WIDTH - 40) correctionX = CANVAS_WIDTH - 40 - shiftedBounds.maxX;
  if (correctionX) {
    state.people.forEach((person) => {
      person.x = alignX(person.x + correctionX);
    });
  }
}

function scrollDiagramIntoView() {
  const bounds = getDiagramBounds();
  if (!bounds) return;
  requestAnimationFrame(() => {
    const viewportWidth = canvasWrap.clientWidth;
    const viewportHeight = canvasWrap.clientHeight;
    canvasWrap.scrollLeft = Math.max(0, (bounds.minX + bounds.maxX) / 2 - viewportWidth / 2);
    canvasWrap.scrollTop = Math.max(0, (bounds.minY + bounds.maxY) / 2 - viewportHeight / 2);
  });
}

function placeSpousesAroundCoreMembers() {
  const partnerRelations = state.relationships.filter((relation) => relation.type === "partner");
  const childIds = new Set(
    state.relationships
      .filter((relation) => relation.type === "parentChild")
      .map((relation) => relation.targetId),
  );
  partnerRelations.forEach((relation) => {
    const first = getPerson(relation.sourceId);
    const second = getPerson(relation.targetId);
    if (!first || !second) return;
    const partnerGap = Math.max(state.layout.siblingSpacing, state.layout.nodeSize * 2 + 60);
    const core = chooseCorePartner(first, second, childIds);
    const spouse = core.id === first.id ? second : first;
    const coreIsFemale = core.sex === "female" && spouse.sex !== "female";
    spouse.x = alignX(core.x + (coreIsFemale ? -partnerGap : partnerGap));
    const generation = Math.min(
      core.generation ?? generationFromY(core.y),
      spouse.generation ?? generationFromY(spouse.y),
    );
    core.generation = generation;
    spouse.generation = generation;
    core.y = generationY(generation);
    spouse.y = generationY(generation);
  });
}

function chooseCorePartner(first, second, childIds) {
  const firstScore = getPedigreeCoreScore(first.id, childIds);
  const secondScore = getPedigreeCoreScore(second.id, childIds);
  if (firstScore !== secondScore) return firstScore > secondScore ? first : second;
  const firstIsChild = childIds.has(first.id);
  const secondIsChild = childIds.has(second.id);
  if (firstIsChild && !secondIsChild) return first;
  if (secondIsChild && !firstIsChild) return second;
  const firstSiblingDegree = getSiblingDegree(first.id);
  const secondSiblingDegree = getSiblingDegree(second.id);
  if (firstSiblingDegree !== secondSiblingDegree) {
    return firstSiblingDegree > secondSiblingDegree ? first : second;
  }
  if (first.proband && !second.proband) return first;
  if (second.proband && !first.proband) return second;
  return first;
}

function getPedigreeCoreScore(personId, childIds) {
  let score = 0;
  if (childIds.has(personId)) score += 4;
  score += getParentCount(personId) * 3;
  score += getSiblingDegree(personId) * 2;
  const person = getPerson(personId);
  if (person?.proband) score += 5;
  return score;
}

function getParentCount(personId) {
  return state.relationships.filter(
    (relation) => relation.type === "parentChild" && relation.targetId === personId,
  ).length;
}

function getSiblingDegree(personId) {
  return state.relationships.filter(
    (relation) => relation.type === "sibling" && (relation.sourceId === personId || relation.targetId === personId),
  ).length;
}

function centerChildrenUnderParents() {
  const partnerRelations = state.relationships.filter((relation) => relation.type === "partner");
  const parentChildRelations = state.relationships.filter((relation) => relation.type === "parentChild");
  partnerRelations.forEach((relation) => {
    const parentA = getPerson(relation.sourceId);
    const parentB = getPerson(relation.targetId);
    if (!parentA || !parentB) return;
    const children = parentChildRelations
      .filter((candidate) => candidate.sourceId === parentA.id || candidate.sourceId === parentB.id)
      .map((candidate) => candidate.targetId)
      .filter((childId, index, ids) => ids.indexOf(childId) === index)
      .map(getPerson)
      .filter(Boolean)
      .filter((child) => !isSpouseOnlyInGeneration(child.id))
      .sort((a, b) => a.x - b.x);
    if (!children.length) return;
    const midX = (parentA.x + parentB.x) / 2;
    const spacing = state.layout.siblingSpacing;
    const startX = midX - ((children.length - 1) * spacing) / 2;
    children.forEach((child, index) => {
      child.x = alignX(startX + index * spacing);
    });
  });
}

function isSpouseOnlyInGeneration(personId) {
  const hasParent = state.relationships.some(
    (relation) => relation.type === "parentChild" && relation.targetId === personId,
  );
  const hasSibling = state.relationships.some(
    (relation) => relation.type === "sibling" && (relation.sourceId === personId || relation.targetId === personId),
  );
  return !hasParent && !hasSibling;
}

function resolveGenerationCollisions() {
  const minGap = Math.max(state.layout.nodeSize * 1.8, 110);
  const rows = groupPeopleByGeneration();
  rows.forEach((people) => {
    people.sort((a, b) => a.x - b.x);
    for (let index = 1; index < people.length; index += 1) {
      const previous = people[index - 1];
      const current = people[index];
      if (current.x - previous.x < minGap) {
        current.x = alignX(previous.x + minGap);
      }
    }
  });
}

function normalizeSiblingSpacing(focusPersonId = null) {
  const groups = collectSiblingGroups();
  const used = new Set();
  groups.forEach((group) => {
    const members = group.members
      .map(getPerson)
      .filter(Boolean)
      .sort((a, b) => a.x - b.x || a.label.localeCompare(b.label, "zh-CN"));
    if (members.length < 2) return;
    const groupKey = members.map((person) => person.id).sort().join("|");
    if (used.has(groupKey)) return;
    used.add(groupKey);

    const generation = members[0].generation ?? generationFromY(members[0].y);
    members.forEach((person) => {
      person.generation = generation;
      person.y = generationY(generation);
    });

    const center = getSiblingGroupCenter(members, group, focusPersonId);
    const startX = center - ((members.length - 1) * state.layout.siblingSpacing) / 2;
    members.forEach((person, index) => {
      person.x = alignX(startX + index * state.layout.siblingSpacing);
    });
  });
}

function collectSiblingGroups() {
  const groups = [];
  const parentChildRelations = state.relationships.filter((relation) => relation.type === "parentChild");
  const partnerRelations = state.relationships.filter((relation) => relation.type === "partner");

  partnerRelations.forEach((partner) => {
    const children = parentChildRelations
      .filter((relation) => relation.sourceId === partner.sourceId || relation.sourceId === partner.targetId)
      .map((relation) => relation.targetId)
      .filter((id, index, ids) => ids.indexOf(id) === index);
    if (children.length > 1) {
      groups.push({
        kind: "parents",
        parentIds: [partner.sourceId, partner.targetId],
        members: children,
      });
    }
  });

  const childrenBySingleParent = new Map();
  parentChildRelations.forEach((relation) => {
    if (!childrenBySingleParent.has(relation.sourceId)) {
      childrenBySingleParent.set(relation.sourceId, new Set());
    }
    childrenBySingleParent.get(relation.sourceId).add(relation.targetId);
  });
  childrenBySingleParent.forEach((children, parentId) => {
    if (children.size > 1) {
      groups.push({
        kind: "singleParent",
        parentIds: [parentId],
        members: Array.from(children),
      });
    }
  });

  state.relationships
    .filter((relation) => relation.type === "sibling")
    .forEach((relation) => {
      const members = expandSiblingSet(relation.sourceId, relation.targetId);
      if (members.size > 1) {
        groups.push({
          kind: "sibling",
          parentIds: [],
          members: Array.from(members),
        });
      }
    });

  return groups;
}

function expandSiblingSet(sourceId, targetId) {
  const members = new Set([sourceId, targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    state.relationships
      .filter((relation) => relation.type === "sibling")
      .forEach((relation) => {
        const touchesGroup = members.has(relation.sourceId) || members.has(relation.targetId);
        if (!touchesGroup) return;
        const before = members.size;
        members.add(relation.sourceId);
        members.add(relation.targetId);
        if (members.size !== before) changed = true;
      });
  }
  return members;
}

function getSiblingGroupCenter(members, group, focusPersonId) {
  const parents = group.parentIds.map(getPerson).filter(Boolean);
  if (parents.length === 2) {
    return (parents[0].x + parents[1].x) / 2;
  }
  if (parents.length === 1) {
    return parents[0].x;
  }
  if (focusPersonId && members.some((person) => person.id === focusPersonId)) {
    const focus = getPerson(focusPersonId);
    if (focus) return focus.x;
  }
  return members.reduce((sum, person) => sum + person.x, 0) / members.length;
}

function generationY(generation) {
  return 160 + clampGeneration(generation) * state.layout.generationSpacing;
}

function GENERATION_Y(generation) {
  return generationY(generation);
}

function generationFromY(y) {
  let nearest = 0;
  let nearestDistance = Infinity;
  GENERATIONS.forEach((generation) => {
    const distance = Math.abs(y - generationY(generation.index));
    if (distance < nearestDistance) {
      nearest = generation.index;
      nearestDistance = distance;
    }
  });
  return nearest;
}

function clampGeneration(generation) {
  return Math.max(0, Math.min(GENERATIONS.length - 1, Number(generation) || 0));
}

function clampX(x) {
  return Math.max(MIN_NODE_X, Math.min(MAX_NODE_X, x));
}

function snapX(x) {
  return Math.round(clampX(x) / 20) * 20;
}

function alignX(x) {
  return clampX(Math.round(x));
}

function shiftGeneration(delta) {
  const person = getPerson(state.selectedPersonId);
  if (!person) return;
  person.generation = clampGeneration((person.generation ?? generationFromY(person.y)) + delta);
  person.y = generationY(person.generation);
  form.generation.value = String(person.generation);
  saveState();
  render();
  updateStatus(`已移动到第 ${GENERATIONS[person.generation].label} 代`);
}

function syncLayoutControls() {
  layoutControls.nodeSize.value = state.layout.nodeSize;
  layoutControls.nodeSizeValue.textContent = state.layout.nodeSize;
  layoutControls.generationSpacing.value = state.layout.generationSpacing;
  layoutControls.generationSpacingValue.textContent = state.layout.generationSpacing;
  layoutControls.siblingSpacing.value = state.layout.siblingSpacing;
  layoutControls.siblingSpacingValue.textContent = state.layout.siblingSpacing;
  layoutControls.layoutSpacing.value = state.layout.layoutSpacing;
  layoutControls.layoutSpacingValue.textContent = state.layout.layoutSpacing;
}

function applyLayoutSetting(key, value) {
  state.layout[key] = Number(value);
  if (key === "generationSpacing") {
    state.people.forEach((person) => {
      person.y = generationY(person.generation ?? generationFromY(person.y));
    });
  }
  if (key === "siblingSpacing") {
    normalizeSiblingSpacing();
  }
  syncLayoutControls();
  saveState();
  render();
}

function resetLayoutSettings() {
  state.layout = { ...DEFAULT_LAYOUT };
  state.people.forEach((person) => {
    person.y = generationY(person.generation ?? generationFromY(person.y));
  });
  normalizeSiblingSpacing();
  syncLayoutControls();
  saveState();
  render();
  updateStatus("布局设置已恢复默认");
}

function clearAll() {
  if (!confirm("确认清空当前谱系图？")) return;
  state.people = [];
  state.relationships = [];
  state.selectedPersonId = null;
  state.selectedRelationshipId = null;
  state.pendingConnectionId = null;
  state.nextPersonNumber = 1;
  localStorage.removeItem(STORAGE_KEY);
  fillInspector();
  render();
  updateStatus("画布已清空");
}

function exportPng() {
  const clone = svg.cloneNode(true);
  clone.setAttribute("width", String(CANVAS_WIDTH));
  clone.setAttribute("height", String(CANVAS_HEIGHT));
  const exportStyle = createSvgElement("style");
  exportStyle.textContent = `
    .node-label{font-size:14px;fill:#172033;text-anchor:middle;dominant-baseline:middle;font-family:Microsoft YaHei,Segoe UI,Arial,sans-serif}
    .node-meta{font-size:12px;fill:#64748b;text-anchor:middle;font-family:Microsoft YaHei,Segoe UI,Arial,sans-serif}
    .relationship-line{stroke:#334155;stroke-width:2;fill:none}
    .relationship-line.parentChild{marker-end:none}
    .relationship-line.sibling{stroke-dasharray:none}
    .relationship-guide{stroke:#334155;stroke-width:2;fill:none}
    .generation-line{stroke:#9fb1c9;stroke-width:1.5;stroke-dasharray:8 8}
    .generation-label{fill:#475569;font-size:18px;font-weight:700;font-family:Microsoft YaHei,Segoe UI,Arial,sans-serif}
    .generation-band{fill:rgba(255,255,255,0.28)}
    .proband-arrow{stroke:#2563eb;stroke-width:2.5;marker-end:url(#arrow)}
    .deceased-line{stroke:#b91c1c;stroke-width:2}
    .selection-ring{display:none}
  `;
  clone.insertBefore(createSvgElement("rect", {
    x: 0,
    y: 0,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    fill: "#ffffff",
  }), clone.firstChild);
  clone.insertBefore(exportStyle, clone.firstChild);

  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(clone);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);
    const link = document.createElement("a");
    link.download = `疾病家族谱系图-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    updateStatus("PNG 已导出");
  };
  image.src = url;
}

document.querySelectorAll(".palette-item").forEach((item) => {
  item.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", item.dataset.sex);
  });
});

canvasWrap.addEventListener("dragover", (event) => {
  event.preventDefault();
});

canvasWrap.addEventListener("drop", (event) => {
  event.preventDefault();
  const sex = event.dataTransfer.getData("text/plain") || "unknown";
  const point = getMousePosition(event);
  addPerson(sex, Math.round(point.x / 10) * 10, Math.round(point.y / 10) * 10);
  updateStatus("已添加人员，可在右侧编辑信息");
});

svg.addEventListener("click", () => {
  hideContextMenu();
  state.selectedPersonId = null;
  state.selectedRelationshipId = null;
  fillInspector();
  render();
});

nodeContextMenu.addEventListener("click", (event) => {
  const parent = event.target.closest(".context-parent");
  if (parent) {
    event.preventDefault();
    event.stopPropagation();
    parent.closest(".context-submenu")?.classList.contains("open")
      ? closeRelativeSubmenu()
      : openRelativeSubmenu();
    return;
  }
  const button = event.target.closest("button[data-action]");
  if (!button || !contextMenuPersonId) return;
  const personId = contextMenuPersonId;
  hideContextMenu();
  addRelative(personId, button.dataset.action);
});

nodeContextMenu.querySelector(".context-submenu")?.addEventListener("mouseenter", openRelativeSubmenu);
nodeContextMenu.querySelector(".context-submenu")?.addEventListener("mouseleave", scheduleCloseRelativeSubmenu);
nodeContextMenu.querySelector(".context-submenu-panel")?.addEventListener("mouseenter", openRelativeSubmenu);
nodeContextMenu.querySelector(".context-submenu-panel")?.addEventListener("mouseleave", scheduleCloseRelativeSubmenu);

window.addEventListener("click", (event) => {
  if (!nodeContextMenu.hidden && !nodeContextMenu.contains(event.target)) {
    hideContextMenu();
  }
});

window.addEventListener("contextmenu", (event) => {
  const closest = typeof event.target.closest === "function" ? event.target.closest.bind(event.target) : null;
  if (closest && !closest(".node-group") && !closest(".context-menu")) {
    hideContextMenu();
  }
});

Object.values(form).forEach((input) => {
  input.addEventListener("input", updateSelectedPerson);
  input.addEventListener("change", updateSelectedPerson);
});

document.querySelectorAll(".relation-mode").forEach((button) => {
  button.addEventListener("click", () => {
    state.relationType = button.dataset.relation;
    document.querySelectorAll(".relation-mode").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    updateStatus(`当前关系类型：${relationName(state.relationType)}`);
  });
});

document.getElementById("connectModeButton").addEventListener("click", () => {
  state.connectMode = !state.connectMode;
  state.pendingConnectionId = null;
  updateConnectButton();
  updateStatus(state.connectMode ? "请选择第一个人" : "已取消连接模式");
});

document.getElementById("deleteSelectedButton").addEventListener("click", deleteSelected);
document.getElementById("addTemplateButton").addEventListener("click", addTemplate);
document.getElementById("layoutButton").addEventListener("click", autoLayout);
document.getElementById("generationUpButton").addEventListener("click", () => shiftGeneration(-1));
document.getElementById("generationDownButton").addEventListener("click", () => shiftGeneration(1));
layoutControls.nodeSize.addEventListener("input", (event) => applyLayoutSetting("nodeSize", event.target.value));
layoutControls.generationSpacing.addEventListener("input", (event) => applyLayoutSetting("generationSpacing", event.target.value));
layoutControls.siblingSpacing.addEventListener("input", (event) => applyLayoutSetting("siblingSpacing", event.target.value));
layoutControls.layoutSpacing.addEventListener("input", (event) => applyLayoutSetting("layoutSpacing", event.target.value));
document.getElementById("resetLayoutButton").addEventListener("click", resetLayoutSettings);
document.getElementById("clearButton").addEventListener("click", clearAll);
document.getElementById("exportButton").addEventListener("click", exportPng);

window.addEventListener("keydown", (event) => {
  if (event.key === "Delete" || event.key === "Backspace") {
    const active = document.activeElement;
    const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
    if (!editing) deleteSelected();
  }
  if (event.key === "Escape" && state.connectMode) {
    state.connectMode = false;
    state.pendingConnectionId = null;
    updateConnectButton();
    updateStatus("已取消连接模式");
  }
  if (event.key === "Escape") {
    hideContextMenu();
  }
});

loadState();
syncLayoutControls();
refreshKinshipLabels();
fillInspector();
render();
updateConnectButton();

