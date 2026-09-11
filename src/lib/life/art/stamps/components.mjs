import {regionNames} from './destinations.mjs';
const p=d=>`<path d="${d}"/>`;
export const palettes=[
['atlantic','#255e83'],['pine','#276c65'],['plum','#72517d'],['carmine','#a64447'],['ochre','#ad6430'],['midnight','#354766'],['olive','#65733e'],['slate','#536a79'],['mulberry','#87486a'],['cobalt','#3c5b99'],['cedar','#48735b'],['brick','#985447'],['teal','#23777e'],['aubergine','#674568'],['umber','#876348'],['marine','#2c678f'],['juniper','#416962'],['wine','#854957'],['indigo','#575593'],['copper','#a65c36'],['moss','#697449'],['storm','#486779'],['rosewood','#99575e'],['iris','#6d6090'],['fir','#347363'],['clay','#a7694c'],['denim','#466f9e'],['ink','#354751'],['berry','#944d78'],['bronze','#87682e']
].map(([id,color])=>({id,color,label:id[0].toUpperCase()+id.slice(1)}));
// Clockwise closed outline with inward, rounded perforations on all four edges.
function postcardBorder(variant){
 const count=12+variant,span=272,pitch=span/count,radius=4+variant*.35,depth=4+variant*.45;
 const point=(x,y)=>`${x.toFixed(2)} ${y.toFixed(2)}`;
 let d='M24 24';
 for(const [x,y,dx,dy] of [[24,24,1,0],[296,24,0,1],[296,296,-1,0],[24,296,0,-1]]){
  for(let i=0;i<count;i++){
   const center=(i+.5)*pitch;
   d+=`L${point(x+dx*(center-radius),y+dy*(center-radius))}`;
   d+=`Q${point(x+dx*center-dy*depth*2,y+dy*center+dx*depth*2)} ${point(x+dx*(center+radius),y+dy*(center+radius))}`;
  }
  d+=`L${point(x+dx*span,y+dy*span)}`;
 }
 return p(d+'Z');
}
const baseBorders={
 capsule:v=>`<rect x="${22+v}" y="${30+v}" width="${276-v*2}" height="${260-v*2}" rx="${68+v*4}"/>`,
 oval:v=>`<ellipse cx="160" cy="160" rx="${137-v*2}" ry="${139-v}"/>`,
 ticket:v=>p(`M32 ${25+v}H288V54Q${262-v} 64 288 80V240Q${262-v} 254 288 266V${295-v}H32V266Q${58+v} 254 32 240V80Q${58+v} 64 32 54Z`),
 square:v=>`<rect x="${27+v}" y="${27+v}" width="${266-v*2}" height="${266-v*2}" rx="${8+v*5}"/>`,
 badge:v=>p(`M160 ${16+v}L${288-v} ${59+v}V215Q270 ${267-v} 160 305Q50 ${267-v} ${32+v} 215V${59+v}Z`),
 clipped:v=>p(`M${49+v*3} 25H${271-v*3}L295 ${49+v*3}V${271-v*3}L${271-v*3} 295H${49+v*3}L25 ${271-v*3}V${49+v*3}Z`),
 arch:v=>p(`M${28+v} 294V${104+v}Q${28+v} 19 160 19Q${292-v} 19 ${292-v} ${104+v}V294Z`),
 barrel:v=>p(`M51 ${29+v}H269Q${319-v} 160 269 ${291-v}H51Q${1+v} 160 51 ${29+v}Z`),
 octagon:v=>p(`M${76+v*2} 23H${244-v*2}L297 ${76+v*2}V${244-v*2}L${244-v*2} 297H${76+v*2}L23 ${244-v*2}V${76+v*2}Z`),
 seal:v=>{let d='';for(let i=0;i<48;i++){const a=i*Math.PI/24-Math.PI/2,rad=i%2?139-v:145-v;d+=`${i?'L':'M'}${(160+Math.cos(a)*rad).toFixed(2)} ${(160+Math.sin(a)*rad).toFixed(2)}`;}return p(d+'Z');},
 postcard:postcardBorder
};
export const borders=Object.entries(baseBorders).flatMap(([family,make])=>Array.from({length:5},(_,v)=>({id:`${family}-${v+1}`,family,label:`${family[0].toUpperCase()+family.slice(1)} ${v+1}`,svg:make(v)})));
// Five genuine arrangements, each in five spacing/scale treatments.
export const layouts=['centered','title-bottom','icon-left','icon-right','code-above'].flatMap((family,i)=>Array.from({length:5},(_,v)=>({id:`${family}-${v+1}`,family,label:`${family.replaceAll('-',' ')} ${v+1}`,scale:1.04+v*.045,titleWidth:210+v*4,maxFont:25+(v%3),gap:8+v*2,codeY:266,ordinal:i*5+v})));
export const typography=['Arial, sans-serif','Verdana, sans-serif','Trebuchet MS, sans-serif','Georgia, serif','Palatino, serif'].flatMap((family,i)=>Array.from({length:5},(_,v)=>({id:`type-${i*5+v+1}`,family,weight:v===0?400:700,tracking:[0,.35,.7,1,1.3][v],label:`${family.split(',')[0]} ${v+1}`})));
const motifFamilies={
 waves:v=>p(`M8 14Q18 ${3+v} 28 14T48 14T68 14T88 14`),
 rays:v=>p(`M28 19L${22-v} 8M48 18V${2+v}M68 19L${74+v} 8`),
 diamonds:v=>p(`M${35-v} 14L48 ${3+v}L${61+v} 14L48 ${25-v}Z`),
 chevrons:v=>p(`M${22-v} 6L${32-v} 14L${22-v} 22M43 6L53 14L43 22M${64+v} 6L${74+v} 14L${64+v} 22`),
 dots:v=>[22,48,74].map(x=>`<circle cx="${x}" cy="14" r="${2+v*.3}"/>`).join(''),
 leaves:v=>p(`M20 22L77 7M32 18Q${21-v} 3 40 7M49 14Q${40-v} 0 57 4M59 12Q${77+v} 26 77 10`),
 steps:v=>p(`M12 23H${23+v}V15H37V7H59V15H${73-v}V23H84`),
 loops:v=>p(`M12 14C12 ${-2+v} 40 ${-2+v} 40 14C40 ${30-v} 12 ${30-v} 12 14M40 14C40 ${-2+v} 68 ${-2+v} 68 14C68 ${30-v} 40 ${30-v} 40 14M68 14H84`),
 bars:v=>p(`M15 14H${32+v}M${64-v} 14H81M48 ${5+v}V${23-v}`),
 star:v=>p(`M48 ${2+v}L${52+v} 10L${64-v} 14L${52+v} 18L48 ${26-v}L${44-v} 18L${32+v} 14L${44-v} 10Z`)
};
export const motifs=Object.entries(motifFamilies).flatMap(([family,make])=>Array.from({length:10},(_,i)=>({id:`${family}-${i+1}`,family,svg:make(i*.3),label:`${family} ${i+1}`})));
export const wear=Array.from({length:30},(_,i)=>({id:i===0?'clean':`ink-${i}`,label:i===0?'Clean':`Ink gaps ${i}`,strength:i===0?0:1+(i%3),seed:i*4817,count:i===0?0:14+i*2}));
const borderChoices=[['capsule','oval','ticket'],['oval','square','ticket'],['square','clipped','badge'],['ticket','badge','clipped'],['oval','ticket','square'],['square','oval','barrel'],['arch','badge','clipped'],['octagon','arch','seal'],['ticket','arch','square'],['square','seal','octagon'],['square','oval','barrel'],['square','arch','clipped'],['arch','seal','octagon'],['arch','capsule','badge'],['capsule','oval','arch'],['arch','octagon','square'],['arch','seal','octagon'],['capsule','square','barrel'],['badge','capsule','oval'],['badge','barrel','clipped'],['badge','ticket','clipped'],['seal','badge','capsule'],['badge','arch','octagon'],['capsule','badge','seal'],['badge','barrel','oval']];
export const regions=Object.entries(regionNames).map(([id,label],i)=>({id,label,borders:borderChoices[i],palettes:[palettes[i%30].id,palettes[(i+6)%30].id,palettes[(i+13)%30].id,palettes[(i+21)%30].id],layouts:i===9?['centered','code-above']:['centered','title-bottom','icon-left','icon-right','code-above'],typography:[`type-${1+(i%5)*5}`,`type-${2+(i%5)*5}`,`type-${3+(i%5)*5}`],motifs:Object.keys(motifFamilies).filter((_,n)=>(n+i)%3===0),note:'Art-direction choices, not claims about national or cultural identity.'}));
export const neutralRegion={id:'neutral',label:'Universal',borders:['capsule','square','oval','ticket','clipped'],palettes:['ink','atlantic','pine','plum','carmine'],layouts:['centered','title-bottom','icon-left','icon-right'],typography:['type-2','type-3'],motifs:['bars','dots','rays']};
