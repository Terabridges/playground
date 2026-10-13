# Terabridges Playground

Small interactive demos for the team. Each project lives in its own folder and is a plain static web page: no npm and no build step.

Published with GitHub Pages; the landing page (`index.html`) links to every project.

## Run one locally

The pages use JavaScript modules, which browsers won't load from a `file://` URL, so serve the folder:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Add a project

1. Make a new folder with its own `index.html`.
2. Use relative paths (`js/main.js`, not `/js/main.js`), because the site is served from `/playground/`, not the domain root.
3. Add a link to it in the top-level `index.html`.

## Projects

- [`perspective-transform/`](perspective-transform/): calibrate a camera image against a top-down field map and draw between them.
