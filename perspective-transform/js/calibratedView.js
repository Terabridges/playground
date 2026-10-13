// @ts-check
import { PerspectiveTransform } from "./perspective.js";

/** @typedef {import("./perspective.js").Point} Point */
/** @typedef {import("./perspective.js").Quad} Quad */
/** @typedef {"calibrate" | "draw"} Mode */

/**
 * A drawing, stored in unit-square coordinates so every calibrated view can show it.
 * @typedef {{ color: string, points: Point[] }} Stroke
 */

/**
 * Everything the views need to draw, shared by all of them.
 * @typedef {object} Scene
 * @property {Mode} mode
 * @property {readonly Stroke[]} strokes
 * @property {Point | null} cursor Where the pointer is, in unit-square coordinates.
 * @property {number} gridDivisions Number of grid lines across the unit square; 0 hides the grid.
 */

/**
 * What a view tells the app about. Every point here is in unit-square coordinates.
 * @typedef {object} ViewEvents
 * @property {(gestureDone: boolean) => void} calibrationChanged
 * @property {(at: Point) => void} drawStart
 * @property {(at: Point) => void} drawMove
 * @property {() => void} drawEnd
 * @property {(at: Point | null) => void} hover
 */

/** Colors for corners 1-4, so matching corners look the same on both images. */
export const CORNER_COLORS = ["#e5484d", "#f5a524", "#30a46c", "#3e63dd"];

/** The image's own corners, as fractions of its width and height, for the corner buttons. */
const IMAGE_CORNERS = [
  { name: "top-left", x: 0, y: 0 },
  { name: "top-right", x: 1, y: 0 },
  { name: "bottom-right", x: 1, y: 1 },
  { name: "bottom-left", x: 0, y: 1 },
];

// On-screen sizes, in CSS pixels.
const HANDLE_RADIUS = 9;
const HIT_RADIUS = 16;
const STROKE_WIDTH = 3;
const CURSOR_RADIUS = 10;

/**
 * An image with a canvas laid over it. You calibrate it by clicking four
 * corners, which gives a transform between the image's pixels and the unit
 * square, (0, 0) to (1, 1).
 */
export class CalibratedView {
  /** @type {HTMLImageElement} */ #img;
  /** @type {HTMLCanvasElement} */ #canvas;
  /** @type {CanvasRenderingContext2D} */ #ctx;
  /** @type {() => Scene} */ #getScene;
  /** @type {ViewEvents} */ #events;
  /** @type {string} */ #defaultSrc;
  /** @type {string} */ #defaultAlt;
  /** Object URL for an uploaded image; it only lives in this tab's memory. @type {string | null} */
  #uploadUrl = null;
  /** @type {HTMLButtonElement[]} */
  #cornerButtons;

  /** Calibration corners, in image pixels. @type {Point[]} */
  #corners = [];
  /** @type {PerspectiveTransform | null} */
  #toUnitSquare = null;
  /** @type {number | null} */
  #dragIndex = null;
  #drawing = false;

  /**
   * @param {HTMLImageElement} img
   * @param {HTMLCanvasElement} canvas
   * @param {() => Scene} getScene
   * @param {ViewEvents} events
   */
  constructor(img, canvas, getScene, events) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser doesn't support canvas drawing.");
    this.#img = img;
    this.#canvas = canvas;
    this.#ctx = ctx;
    this.#getScene = getScene;
    this.#events = events;
    this.#defaultSrc = img.src;
    this.#defaultAlt = img.alt;

