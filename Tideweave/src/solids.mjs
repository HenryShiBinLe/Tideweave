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
