import {z} from 'zod';
import {reasoningEfforts} from './reasoning';
export const chatModels = ['gpt-6-astra','gpt-6.1-sol','claude-sonnet-5-5','claude-opus-5-5'] as const;
export type ChatModel = typeof chatModels[number];
export const gatewayModelIds:Record<ChatModel,string>={
 'gpt-6-astra':'openai/gpt-6-astra',
 'gpt-6.1-sol':'openai/gpt-6.1-sol',
 'claude-sonnet-5-5':'anthropic/claude-sonnet-5.5',
 'claude-opus-5-5':'anthropic/claude-opus-5.5',
};
export const defaultChatModel: ChatModel = 'claude-opus-5-5';
export const modelLabels: Record<ChatModel,string> = {'gpt-6-astra':'Astra','gpt-6.1-sol':'GPT-6.1 Sol','claude-sonnet-5-5':'Sonnet 5.5','claude-opus-5-5':'Opus 5.5'};
export const isChatModel = (value:unknown):value is ChatModel => typeof value==='string'&&(chatModels as readonly string[]).includes(value);
export const modelSelectionSchema=z.object({model:z.enum(chatModels),effort:z.enum(reasoningEfforts),defaultsVersion:z.literal(1).optional()});
export type ModelSelection=z.infer<typeof modelSelectionSchema>;

// Explicit October 2026 switch: old durable auth snapshots must use Opus too.
// Versioned snapshots preserve model choices made after this switch.
export const modelDefaultsVersion = 1;
export function effectiveTaskModelSelection(value:unknown):ModelSelection {
 const selected=modelSelectionSchema.parse(value);
 return {model:selected.defaultsVersion===modelDefaultsVersion?selected.model:defaultChatModel,effort:selected.effort};
}
