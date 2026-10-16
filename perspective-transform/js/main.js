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
 * The robot's saved calibration: corners, in image pixels, for the camera and
 * field images. Corner 1 is the same spot on the floor in both images.
 * @type {[Point[], Point[]]}
 */
const DEFAULT_CORNERS = [
  [
    { x: 67, y: 990 },
    { x: 65, y: 57 },
    { x: 1332, y: 48 },
    { x: 1319, y: 990 },
  ],
  [
    { x: 3330, y: 3627 },
    { x: 136, y: 2587 },
    { x: 2431, y: 150 },
    { x: 3602, y: 3337 },
  ],
];

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
      // Once both images have all four corners, switch to drawing automatically,
      // and go back to calibrating if an image loses its corners (e.g. a new image).
      const allCalibrated = views.every((v) => v.isCalibrated);
      if (allCalibrated && !state.allCalibrated) setMode("draw");
      if (!allCalibrated && state.mode === "draw") setMode("calibrate");
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
/** The prefix each view's elements use in their ids, e.g. "camera-status". @type {[CalibratedView, string][]} */
const namedViews = [
  [camera, "camera"],
  [field, "field"],
];

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
  for (const [view, name] of namedViews) {
    const status = byId(`${name}-status`);
    status.textContent = view.isCalibrated ? "Calibrated" : `${view.cornerCount} / 4 corners`;
    status.classList.toggle("done", view.isCalibrated);
    byId(`${name}-restore`).hidden = !view.hasCustomImage;
  }

  const next = Math.min(camera.cornerCount, field.cornerCount);
  if (state.mode === "calibrate") {
    instructions.innerHTML = state.allCalibrated
      ? "Drag any numbered corner to fine-tune it. Switch to <b>Draw</b> when you're done."
      : `Click the four corners of the field floor in <b>both</b> images. Go clockwise and start at the same
         physical corner in each image, so corner 1 is the same spot in both. Next up:
         <span class="swatch" style="--c:${CORNER_COLORS[next] ?? "transparent"}"></span> corner ${next + 1}.
         To put a corner exactly on the image's edge, click the corner button (⌜) in that corner of the image.`;
  } else {
    instructions.innerHTML = state.allCalibrated
      ? "Draw on either image. Everything you draw also appears on the other image, in the matching spot."
      : "Finish calibrating both images before drawing.";
  }
}

/**
 * @param {Point | null} p
 * @param {number} digits
 */
function formatPoint(p, digits) {
  return p ? `${p.x.toFixed(digits)}, ${p.y.toFixed(digits)}` : "–";
}

function updateReadout() {
  const unit = state.cursor;
  byId("readout-camera").textContent = formatPoint(unit && camera.fromUnit(unit), 0);
  byId("readout-unit").textContent = formatPoint(unit, 3);
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
    // Uploaded images aren't saved, so neither are the corners clicked on them.
    const corners = views.map((v) => (v.hasCustomImage ? [] : v.getCorners()));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ corners, strokes: state.strokes }));
  } catch {
    // Storage can be unavailable (private mode, etc.); saving is just a convenience.
  }
}

function load() {
  views.forEach((v, i) => v.setCorners(DEFAULT_CORNERS[i]));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved) {
      views.forEach((v, i) => v.setCorners(saved.corners?.[i] ?? []));
      state.strokes = Array.isArray(saved.strokes) ? saved.strokes : [];
    }
  } catch {
    // Ignore missing or corrupt saved data and start from the defaults.
  }
  state.allCalibrated = views.every((v) => v.isCalibrated);
  if (state.allCalibrated) setMode("draw");
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
for (const [view, name] of namedViews) {
  /** @type {HTMLInputElement} */
  const upload = byId(`${name}-upload`);
  upload.addEventListener("change", () => {
    const file = upload.files?.[0];
    upload.value = ""; // So picking the same file again still fires "change".
    if (file) view.loadImage(file);
  });
  byId(`${name}-restore`).addEventListener("click", () => view.restoreImage());
}
byId("undo").addEventListener("click", undo);
byId("clear").addEventListener("click", () => {
  state.strokes = [];
  save();
  update();
});
byId("saved-calibration").addEventListener("click", () => {
  // The saved corners only fit the page's own images, so bring those back first.
  views.forEach((v, i) => {
    if (v.hasCustomImage) v.restoreImage();
    v.setCorners(DEFAULT_CORNERS[i]);
  });
  state.allCalibrated = true;
  save();
  setMode("draw");
});
byId("reset").addEventListener("click", () => {
  views.forEach((v) => v.setCorners([]));
  state.allCalibrated = false;
  save();
  setMode("calibrate");
});
for (const input of [showGridInput, gridDivisionsInput]) {
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
