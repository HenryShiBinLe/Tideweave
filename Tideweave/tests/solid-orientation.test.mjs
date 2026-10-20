import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {solids} from '../src/solids.mjs';
import {faceFrame,SolidView} from '../src/solid-view.mjs';

test('every solid face has outward triangles and unmirrored texture axes',()=>{
  for(const [name,spec] of Object.entries(solids))for(const [id,face] of spec.faces.entries()){
    const frame=faceFrame(spec,face),points=frame.face.map(i=>new THREE.Vector3(...spec.vertices[i]));
    const center=points.reduce((sum,p)=>sum.add(p),new THREE.Vector3()).divideScalar(points.length);
    assert.ok(frame.normal.dot(center)>0,`${name} ${id}: outward normal`);
    assert.ok(frame.right.clone().cross(frame.up).dot(frame.normal)>.999,`${name} ${id}: right-handed text basis`);
    for(let i=1;i<points.length-1;i++){
      const normal=points[i].clone().sub(points[0]).cross(points[i+1].clone().sub(points[0]));
      assert.ok(normal.dot(frame.normal)>0,`${name} ${id}: front-facing triangle`);
      const [a,b,c]=[frame.uv[0],frame.uv[i],frame.uv[i+1]];
      assert.ok((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])>0,`${name} ${id}: no mirrored UV triangle`);
    }
    const geometry=new THREE.BufferGeometry().setFromPoints(points.flatMap((_,i)=>i>0&&i<points.length-1?[points[0],points[i],points[i+1]]:[]));
    const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.FrontSide}));
    const ray=new THREE.Raycaster(center.clone().addScaledVector(frame.normal,3),frame.normal.clone().negate());
    assert.ok(ray.intersectObject(mesh).length,`${name} ${id}: selectable from outside`);
    geometry.dispose();mesh.material.dispose();
  }
});

test('face focus keeps text upright and remembers roll through a redraw',()=>{
  for(const spec of Object.values(solids))for(const face of spec.faces){
    const frame=faceFrame(spec,face);let target,rotation;
    SolidView.prototype.focusFace.call({meshes:[{userData:{frame}}],rotateTo:q=>target=q},0);
    for(const [axis,expected] of [[frame.right,[1,0,0]],[frame.up,[0,1,0]],[frame.normal,[0,0,1]]])
      assert.ok(axis.clone().applyQuaternion(target).distanceTo(new THREE.Vector3(...expected))<1e-8);
    const group=new THREE.Group();group.quaternion.copy(target);
    SolidView.prototype.remember.call({group,onRotate:value=>rotation=value});
    const restored=new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x,rotation.y,rotation.z));
    assert.ok(restored.angleTo(target)<1e-7,'paint redraw preserves the entire view rotation');
  }
});
