import {selectedModel} from "../../lib/selected-model";
import { defineAgent } from 'eve';
export default defineAgent({
 description:'Investigate replay evidence, opponents, semantic IR and league questions in a persistent task. Save findings and progress.',
 tool:false, defaultTools:false, model:selectedModel,
 limits:{sessionTimeoutMs:7*24*60*60*1000,maxOutputTokensPerSession:250000},
});
