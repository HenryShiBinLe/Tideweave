import test from 'node:test';
import assert from 'node:assert/strict';
import {palette,paletteText,colorNames} from '../src/assets.mjs';
import {patternDefs} from '../src/board.mjs';

const rgb=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255);
const luminance=rgb=>rgb.map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

test('all six game colors keep readable labels on plain and patterned fills',()=>{
  assert.equal(palette.length,6);assert.equal(paletteText.length,6);assert.equal(colorNames.length,6);
  assert.equal((patternDefs().match(/stroke-opacity=".08"/g)??[]).length,6);
  for(const [i,color] of palette.entries()){
    const background=rgb(color),ink=rgb(paletteText[i]);
    assert.ok(contrast(background,ink)>=4.5,colorNames[i]+' plain fill');
    assert.ok(contrast(background.map(x=>x*.92+.08),ink)>=4.5,colorNames[i]+' stripe fill');
    assert.ok(contrast(background.map(x=>x*.84),ink)>=4.5,colorNames[i]+' darkest texture overlay');
  }
});
