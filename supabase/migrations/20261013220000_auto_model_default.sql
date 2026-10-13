-- Auto (Haiku 5.5 escalating to Gemini 3.8 Flash, then GPT-6.1 Sol) becomes
-- the default. Haiku 5.5 and Gemini 3.8 Flash are also selectable directly.
-- Saved preferences and immutable task snapshots are preserved.
alter table students drop constraint students_chat_model_check;
alter table students add constraint students_chat_model_check check (
 chat_model in ('auto','claude-haiku-5-5','gemini-3.8-flash','gpt-6-luna','gpt-6-astra','gpt-6.1-sol','claude-sonnet-5-5','claude-opus-5-5')
);
alter table students alter column chat_model set default 'auto';

alter table research_campaigns drop constraint campaign_model_selection_valid;
alter table research_campaigns add constraint campaign_model_selection_valid check (coalesce(
 jsonb_typeof(model_selection)='object' and model_selection ?& array['model','effort'] and
 model_selection->>'model' in ('auto','claude-haiku-5-5','gemini-3.8-flash','gpt-6-luna','gpt-6-astra','gpt-6.1-sol','claude-sonnet-5-5','claude-opus-5-5') and
 model_selection->>'effort' in ('low','medium','high','xhigh')
,false));
notify pgrst,'reload schema';
