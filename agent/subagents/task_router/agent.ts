import {selectedModel} from "../../lib/selected-model";
import { defineAgent } from 'eve';
export default defineAgent({description:'Choose the execution path for a background objective and detect unsupported requirements before spending on work.',tool:false,defaultTools:false,model:selectedModel,limits:{maxOutputTokensPerSession:250000,maxTokenCostUsdPerSession:false,sessionTimeoutMs:120000}});
