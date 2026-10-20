import * as THREE from "three";
import { solids, faceTopology } from "./solids.mjs";
import { palette, paletteText } from "./assets.mjs";
const surfaceImages = new Map();
function loadSurface(url) {
  if (!surfaceImages.has(url)) surfaceImages.set(url, new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  }));
  return surfaceImages.get(url);
}
export function faceFrame(spec, face) {
  face=[...face];
  const points = face.map(index => new THREE.Vector3(...spec.vertices[index]));
  const center = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
  const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize();
  const solidCenter=spec.vertices.reduce((sum,v)=>sum.add(new THREE.Vector3(...v)),new THREE.Vector3()).divideScalar(spec.vertices.length);
  // Texture axes and triangle winding must both face outwards, including imported solids.
  if(normal.dot(center.clone().sub(solidCenter))<0){normal.negate();points.reverse();face.reverse();}
  const upright = Math.abs(normal.y) > .9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
  const right = upright.clone().cross(normal).normalize(), up = normal.clone().cross(right);
  const plane = points.map(point => {const offset = point.clone().sub(center);return [offset.dot(right), offset.dot(up)];});
  const extent = Math.max(...plane.flat().map(Math.abs));
  return {face,normal,right,up,uv:plane.map(([x,y]) => [.5 + x / extent * .43, .5 + y / extent * .43])};
}
function faceTexture(label, color, surface, uv) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const c = canvas.getContext("2d");
  const ink = color < 0 ? '#365446' : paletteText[color];
  c.fillStyle = color < 0 ? "#edf0e6" : palette[color];
  c.fillRect(0, 0, 512, 512);
  if (surface) {
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.globalAlpha = .16;
    c.drawImage(surface, 0, 0, 512, 512);
    c.restore();
  }
  const outline = (scale, stroke, width) => {
    c.beginPath();
    uv.forEach(([u,v],i) => {const x=256+(u-.5)*512*scale,y=256-(v-.5)*512*scale;i?c.lineTo(x,y):c.moveTo(x,y);});
    c.closePath();c.strokeStyle=stroke;c.lineWidth=width;c.lineJoin='round';c.stroke();
  };
  outline(.94, color < 0 ? '#afbeaa' : '#e5ead7bb', 7);
  outline(.84, color < 0 ? '#ffffffd9' : '#ffffff40', 2);
  c.fillStyle = ink;
  c.globalAlpha = .5;
  c.fillRect(228, 176, 56, 3);
  c.globalAlpha = 1;
  c.font = '600 64px "Microsoft YaHei",sans-serif';
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(label, 256, 250);
  c.font = '22px Consolas,monospace';
  c.globalAlpha = .8;
  c.fillText(color < 0 ? '\u00b7 \u00b7 \u00b7' : String(color + 1).padStart(2, '0'), 256, 319);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
