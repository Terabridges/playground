// @ts-check
/*
 * A perspective (projective) transform maps points on one flat plane onto
 * another flat plane, the way a camera sees the floor of a field. It is a
 * 3x3 matrix applied to the point (x, y, 1):
 *
 *   [x']   [m00 m01 m02] [x]
 *   [y'] = [m10 m11 m12] [y]        result = (x' / w, y' / w)
 *   [w ]   [m20 m21 m22] [1]
 *
 * Dividing by w is what makes far-away things look smaller.
 *
 * Ported from StatEasy's perspective.js, which was itself ported from
 * javax.media.jai.PerspectiveTransform.
 */

/** @typedef {{ x: number, y: number }} Point */
/** Four corners, listed in order around the shape (e.g. clockwise from top-left). @typedef {[Point, Point, Point, Point]} Quad */
/** @typedef {[[number, number, number], [number, number, number], [number, number, number]]} Matrix3 */

const EPSILON = 1e-9;

export class PerspectiveTransform {
  // Start out as the identity transform (maps every point to itself).
  m00 = 1;
  m01 = 0;
  m02 = 0;
  m10 = 0;
  m11 = 1;
  m12 = 0;
  m20 = 0;
  m21 = 0;
  m22 = 1;

  /**
   * Transforms a point using the perspective transform matrix.
   * @param {Point} p
   * @returns {Point}
   */
  transform({ x, y }) {
    const w = this.m20 * x + this.m21 * y + this.m22;
    return {
      x: (this.m00 * x + this.m01 * y + this.m02) / w,
      y: (this.m10 * x + this.m11 * y + this.m12) / w,
    };
  }

  /**
   * Transforms a point backwards, using the inverse of the matrix.
   * @param {Point} p
   * @returns {Point}
   */
  inverseTransform({ x, y }) {
    const { m00, m01, m02, m10, m11, m12, m20, m21, m22 } = this;
    const tx = (m11 * m22 - m12 * m21) * x + (m02 * m21 - m01 * m22) * y + (m01 * m12 - m02 * m11);
    const ty = (m12 * m20 - m10 * m22) * x + (m00 * m22 - m02 * m20) * y + (m02 * m10 - m00 * m12);
    const w = (m10 * m21 - m11 * m20) * x + (m01 * m20 - m00 * m21) * y + (m00 * m11 - m01 * m10);
    return { x: tx / w, y: ty / w };
  }

  /**
   * @param {Matrix3} m
   * @returns {this}
   */
  setTransform(m) {
    [
      [this.m00, this.m01, this.m02],
      [this.m10, this.m11, this.m12],
      [this.m20, this.m21, this.m22],
    ] = m;
    return this;
  }

  /** @returns {Matrix3} */
  getTransform() {
    return [
      [this.m00, this.m01, this.m02],
      [this.m10, this.m11, this.m12],
      [this.m20, this.m21, this.m22],
    ];
  }

  /**
   * Replaces the matrix with its adjoint. The adjoint is the inverse matrix
   * multiplied by a constant, and multiplying a perspective matrix by a
   * constant doesn't change where points land, so this inverts the transform.
   * @returns {this}
   */
  makeAdjoint() {
    const { m00, m01, m02, m10, m11, m12, m20, m21, m22 } = this;
    return this.setTransform([
      [m11 * m22 - m12 * m21, m02 * m21 - m01 * m22, m01 * m12 - m02 * m11],
      [m12 * m20 - m10 * m22, m00 * m22 - m02 * m20, m02 * m10 - m00 * m12],
      [m10 * m21 - m11 * m20, m01 * m20 - m00 * m21, m00 * m11 - m01 * m10],
    ]);
  }

  /**
   * Post-concatenates `tx`: the result applies this transform first, then `tx`.
   * @param {PerspectiveTransform} tx
   * @returns {this}
   */
  concatenate(tx) {
    const a = tx.getTransform();
    const b = this.getTransform();
    const product = /** @type {Matrix3} */ (
      a.map((row) => [0, 1, 2].map((col) => row[0] * b[0][col] + row[1] * b[1][col] + row[2] * b[2][col]))
    );
    return this.setTransform(product);
  }

  /**
   * Creates a transform that maps the unit square onto an arbitrary quadrilateral:
   *
   *   (0, 0) -> q[0]    (1, 0) -> q[1]    (1, 1) -> q[2]    (0, 1) -> q[3]
   *
   * @param {Quad} quad
   * @returns {PerspectiveTransform}
   */
  static squareToQuad([p0, p1, p2, p3]) {
    const dx3 = p0.x - p1.x + p2.x - p3.x;
    const dy3 = p0.y - p1.y + p2.y - p3.y;

    if (Math.abs(dx3) < EPSILON && Math.abs(dy3) < EPSILON) {
      // The quad is a parallelogram, so no perspective division is needed.
      return new PerspectiveTransform().setTransform([
        [p1.x - p0.x, p2.x - p1.x, p0.x],
        [p1.y - p0.y, p2.y - p1.y, p0.y],
        [0, 0, 1],
      ]);
    }

    const dx1 = p1.x - p2.x;
    const dy1 = p1.y - p2.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;

    const invdet = 1 / (dx1 * dy2 - dx2 * dy1);
    const m20 = (dx3 * dy2 - dx2 * dy3) * invdet;
    const m21 = (dx1 * dy3 - dx3 * dy1) * invdet;

    return new PerspectiveTransform().setTransform([
      [p1.x - p0.x + m20 * p1.x, p3.x - p0.x + m21 * p3.x, p0.x],
      [p1.y - p0.y + m20 * p1.y, p3.y - p0.y + m21 * p3.y, p0.y],
      [m20, m21, 1],
    ]);
  }

  /**
   * Creates a transform that maps an arbitrary quadrilateral onto the unit square:
   *
   *   q[0] -> (0, 0)    q[1] -> (1, 0)    q[2] -> (1, 1)    q[3] -> (0, 1)
   *
   * @param {Quad} quad
   * @returns {PerspectiveTransform}
   */
  static quadToSquare(quad) {
    return PerspectiveTransform.squareToQuad(quad).makeAdjoint();
  }

  /**
   * Creates a transform that maps one quadrilateral onto another, corner by corner.
   * @param {Quad} from
   * @param {Quad} to
   * @returns {PerspectiveTransform}
   */
  static quadToQuad(from, to) {
    return PerspectiveTransform.quadToSquare(from).concatenate(PerspectiveTransform.squareToQuad(to));
  }
}
