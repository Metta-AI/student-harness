import {selectedModel} from "../../lib/selected-model";
import {defineAgent} from 'eve';
export default defineAgent({description:'Synthesize replay and opponent evidence into compatible candidate policy components.',tool:false,defaultTools:false,model:selectedModel,limits:{sessionTimeoutMs:7*24*60*60*1000,maxOutputTokensPerSession:250000}});
