// Original 2.5D waterworks, drawn locally without model files or reference artwork.
export function drawCity(canvas, restored = 0) {
  const w = 2200, h = 820;
  canvas.width = w; canvas.height = h;
  const c = canvas.getContext('2d');
  c.fillStyle = '#e4e8df'; c.fillRect(0,0,w,h);
  const poly=(points,fill,stroke)=>{
    c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();
    if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}
  };
  const iso=(x,y,z=0)=>[1370+(x-y)*1.05,80+(x+y)*.43-z];
  const tile=(x,y,dx,dy,fill)=>poly([iso(x,y),iso(x+dx,y),iso(x+dx,y+dy),iso(x,y+dy)],fill,'#eff1e9');
  const line=(points,color,width=1)=>{
    c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.strokeStyle=color;c.lineWidth=width;c.lineJoin='miter';c.stroke();
  };
  const beam=(x,y,dx,dy,z,top='#e9ede5',front='#98a99e',side='#5c726b')=>{
    poly([iso(x+dx,y),iso(x+dx,y+dy),iso(x+dx,y+dy,z),iso(x+dx,y,z)],side);
    poly([iso(x,y+dy),iso(x+dx,y+dy),iso(x+dx,y+dy,z),iso(x,y+dy,z)],front);
    poly([iso(x,y,z),iso(x+dx,y,z),iso(x+dx,y+dy,z),iso(x,y+dy,z)],top,'#f5f7f0');
  };
  // Agricultural parcels sit at a lower plane than the concrete infrastructure.
  for(let x=-720;x<970;x+=104)for(let y=-240;y<1100;y+=94){
    const k=Math.abs(Math.round(x/104)*3+Math.round(y/94))%5;
    const palette=['#aab393','#c8ca9a','#b6c3aa','#d5d7bd','#99b2a7'];
    tile(x,y,98,88,palette[k]);
    for(let row=13;row<88;row+=13)line([iso(x+7,y+row),iso(x+91,y+row)],'#f5f4d250',1);
  }
  const river=[[-900,160],[-540,190],[-260,255],[20,385],[330,420],[700,500],[1130,670]];
  line(river.map(p=>iso(...p)),'#f0f2e8',146);
  line(river.map(p=>iso(...p)),'#92b4ad',124);
  line(river.map(p=>iso(...p)),'#5e9391',90);
  for(let k=-20;k<=20;k+=10)line(river.map(([x,y])=>iso(x,y+k)),'#c5e0cf55',1.4);
  tile(-670,-155,1640,32,'#858e85');tile(-95,-240,32,1330,'#858e85');
  line([iso(-670,-139),iso(970,-139)],'#f4f1dc',2);
  line([iso(-79,-240),iso(-79,1090)],'#f4f1dc',2);
  for(const [x,y] of [[-430,205],[20,385],[545,465]]){
    beam(x-28,y-130,56,270,25,'#f2f3e9','#c5cdbf','#61766d');
    for(const offset of [-25,23])line([iso(x+offset,y-130,29),iso(x+offset,y+140,29)],'#314d48',3);
    for(let j=-110;j<140;j+=36){line([iso(x-26,y+j,25),iso(x-26,y+j,45)],'#546b61',2);line([iso(x+25,y+j,25),iso(x+25,y+j,45)],'#546b61',2);}
  }
  // Stepped control building: industrial massing, not a replica of a reference landmark.
  tile(-415,-90,260,230,'#d5ddd0');
  beam(-390,-65,205,160,48);
  beam(-375,-45,175,125,95,'#dce6db','#a6b7aa','#4d6961');
  beam(-355,-25,135,85,147,'#f0f3e8','#ced6c5','#5a756c');
  for(let i=0;i<6;i++)beam(-363+i*27,-33,16,102,151,'#728977','#b6c4b2','#40594e');
  beam(-316,-9,58,50,185,'#dae574','#9caa4a','#526642');
  for(let floor=42;floor<135;floor+=26)line([iso(-375,80,floor),iso(-200,80,floor)],'#4d6255',5);
  for(let i=0;i<6;i++){
    const x=70+i%3*165,y=-60+Math.floor(i/3)*115;
    tile(x-14,y-12,151,102,'#cbd5c8');beam(x,y,126,70,36+i%2*18,'#edf0e4','#a9b7a8','#5c7367');
    for(let j=8;j<120;j+=19)line([iso(x+j,y,39+i%2*18),iso(x+j,y+70,39+i%2*18)],'#b3c1b0',2);
    for(let j=12;j<120;j+=25)line([iso(x+j,y+70,9),iso(x+j,y+70,25)],restored>1?'#e4e47f':'#49685f',6);
  }
  tile(405,540,420,220,'#cbd6c9');
  beam(430,565,340,140,25,'#e5ebe0','#b2c0ad','#688072');
  for(let i=0;i<5;i++){
    beam(450+i*58,585,38,92,50,'#f1f3e7','#afbfaa','#48685c');
    line([iso(469+i*58,580,53),iso(469+i*58,690,53)],'#788b68',4);
  }
  for(let i=0;i<4;i++)beam(-490+i*99,575,73,95,27+i%2*14,'#f1f3e4','#b6c2a5','#68816a');
  for(let i=0;i<5;i++)tile(-550,790+i*28,820,7,'#8ea087');
  for(const [x,y] of [[-150,85],[580,65],[305,645]]){
    beam(x,y,26,26,96,'#d8dfcc','#b6c8ae','#446c60');
    const peak=iso(x+13,y+13,132);line([iso(x+13,y+13,96),peak],'#324f47',4);
    line([[peak[0]-17,peak[1]+9],[peak[0]+17,peak[1]+9]],'#35594e',3);
  }
  for(let i=0;i<5;i++){
    const [x,y]=iso(-260+i*170,95+i*110,8);
    c.fillStyle=i<restored?'#dce775':'#f5f6e9';c.fillRect(x-7,y-7,14,14);
    c.strokeStyle='#47664e';c.lineWidth=2;c.strokeRect(x-7,y-7,14,14);
  }
  // A small amount of printed grain is generated, not loaded from the reference materials.
  let seed=37;
  for(let i=0;i<9000;i++){seed=(seed*1664525+1013904223)>>>0;const x=seed%w;seed=(seed*1664525+1013904223)>>>0;const y=seed%h;c.fillStyle=i%2?'#ffffff12':'#20312b0c';c.fillRect(x,y,1,1);}
}
