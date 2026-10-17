import {solids,faceTopology} from './solids.mjs';

const network=(labels,xy,edges)=>({nodes:labels.map((label,i)=>({label,x:xy[i][0],y:xy[i][1]})),edges:edges.map(([a,b,w=1,candidate=false])=>({a,b,w,candidate}))});
const ringPositions=(n,cx=500,cy=290,rx=350,ry=220)=>Array.from({length:n},(_,i)=>[cx+rx*Math.cos(-Math.PI/2+2*Math.PI*i/n),cy+ry*Math.sin(-Math.PI/2+2*Math.PI*i/n)]);
const solid=name=>({solid:name,nodes:solids[name].labels.map(label=>({label,x:0,y:0})),edges:faceTopology(solids[name]).map(({a,b})=>({a,b}))});

export function refineLevels(levels){
  const update=(id,data)=>Object.assign(levels.find(l=>l.id===id),data,{revision:2});
  const loop=network(['调度','北井','东井','桥站','南井','西井','仓站','田站'],ringPositions(8),[[0,1],[1,2],[2,3],[3,0],[3,4],[4,5],[5,6],[6,3],[6,7]]);
  update('01-02.3',{...loop,title:'双环里的支路'});
  const relay=network(['西端','西泵','西仓','中继','东仓','东泵','东端','北田','南田'],[[90,290],[240,290],[380,290],[520,290],[660,290],[800,290],[930,290],[520,100],[520,480]],[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[3,7],[3,8]]);
  update('01-03.2',{...relay,title:'覆盖两岸',limit:3,perfect:'最少 3 轮，并准确预测'});
  const mesh=network(['西泵','北仓','东泵','田站','南渠','西仓','中继','桥站'],[[140,140],[370,100],[650,100],[860,230],[810,450],[530,470],[280,430],[490,280]],[[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,0],[0,7],[2,7],[4,7],[6,7]]);
  update('01-04.1',{...mesh,title:'环网留线',perfect:'只留 7 条线路'});
  update('01-04.2',{...network(['西仓','西泵','西渠','西田','西桥','东泵','东仓','东田','东桥'],[[120,150],[330,120],[430,300],[300,460],[110,410],[610,140],[850,140],[850,440],[610,440]],[[0,1],[1,2],[2,3],[3,4],[4,0],[1,3],[5,6],[6,7],[7,8],[8,5],[5,7]]),perfect:'两片网络合计只留 7 条线'});
  update('02-02.2',{...network(['仓站','北闸','近岸','中桥','田口','南渠','收货站'],[[110,290],[320,100],[320,450],[520,230],[730,100],[700,450],[920,290]],[[0,1,2],[0,2,4],[1,3,6],[2,3,2],[3,4,2],[4,6,3],[2,5,5],[5,6,5],[1,4,9],[3,6,7]]),target:6,budget:13,perfect:'总用时 11',title:'先绕再快'});
  const delivery=network(['仓站','西闸','南泵','中桥','北仓','田站','东港','东闸'],[[110,280],[300,100],[300,450],[490,270],[650,90],[670,440],[900,180],[900,440]],[[0,1,3],[0,2,5],[1,3,2],[2,3,1],[1,4,7],[3,4,3],[3,5,4],[2,5,6],[4,6,2],[5,6,3],[5,7,2],[6,7,4]]);
  update('02-03.2',{...delivery,targets:[4,6,7],budget:31,perfect:'三份运单合计用时 29'});
  const transit=network(['中站','东站','西站','南站'],[[470,210],[780,180],[160,180],[650,440]],[[0,1,3],[0,2,2],[1,2,9],[0,3,6],[1,3,1]]);
  transit.edges[2].bend=[460,-30];
  update('02-S1.1',{...transit,stage:0,title:'第一次允许中转',perfect:'找全本轮变快或新接通的组合'});
  const extended=network(['中站','东站','西站','南站','田站'],[[370,230],[660,190],[120,180],[640,450],[900,340]],[[0,1,3],[0,2,2],[1,2,9],[0,3,6],[1,3,1],[1,4,4],[3,4,7]]);
  extended.edges[2].bend=[400,-20];
  update('02-S1.2',{...extended,stage:1,title:'接续东站中转'});
  const build=network(['电站','北泵','西仓','中桥','北田','南渠','东仓','东港'],[[100,280],[300,110],[310,450],[500,270],[680,90],[670,450],[890,180],[900,440]],[[0,1,2],[0,2,4],[1,2,3],[1,3,6],[2,3,2],[3,4,3],[4,6,2],[3,5,5],[5,7,1],[6,7,4],[5,6,6],[2,5,7]]);
  update('03-02.1',{...build,title:'三片电网合拢',budget:18,perfect:'总造价 17'});
  update('03-03.2',{...network(['测绘','地基','水管','支架','布线','试水','验收'],[[120,290],[340,140],[340,430],[570,120],[570,290],[570,460],[850,290]],[[0,1],[0,2],[1,3],[1,4],[2,4],[2,5],[3,6],[4,6],[5,6]]),title:'多路汇合开工'});
  const project=network(['开工','架线','泵组','渠闸','试灯','试水','验收'],[[100,290],[320,100],[320,290],[320,480],[620,150],[620,420],[870,290]],[[0,1],[0,2],[0,3],[1,4],[2,4],[2,5],[3,5],[4,6],[5,6]]);
  project.nodes.forEach((n,i)=>n.duration=[1,4,3,4,2,3,1][i]);
  update('03-04.2',{...project,title:'三线并工',budget:6,deadline:6,perfect:'只用 5 份加速'});
  const grid={nodes:[],edges:[]};
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    const i=row*3+col,x=180+col*210,y=70+row*155;
    grid.nodes.push({label:['西北','北田','东北','西田','中田','东田','西南','南田','东南'][i],x:x+105,y:y+78,polygon:[[x,y],[x+210,y],[x+210,y+155],[x,y+155]]});
    if(col<2)grid.edges.push({a:i,b:i+1});if(row<2)grid.edges.push({a:i,b:i+3});
  }
  update('04-01.2',{...grid,title:'九田交错',maxColors:3,perfect:'只用 2 色'});
  const outer=ringPositions(7,500,300,390,260),inner=ringPositions(7,500,300,145,100);
  const districts={nodes:[{label:'中枢',x:500,y:300,polygon:inner}],edges:[]};
  outer.forEach((p,i)=>{
    const j=(i+1)%7,polygon=[p,outer[j],inner[j],inner[i]];
    districts.nodes.push({label:`田区${i+1}`,polygon,x:polygon.reduce((s,p)=>s+p[0],0)/4,y:polygon.reduce((s,p)=>s+p[1],0)/4});
    districts.edges.push({a:0,b:i+1},{a:i+1,b:j+1});
  });
  update('04-01.4',{...districts,title:'七田围中枢',maxColors:4,perfect:'使用 4 色'});
  update('04-02.1',{...solid('tetra'),title:'转动与展开'});
  update('04-02.2',{...solid('prism'),title:'五棱灯塔',maxColors:4,perfect:'只用 4 色'});
  update('04-02.3',{...solid('truncated'),title:'十四面灯阵',maxColors:4,perfect:'只用 3 色'});
  const shifts=network(['甲班','乙班','丙班','丁班','戊班','泵站岗','架线岗','闸门岗','检修岗','仓运岗'],Array.from({length:10},(_,i)=>[i<5?220:780,90+(i%5)*100]),[[0,5],[0,6],[1,6],[1,7],[2,7],[2,8],[3,8],[3,9],[4,5]]);
  shifts.nodes.forEach((n,i)=>n.side=i<5?'left':'right');
  update('04-03.2',{...shifts,title:'五班连环换岗',coverage:5,perfect:'全部 5 岗有人'});
  const shared=network(['西仓','西泵','西枢','中泵','东枢','东仓','东泵'],[[120,130],[120,450],[340,290],[520,90],[680,290],[880,130],[880,450]],[[0,1],[1,2],[2,0],[2,3],[3,4],[4,2],[4,5],[5,6],[6,4]]);
  update('05-01.3',{...shared,title:'三环共站'});
  const infection=network(['源站','北关','南关','中继','北仓','南仓','东闸','田站','核心'],[[90,290],[270,110],[270,460],[460,280],[620,90],[620,460],[790,220],[840,470],[930,90]],[[0,1],[0,2],[1,3],[2,3],[1,4],[2,5],[3,6],[4,6],[5,7],[7,6],[6,8]]);
  update('05-02.2',{...infection,target:8,title:'三路交汇的故障',budget:2,perfect:'最终仅 1 台设备受影响'});
  update('05-03.1',{...network(['源站','北线','中线','南线','汇流','核心'],[[120,290],[360,90],[360,290],[360,490],[680,290],[900,290]],[[0,1],[1,5],[0,2],[2,4],[4,5],[0,3],[3,5],[1,2],[2,3]]),target:5,title:'切断三路来讯',perfect:'只停用 3 条线路'});
  const backup=network(['西仓','西泵','西闸','中闸','中泵','东闸','东泵','东仓','东田'],[[90,100],[90,440],[270,270],[440,100],[440,440],[610,270],[780,100],[920,270],[780,440]],[[0,1],[1,2],[2,0],[2,3],[3,4],[4,5],[5,3],[5,6],[6,7],[7,8],[8,6],[0,4,2,true],[4,8,3,true],[1,7,7,true],[0,7,8,true]]);
  backup.edges[3].bend=[310,70];backup.edges[7].bend=[650,80];backup.edges[11].bend=[60,560];backup.edges[14].b=6;backup.edges[14].bend=[430,-40];backup.edges[13].bend=[500,610];
  update('05-03.2',{...backup,title:'两处断线一起防',budget:7,perfect:'组合加线，总造价 5'});
  const nodeBackup=structuredClone(shared);
  nodeBackup.edges.push({a:1,b:3,w:2,candidate:true,bend:[300,510]},{a:3,b:5,w:3,candidate:true,bend:[680,30]},{a:0,b:6,w:8,candidate:true,bend:[490,640]},{a:1,b:5,w:7,candidate:true,bend:[950,610]});
  update('05-03.3',{...nodeBackup,title:'两座枢纽的后备',budget:7,perfect:'组合加线，总造价 5'});
}
