# Perspective Transform

A demo of using a perspective transform to map points between a camera image of the field and a top-down field map.

## Use it

1. **Calibrate:** click the four corners of the field floor in both images. Go clockwise and start at the same physical corner in each image. Drag a numbered corner to adjust it.
2. **Draw:** draw on either image and the drawing also appears on the other one.

## Code

Plain JavaScript modules, no build step. Each file starts with `// @ts-check` and uses JSDoc type comments, so VS Code shows type hints and type errors.

- `js/perspective.js`: the `PerspectiveTransform` math: `quadToSquare`, `squareToQuad`, `quadToQuad`, `transform` and `inverseTransform`.
- `js/calibratedView.js`: one image with a canvas over it. It handles calibration clicks and drawing, and renders the grid, strokes and cursor through that image's transform.
- `js/main.js`: the app: shared state (drawings are stored in unit-square coordinates), the toolbar and the readout panel.
