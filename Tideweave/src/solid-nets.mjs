// Unfold convex faces across real shared edges; reject overlapping placements.
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const norm=a=>Math.sqrt(dot(a,a));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function inside(p,poly){
  const signs=poly.map((a,i)=>turn(a,poly[(i+1)%poly.length],p));
  return signs.every(v=>v>1e-7)||signs.every(v=>v< -1e-7);
}
function overlaps(a,b){
  if(a.some(p=>inside(p,b))||b.some(p=>inside(p,a)))return true;
  const center=p=>[0,1].map(k=>p.reduce((s,v)=>s+v[k],0)/p.length);
  if(inside(center(a),b)||inside(center(b),a))return true;
  return a.some((p,i)=>b.some((q,j)=>{
    const r=a[(i+1)%a.length],s=b[(j+1)%b.length];
    return turn(p,r,q)*turn(p,r,s)<-1e-8&&turn(q,s,p)*turn(q,s,r)<-1e-8;
  }));
}
export function unfold(spec){
  const {vertices,faces}=spec;
  const local=(face,a,b)=>{
    const origin=vertices[a],u=sub(vertices[b],origin),length=norm(u),axis=u.map(v=>v/length);
    const other=face.find(v=>v!==a&&v!==b),v=sub(vertices[other],origin);
    const perpendicular=sub(v,axis.map(x=>x*dot(v,axis))),h=norm(perpendicular),y=perpendicular.map(x=>x/h);
    return face.map(id=>{const p=sub(vertices[id],origin);return [dot(p,axis),dot(p,y)];});
  };
  const shared=[];
  faces.forEach((f,i)=>faces.forEach((g,j)=>{
    if(j<=i)return;
    const ids=f.filter(v=>g.includes(v));
    if(ids.length===2)shared.push({i,j,ids});
  }));
  let placed;
  for(let attempt=0;attempt<256;attempt++){
    let seed=attempt+1;
    const random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
    placed=new Map([[0,local(faces[0],faces[0][0],faces[0][1])]]);
    while(placed.size<faces.length){
      const candidates=shared.filter(e=>placed.has(e.i)!==placed.has(e.j)).map(e=>({...e,rank:random()})).sort((a,b)=>a.rank-b.rank);
      let added=false;
      for(const edge of candidates){
        const from=placed.has(edge.i)?edge.i:edge.j,to=from===edge.i?edge.j:edge.i,[a,b]=edge.ids;
        const base=placed.get(from),A=base[faces[from].indexOf(a)],B=base[faces[from].indexOf(b)];
        const dx=B[0]-A[0],dy=B[1]-A[1],length=Math.hypot(dx,dy);
        const center=base.reduce((s,p)=>[s[0]+p[0]/base.length,s[1]+p[1]/base.length],[0,0]);
        const sign=turn(A,B,center)>0?-1:1;
        const poly=local(faces[to],a,b).map(([x,y])=>[A[0]+x*dx/length-sign*y*dy/length,A[1]+x*dy/length+sign*y*dx/length]);
        if([...placed.values()].some(other=>overlaps(poly,other)))continue;
        placed.set(to,poly);added=true;break;
      }
      if(!added)break;
    }
    if(placed.size===faces.length)break;
  }
  if(placed.size!==faces.length)throw new Error('Cannot unfold solid without overlaps');
  const points=[...placed.values()].flat(),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  const minX=Math.min(...xs),minY=Math.min(...ys),w=Math.max(...xs)-minX,h=Math.max(...ys)-minY,scale=Math.min(880/w,490/h);
  spec.net=faces.map((_,i)=>placed.get(i).map(([x,y])=>[(x-minX-w/2)*scale+500,(y-minY-h/2)*scale+300]));
  spec.netVertices=faces.map(f=>[...f]);
  spec.netViewBox='0 0 1000 600';
  return spec;
}

export function planeFaces(vertices,planes){
  return planes.map(([normal,value])=>{
    const ids=vertices.map((v,i)=>Math.abs(dot(v,normal)-value)<1e-6?i:-1).filter(i=>i>=0);
    const center=[0,1,2].map(k=>ids.reduce((s,i)=>s+vertices[i][k],0)/ids.length);
    const axis=sub(vertices[ids[0]],center),vertical=cross(normal,axis);
    return ids.sort((a,b)=>{
      const angle=i=>{const d=sub(vertices[i],center);return Math.atan2(dot(d,vertical)/norm(vertical),dot(d,axis)/norm(axis));};
      return angle(a)-angle(b);
    });
  });
}
