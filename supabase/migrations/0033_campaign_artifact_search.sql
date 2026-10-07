-- Search complete saved findings, including rejected branches and transcript content.
alter table research_artifacts add column search_text tsvector generated always as (to_tsvector('english',title||' '||content::text)) stored;
create index research_artifact_text_search on research_artifacts using gin(search_text);
