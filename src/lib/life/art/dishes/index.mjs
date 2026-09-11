import {detectComponents,detectMethod,composeFood} from './composition.mjs';
export {ingredients as ingredientComponents} from './composition.mjs';
import {icons} from './icons.mjs';
import {findDishFamily,selectDishVariant,dishFamilies} from './dish-catalog.mjs';
export {icons};
export {dishFamilies,dishVariantCount,findDishFamily,selectDishVariant} from './dish-catalog.mjs';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function renderCookbookIcon({icon='dish',color='currentColor',size=112,label}={}){
 if(!Object.hasOwn(icons,icon))throw new Error(`Unknown cookbook icon: ${icon}`);
 if(color!=='currentColor'&&!/^#[0-9a-fA-F]{6}$/.test(color))throw new Error('Invalid color; use currentColor or six-digit hex');
 if(!Number.isInteger(size)||size<16||size>4096)throw new Error('Size must be an integer from 16 to 4096');
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 112" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${escape(label??icons[icon].label)}"><title>${escape(label??icons[icon].label)}</title>${icons[icon].svg}</svg>`;
}
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
// Food form precedes individual ingredients: chicken noodle soup is still soup.
const rules=[
 ['soup',/\b(soups?|broth|bisque|chowder|consomme|gazpacho)\b/],
 ['salad',/\b(salads?|coleslaw)\b/],
 ['pizza',/\b(pizzas?|flatbreads?)\b/],
 ['pancakes',/\b(pancakes?|crepes?|waffles?|blini)\b/],
 ['ragu',/\b(ragu|bolognese)\b/],
 ['stew',/\b(stews?|casseroles?|goulash|curry|curries|tagine|chili|chilli)\b/],
 ['noodles',/\b(noodles?|ramen|udon|soba|vermicelli|pho|pad thai)\b/],
 ['pasta',/\b(pasta|spaghetti|penne|rigatoni|linguine|lasagn[ae]|ravioli|tortellini|macaroni|gnocchi)\b/],
 ['rice',/\b(rice|risotto|paella|biryani|pilaf|congee)\b/],
 ['bread',/\b(bread|loaf|loaves|baguettes?|focaccia|sourdough|bagels?|buns?|rolls?)\b/],
 ['dessert',/\b(cakes?|cookies?|biscuits?|brownies?|pudding|tarts?|ice cream|cheesecake|mousse|tiramisu|apple pie|cherry pie)\b/],
 ['drink',/\b(smoothies?|juices?|lemonade|coffee|tea|cocktails?|milkshakes?)\b/],
 ['aubergine',/\b(aubergines?|eggplants?)\b/],
 ['seafood',/\b(shrimps?|prawns?|lobsters?|crabs?|mussels?|clams?|oysters?|scallops?|squid|octopus|seafood)\b/],
 ['whole-fish',/\b(fish|salmon|trout|cod|haddock|tuna|mackerel|sardines?|sea bass|sea bream)\b/],
 ['poultry',/\b(chicken|turkey|duck|goose|poultry)\b/],
 ['meat',/\b(beef|pork|lamb|steak|veal|venison|sausages?|meatballs?|bacon)\b/],
 ['eggs',/\b(eggs?|omelett?es?|frittata|shakshuka)\b/]
];
function match(text){const clean=normalize(text).replace(/\b(?:without|no|omit|excluding)\s+[\w-]+/g,' ').replace(/\b\w+[- ]free\b/g,' ');return rules.find(([,pattern])=>pattern.test(clean))?.[0];}
function validateRecipe({title,category,ingredients=[]}){
 if(title!==undefined&&typeof title!=='string')throw new TypeError('Recipe title must be a string');
 if(category!==undefined&&typeof category!=='string')throw new TypeError('Category must be a string');
 if(!Array.isArray(ingredients)||ingredients.some(x=>typeof x!=='string'))throw new TypeError('Ingredients must be an array of strings');
}
const dishAlias=id=>({'chicken-salad':'salad','cabbage-soup':'soup'}[id]??id);
export function analyzeRecipe({title='',category,ingredients=[],icon,mode='auto'}={}){
 validateRecipe({title,category,ingredients});
 if(!['auto','fixed','compose'].includes(mode))throw new Error('Unknown recipe artwork mode');
 if(icon!==undefined){renderCookbookIcon({icon});return {dish:icon,components:[],method:null,source:'icon',mode:'fixed',family:'generic',variant:'explicit'};}
 let dish,source='fallback';
 if(category){const key=normalize(category).trim();dish=Object.hasOwn(icons,key)?dishAlias(key):match(key);if(dish)source='category';}
 if(!dish&&title){dish=match(title);if(dish)source='title';}
 if(!dish&&ingredients.length){dish=match(ingredients.join(' '));if(dish)source='ingredients';}
 dish??='dish';
 const family=findDishFamily({title,category,ingredients}).family;
 const chosen=mode==='compose'?{icon:dish,variant:dish}:selectDishVariant({title,category,ingredients,preferredIcon:source!=='fallback'?dish:undefined});
 const resolved=mode==='compose'?dish:chosen.icon;
 const components=mode==='compose'?detectComponents(title,[...(category?[category]:[]),...ingredients],dish):[];
 return {dish:resolved,components,method:mode==='compose'?detectMethod(title):null,source,mode:mode==='compose'?'compose':'fixed',family:family.id,variant:chosen.variant};
}
/** Render a saved composition; legacy fixed-icon definitions remain supported. */
export function renderRecipeDefinition(definition){
 if(definition.version!==2)return renderCookbookIcon(definition);
 const {dish,components,method,color,size,label}=definition;
 const base=renderCookbookIcon({icon:dish,color,size,label});
 if(!Array.isArray(components)||components.length>3)throw new Error('Composition requires up to three ingredient components');
 if(![null,'grilled','baked','steamed','fried'].includes(method))throw new Error('Unknown cooking method');
 if(!components.length)return base;
 return base.replace(/<\/title>[\s\S]*<\/svg>$/,`</title>${composeFood(dish,components,method)}</svg>`);
}
export function createRecipeArtwork(options={}){
 const analysis=analyzeRecipe(options),{title,color='currentColor',size=112}=options;
 const definition=analysis.mode==='compose'
  ? {version:2,dish:analysis.dish,components:analysis.components,method:analysis.method,color,size,...(title===undefined?{}:{label:title})}
  : {version:1,icon:analysis.dish,color,size,...(title===undefined?{}:{label:title})};
 return {icon:analysis.dish,source:analysis.source,analysis,definition,svg:renderRecipeDefinition(definition)};
}
export function generateRecipeArtwork(recipe={}){return createRecipeArtwork(recipe).svg;}
