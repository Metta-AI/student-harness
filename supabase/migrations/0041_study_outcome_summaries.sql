-- Keep polling independent of native replay size. Repeated JSON-path reads of
-- result decompress its TOASTed evidence for every scalar, even for tiny responses.
-- PostgreSQL maintains the summary atomically with the authoritative full result.
alter table research_attempts add column outcome_summary jsonb
 generated always as (result - 'evidence') stored;
notify pgrst,'reload schema';
