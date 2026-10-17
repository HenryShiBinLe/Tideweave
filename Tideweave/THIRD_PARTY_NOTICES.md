# Third-Party Notices

Tideweave original source and procedural artwork are separate from the following upstream software. Retain their license notices when redistributing.

- Electron: MIT. Chromium and Node.js notices are included in the portable runtime (`LICENSE`, `LICENSES.chromium.html`).
- Three.js: MIT. Copyright Three.js Authors.
- Lucide: ISC. Copyright Lucide Contributors; portions derived from Feather Icons, MIT.
- Graphology and Graphology standard-library components / shortest-path: MIT. Copyright Yomguithereal and contributors. Their runtime dependencies include graphology-indices, graphology-types, graphology-utils, mnemonist, obliterator and `@yomguithereal/helpers`, all distributed under MIT notices in `licenses/`.
- `events`: MIT. Copyright the Node.js contributors.
- Build and test tools (not shipped as executable dependencies): esbuild MIT, Playwright Apache-2.0, @electron/packager BSD-2-Clause.
- Tideweave Serif display subset: derived from Source Han Serif (思源宋体) Bold supplied with the local reference materials. Source Han Serif is licensed under the SIL Open Font License 1.1; the applicable license text is retained at `assets/fonts/OFL.txt`. The subset is renamed internally to `Tideweave Serif` and contains only characters used by the game source.

The release includes a `licenses/` folder with the complete license files copied from the locally installed runtime dependencies. The reference PPT, video and images are not distributed. No external 3D models are bundled; the display font subset is accompanied by its OFL notice and system fonts provide fallbacks on Windows.
