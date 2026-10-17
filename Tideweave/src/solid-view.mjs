import * as THREE from "three";
import { solids, faceTopology } from "./solids.mjs";
import { palette, paletteText } from "./assets.mjs";
function faceTexture(label, color) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d");
  c.fillStyle = color < 0 ? "#e8ece5" : palette[color];
  c.fillRect(0, 0, 256, 256);
  c.strokeStyle = color < 0 ? "#bcc7c0" : "#ffffff14";
  c.lineWidth = 3;
  const step = 20 + (color + 1) * 5;
  for (let i = -256; i < 512; i += step) {
    c.beginPath();
    c.moveTo(i, 0);
    c.lineTo(i + 256, 256);
    c.stroke();
  }
  c.fillStyle = color < 0 ? "#273e39" : paletteText[color];
  c.font = 'bold 46px "Microsoft YaHei",sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(label, 128, 130);
  c.strokeStyle = "#263f3977";
  c.lineWidth = 10;
  c.strokeRect(5, 5, 246, 246);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
class SolidView {
  constructor(container, name, onPaint, onRotate, rotation) {
    this.container = container;
    this.spec = solids[name];
    this.onPaint = onPaint;
    this.onRotate = onRotate;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0, 0);
    this.renderer.domElement.setAttribute("aria-label", "可旋转的多面体");
    this.renderer.domElement.setAttribute("tabindex", "0");
    this.renderer.domElement.dataset.solid = "true";
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
    this.camera.position.set(0, 0, 7.8);
    this.group = new THREE.Group();
    this.group.rotation.set(rotation?.x ?? -0.32, rotation?.y ?? 0.55, 0);
    this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(16777215, 7441027, 2.4));
    const light = new THREE.DirectionalLight(16777215, 2);
    light.position.set(-3, 5, 6);
    this.scene.add(light);
    this.meshes = this.spec.faces.map((face, id) => {
      const ps = [], uvs = [], uv = face.length === 4 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0.5, 1], [0, 0], [1, 0]];
      for (let t = 1; t < face.length - 1; t++) for (const j of [0, t, t + 1]) {
        ps.push(...this.spec.vertices[face[j]]);
        uvs.push(...uv[j]);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ map: faceTexture(this.spec.labels[id], -1), roughness: 0.86, metalness: 0.05, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.face = id;
      this.group.add(mesh);
      return mesh;
    });
    for (const edge of faceTopology(this.spec)) {
      const [a, b] = edge.key.split("-").map(Number), geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...this.spec.vertices[a]), new THREE.Vector3(...this.spec.vertices[b])]);
      this.group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 3362373 })));
    }
    this.ray = new THREE.Raycaster();
    this.colors = [];
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => {
      this.drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      if (Math.hypot(e.clientX - this.drag.x, e.clientY - this.drag.y) > 6) this.drag.moved = true;
      if (this.drag.moved) {
        this.group.rotation.y += (e.clientX - this.drag.lastX) * 9e-3;
        this.group.rotation.x += (e.clientY - this.drag.lastY) * 9e-3;
        this.remember();
        this.render();
      }
      this.drag.lastX = e.clientX;
      this.drag.lastY = e.clientY;
    });
    canvas.addEventListener("pointerup", (e) => {
      const hit = this.drag && !this.drag.moved ? this.pick(e.clientX, e.clientY) : null;
      this.drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (hit !== null) this.onPaint(hit);
    });
    canvas.addEventListener("pointercancel", () => {
      this.drag = null;
    });
    canvas.addEventListener("keydown", (e) => {
      const changes = { ArrowLeft: [0, -0.2], ArrowRight: [0, 0.2], ArrowUp: [-0.2, 0], ArrowDown: [0.2, 0] };
      if (changes[e.key]) {
        e.preventDefault();
        const [x, y] = changes[e.key];
        this.group.rotation.x += x;
        this.group.rotation.y += y;
        this.remember();
        this.render();
      }
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }
  remember() {
    this.onRotate({ x: this.group.rotation.x, y: this.group.rotation.y });
  }
  pick(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1), this.camera);
    return this.ray.intersectObjects(this.meshes)[0]?.object.userData.face ?? null;
  }
  setColors(colors, conflicts = []) {
    this.meshes.forEach((mesh, i) => {
      if (this.colors[i] !== colors[i]) {
        mesh.material.map.dispose();
        mesh.material.map = faceTexture(this.spec.labels[i], colors[i]);
        mesh.material.needsUpdate = true;
      }
      mesh.material.emissive.set(conflicts.includes(i) ? "#6b110d" : "#000000");
    });
    this.colors = [...colors];
    this.render();
  }
  reset() {
    this.group.rotation.set(-0.32, 0.55, 0);
    this.remember();
    this.render();
  }
  focusFace(id) {
    const face = this.spec.faces[id], normal = new THREE.Vector3();
    face.forEach((v) => normal.add(new THREE.Vector3(...this.spec.vertices[v])));
    normal.normalize();
    this.group.quaternion.setFromUnitVectors(normal, new THREE.Vector3(0, 0, 1));
    this.remember();
    this.render();
  }
  resize() {
    const r = this.container.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.position.z = r.width < 600 ? 9.5 : 7.8;
    this.camera.updateProjectionMatrix();
    this.render();
  }
  render() {
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.observer.disconnect();
    this.group.traverse((x) => {
      x.geometry?.dispose();
      if (x.material) {
        x.material.map?.dispose();
        x.material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
export {
  SolidView
};
