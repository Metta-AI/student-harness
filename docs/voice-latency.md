# Preston voice latency

Keep routine lookups under two seconds of application/tool time when dependencies are healthy. This is an operational target, not a guarantee about OpenAI, Softmax, network latency, or the time to speak an answer.

- GPT-Live keeps speaking/listening while GPT-6 Astra dispatches with low reasoning effort. Deep policy work goes to durable research workers.
- Up to four adjacent read-only tool calls overlap. Research writes, UI changes, cursor actions, unknown tools, and backend continuations preserve order. Every pending function receives a result before continuation.
- Identical concurrent CLI reads share execution, keyed by a hash of account credentials, server, executable and arguments. Live results are fetched again after completion. Only successful help output is cached, for five minutes with at most 64 entries.
- CLI processes are capped at four per application process. Saturation fails promptly; failed reads are never cached. CLI reads are killed at 12 seconds. Partial timeout/oversize output is discarded. JSON is compacted without removing fields.
- The league snapshot starts leaderboard retrieval immediately after division lookup, in parallel with metadata and account lookups. It loads only policy identifiers and skips historical win/loss reconstruction by default. These network reads share a 12-second cancellation signal.
- Routine workspace reads fetch summaries and at most 20 revisions/experiments. Source is opt-in. These queries share a 12-second cancellation signal.

## Measurements

The voice tool route logs tool name, duration and outcome without arguments or credentials, flags calls over two seconds, and sends a `Server-Timing` header. Persisted conversation tool events include browser-to-result duration, including network overhead. The CLI result includes duration and whether execution was reused.

Run the read-only live benchmark from the repository root:

```sh
node --env-file=.env.local --experimental-strip-types scripts/voice-benchmark.mjs
```

It uses the most recently active account, performs help/division/league/workspace reads, and prints only timings and sizes. Compare several runs, including cold starts; do not treat a single sample as a percentile.

`tests/voice-latency.test.mjs`, `tests/voice-cli.test.mjs`, and `tests/voice-league-latency.test.mjs` verify concurrency, ordering, account separation, bounded processes, timeout termination, freshness and critical-path dependencies without relying on wall-clock speed assertions.

The delegation protocol follows [OpenAI's GPT-Live delegation guide](https://developers.openai.com/api/docs/guides/live-delegation).
