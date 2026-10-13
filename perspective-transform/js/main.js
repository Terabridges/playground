// @ts-check
import { CalibratedView, CORNER_COLORS } from "./calibratedView.js";
import { PerspectiveTransform } from "./perspective.js";

/** @typedef {import("./perspective.js").Point} Point */
/** @typedef {import("./calibratedView.js").Mode} Mode */
/** @typedef {import("./calibratedView.js").Scene} Scene */
/** @typedef {import("./calibratedView.js").Stroke} Stroke */
/** @typedef {import("./calibratedView.js").ViewEvents} ViewEvents */
/** @typedef {"pen" | "line"} Tool */

const STORAGE_KEY = "perspective-playground";

/**
 * @template {HTMLElement} [T=HTMLElement]
 * @param {string} id
 * @returns {T}
 */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return /** @type {T} */ (el);
}

/** @type {Record<Mode, HTMLButtonElement>} */
const modeButtons = {
  calibrate: byId("mode-calibrate"),
  draw: byId("mode-draw"),
};
/** @type {Record<Tool, HTMLButtonElement>} */
const toolButtons = {
  pen: byId("tool-pen"),
  line: byId("tool-line"),
};
/** @type {HTMLInputElement} */
const colorInput = byId("color");
/** @type {HTMLInputElement} */
const showGridInput = byId("show-grid");
/** @type {HTMLInputElement} */
const gridDivisionsInput = byId("grid-divisions");
/** @type {HTMLInputElement} */
const fieldSizeInput = byId("field-size");
const instructions = byId("instructions");

const state = {
  /** @type {Mode} */ mode: "calibrate",
  /** @type {Tool} */ tool: "pen",
  /** @type {Stroke[]} */ strokes: [],
  /** @type {Stroke | null} */ current: null,
  /** @type {Point | null} */ cursor: null,
  allCalibrated: false,
};

/** @returns {Scene} */
function scene() {
  const divisions = Math.round(Number(gridDivisionsInput.value));
  return {
    mode: state.mode,
    strokes: state.strokes,
    cursor: state.cursor,
    gridDivisions: showGridInput.checked && divisions > 0 ? Math.min(divisions, 48) : 0,
  };
}

/** @type {ViewEvents} */
const events = {
  calibrationChanged(gestureDone) {
    if (gestureDone) {
      // Once both images have all four corners, switch to drawing automatically.
      const allCalibrated = views.every((v) => v.isCalibrated);
      if (allCalibrated && !state.allCalibrated) setMode("draw");
      state.allCalibrated = allCalibrated;
      save();
    }
    update();
  },
  drawStart(at) {
    state.current = { color: colorInput.value, points: [at] };
    state.strokes.push(state.current);
    update();
  },
  drawMove(at) {
    const stroke = state.current;
    if (!stroke) return;
    if (state.tool === "line") stroke.points[1] = at;
    else stroke.points.push(at);
    update();
  },
  drawEnd() {
    state.current = null;
    save();
    update();
  },
  hover(at) {
    state.cursor = at;
    update();
  },
};

const camera = new CalibratedView(byId("camera-image"), byId("camera-canvas"), scene, events);
const field = new CalibratedView(byId("field-image"), byId("field-canvas"), scene, events);
const views = [camera, field];

// Batch redraws so a burst of pointer events causes at most one redraw per frame.
let updateQueued = false;
function update() {
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(() => {
    updateQueued = false;
    views.forEach((v) => v.render());
    updateStatus();
    updateReadout();
  });
}

/** @param {Mode} mode */
function setMode(mode) {
  state.mode = mode;
  for (const [name, button] of Object.entries(modeButtons)) {
    button.setAttribute("aria-pressed", String(name === mode));
  }
  update();
}

/** @param {Tool} tool */
function setTool(tool) {
  state.tool = tool;
  for (const [name, button] of Object.entries(toolButtons)) {
    button.setAttribute("aria-pressed", String(name === tool));
  }
  setMode("draw");
}

