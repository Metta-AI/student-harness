import {z} from 'zod';
import {reasoningEfforts} from './reasoning';
export const chatModels = ['auto','claude-haiku-5-5','gemini-3.8-flash','gpt-6-luna','gpt-6-astra','gpt-6.1-sol','claude-sonnet-5-5','claude-opus-5-5'] as const;
export type ChatModel = typeof chatModels[number];
/** Auto starts on a cheap capable model and steps up while a conversation is
 * struggling (see agent/lib/model-escalation.ts). Each rung is a concrete model. */
export const autoModelLadder=['claude-haiku-5-5','gemini-3.8-flash','gpt-6.1-sol'] as const satisfies readonly ChatModel[];
/** Gateway IDs. Auto maps to its first rung wherever a call is not escalated. */
export const gatewayModelIds:Record<ChatModel,string>={
 'auto':'anthropic/claude-haiku-5.5',
 'claude-haiku-5-5':'anthropic/claude-haiku-5.5',
 'gemini-3.8-flash':'google/gemini-3.8-flash',
 'gpt-6-luna':'openai/gpt-6-luna',
 'gpt-6-astra':'openai/gpt-6-astra',
 'gpt-6.1-sol':'openai/gpt-6.1-sol',
 'claude-sonnet-5-5':'anthropic/claude-sonnet-5.5',
 'claude-opus-5-5':'anthropic/claude-opus-5.5',
};
export const defaultChatModel: ChatModel = 'auto';
export const modelLabels: Record<ChatModel,string> = {'auto':'Auto','claude-haiku-5-5':'Haiku 5.5','gemini-3.8-flash':'Gemini 3.8 Flash','gpt-6-luna':'GPT-6 Luna','gpt-6-astra':'Astra','gpt-6.1-sol':'GPT-6.1 Sol','claude-sonnet-5-5':'Sonnet 5.5','claude-opus-5-5':'Opus 5.5'};
/** The gateway model for a selection at an escalation level (0 = no escalation). */
export function gatewayModelFor(model:ChatModel,level=0){
 return model==='auto'?gatewayModelIds[autoModelLadder[Math.max(0,Math.min(level,autoModelLadder.length-1))]]:gatewayModelIds[model];
}
export const isChatModel = (value:unknown):value is ChatModel => typeof value==='string'&&(chatModels as readonly string[]).includes(value);
export const modelSelectionSchema=z.object({model:z.enum(chatModels),effort:z.enum(reasoningEfforts),defaultsVersion:z.literal(1).optional()});
export type ModelSelection=z.infer<typeof modelSelectionSchema>;

// Unversioned snapshots use the project default. Versioned snapshots preserve
// explicit saved choices; changing the default does not rewrite active work.
export const modelDefaultsVersion = 1;
export function effectiveTaskModelSelection(value:unknown):ModelSelection {
 const selected=modelSelectionSchema.parse(value);
 return {model:selected.defaultsVersion===modelDefaultsVersion?selected.model:defaultChatModel,effort:selected.effort};
}
