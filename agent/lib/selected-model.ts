import {defineDynamic} from 'eve';
import {anthropic} from 'eve/models/anthropic';
import {openai,chatgpt} from 'eve/models/openai';
import {sessionModelSelection} from '../../lib/session-model';
export const selectedModel=defineDynamic({events:{'step.started':async(_event,ctx)=>{
 const selected=await sessionModelSelection(ctx.session.auth);
 const subscription=selected.model.startsWith('gpt-')&&process.env.PRESTON_OPENAI_TRANSPORT==='chatgpt';
 if(subscription&&process.env.NODE_ENV==='production')throw new Error('ChatGPT subscription transport is local only; configure an OpenAI API key for deployment.');
 // Gateway lists these models under openai/, while subscription models identify
 // as codex/. Supply the same published window for Eve's compaction accounting.
 return {model:selected.model.startsWith('gpt-')?(subscription?chatgpt(selected.model):openai(selected.model)):anthropic(selected.model),reasoning:selected.effort,
  ...(subscription?{modelContextWindowTokens:1050000}:{})};
}}});
