import Graph from 'graphology';
import components from 'graphology-components';
import shortestPath from 'graphology-shortest-path';

export const sum = xs => xs.reduce((a,b)=>a+b,0);
export const sameSet = (a,b) => a.length === b.length && new Set(a).size === a.length && a.every(x=>b.includes(x));
export function graphOf(level, indices=null, removed=[]) {
  const g = new Graph({type: level.directed ? 'directed' : 'undirected'});
  level.nodes.forEach((_,i)=>{if(!removed.includes(i)) g.addNode(String(i));});
  level.edges.forEach((e,i)=>{
    if ((indices ? indices.includes(i) : !e.candidate) && g.hasNode(String(e.a)) && g.hasNode(String(e.b)))
      g.addEdgeWithKey(String(i), String(e.a), String(e.b), {weight:e.w??1});
  });
  return g;
}
export function groups(level, indices=null, removed=[]) {
  return components.connectedComponents(graphOf({...level,directed:false},indices,removed)).map(g=>g.map(Number));
}
export function strongGroups(level) {
  return components.stronglyConnectedComponents(graphOf(level)).map(g=>g.map(Number));
}
export function distances(level, source, indices=null, removed=[]) {
  if (removed.includes(source)) return level.nodes.map(()=>Infinity);
  const data = shortestPath.dijkstra.singleSource(graphOf(level,indices,removed), String(source), 'weight');
  return level.nodes.map((_,i)=> data[i] ? pathCost(level,data[i].map(Number)) : Infinity);
}
export function shortest(level, a,b) {
  return shortestPath.dijkstra.bidirectional(graphOf(level),String(a),String(b),'weight')?.map(Number) ?? [];
}
export function edgeBetween(level,a,b) {
  return level.edges.findIndex(e=>!e.candidate && ((e.a===a&&e.b===b)||(!level.directed&&e.a===b&&e.b===a)));
}
export function walkEdges(level,path) { return path.slice(1).map((v,i)=>edgeBetween(level,path[i],v)); }
export function pathCost(level,path) {
  const es=walkEdges(level,path); return es.includes(-1)?Infinity:sum(es.map(i=>level.edges[i].w??1));
}
export function subsets(items,max=items.length) {
  const out=[];
  for(let m=0;m<2**items.length;m++) {
    const s=items.filter((_,i)=>(m & 2**i)!==0);
    if(s.length<=max) out.push(s);
  }
  return out;
}
export function mst(level) {
  const parent=level.nodes.map((_,i)=>i), selected=[];
  const root=x=>parent[x]===x?x:(parent[x]=root(parent[x]));
  level.edges.map((e,i)=>({...e,i})).filter(e=>!e.candidate).sort((a,b)=>(a.w??1)-(b.w??1)).forEach(e=>{
    const a=root(e.a),b=root(e.b); if(a!==b){parent[a]=b;selected.push(e.i);}
  });
  return {edges:selected, cost:sum(selected.map(i=>level.edges[i].w??1))};
}
export function chromatic(level) {
  const order=level.nodes.map((_,i)=>i).sort((a,b)=>level.edges.filter(e=>e.a===b||e.b===b).length-level.edges.filter(e=>e.a===a||e.b===a).length);
  for(let k=1;k<=level.nodes.length;k++){
    const colors=level.nodes.map(()=>-1);
    const search=p=>{
      if(p===order.length) return true;
      const n=order[p];
      for(let c=0;c<k;c++){
        if(level.edges.some(e=>(e.a===n&&colors[e.b]===c)||(e.b===n&&colors[e.a]===c))) continue;
        colors[n]=c; if(search(p+1)) return true; colors[n]=-1;
      }
      return false;
    };
    if(search(0)) return {count:k,colors};
  }
}
export function maximumMatching(level) {
  const right=new Map();
  const visit=(a,seen)=>{
    for(const [i,e] of level.edges.entries()){
      if(e.a!==a||seen.has(e.b)) continue;
      seen.add(e.b);
      if(!right.has(e.b)||visit(level.edges[right.get(e.b)].a,seen)){right.set(e.b,i); return true;}
    }
    return false;
  };
  level.nodes.forEach((n,i)=>{if(n.side==='left') visit(i,new Set());});
  return [...right.values()];
}
export function criticalSchedule(level, boosts=[]) {
  const starts=level.nodes.map(()=>0),ends=level.nodes.map(()=>0),order=[],pending=new Set(level.nodes.map((_,i)=>i));
  while(pending.size){
    const ready=[...pending].filter(n=>level.edges.filter(e=>e.b===n).every(e=>!pending.has(e.a)));
    if(!ready.length) return {total:Infinity,starts,ends,order};
    for(const n of ready){
      starts[n]=Math.max(0,...level.edges.filter(e=>e.b===n).map(e=>ends[e.a]));
      ends[n]=starts[n]+Math.max(1,level.nodes[n].duration-(boosts[n]??0));
      order.push(n);pending.delete(n);
    }
  }
  return {total:Math.max(...ends),starts,ends,order};
}
export function optimalBoost(level){
  let best=null;
  const visit=(i,left,bs)=>{
    if(i===level.nodes.length){
      const time=criticalSchedule(level,bs).total,cost=sum(bs);
      if(time<=level.deadline&&(!best||cost<best.cost)) best={cost,boosts:[...bs],time};
      return;
    }
    for(let b=0;b<=Math.min(left,level.nodes[i].duration-1);b++) visit(i+1,left-b,[...bs,b]);
  };
  visit(0,level.budget,[]);return best;
}
export function faults(level,kind){
  const base=groups(level).length;
  return (kind==='edge'?level.edges:level.nodes).map((_,i)=>i).filter(i=>
    (kind==='edge'?groups(level,level.edges.map((_,j)=>j).filter(j=>i!==j)):groups(level,null,[i])).length>base);
}
export function floydStages(level){
  let d=level.nodes.map((_,i)=>level.nodes.map((_,j)=>i===j?0:Infinity));
  for(const e of level.edges){d[e.a][e.b]=e.w??1;if(!level.directed)d[e.b][e.a]=e.w??1;}
  const stages=[];
  level.nodes.forEach((_,k)=>{
    const before=d.map(r=>[...r]);
    d=d.map((r,i)=>r.map((v,j)=>Math.min(v,before[i][k]+before[k][j])));
    const improved=[];
    d.forEach((r,i)=>r.forEach((v,j)=>{if(i<j&&v<before[i][j]) improved.push(`${i}-${j}`);}));
    stages.push({k,before,after:d.map(r=>[...r]),improved});
  });
  return stages;
}
export function postman(level){
  const odd=level.nodes.map((_,i)=>i).filter(i=>level.edges.filter(e=>e.a===i||e.b===i).length%2);
  const pair=xs=>{
    if(!xs.length)return {cost:0,pairs:[]};
    let best={cost:Infinity,pairs:[]};
    xs.slice(1).forEach(b=>{
      const rest=pair(xs.filter(x=>x!==xs[0]&&x!==b));
      const route=shortest(level,xs[0],b),cost=pathCost(level,route)+rest.cost;
      if(cost<best.cost)best={cost,pairs:[route,...rest.pairs]};
    });return best;
  };
  const extra=pair(odd); return {...extra,total:sum(level.edges.map(e=>e.w??1))+extra.cost,odd};
}
export function eulerWalk(level,duplicates=[]){
  const items=level.edges.map((e,i)=>({...e,id:i}));
  duplicates.forEach(i=>items.push({...level.edges[i],id:items.length}));
  const stack=[level.source??0],route=[],used=new Set();
  while(stack.length){
    const n=stack.at(-1),e=items.find(e=>!used.has(e.id)&&(e.a===n||e.b===n));
    if(e){used.add(e.id);stack.push(e.a===n?e.b:e.a);}else route.unshift(stack.pop());
  }return route;
}
export function cycle(level){
  for(const start of level.nodes.map((_,i)=>i)){
    const visit=path=>{
      for(const e of level.edges.filter(e=>e.a===path.at(-1))){
        if(e.b===start&&path.length>1)return [...path,start];
        if(!path.includes(e.b)){const r=visit([...path,e.b]);if(r)return r;}
      }return null;
    };
    const r=visit([start]);if(r)return r;
  }return [];
}