class SolidView {
  constructor(container, name, onPaint, onRotate, rotation, surfaceUrl) {
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
    this.group.rotation.set(rotation?.x ?? -0.32, rotation?.y ?? 0.55, rotation?.z ?? 0);
    this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(16777215, 7441027, 2.4));
    const light = new THREE.DirectionalLight(16777215, 2);
    light.position.set(-3, 5, 6);
    this.scene.add(light);
    this.meshes = this.spec.faces.map((face, id) => {
      const ps = [], uvs = [], frame=faceFrame(this.spec,face),{uv}=frame;
      for (let t = 1; t < face.length - 1; t++) for (const j of [0, t, t + 1]) {
        ps.push(...this.spec.vertices[frame.face[j]]);
        uvs.push(...uv[j]);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(ps, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ map: faceTexture(this.spec.labels[id], -1, null, uv), roughness: 0.9, metalness: 0.02, side: THREE.FrontSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.face = id;
      mesh.userData.uv = uv;
      mesh.userData.frame=frame;
      this.group.add(mesh);
      return mesh;
    });
    for (const edge of faceTopology(this.spec)) {
      const [a, b] = edge.key.split("-").map(Number), geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...this.spec.vertices[a]), new THREE.Vector3(...this.spec.vertices[b])]);
      this.group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 3362373 })));
    }
    this.hoverFace=null;
    this.hoverStrength=this.meshes.map(()=>0);
    this.hoverOutline=new THREE.LineLoop(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#95c5cb',transparent:true,opacity:0,depthWrite:false}));
    this.hoverOutline.scale.setScalar(1.003);
    this.hoverOutline.visible=false;
    this.group.add(this.hoverOutline);
    this.ray = new THREE.Raycaster();
    this.colors = [];
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (e) => {
      cancelAnimationFrame(this.rotationFrame);
      this.hover(null);
      canvas.style.cursor='grabbing';
      this.drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag) {this.hover(e.pointerType==='touch'?null:this.pick(e.clientX,e.clientY));return;}
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
      canvas.style.cursor='grab';
      if (hit !== null) this.onPaint(hit);
    });
    canvas.addEventListener("pointercancel", () => {
      this.drag = null;
      this.hover(null);
      canvas.style.cursor='grab';
    });
    canvas.addEventListener('pointerleave',()=>{if(!this.drag)this.hover(null);});
    canvas.addEventListener("keydown", (e) => {
      const changes = { ArrowLeft: [0, -0.2], ArrowRight: [0, 0.2], ArrowUp: [-0.2, 0], ArrowDown: [0.2, 0] };
      if (changes[e.key]) {
        cancelAnimationFrame(this.rotationFrame);
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
    if (surfaceUrl) loadSurface(surfaceUrl).then(image => {
      // Rendering is rebuilt after edits; late image loads must not revive disposed views.
      if (this.disposed || !image) return;
      this.surface = image;
      this.setColors(this.colors, this.conflicts, true);
      this.renderer.domElement.dataset.surface = 'loaded';
    });
  }
  remember() {
    this.onRotate({ x: this.group.rotation.x, y: this.group.rotation.y, z: this.group.rotation.z });
  }
  hover(id) {
    if(this.disposed||id===this.hoverFace)return;
    this.hoverFace=id;
    this.renderer.domElement.style.cursor=id===null?'grab':'pointer';
    if(id!==null){
      this.hoverOutline.geometry.dispose();
      this.hoverOutline.geometry=new THREE.BufferGeometry().setFromPoints(this.spec.faces[id].map(index=>new THREE.Vector3(...this.spec.vertices[index])));
      this.hoverOutline.visible=true;
    }
    cancelAnimationFrame(this.hoverFrame);
    const from=[...this.hoverStrength],start=performance.now();
    const step=now=>{
      if(this.disposed)return;
      const reduced=document.documentElement.dataset.motion==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches;
      const t=reduced?1:Math.min(1,(now-start)/170),amount=1-(1-t)**3;
      this.hoverStrength=from.map((value,index)=>value+((index===id?1:0)-value)*amount);
      this.meshes.forEach((mesh,index)=>{
        mesh.material.emissive.set(this.conflicts?.includes(index)?'#6b110d':'#29434a');
        if(!this.conflicts?.includes(index))mesh.material.emissive.multiplyScalar(this.hoverStrength[index]*.45);
      });
      this.hoverOutline.material.opacity=(id===null?Math.max(...this.hoverStrength):this.hoverStrength[id])*.7;
      this.render();
      if(t<1)this.hoverFrame=requestAnimationFrame(step);
      else if(id===null)this.hoverOutline.visible=false;
    };
    step(start);
  }
  pick(x, y) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1), this.camera);
    return this.ray.intersectObjects(this.meshes)[0]?.object.userData.face ?? null;
  }
  setColors(colors, conflicts = [], refresh = false) {
    this.meshes.forEach((mesh, i) => {
      if (refresh || this.colors[i] !== colors[i]) {
        mesh.material.map.dispose();
        mesh.material.map = faceTexture(this.spec.labels[i], colors[i], this.surface, mesh.userData.uv);
        mesh.material.needsUpdate = true;
      }
      mesh.material.emissive.set(conflicts.includes(i) ? '#6b110d' : '#29434a');
      if(!conflicts.includes(i))mesh.material.emissive.multiplyScalar((this.hoverStrength[i]??0)*.45);
    });
    this.colors = [...colors];
    this.conflicts = [...conflicts];
    this.render();
  }
  reset() {
    this.rotateTo(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.32,.55,0)));
  }
  focusFace(id) {
    const {right,up,normal}=this.meshes[id].userData.frame;
    const basis=new THREE.Matrix4().makeBasis(right,up,normal);
    this.rotateTo(new THREE.Quaternion().setFromRotationMatrix(basis).invert());
  }
  rotateTo(target) {
    cancelAnimationFrame(this.rotationFrame);
    this.hover(null);
    const from=this.group.quaternion.clone(),start=performance.now();
    const step=now=>{
      if(this.disposed)return;
      const reduced=document.documentElement.dataset.motion==='reduced'||matchMedia('(prefers-reduced-motion: reduce)').matches;
      const t=reduced?1:Math.min(1,(now-start)/260);
      this.group.quaternion.slerpQuaternions(from,target,1-(1-t)**3);
      this.remember();this.render();
      if(t<1)this.rotationFrame=requestAnimationFrame(step);
    };
    step(start);
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
    this.disposed = true;
    cancelAnimationFrame(this.hoverFrame);
    cancelAnimationFrame(this.rotationFrame);
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
