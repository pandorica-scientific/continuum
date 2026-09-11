/** Public, synchronous runtime API. No DOM, filesystem, network, or build step. */
import {destinations,slug} from './destinations.mjs';
import {landmarks} from './landmarks.mjs';
import {renderStamp,resolveStamp,hash} from './renderer.mjs';
export {renderStamp,renderIcon} from './renderer.mjs';
export {symbols} from './symbols.mjs';
export {borders,layouts,palettes,typography,motifs,wear,regions,neutralRegion} from './components.mjs';
export {landmarks} from './landmarks.mjs';
export {destinations} from './destinations.mjs';
const byId=new Map(destinations.map(d=>[d.id,d]));
const landmarkByCity=new Map(Object.values(landmarks).map(l=>[l.city,l]));
const byName=new Map();
for(const d of destinations){const key=slug(d.name);byName.set(key,[...(byName.get(key)??[]),d]);}
const regionByCountry=new Map();
for(const d of destinations)if(!regionByCountry.has(d.country))regionByCountry.set(d.country,d.region);
/**
 * Generate on demand and return both the SVG and a serializable definition.
 * Exact/diacritic-insensitive city lookup; ambiguous names use a neutral fallback.
 * Caller-supplied components always override automatic choices.
 */
export function createStamp(input){
 if(!input||typeof input!=='object')throw new TypeError('Stamp options are required');
 if(typeof input.name!=='string'||!input.name.trim())throw new TypeError('A place name is required');
 if(input.seed!==undefined&&(!Number.isInteger(input.seed)||input.seed<0||input.seed>4294967295))throw new TypeError('Seed must be an integer between 0 and 4294967295');
 if(input.country!==undefined&&typeof input.country!=='string')throw new TypeError('Country code must be a string');
 const name=input.name.trim().replace(/\s+/g,' '),country=input.country?.trim().toUpperCase()??'';
 let destination;
 if(input.destinationId!==undefined){destination=byId.get(input.destinationId);if(!destination)throw new Error(`Unknown destination: ${input.destinationId}`);if(country&&country!==destination.country)throw new Error('Country code does not match destination');}
 else{const matches=(byName.get(slug(name))??[]).filter(d=>!country||d.country===country);if(matches.length===1)destination=matches[0];}
 const landmark=destination?landmarkByCity.get(destination.id):undefined;
 const icon=input.icon??landmark?.id??destination?.icon??'pin';
 const definition=resolveStamp({...input,name,country:country||destination?.country||'',icon,region:input.region??destination?.region??regionByCountry.get(country)??'neutral',seed:input.seed??hash((destination?.id??name.toLowerCase())+':'+country)});
 const source=landmarks[icon]?'landmark':destination?'shared-symbol':'generic';
 return {svg:renderStamp(definition),definition,destinationId:destination?.id??null,source};
}
/** Return an SVG string ready for an HTTP response, an image data URL, or a file. */
export function generateStamp(input){return createStamp(input).svg;}
