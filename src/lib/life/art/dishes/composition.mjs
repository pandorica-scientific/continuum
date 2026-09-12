// Ingredient primitives are composed inside a dish vessel, never recipe-specific drawings.
const p=d=>`<path d="${d}"/>`;
const c=(x,y,r)=>`<circle cx="${x}" cy="${y}" r="${r}"/>`;
export const ingredients={
 chicken:{label:'Chicken',words:['chicken','poultry','turkey'],svg:p('M4 21L19 5Q24 1 28 7L30 13L14 29ZM10 14L20 24M17 7L27 17')},
 fish:{label:'Fish',words:['fish','salmon','tuna','cod','trout','mackerel'],svg:p('M2 16Q12 3 23 12L30 6V26L23 20Q12 30 2 16ZM12 8Q16 16 12 24')+c(8,15,1)},
 shrimp:{label:'Shrimp',words:['shrimp','shrimps','prawn','prawns'],svg:p('M10 27C0 17 5 4 18 4Q29 4 29 16H23Q22 10 17 11Q8 12 13 20L22 24L18 30ZM6 11L12 14M6 21L12 19')},
 beef:{label:'Meat',words:['beef','pork','lamb','steak','bacon','meatballs'],svg:p('M4 24Q-1 13 11 10Q16 0 26 6Q35 15 24 22Q11 33 4 24ZM10 21Q7 15 16 14Q20 7 24 12Q27 18 17 19')},
 tofu:{label:'Tofu',words:['tofu','tempeh'],svg:p('M3 11L16 4L29 11V25L16 31L3 25ZM3 11L16 18L29 11M16 18V31')},
 egg:{label:'Egg',words:['egg','eggs','omelette','omelet'],svg:p('M5 20C5 10 11 2 16 2C21 2 27 10 27 20C27 34 5 34 5 20Z')+c(16,21,5)},
 beans:{label:'Beans / lentils',words:['bean','beans','lentil','lentils','chickpea','chickpeas'],svg:p('M5 4Q17 0 15 10Q11 10 12 17Q3 24 2 15Q0 8 5 4M23 13Q35 10 30 23Q24 22 25 29Q16 34 16 24Q16 17 23 13')},
 buckwheat:{label:'Buckwheat',words:['buckwheat','backwead','kasha'],svg:p('M3 10L8 3L14 10L8 15ZM19 10L24 3L30 10L24 15ZM10 25L16 18L22 25L16 31Z')},
 rice:{label:'Rice / grains',words:['rice','quinoa','bulgur','couscous','barley','farro'],svg:p('M3 11Q5 2 10 5Q13 10 7 15Q2 17 3 11M20 8Q26 0 29 6Q29 12 23 15Q17 15 20 8M12 24Q14 17 19 20Q22 27 15 31Q9 32 12 24')},
 noodles:{label:'Noodles',words:['noodle','noodles','ramen','udon','soba'],svg:p('M4 5Q12 0 16 7T28 7M4 15Q12 10 16 17T28 17M4 25Q12 20 16 27T28 27')},
 mushroom:{label:'Mushroom',words:['mushroom','mushrooms','shiitake','porcini'],svg:p('M2 17C2 0 30 0 30 17ZM12 17V29H21V17M9 11H10M22 10H23')},
 tomato:{label:'Tomato',words:['tomato','tomatoes'],svg:c(16,19,12)+p('M16 9V2M16 9L8 5M16 9L25 5M9 18Q8 24 14 26')},
 cabbage:{label:'Cabbage',words:['cabbage','kale','lettuce','spinach','greens'],svg:p('M16 29C-2 22 0 9 8 10C4 0 21 0 23 8C35 5 36 24 16 29ZM16 27V10M16 21L8 15M16 22L25 14')},
 aubergine:{label:'Aubergine',words:['aubergine','aubergines','eggplant','eggplants'],svg:p('M21 9Q15 7 13 16Q-2 20 4 28Q17 36 28 16ZM21 9L21 3L26 7L30 4V12L26 16M27 5L29 1')},
 carrot:{label:'Carrot',words:['carrot','carrots'],svg:p('M5 29L11 9Q16 3 23 10Q29 16 22 21ZM19 8L22 1M24 11L31 7M11 16L17 20')},
 broccoli:{label:'Broccoli',words:['broccoli','cauliflower'],svg:p('M13 29V21C-1 25-2 10 8 9C6-2 23-2 23 9C34 5 36 24 21 22V29ZM16 23V13M16 18L10 13M16 18L24 13')},
 cheese:{label:'Cheese',words:['cheese','feta','parmesan','mozzarella','cheddar'],svg:p('M3 15L23 4L30 15V29H3ZM3 15H30')+c(11,22,2)+c(24,22,2)},
 potato:{label:'Potato',words:['potato','potatoes'],svg:p('M4 22Q-1 13 9 7Q18-1 27 7Q35 18 24 25Q12 34 4 22M11 14H12M22 12H23M17 24H18')},
 lemon:{label:'Citrus',words:['lemon','lime','orange','citrus'],svg:p('M3 17Q7 2 20 5L25 3L28 8Q34 22 18 28L11 27L6 30L3 24ZM10 19Q11 11 20 12')},
 fruit:{label:'Fruit',words:['apple','banana','berry','berries','strawberry','strawberries','blueberry','blueberries','pear','peach'],svg:p('M16 10C0-2-2 28 11 30L16 27L22 30C34 28 35-2 16 10ZM16 10Q15 1 23 2')}
};
export const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function present(text,word){
 const escaped=word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const re=new RegExp(`\\b${escaped}\\b`,'g');
 return [...text.matchAll(re)].some(m=>!/(?:without|no|omit|excluding)\s+$/.test(text.slice(0,m.index))&&!/^[- ]free\b/.test(text.slice(m.index+word.length)));
}
export function detectComponents(title,list,dish){
 const t=normalize(title??''),rest=list.map(normalize).join(' ');
 return Object.entries(ingredients).map(([id,v],rank)=>({id,rank,title:v.words.some(w=>present(t,w)),listed:v.words.some(w=>present(rest,w))})).filter(x=>(x.title||x.listed)&&x.id!==dish).sort((a,b)=>Number(b.title)-Number(a.title)||a.rank-b.rank).slice(0,3).map(x=>x.id);
}
export function detectMethod(title){const t=normalize(title??'');for(const [id,words] of [['grilled',['grilled','grill','barbecued']],['baked',['baked','roasted','roast']],['steamed',['steamed']],['fried',['fried','sauteed']]])if(words.some(w=>present(t,w)))return id;return null;}
// Ingredients share the dish's foreshortened food surface. A primary serving
// occludes the food bed beneath it; texture and garnish occupy the remaining area.
const textures={
 grains:p('M22 54l3-2M30 46l3 2M39 39l3 2M49 44l3-2M62 39l3 2M77 44l3 2M86 53l-3 2M28 62l3-2M40 66l3 2M55 67l3-2M69 66l3 2M81 60l3-2M39 53l3-2M63 53l3 2'),
 buckwheat:p('M24 52l3-3l4 3l-4 3ZM35 43l3-3l4 3l-4 3ZM48 39l3-3l4 3l-4 3ZM72 42l3-3l4 3l-4 3ZM82 53l3-3l4 3l-4 3ZM30 62l3-3l4 3l-4 3ZM45 66l3-3l4 3l-4 3ZM66 64l3-3l4 3l-4 3ZM77 61l3-3l4 3l-4 3Z'),
 pasta:p('M23 52C30 38 45 43 40 54C35 64 51 66 58 55C64 44 76 45 83 55M26 62C38 52 41 65 52 63C64 60 66 48 79 60M32 46C42 36 60 40 66 46M37 68Q46 72 58 65M67 67Q76 69 84 62'),
 greens:p('M23 60C12 49 25 41 36 47C30 34 47 32 51 46C57 32 72 33 74 45C89 37 98 52 86 62M27 61L34 51M44 52L45 40M66 49L68 40M78 60L86 49M34 66Q45 59 49 68M61 67Q68 58 74 65'),
 broth:p('M20 55Q25 52 29 55M76 60Q84 63 90 57M25 65Q34 69 40 66M62 43Q69 40 74 44')
};
const parts={
 chicken:{outline:'M37 55L57 37Q63 32 69 37L77 44L54 66ZM58 67L80 47Q86 46 90 54L73 69Q65 73 58 67Z',detail:'M44 48L61 61M52 41L69 54M68 57L79 66'},
 fish:{outline:'M34 56Q47 34 76 39L88 54Q68 69 44 66Z',detail:'M45 49L54 62M54 44L63 62M64 41L73 59'},
 shrimp:{outline:'M43 62C31 56 39 39 52 40Q65 40 64 51L57 54Q58 45 50 47Q44 49 48 55L55 61L49 66ZM67 62C58 55 67 42 78 46Q87 50 82 59L75 58Q79 51 73 52Q67 55 73 60L72 67Z',detail:'M39 48L46 50M41 57L47 54M64 51L69 55'},
 beef:{outline:'M34 58Q30 43 48 42Q61 32 76 40Q93 47 82 60Q62 75 45 67Z',detail:'M43 48L57 65M53 43L68 62M66 40L79 55'},
 tofu:{outline:'M33 50L47 42L60 49V62L47 70L33 62ZM62 43L76 36L88 43V56L76 63L62 56Z',detail:'M33 50L47 57L60 49M47 57V70M62 43L76 50L88 43M76 50V63'},
 egg:{outline:'M36 58Q30 43 47 38Q60 38 61 52Q62 65 48 68Q39 68 36 58ZM64 59Q60 43 75 43Q91 46 85 61Q76 72 68 66Z',detail:'M43 52C42 44 54 44 54 51C56 60 44 60 43 52ZM69 56C69 49 80 50 79 56C79 63 69 63 69 56Z'},
 beans:{outline:'M34 50Q39 41 44 46Q48 52 43 58Q35 63 33 56ZM55 42Q64 40 64 47Q59 49 61 53Q53 58 51 51ZM70 55Q72 46 79 48Q86 53 80 60Q72 66 70 55ZM49 64Q48 57 57 57Q65 63 58 68Q51 72 49 64Z',detail:''},
 mushroom:{outline:'M32 53Q28 37 45 37Q59 36 59 49ZM41 52L42 65L50 64L49 51M61 55Q61 39 76 43Q89 47 85 59ZM71 57L69 67L76 69L80 58',detail:'M38 44L42 42M72 49L77 50'},
 tomato:{outline:'M32 54Q33 39 47 43Q60 48 51 61Q40 67 32 54ZM63 53Q65 40 79 44Q89 53 80 63Q69 68 63 53Z',detail:'M37 51L44 49L44 57ZM70 50L77 51L73 58Z'},
 cabbage:{outline:'M33 63Q24 49 39 47Q35 33 51 39Q62 32 67 45Q85 40 84 53Q81 67 58 69Z',detail:'M42 61L63 43M51 53L45 43M58 49L71 50'},
 aubergine:{outline:'M30 62Q46 32 67 39Q72 52 50 68Q36 75 30 62ZM58 66Q72 40 87 47Q89 59 75 70Q66 77 58 66Z',detail:'M39 60L60 43M47 56L44 50M70 59L79 51'},
 carrot:{outline:'M32 58L44 44L52 51L40 65ZM56 63L66 45L75 49L65 68ZM73 61L80 51L88 56L81 66Z',detail:''},
 broccoli:{outline:'M35 61L41 52Q29 48 37 42Q36 31 48 37Q59 30 63 43Q62 53 51 54L48 65ZM66 66L73 57Q62 54 69 46Q70 36 79 43Q92 38 93 52Q90 61 82 60L78 69Z',detail:'M41 52L49 44M73 57L80 50'},
 cheese:{outline:'M35 50L45 45L54 49V58L44 64L35 59ZM61 43L71 37L82 42V53L71 58L61 53Z',detail:'M35 50L44 55L54 49M44 55V64M61 43L71 48L82 42M71 48V58'},
 potato:{outline:'M32 58Q27 48 40 44Q48 37 56 45Q63 55 50 62Q39 69 32 58ZM61 59Q55 48 69 44Q83 39 87 49Q92 59 80 65Q67 71 61 59Z',detail:'M39 52L43 50M70 53L74 51'},
 lemon:{outline:'M32 61L56 38Q74 58 51 70Z',detail:'M41 61L55 45L60 56M48 64L60 56M57 65L60 56'},
 fruit:{outline:'M34 56Q28 44 41 40Q48 36 54 43Q64 43 60 55Q54 69 42 66ZM68 60Q61 48 72 44Q82 40 87 51Q91 62 81 67Q73 71 68 60Z',detail:'M47 42L48 36M73 54L77 50'}
};
const proteinIds=['chicken','fish','shrimp','beef','tofu','egg','beans'];
const grainIds=['buckwheat','rice','noodles'];
const soupDishes=['soup','stew','ragu'];
const steam=p('M39 25Q34 19 39 13M56 23Q51 17 56 11M73 25Q68 19 73 13');
const hash=s=>{let h=2166136261;for(const ch of s){h=Math.imul(h^ch.charCodeAt(0),16777619);}return (h>>>0).toString(36);};
function vessel(dish){
 if(dish==='salad'||dish==='soup'||dish==='rice'||dish==='noodles')return {
  clip:'M15 55C15 31 97 31 97 55C97 79 15 79 15 55Z',
  back:p('M13 55C13 29 99 29 99 55'),
  front:p('M13 55C13 79 99 79 99 55M13 55Q20 96 56 97Q92 96 99 55M39 103H73')
 };
 if(dish==='stew'||dish==='ragu')return {clip:'M26 53C26 36 86 36 86 53C86 74 26 74 26 53Z',back:p('M24 53C24 32 88 32 88 53M24 59H13V75H24M88 59H99V75H88'),front:p('M24 53C24 76 88 76 88 53M24 53V84Q24 99 40 99H72Q88 99 88 84V53')};
 if(dish==='pizza')return {clip:'M25 43Q56 24 87 43L56 99Z',back:p('M17 34Q56 5 95 34L56 103ZM24 44Q56 23 88 44'),front:''};
 return {clip:'M18 56C18 28 94 28 94 56C94 84 18 84 18 56Z',back:p('M11 60C11 17 101 17 101 60C101 104 11 104 11 60ZM19 60C19 29 93 29 93 60'),front:p('M19 60C19 89 93 89 93 60')};
}
function garnish(id){
 if(id==='tomato')return p('M24 54Q25 44 34 48L30 59ZM77 61Q81 50 88 56L84 65Z');
 if(id==='cheese'||id==='tofu')return p('M24 51L30 47L35 52L30 58ZM77 64L83 58L88 62L83 68Z');
 if(id==='mushroom')return p('M22 54Q21 43 32 45Q39 49 35 56ZM28 55L27 62M76 61Q77 50 87 54L89 62ZM81 62L80 68');
 if(id==='egg')return p('M23 57Q17 47 29 44Q39 48 32 59Q26 64 23 57ZM26 51H28');
 if(id==='lemon'||id==='fruit')return p('M22 55L34 43Q43 57 29 62ZM26 55L33 49');
 return p('M22 53Q20 43 30 44Q39 52 27 59ZM80 62Q78 49 90 53Q94 61 83 66M26 53L30 48M84 61L88 55');
}
/** Compose a single serving, using occlusion and a shared food surface. */
export function composeFood(dish,components,method){
 for(const id of components)if(!Object.hasOwn(ingredients,id))throw new Error(`Unknown ingredient component: ${id}`);
 const primary=components.find(id=>proteinIds.includes(id))??components.find(id=>!grainIds.includes(id));
 const grain=components.find(id=>grainIds.includes(id));
 const accent=components.find(id=>id!==primary&&id!==grain);
 const surface=vessel(dish),uid=`food-${hash(JSON.stringify([dish,components,method]))}`;
 const broth=soupDishes.includes(dish);
 let serving=primary?parts[primary]:null;
 // Soups use submerged pieces instead of whole cuts; grain dishes retain a food bed.
 if(broth&&primary&&proteinIds.includes(primary))serving={outline:'M31 51L40 44L49 50L42 60L33 59ZM62 46L73 41L80 49L72 57L63 54ZM52 63L59 55L66 60L62 68L54 68Z',detail:primary==='chicken'||primary==='beef'?'M37 50L44 54M68 47L75 51':''};
 const bed=broth?textures.broth:grain==='buckwheat'?textures.buckwheat:grain==='rice'||dish==='rice'?textures.grains:grain==='noodles'||dish==='pasta'||dish==='noodles'?textures.pasta:dish==='salad'?textures.greens:'';
 const bedExtra=dish==='salad'&&grain?p('M20 47Q19 38 30 40M81 43Q90 35 93 48M22 64Q30 70 36 65'):'';
 const masked=serving?` mask="url(#${uid}-under)"`:'';
 const definitions=`<defs><clipPath id="${uid}-surface"><path d="${surface.clip}"/></clipPath>${serving?`<mask id="${uid}-under" maskUnits="userSpaceOnUse" x="0" y="0" width="112" height="112"><rect width="112" height="112" fill="white" stroke="none"/><path d="${serving.outline}" fill="black" stroke="black" stroke-width="6"/></mask>`:''}</defs>`;
 const bedArt=`<g${masked} stroke-width="2.7">${bed}${bedExtra}</g>`;
 const main=serving?`<g data-component="${primary}">${p(serving.outline)}<g stroke-width="2.7">${p(serving.detail)}</g></g>`:'';
 const detail=accent?`<g data-component="${accent}"${masked} stroke-width="2.7">${garnish(accent)}</g>`:'';
 const mark=broth||method&&method!=='grilled'?steam:'';
 return `${definitions}<g data-dish="${dish}">${mark}${surface.back}<g clip-path="url(#${uid}-surface)">${bedArt}${detail}${main}</g>${surface.front}</g>`;
}
