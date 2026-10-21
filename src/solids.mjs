import {unfold,planeFaces} from './solid-nets.mjs';
const solids = {
  cube: {
    vertices: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]],
    faces: [[0, 1, 2, 3], [5, 4, 7, 6], [3, 2, 6, 7], [4, 5, 1, 0], [1, 5, 6, 2], [4, 0, 3, 7]],
    labels: ["前", "后", "上", "下", "右", "左"],
    net: [[420, 210], [700, 210], [420, 70], [420, 350], [560, 210], [280, 210]],
    netVertices: [[3, 2, 1, 0], [6, 7, 4, 5], [7, 6, 2, 3], [0, 1, 5, 4], [2, 6, 5, 1], [7, 3, 0, 4]],
    optimum: 3
  },
  tetra: {
    vertices: [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]],
    faces: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
    labels: ["甲", "乙", "丙", "丁"],
    net: [[[490, 110], [340, 370], [640, 370]], [[490, 110], [640, 370], [790, 110]], [[490, 110], [190, 110], [340, 370]], [[340, 370], [490, 630], [640, 370]]],
    netVertices: [[0, 2, 1], [0, 1, 3], [0, 3, 2], [2, 3, 1]],
    optimum: 4
  }
};
const prismVertices=Array.from({length:10},(_,i)=>{
  const angle=(i%5)*Math.PI*2/5;
  return [Math.cos(angle)*1.3, i<5?-.85:.85, Math.sin(angle)*1.3];
});
solids.prism=unfold({
  vertices:prismVertices,
  faces:[[4,3,2,1,0],[5,6,7,8,9],...Array.from({length:5},(_,i)=>[i,(i+1)%5,(i+1)%5+5,i+5])],
  labels:['底','顶','侧一','侧二','侧三','侧四','侧五'],optimum:4
});
const truncatedVertices=[];
for(const zero of [0,1,2])for(const swap of [false,true])for(const a of [-1,1])for(const b of [-1,1]){
  const remaining=[0,1,2].filter(i=>i!==zero),v=[0,0,0];
  v[remaining[0]]=a*(swap?2:1);v[remaining[1]]=b*(swap?1:2);truncatedVertices.push(v);
}
const planes=[];
for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){const n=[0,0,0];n[axis]=sign;planes.push([n,2]);}
for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])planes.push([[x,y,z],3]);
solids.truncated=unfold({
  vertices:truncatedVertices.map(v=>v.map(x=>x*.68)),
  faces:planeFaces(truncatedVertices,planes),
  labels:['方一','方二','方三','方四','方五','方六','六一','六二','六三','六四','六五','六六','六七','六八'],optimum:3
});
function faceTopology(solid) {
  const byEdge = /* @__PURE__ */ new Map();
  solid.faces.forEach((face, f) => face.forEach((v, i) => {
    const key = [v, face[(i + 1) % face.length]].sort((a, b) => a - b).join("-");
    if (!byEdge.has(key)) byEdge.set(key, []);
    byEdge.get(key).push(f);
  }));
  return [...byEdge.entries()].map(([key, faces], i) => ({ id: i, key, a: faces[0], b: faces[1] }));
}
export {
  faceTopology,
  solids
};
