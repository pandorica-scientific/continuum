import {icons} from './icons.mjs';

// Whole illustrations are intentionally selected as a unit. Variants may share
// an existing cohesive drawing today and can be replaced by designer artwork
// later without changing recipe matching or the generator API.
export const dishFamilies = [
 {id:'meat',label:'Meat',keywords:['beef','pork','lamb','steak','veal','venison','sausage','meatball','bacon','roast','ragu','bolognese'],variants:[['meat','Steak'],['meatballs','Meatballs'],['skewers','Grilled skewers'],['poultry','Chicken drumstick'],['stew','Stew'],['ragu','Sauce pot']]},
 {id:'fish',label:'Fish',keywords:['fish','salmon','trout','cod','haddock','tuna','mackerel','sardine','sea bass','sea bream'],variants:[['whole-fish','Whole fish'],['fish-fillet','Fish fillet'],['seafood','Shrimp']]},
 {id:'pasta',label:'Pasta',keywords:['pasta','spaghetti','penne','rigatoni','linguine','lasagna','ravioli','tortellini','macaroni','gnocchi'],variants:[['pasta','Pasta plate'],['spaghetti','Spaghetti nest'],['ravioli','Filled pasta'],['lasagna','Baked pasta']]},
 {id:'noodles',label:'Noodles',keywords:['noodle','ramen','udon','soba','vermicelli','pho','pad thai'],variants:[['noodles','Noodles']]},
 {id:'rice',label:'Rice',keywords:['rice','risotto','paella','biryani','pilaf','congee','grain','quinoa','couscous','bulgur'],variants:[['rice','Rice bowl'],['rice-plate','Rice with vegetables']]},
 {id:'soup',label:'Soup',keywords:['soup','broth','bisque','chowder','consomme','gazpacho'],variants:[['soup','Soup bowl'],['cabbage-soup','Cabbage soup']]},
 {id:'salad',label:'Salad',keywords:['salad','coleslaw','slaw','bowl'],variants:[['salad','Green salad'],['chicken-salad','Chicken salad'],['grain-salad','Grain salad'],['chopped-salad','Chopped salad']]},
 {id:'vegetable',label:'Vegetables',keywords:['vegetable','cabbage','aubergine','eggplant','broccoli','carrot','potato','mushroom','greens'],variants:[['aubergine','Aubergine']]},
 {id:'bread',label:'Bread',keywords:['bread','loaf','baguette','focaccia','sourdough','bagel','bun','roll'],variants:[['bread','Bread loaf'],['sandwich','Sandwich']]},
 {id:'breakfast',label:'Breakfast',keywords:['pancake','crepe','waffle','blini','egg','omelette','frittata','shakshuka'],variants:[['pancakes','Pancakes'],['eggs','Fried egg']]},
 {id:'dessert',label:'Dessert & cake',keywords:['cake','cookie','biscuit','brownie','pudding','tart','ice cream','cheesecake','mousse','tiramisu','pie','dessert'],variants:[['dessert','Cake slice'],['layer-cake','Layer cake'],['cupcake','Cupcake'],['cookies','Cookies'],['ice-cream','Ice cream'],['pie','Lattice pie']]},
 {id:'drink',label:'Drinks',keywords:['smoothie','juice','lemonade','coffee','tea','cocktail','milkshake','drink'],variants:[['drink','Cold drink']]},
 {id:'generic',label:'Generic',keywords:[],variants:[['dish','Covered dish'],['pizza','Pizza slice'],['dumplings','Dumplings']]}
];

export const dishVariantCount=new Set(dishFamilies.flatMap(f=>f.variants.map(([id])=>id))).size;
const normalized=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const words=s=>normalized(s).split(/[^a-z0-9]+/).filter(Boolean);
const score=(text,family)=>family.keywords.reduce((n,k)=>n+(words(text).some(w=>w===normalized(k)||w.startsWith(normalized(k)))?1:0),0);
const hash=s=>{let h=2166136261;for(const ch of s){h=Math.imul(h^ch.charCodeAt(0),16777619);}return h>>>0;};

export function findDishFamily({title='',category='',ingredients=[]}={}){
 const text=[category,title,...ingredients].join(' ');
 let best=dishFamilies.at(-1),bestScore=0;
 for(const family of dishFamilies.slice(0,-1)){const value=score(text,family);if(value>bestScore){best=family;bestScore=value;}}
 return {family:best,score:bestScore};
}
export function selectDishVariant({title='',category='',ingredients=[],preferredIcon}={}){
 const {family,score}=findDishFamily({title,category,ingredients});
 if(preferredIcon&&Object.hasOwn(icons,preferredIcon))return {family,score,icon:preferredIcon,label:icons[preferredIcon].label,variant:'explicit'};
 const text=normalized([title,category,...ingredients].join(' '));
 const variant=family.variants[0];
 return {family,score,icon:variant[0],label:variant[1],variant:variant[0]};
}