    // Buttons that place the next corner exactly on one of the image's own corners.
    const stage = /** @type {HTMLElement} */ (canvas.parentElement);
    this.#cornerButtons = IMAGE_CORNERS.map(({ name, x, y }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `corner-button ${name}`;
      button.title = `Put the next corner exactly in the ${name.replace("-", " ")} corner`;
      button.setAttribute("aria-label", button.title);
      button.addEventListener("click", () =>
        this.#addCorner({ x: x * this.#img.naturalWidth, y: y * this.#img.naturalHeight }),
      );
      stage.append(button);
      return button;
    });

    // Dropping an image file on the picture works the same as uploading it.
    stage.addEventListener("dragover", (e) => e.preventDefault());
    stage.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file?.type.startsWith("image/")) this.loadImage(file);
    });

    img.addEventListener("load", () => this.#resize());
    img.addEventListener("error", () => {
      if (!this.#uploadUrl) return;
      this.restoreImage();
      window.alert("That file couldn't be opened as an image.");
    });

    new ResizeObserver(() => this.#resize()).observe(img);
    canvas.addEventListener("pointerdown", (e) => this.#onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.#onPointerMove(e));
    canvas.addEventListener("pointerup", () => this.#onPointerUp());
    canvas.addEventListener("pointercancel", () => this.#onPointerUp());
    canvas.addEventListener("pointerleave", () => this.#events.hover(null));
  }

  get isCalibrated() {
    return this.#toUnitSquare !== null;
  }

  /** True while showing an uploaded image instead of the page's own. */
  get hasCustomImage() {
    return this.#uploadUrl !== null;
  }

  get cornerCount() {
    return this.#corners.length;
  }

  /**
   * The four calibration corners, once they've all been placed.
   * @returns {Quad | null}
   */
  get quad() {
    const [a, b, c, d] = this.#corners;
    return this.#corners.length === 4 ? [a, b, c, d] : null;
  }

  /** @returns {Point[]} */
  getCorners() {
    return this.#corners.map((p) => ({ ...p }));
  }

  /** @param {Point[]} corners */
  setCorners(corners) {
    this.#corners = corners.slice(0, 4).map((p) => ({ ...p }));
    this.#updateTransform();
  }

  /**
   * Shows an image file from the user's computer. It's never uploaded anywhere
   * or saved: the browser just reads it from disk for this tab.
   * @param {File} file
   */
  loadImage(file) {
    this.#showImage(URL.createObjectURL(file), "Your uploaded image");
  }

  /** Goes back to the page's own image. */
  restoreImage() {
    this.#showImage(this.#defaultSrc, this.#defaultAlt);
  }

  /**
   * @param {string} src
   * @param {string} alt
   */
  #showImage(src, alt) {
    if (this.#uploadUrl) URL.revokeObjectURL(this.#uploadUrl);
    this.#uploadUrl = src === this.#defaultSrc ? null : src;
    this.#img.alt = alt;
    this.#img.src = src;
    // Corners clicked on the old image don't mean anything on the new one.
    this.setCorners([]);
    this.#events.calibrationChanged(true);
  }

  /**
   * Image pixels -> unit square. Points inside the calibrated quad land in 0..1.
   * @param {Point} p
   * @returns {Point | null}
   */
  toUnit(p) {
    return this.#toUnitSquare ? finiteOrNull(this.#toUnitSquare.transform(p)) : null;
  }

  /**
   * Unit square -> image pixels.
   * @param {Point} p
   * @returns {Point | null}
   */
  fromUnit(p) {
    return this.#toUnitSquare ? finiteOrNull(this.#toUnitSquare.inverseTransform(p)) : null;
  }

  render() {
    const ctx = this.#ctx;
    const canvas = this.#canvas;
    const img = this.#img;
    const scene = this.#getScene();
    this.#updateCornerButtons(scene.mode === "calibrate");
    if (!img.naturalWidth || !canvas.width) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw in image pixels and let the canvas scale them to the on-screen size.
    const scale = canvas.width / img.naturalWidth;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (this.isCalibrated) {
      if (scene.gridDivisions > 0) this.#drawGrid(scene.gridDivisions);
      for (const stroke of scene.strokes) this.#drawStroke(stroke);
      if (scene.cursor) this.#drawCursor(scene.cursor);
    }
    this.#drawCalibration(scene.mode === "calibrate");
  }

  /** @param {Point} p */
  #addCorner(p) {
    if (this.#corners.length >= 4) return;
    this.#corners.push(p);
    this.#updateTransform();
    this.#events.calibrationChanged(true);
  }

  /**
   * Shows a corner button only while there are corners left to place and that
   * image corner isn't already used.
   * @param {boolean} calibrating
   */
  #updateCornerButtons(calibrating) {
    const { naturalWidth: w, naturalHeight: h } = this.#img;
    this.#cornerButtons.forEach((button, i) => {
      const target = { x: IMAGE_CORNERS[i].x * w, y: IMAGE_CORNERS[i].y * h };
      const used = this.#corners.some((c) => c.x === target.x && c.y === target.y);
      button.hidden = !calibrating || !w || this.#corners.length >= 4 || used;
    });
  }

  #updateTransform() {
    const quad = this.quad;
    this.#toUnitSquare = quad ? PerspectiveTransform.quadToSquare(quad) : null;
  }

  #resize() {
    const dpr = window.devicePixelRatio || 1;
    this.#canvas.width = Math.round(this.#img.clientWidth * dpr);
    this.#canvas.height = Math.round(this.#img.clientHeight * dpr);
    this.render();
  }

  /**
   * Converts a size in CSS pixels on screen to image pixels.
   * @param {number} cssPixels
   */
  #px(cssPixels) {
    return (cssPixels * this.#img.naturalWidth) / this.#img.clientWidth;
  }

  /**
   * @param {PointerEvent} e
   * @returns {Point}
   */
  #eventToImage(e) {
    const rect = this.#canvas.getBoundingClientRect();
    const { naturalWidth: w, naturalHeight: h } = this.#img;
    return {
      x: clamp(((e.clientX - rect.left) / rect.width) * w, 0, w),
      y: clamp(((e.clientY - rect.top) / rect.height) * h, 0, h),
    };
  }

  /**
   * @param {Point} p
   * @returns {number | null}
   */
  #cornerAt(p) {
    const radius = this.#px(HIT_RADIUS);
    const index = this.#corners.findIndex((c) => Math.hypot(c.x - p.x, c.y - p.y) <= radius);
    return index === -1 ? null : index;
  }

  /** @param {PointerEvent} e */
  #onPointerDown(e) {
    const p = this.#eventToImage(e);

    if (this.#getScene().mode === "calibrate") {
      const hit = this.#cornerAt(p);
      if (hit !== null) {
        this.#dragIndex = hit;
      } else if (this.#corners.length < 4) {
        this.#corners.push(p);
        this.#dragIndex = this.#corners.length - 1;
        this.#updateTransform();
        this.#events.calibrationChanged(false);
      } else {
        return;
      }
    } else {
      const unit = this.toUnit(p);
      if (!unit) return;
      this.#drawing = true;
      this.#events.drawStart(unit);
    }

    // Keep getting move/up events even if the pointer leaves the canvas.
    this.#canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  /** @param {PointerEvent} e */
  #onPointerMove(e) {
    const p = this.#eventToImage(e);

    if (this.#dragIndex !== null) {
      this.#corners[this.#dragIndex] = p;
      this.#updateTransform();
      this.#events.calibrationChanged(false);
    }

    const grabbing = this.#dragIndex !== null;
    const overCorner = this.#getScene().mode === "calibrate" && this.#cornerAt(p) !== null;
    this.#canvas.style.cursor = grabbing ? "grabbing" : overCorner ? "grab" : "crosshair";

    const unit = this.toUnit(p);
    if (this.#drawing && unit) this.#events.drawMove(unit);
    this.#events.hover(unit);
  }

  #onPointerUp() {
    if (this.#dragIndex !== null) {
      this.#dragIndex = null;
      this.#events.calibrationChanged(true);
    }
    if (this.#drawing) {
      this.#drawing = false;
      this.#events.drawEnd();
    }
  }

  /** @param {number} divisions */
  #drawGrid(divisions) {
    const ctx = this.#ctx;
    ctx.beginPath();
    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions;
      this.#unitLine({ x: t, y: 0 }, { x: t, y: 1 });
      this.#unitLine({ x: 0, y: t }, { x: 1, y: t });
    }
    ctx.strokeStyle = "rgba(0, 190, 255, 0.85)";
    ctx.lineWidth = this.#px(1.5);
    ctx.stroke();
  }

  /**
   * Perspective transforms keep straight lines straight, so mapping the two ends is enough.
   * @param {Point} a
   * @param {Point} b
   */
  #unitLine(a, b) {
    const p = this.fromUnit(a);
    const q = this.fromUnit(b);
    if (!p || !q) return;
    this.#ctx.moveTo(p.x, p.y);
    this.#ctx.lineTo(q.x, q.y);
  }

  /** @param {Stroke} stroke */
  #drawStroke(stroke) {
    const ctx = this.#ctx;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = this.#px(STROKE_WIDTH);
    ctx.beginPath();

    let penDown = false;
    for (const unit of stroke.points) {
      const p = this.fromUnit(unit);
      if (!p) {
        penDown = false;
        continue;
      }
      if (penDown) ctx.lineTo(p.x, p.y);
      else ctx.moveTo(p.x, p.y);
      penDown = true;
    }
    ctx.stroke();

    // A single click is a dot.
    const dot = stroke.points.length === 1 ? this.fromUnit(stroke.points[0]) : null;
    if (dot) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, this.#px(STROKE_WIDTH), 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  /** @param {Point} unit */
  #drawCursor(unit) {
    const p = this.fromUnit(unit);
    if (!p) return;
    const ctx = this.#ctx;
    const r = this.#px(CURSOR_RADIUS);

    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    ctx.moveTo(p.x - r * 1.6, p.y);
    ctx.lineTo(p.x + r * 1.6, p.y);
    ctx.moveTo(p.x, p.y - r * 1.6);
    ctx.lineTo(p.x, p.y + r * 1.6);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
    ctx.lineWidth = this.#px(4);
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = this.#px(2);
    ctx.stroke();
  }

  /** @param {boolean} active */
  #drawCalibration(active) {
    const ctx = this.#ctx;
    const corners = this.#corners;
    if (corners.length === 0) return;

    ctx.save();
    ctx.globalAlpha = active ? 1 : 0.55;

    if (corners.length > 1) {
      ctx.beginPath();
      corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y)));
      if (corners.length === 4) ctx.closePath();
      ctx.setLineDash([this.#px(6), this.#px(4)]);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = this.#px(2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const radius = this.#px(HANDLE_RADIUS);
    ctx.font = `bold ${this.#px(11)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    corners.forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = CORNER_COLORS[i];
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = this.#px(2);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(i + 1), c.x, c.y + this.#px(0.5));
    });

    ctx.restore();
  }
}

/**
 * @param {number} n
 * @param {number} min
 * @param {number} max
 */
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * @param {Point} p
 * @returns {Point | null}
 */
function finiteOrNull(p) {
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}
