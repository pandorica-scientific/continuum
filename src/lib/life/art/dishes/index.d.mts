export type CookbookIcon = 'noodles'|'ragu'|'cabbage-soup'|'whole-fish'|'pancakes'|'aubergine'|'dish'|'soup'|'stew'|'salad'|'chicken-salad'|'pasta'|'rice'|'pizza'|'bread'|'meat'|'poultry'|'eggs'|'dessert'|'drink'|'seafood'|'fish-fillet'|'meatballs'|'skewers'|'spaghetti'|'ravioli'|'lasagna'|'rice-plate'|'layer-cake'|'cupcake'|'cookies'|'ice-cream'|'grain-salad'|'chopped-salad'|'sandwich'|'pie'|'dumplings';
export interface IconOptions { icon?:CookbookIcon; color?:string; size?:number; label?:string }
export function renderCookbookIcon(options?:IconOptions):string;
export type RecipeMode='auto'|'fixed'|'compose';
export interface RecipeOptions extends Omit<IconOptions,'label'> { title?:string; category?:string; ingredients?:string[]; mode?:RecipeMode }
export interface RecipeAnalysis {dish:CookbookIcon;components:string[];method:null|'grilled'|'baked'|'steamed'|'fried';source:'icon'|'category'|'title'|'ingredients'|'fallback';mode:'fixed'|'compose';family:string;variant:string}
export type RecipeDefinition = {version:1;icon:CookbookIcon;color:string;size:number;label?:string} | {version:2;dish:CookbookIcon;components:string[];method:RecipeAnalysis['method'];color:string;size:number;label?:string};
export interface RecipeArtwork {icon:CookbookIcon;svg:string;source:RecipeAnalysis['source'];analysis:RecipeAnalysis;definition:RecipeDefinition}
export function analyzeRecipe(options?:RecipeOptions):RecipeAnalysis;
export function createRecipeArtwork(options?:RecipeOptions):RecipeArtwork;
export function generateRecipeArtwork(options?:RecipeOptions):string;
export function renderRecipeDefinition(definition:RecipeDefinition|IconOptions):string;
export const ingredientComponents:Record<string,{label:string;words:string[];svg:string}>;
export const icons:Record<CookbookIcon,{id:CookbookIcon;label:string;svg:string}>;
export const dishFamilies:ReadonlyArray<{id:string;label:string;keywords:string[];variants:ReadonlyArray<[CookbookIcon,string]>}>;
export const dishVariantCount:number;
export function findDishFamily(options?:{title?:string;category?:string;ingredients?:string[]}):{family:{id:string;label:string;keywords:string[];variants:ReadonlyArray<[CookbookIcon,string]>};score:number};
export function selectDishVariant(options?:{title?:string;category?:string;ingredients?:string[];preferredIcon?:CookbookIcon}):{family:{id:string;label:string;keywords:string[];variants:ReadonlyArray<[CookbookIcon,string]>};score:number;icon:CookbookIcon;label:string;variant:string};
