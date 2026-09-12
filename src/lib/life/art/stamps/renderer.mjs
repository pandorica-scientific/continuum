import {symbols} from './symbols.mjs';
import {landmarks} from './landmarks.mjs';
import {borders,layouts,palettes,typography,motifs,wear,regions,neutralRegion} from './components.mjs';
export const escapeXML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function hash(s){let n=2166136261;for(const c of String(s)){n^=c.codePointAt(0);n=Math.imul(n,16777619);}return n>>>0;}
function random(seed){let n=hash(seed);return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
const units=s=>[...s].reduce((n,c)=>n+(/[MW@]/.test(c)?.94:/[I1.,' ]/.test(c)?.36:c.codePointAt(0)>0x2ff?1:.7),0);
export function fitTitle(name,{width=220,maxFont=27}={}){
 const source=String(name).trim().replace(/\s+/g,' ').toUpperCase();
 if(!source)throw new Error('Place name is required');
 if([...source].length>120)throw new Error('Place name must be 120 characters or fewer');
 for(let fontSize=maxFont;fontSize>=14;fontSize--){
  const limit=width/(fontSize+1.5),lines=[];
  if(fontSize>14 && source.split(' ').some(word=>units(word)>limit))continue;
  for(const word of source.split(' ')){
   if(units(word)>limit){
    if(lines.at(-1)==='')lines.pop();
    let chunk='';for(const ch of word){if(units(chunk+ch)>limit){lines.push(chunk);chunk='';}chunk+=ch;}if(chunk)lines.push(chunk);
   }else if(lines.length&&units(lines.at(-1)+' '+word)<=limit){lines[lines.length-1]+=' '+word;}else lines.push(word);
  }
  if(lines.length<=3||fontSize===14)return {lines,fontSize,lineHeight:fontSize*1.2};
 }
}
function pickById(list,id,name){const x=list.find(x=>x.id===id);if(!x)throw new Error(`Unknown ${name}: ${id}`);return x;}
export function resolveStamp(input){
 const name=String(input.name??'Any place').trim();
 const country=String(input.country??'').trim().toUpperCase();
 if(country&&!/^[A-Z]{2}$/.test(country))throw new Error('Country code must be two letters or blank');
 const seed=input.seed??hash(name+country),rnd=random(seed),region=input.region==='neutral'?neutralRegion:pickById(regions,input.region??'iberian','region');
 const pick=list=>list[Math.floor(rnd()*list.length)];
 const border=input.border??`${pick(region.borders)}-${1+Math.floor(rnd()*5)}`;
 const layout=input.layout??`${pick(region.layouts)}-${1+Math.floor(rnd()*5)}`;
 const palette=input.palette??pick(region.palettes);
 const color=input.color??pickById(palettes,palette,'palette').color;
 if(!/^#[0-9a-fA-F]{6}$/.test(color))throw new Error('Invalid color: use a six-digit hex value');
 return {name,country,seed,region:region.id,border,layout,palette,color,icon:input.icon??'compass',type:input.type??pick(region.typography),motif:input.motif??null,wear:input.wear??'clean'};
}
export function renderStamp(input){
 const d=resolveStamp(input),border=pickById(borders,d.border,'border'),layout=pickById(layouts,d.layout,'layout'),type=pickById(typography,d.type,'typography'),texture=pickById(wear,d.wear,'wear');
 const icon=symbols[d.icon]??landmarks[d.icon];if(!icon)throw new Error(`Unknown icon: ${d.icon}`);
 const short=[...d.name].length<=19&&d.name.split(/\s+/).every(w=>w.length<=7),side=short&&['icon-left','icon-right'].includes(layout.family);
 const curved=['oval','seal'].includes(border.family);
 let title=fitTitle(d.name,{width:side?118:curved?178:layout.titleWidth,maxFont:side?22:layout.maxFont});
 if(!side&&title.lines.length>=3)title=fitTitle(d.name,{width:curved?178:layout.titleWidth,maxFont:22});
 // Long names receive the full title area, even when a side-by-side layout was requested.
 const family=title.lines.length>3?'centered':side?layout.family:['icon-left','icon-right'].includes(layout.family)?'centered':layout.family;
 let tx=160,ty=title.lines.length===1?92:title.lines.length===2?93:83,ix=160,iy=177,scale=layout.scale;
 if(title.lines.length===2){scale=Math.min(scale,.95);iy=196;}
 if(title.lines.length===3){scale=.82;iy=206;}
 if(title.lines.length>3){scale=.62;iy=225;ty=80;}
 if(family==='title-bottom'){if(title.lines.length===3){title.fontSize=Math.min(title.fontSize,22);title.lineHeight=title.fontSize*1.2;}ty=title.lines.length===1?234:title.lines.length===2?211:188;iy=117;scale=Math.min(scale,1.05);}
 if(family==='code-above'){ty=title.lines.length===1?102:title.lines.length===2?93:83;iy=title.lines.length===3?206:196;scale=Math.min(scale,title.lines.length===3?.82:1.02);}
 if(side){tx=family==='icon-left'?211:109;ix=family==='icon-left'?93:227;iy=152;scale=.82;ty=151-(title.lines.length-1)*title.lineHeight/2;}
 const titleSvg=title.lines.map((line,i)=>`<text data-layer="title" x="${tx}" y="${(ty+i*title.lineHeight).toFixed(2)}" text-anchor="middle" direction="auto" fill="${d.color}" stroke="none" font-family="${escapeXML(type.family)}" font-size="${title.fontSize}" font-weight="${type.weight}" letter-spacing="${type.tracking}">${escapeXML(line)}</text>`).join('');
 const codeY=family==='code-above'?49:267;
 const code=d.country?`<text data-layer="country" x="160" y="${codeY}" text-anchor="middle" fill="${d.color}" stroke="none" font-family="Arial, sans-serif" font-size="18" font-weight="700">${escapeXML(d.country)}</text>`:'';
 const accents=family==='code-above'?'':`<path d="M111 261H133M187 261H209"/>`;
 let motif='';if(d.motif){const m=pickById(motifs,d.motif,'motif');const y=side?215: family==='title-bottom'?154: family==='code-above'?245:230;motif=`<g transform="translate(126 ${y}) scale(.7)" stroke-width="3">${m.svg}</g>`;}
 const art=border.svg+titleSvg+`<g data-layer="icon" transform="translate(${(ix-56*scale).toFixed(2)} ${(iy-56*scale).toFixed(2)}) scale(${scale})">${icon.svg}</g>`+code+accents+motif;
 let defs='',mask='';if(texture.count){const rnd=random(`${texture.seed}:${d.seed}`),maskId=`ink-${hash(JSON.stringify(d))}`;defs=`<defs><mask id="${maskId}"><rect width="320" height="320" fill="white"/>${Array.from({length:texture.count},()=>`<ellipse cx="${(rnd()*320).toFixed(2)}" cy="${(rnd()*320).toFixed(2)}" rx="${(1+rnd()*texture.strength).toFixed(2)}" ry="${(.4+rnd()).toFixed(2)}" fill="black"/>`).join('')}</mask></defs>`;mask=` mask="url(#${maskId})"`;}
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="none" stroke="${d.color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${escapeXML(d.name)} travel stamp"><title>${escapeXML(d.name)} travel stamp</title>${defs}<g${mask}>${art}</g></svg>`;
}
export function renderIcon(id,color='currentColor'){
 const icon=symbols[id]??landmarks[id];if(!icon)throw new Error(`Unknown icon: ${id}`);
 if(color!=='currentColor'&&!/^#[0-9a-fA-F]{6}$/.test(color))throw new Error('Invalid color');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${escapeXML(icon.label)}"><title>${escapeXML(icon.label)}</title>${icon.svg}</svg>`;
}