function updateStatus() {
  /** @type {[CalibratedView, string][]} */
  const statuses = [
    [camera, "camera-status"],
    [field, "field-status"],
  ];
  for (const [view, id] of statuses) {
    const el = byId(id);
    el.textContent = view.isCalibrated ? "Calibrated" : `${view.cornerCount} / 4 corners`;
    el.classList.toggle("done", view.isCalibrated);
  }

  const next = Math.min(camera.cornerCount, field.cornerCount);
  if (state.mode === "calibrate") {
    instructions.innerHTML = state.allCalibrated
      ? "Drag any numbered corner to fine-tune it. Switch to <b>Draw</b> when you're done."
      : `Click the four corners of the field floor in <b>both</b> images. Go clockwise and start at the same
         physical corner in each image, so corner 1 is the same spot in both. Next up:
         <span class="swatch" style="--c:${CORNER_COLORS[next] ?? "transparent"}"></span> corner ${next + 1}.`;
  } else {
    instructions.innerHTML = state.allCalibrated
      ? "Draw on either image. Everything you draw also appears on the other image, in the matching spot."
      : "Finish calibrating both images before drawing.";
  }
}

/**
 * @param {Point | null} p
 * @param {number} digits
 * @param {number} [scale]
 */
function formatPoint(p, digits, scale = 1) {
  return p ? `${(p.x * scale).toFixed(digits)}, ${(p.y * scale).toFixed(digits)}` : "–";
}

function updateReadout() {
  const unit = state.cursor;
  const fieldSize = Number(fieldSizeInput.value) || 0;
  byId("readout-camera").textContent = formatPoint(unit && camera.fromUnit(unit), 0);
  byId("readout-unit").textContent = formatPoint(unit, 3);
  byId("readout-field").textContent = formatPoint(unit, 1, fieldSize);
  byId("readout-topdown").textContent = formatPoint(unit && field.fromUnit(unit), 0);

  // The single matrix that takes camera pixels straight to top-down pixels.
  const matrix = byId("matrix");
  if (camera.quad && field.quad) {
    const m = PerspectiveTransform.quadToQuad(camera.quad, field.quad).getTransform();
    // Scaling the whole matrix doesn't change the transform, so scale it to make the bottom-right entry 1.
    const s = m[2][2];
    matrix.textContent = m.map((row) => row.map((v) => (v / s).toFixed(5).padStart(12)).join(" ")).join("\n");
  } else {
    matrix.textContent = "Calibrate both images to see it.";
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ corners: views.map((v) => v.getCorners()), strokes: state.strokes }));
  } catch {
    // Storage can be unavailable (private mode, etc.); saving is just a convenience.
  }
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved) return;
    views.forEach((v, i) => v.setCorners(saved.corners?.[i] ?? []));
    state.strokes = Array.isArray(saved.strokes) ? saved.strokes : [];
    state.allCalibrated = views.every((v) => v.isCalibrated);
    if (state.allCalibrated) setMode("draw");
  } catch {
    // Ignore missing or corrupt saved data and start fresh.
  }
}

function undo() {
  state.strokes.pop();
  save();
  update();
}

modeButtons.calibrate.addEventListener("click", () => setMode("calibrate"));
modeButtons.draw.addEventListener("click", () => setMode("draw"));
toolButtons.pen.addEventListener("click", () => setTool("pen"));
toolButtons.line.addEventListener("click", () => setTool("line"));
byId("undo").addEventListener("click", undo);
byId("clear").addEventListener("click", () => {
  state.strokes = [];
  save();
  update();
});
byId("reset").addEventListener("click", () => {
  views.forEach((v) => v.setCorners([]));
  state.allCalibrated = false;
  save();
  setMode("calibrate");
});
for (const input of [showGridInput, gridDivisionsInput, fieldSizeInput]) {
  input.addEventListener("input", update);
}
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "z") {
    e.preventDefault();
    undo();
  }
});

load();
update();
