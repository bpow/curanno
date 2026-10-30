# Performance: ACL-filtered search under load

The plan's risk table (section 11) foresaw that filtering every read through the per-annotation ACL in SQL could make search slow at scale, and assigned a load test at representative volumes to Phase 5. This document records that test, run on 2026-10-30 against the 1.0 release candidate: the data, the method, the numbers before and after the fixes it led to, and the query plans. It is reproducible with two workspace scripts (operator guide, section 9).

## 1. Summary

- Four fixes came out of the test, each its own commit: full-text search goes through the GIN indexes (it did not); a listing computes its filtered set once and loads only the page (it counted and paged in two passes and built every row before the offset); a partial index on read grants gives the ACL check a one-descent probe; a `Last-Event-ID` replay loads its annotations in one query instead of two per event.
- After them, on a laptop with Postgres at its default settings and ten concurrent clients, every path that a sidebar uses answers at or under about 200 ms at the 95th percentile even for the most annotated document in the set (36 340 annotations): its container in 117 to 195 ms, full-text search within it in 214 ms, and the replay of a thousand events in 130 to 190 ms; a median document's container takes 5 ms and a rare term 14 ms.
- Two paths remain above 200 ms at p95 and are explained in section 6: full-text search for the most common content word as a member of 32 groups (395 ms), whose cost is the term's 25 000 matches and the caller's 388 000 readable annotations; and search with no filter at all (604 ms anonymous, 966 ms for that caller), which must count every annotation the caller may read. Neither is on the sidebar's path; the management site's browse page issues the second when opened without a filter.

## 2. Data

`apps/api/scripts/load-seed.ts` fills a migrated database deterministically from a seed (`pnpm load:seed`, defaults shown):

| What | Volume | Shape |
|---|---:|---|
| Users | 5 000 | One issuer; tokens are minted for them by the runner |
| Groups | 500 | Membership skewed: a tenth of users in no group, most in one to eight, one in a hundred in 15 to 40; group popularity follows 1/rank, so the largest group has 1 133 members and the smallest 2 |
| Documents | 10 000 | Each with its own URI, three in ten with a second one |
| Annotations | 1 000 000 | Over documents and creators by 1/rank^0.8: the most annotated document has 36 340, the median 40; the most prolific creator 43 711. Two years of timestamps; 2% soft-deleted; 10% updated after creation; motivations 65% commenting, 20% highlighting, 10% tagging, 5% classifying |
| Targets | 1 000 000 | One per annotation: a TextQuoteSelector with a 3 to 10 word quote plus a TextPositionSelector; 3% orphaned |
| Bodies | 849 600 | A TextualBody of one to three sentences (highlights have none; tags have a tag body and half of them a comment) |
| ACL rows | 4 569 298 | The creator's four permissions on every annotation, then: 50% shared with nobody else, 25% read (a third also update) for one of the creator's groups, 10% read for `authenticated`, 15% read for `public` |
| Events | 1 118 382 | One per creation, update and deletion, in time order |

Text comes from a 4 000-word vocabulary whose frequencies follow a Zipf law: English function words first (which `to_tsvector` drops), then a curation and general vocabulary, then pseudo-words for the long tail. The runner searches for the most frequent content word (`variant`, which 24 907 bodies or quotes contain), a mid-rank one (`good`) and a rare one (`rimopraine`). The database is 2.8 GB; the ACL table with its indexes 1.1 GB.

## 3. Method

`apps/api/scripts/load-run.ts` (`pnpm load:run`) starts the API from the build in a child process against the seeded database, signs tokens for seeded users with a key it generates, and drives each scenario through autocannon with 10 connections for 10 seconds after a 2-second warm-up, sampling every response's latency. Event-stream replays use their own closed loop of 10 subscribers, each timing a request until the window's last `id:` line arrives. It then runs `EXPLAIN (ANALYZE, BUFFERS)` on the exact statements the store issues.

Principals:

| Name | Who | Readable annotations |
|---|---|---:|
| anonymous | No token: the `public` principal | 147 441 |
| light | A user in one group of one member, 52 own annotations | 10 434 on the hot document |
| heavy | A user in 32 groups including the largest (1 133, 583, 435 ... members), 50 own annotations | 380 754 |
| creator | The most prolific user, 43 711 own annotations, no groups | 42 788 own undeleted |

The search API has no group filter: a caller's groups enter through the ACL, so the scenarios vary the principal instead and use the `creator` filter as the other narrow filter. The hot document is the most annotated one; the mid document has 40 annotations; the deep container page is a quarter of the way through the hot document (page 454); the replay starts from event 1 with 1.1 million events behind it.

Hardware and software: Apple M5 Pro (18 cores, 64 GB), macOS 26.6. Postgres 17.11 (`postgres:17-alpine`) in a podman machine with 8 vCPUs and 10.8 GiB, `--shm-size=1g`, otherwise default settings (`shared_buffers` 128 MB, `work_mem` 4 MB, `max_parallel_workers_per_gather` 2). The API (Node 26.4) and autocannon ran on the host, so the measured latencies include a virtual network hop and the load generator shared the machine with the server. Numbers are from one run each; repeat runs varied by about 10%.

## 4. Results

Latencies in milliseconds. "Before" is the release candidate at `main` (f9e1e3e); "after" is this branch. "Timed out" means no request completed within autocannon's 10-second timeout.

| Scenario | Principal | Visible total | Before p50 | Before p95 | After p50 | After p95 | After p99 | After req/s |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| container hot document | anonymous | 5491 | 143 | 165 | 108 | 117 | 174 | 92 |
| container hot document | light | 10434 | 150 | 221 | 106 | 153 | 180 | 89 |
| container hot document | heavy | 14105 | 197 | 298 | 164 | 195 | 293 | 60 |
| container mid document | heavy | 18 | 4 | 5 | 3 | 5 | 6 | 2718 |
| container hot document, deep page | heavy |  | 816 | 1704 | 165 | 200 | 260 | 59 |
| search text common | anonymous | 3550 | timed out | timed out | 228 | 254 | 269 | 43 |
| search text common | heavy | 9371 | timed out | timed out | 337 | 395 | 592 | 28 |
| search text mid | heavy | 2344 | timed out | timed out | 155 | 292 | 309 | 57 |
| search text rare | heavy | 310 | timed out | timed out | 10 | 14 | 16 | 972 |
| search text common in hot document | heavy | 358 | 468 | 3701 | 203 | 214 | 243 | 49 |
| search by creator | heavy | 21500 | 188 | 244 | 173 | 213 | 280 | 57 |
| search by creator | creator | 42788 | 154 | 232 | 142 | 211 | 233 | 65 |
| search in hot document, no text | heavy | 14105 | 181 | 231 | 164 | 195 | 302 | 60 |
| search without filters | anonymous | 147441 | 594 | 1193 | 287 | 604 | 654 | 28 |
| search without filters | heavy | 380754 | 1488 | 2191 | 619 | 966 | 1334 | 14 |
| search text common, offset 5000 | heavy | 9371 | timed out | timed out | 321 | 337 | 536 | 30 |
| search without filters, offset 100000 | heavy | 380754 | 6127 | 7309 | 698 | 1039 | 1176 | 13 |
| SSE replay from the start | heavy |  | 1939 | 2623 | 115 | 144 | 213 | 84 |
| SSE replay from the start | anonymous |  | 1624 | 1685 | 166 | 190 | 221 | 59 |
| SSE replay from the start, hot document | heavy |  | 2127 | 2240 | 109 | 130 | 146 | 90 |

Event replays are timed to the last event of the window; time to the first event was 80 ms (heavy), 136 ms (anonymous) and 77 ms (hot document) at p50 after the fix, against 38, 50 and 299 ms before, when the first event followed a cheaper query but the rest trickled out two queries at a time.

## 5. What was slow, and the fixes

### 5.1 Full-text search never used its indexes

The `text` filter was `exists (bodies ... @@ query) or exists (targets ... @@ query)`, two correlated subqueries. Postgres evaluated them once per candidate annotation through the `(annotation_id, position)` indexes and filtered on the tsvector in memory; `bodies_text_search_idx` and `targets_quote_search_idx` were never read. For the heavy caller that meant 388 000 candidates, each costing three index probes: 2.4 seconds per query and every request timing out under load.

Fix (commit "Match full-text search through the GIN indexes"): the matching ids are one `UNION` of the two GIN-indexed scans, and the candidate set is joined to it (`annotations.id in (...)`). The plan becomes two bitmap index scans, a hash aggregate of about 25 000 ids for the common term, and a join to the ACL. 2 397 ms became 256 ms for the common term; the rare term is now served in 10 ms.

### 5.2 Counting and paging were two passes, and paging built every skipped row

`list` ran a `count(*)` statement and a page statement over the same filtered set, so the ACL join was paid twice, and the page statement computed each row's bodies, targets and permissions as JSON for every row ahead of the offset before the `LIMIT` discarded them: page 454 of the hot document built 9 000 rows to return 20, and `offset=100000` built 100 050.

Fix (commit "List annotations in one filtered pass and load only the page"): one statement computes the filtered set in a materialized CTE and returns its count, its latest modification and the ordered ids of the page; a second statement loads those ids, still through the ACL-filtered record query. Deep pages are now the cost of a top-N sort over the filtered set: page 454 went from 816 to 165 ms and `offset=100000` from 6.1 s to 0.7 s, the latter dominated by the count (5.4 below).

### 5.3 The ACL probe was priced per principal

The read check is `exists (select 1 from acl where annotation_id = ? and permission = 'read' and principal_id = any(?))`. Probing `acl_pkey (annotation_id, principal_id, permission)` with 34 principals as scalar-array keys is costed by the planner at roughly 160 per probe, so for a caller in many groups it preferred hashing the caller's whole readable set (388 000 rows from `acl_principal_idx`, spilling to disk at the default `work_mem`) for every query, including the container of a 40-annotation document, which took 62 ms after 5.2 made the count the only pass.

Fix (migration `0009_acl_read_index.sql`): `create index acl_annotation_read_idx on acl (annotation_id) include (principal_id) where permission = 'read'`, 71 MB against the primary key's 331 MB. The probe is one descent plus a filter on the included column; the planner uses it whenever the candidate set is small and keeps the hash for large ones. The 40-annotation container fell to 0.2 ms, text search within the hot document from 127 to 87 ms per query.

### 5.4 Replay ran two queries per event

The security review (finding 5) moved the ACL into the replay query, but the handler still called `canRead` and then `get` for each of the 1 000 replayed events: 2 000 round trips, 1.6 to 2.1 seconds per reconnecting sidebar.

Fix (commit "Load replayed events in one query"): the replayed annotations are loaded in one ACL-filtered query by id and written in order; the live path, which handles one event at a time, is unchanged. A full window now takes 109 to 166 ms.

## 6. What remains, and why

The cost that remains in every "heavy" number is the caller's readable set. When the candidate set is large (the hot document's 36 340 annotations, a creator's 43 000, every annotation that mentions `variant`), the planner enumerates the 388 485 ACL rows of the caller's 35 principals and hashes them, about 50 ms of CPU and, at the default `work_mem`, a spill to temporary files. The alternative, one probe per candidate, costs about the same at these sizes (36 000 probes at 3 µs). That is inherent to per-annotation ACL rows filtered by principal: the work is proportional to min(candidates, readable), and both are large here.

- **Search for a very common term as a member of many groups** (p95 395 ms): 25 000 matches found in 60 ms through the GIN indexes plus the ACL hash. Terms that match less than about 1% of annotations stay well under 200 ms (mid term p50 155 ms, rare 10 ms).
- **Search without any filter** (p95 604 ms anonymous, 966 ms heavy): the `total` must count every annotation the caller may read, a parallel hash semi-join over a million rows (244 ms per query, 14 requests per second with ten clients). The sidebar never issues this; the management site's browse page does when opened without a filter. Options if it matters: cap the count (count to a bound and report "at least"), which is a change to the search response, or have the page open with a filter.
- **The hottest document** (container p95 195 ms heavy, 117 ms anonymous) is the extreme of the Zipf distribution; documents with a few thousand annotations cost a few tens of milliseconds. If real deployments concentrate more annotations on fewer documents, the next step is to carry `document_id` on ACL rows so that a document's grants can be enumerated directly (an index on `(document_id, principal_id, permission, annotation_id)`), which bounds the work by the document instead of the caller.

Setting `work_mem` to 32 or 64 MB keeps the ACL hash and its sort in memory and takes 10 to 20% off the heavy numbers (hot container 100 to 87 ms per query); it is a Postgres setting, not the application's, and the operator guide mentions it.

## 7. Query plans

`EXPLAIN (ANALYZE, BUFFERS)` of the statement that computes the total and the page ids, after the fixes, as the heavy caller. The 34-element principal list is elided.

### search text common (heavy): total and page ids

```
Result  (cost=88803.66..88803.67 rows=1 width=48) (actual time=231.418..231.423 rows=1 loops=1)
  Buffers: shared hit=27320 read=37354, temp read=2606 written=2608
  CTE matched
    ->  Nested Loop  (cost=82641.61..88333.09 rows=4783 width=32) (actual time=173.592..228.353 rows=9371 loops=1)
          Buffers: shared hit=27320 read=37351, temp read=2606 written=2608
          ->  Hash Join  (cost=82641.19..83030.99 rows=4883 width=32) (actual time=173.560..194.566 rows=9557 loops=1)
                Hash Cond: (bodies.annotation_id = acl.annotation_id)
                Buffers: shared hit=691 read=25752, temp read=2606 written=2608
                ->  HashAggregate  (cost=58030.85..58281.62 rows=25077 width=16) (actual time=53.578..55.253 rows=24773 loops=1)
                      Group Key: bodies.annotation_id
                      Batches: 1  Memory Usage: 1809kB
                      Buffers: shared hit=209 read=22087
                      ->  Append  (cost=146.45..57968.16 rows=25077 width=16) (actual time=2.733..49.899 rows=24907 loops=1)
                            Buffers: shared hit=209 read=22087
                            ->  Bitmap Heap Scan on bodies  (cost=146.45..40243.57 rows=19144 width=16) (actual time=2.732..34.395 rows=18532 loops=1)
                                  Recheck Cond: (text_search @@ '''variant'''::tsquery)
                                  Heap Blocks: exact=16201
                                  Buffers: shared hit=162 read=16051
                                  ->  Bitmap Index Scan on bodies_text_search_idx  (cost=0.00..141.66 rows=19144 width=0) (actual time=1.554..1.554 rows=18532 loops=1)
                                        Index Cond: (text_search @@ '''variant'''::tsquery)
                                        Buffers: shared hit=1 read=11
                            ->  Bitmap Heap Scan on targets  (cost=56.46..17599.20 rows=5933 width=16) (actual time=0.868..14.538 rows=6375 loops=1)
                                  Recheck Cond: (quote_search @@ '''variant'''::tsquery)
                                  Heap Blocks: exact=6075
                                  Buffers: shared hit=47 read=6036
                                  ->  Bitmap Index Scan on targets_quote_search_idx  (cost=0.00..54.98 rows=5933 width=0) (actual time=0.469..0.469 rows=6375 loops=1)
                                        Index Cond: (quote_search @@ '''variant'''::tsquery)
                                        Buffers: shared read=8
                ->  Hash  (cost=23009.99..23009.99 rows=128028 width=16) (actual time=119.732..119.733 rows=388464 loops=1)
                      Buckets: 262144 (originally 131072)  Batches: 4 (originally 1)  Memory Usage: 6618kB
                      Buffers: shared hit=482 read=3665, temp read=952 written=2232
                      ->  Unique  (cost=22315.26..23009.99 rows=128028 width=16) (actual time=54.220..96.243 rows=388464 loops=1)
                            Buffers: shared hit=482 read=3665, temp read=952 written=954
                            ->  Sort  (cost=22315.26..22662.62 rows=138946 width=16) (actual time=54.218..72.481 rows=388485 loops=1)
                                  Sort Key: acl.annotation_id
                                  Sort Method: external merge  Disk: 7616kB
                                  Buffers: shared hit=482 read=3665, temp read=952 written=954
                                  ->  Index Only Scan using acl_principal_idx on acl  (cost=0.56..8069.88 rows=138946 width=16) (actual time=0.028..26.176 rows=388485 loops=1)
                                        Index Cond: ((principal_id = ANY (<34 principals>)) AND (permission = 'read'::text))
                                        Heap Fetches: 465
                                        Buffers: shared hit=482 read=3665
          ->  Index Scan using annotations_pkey on annotations  (cost=0.42..1.16 rows=1 width=32) (actual time=0.003..0.003 rows=1 loops=9557)
                Index Cond: (id = acl.annotation_id)
                Filter: (deleted_at IS NULL)
                Rows Removed by Filter: 0
                Buffers: shared hit=26629 read=11599
  InitPlan 2
    ->  Aggregate  (cost=107.62..107.63 rows=1 width=8) (actual time=229.835..229.835 rows=1 loops=1)
          Buffers: shared hit=27320 read=37351, temp read=2606 written=2608
          ->  CTE Scan on matched  (cost=0.00..95.66 rows=4783 width=0) (actual time=173.594..229.522 rows=9371 loops=1)
                Buffers: shared hit=27320 read=37351, temp read=2606 written=2608
  InitPlan 3
    ->  Aggregate  (cost=107.62..107.63 rows=1 width=8) (actual time=0.580..0.580 rows=1 loops=1)
          ->  CTE Scan on matched matched_1  (cost=0.00..95.66 rows=4783 width=8) (actual time=0.001..0.282 rows=9371 loops=1)
  InitPlan 4
    ->  Aggregate  (cost=255.30..255.31 rows=1 width=32) (actual time=1.001..1.001 rows=1 loops=1)
          Buffers: shared read=3
          ->  Subquery Scan on agg  (cost=254.55..255.17 rows=50 width=40) (actual time=0.923..0.930 rows=50 loops=1)
                Buffers: shared read=3
                ->  Limit  (cost=254.55..254.67 rows=50 width=24) (actual time=0.719..0.723 rows=50 loops=1)
                      Buffers: shared read=3
                      ->  Sort  (cost=254.55..266.51 rows=4783 width=24) (actual time=0.719..0.720 rows=50 loops=1)
                            Sort Key: matched_2.created_at DESC, matched_2.id DESC
                            Sort Method: top-N heapsort  Memory: 30kB
                            Buffers: shared read=3
                            ->  CTE Scan on matched matched_2  (cost=0.00..95.66 rows=4783 width=24) (actual time=0.000..0.335 rows=9371 loops=1)
Planning:
  Buffers: shared hit=291 read=52
Planning Time: 1.989 ms
Execution Time: 232.443 ms
```

### container hot document (heavy): total and page ids

```
Result  (cost=32255.81..32255.82 rows=1 width=48) (actual time=101.810..101.813 rows=1 loops=1)
  Buffers: shared hit=3203 read=16991, temp read=1745 written=1745
  CTE matched
    ->  Hash Semi Join  (cost=11659.36..31813.27 rows=4827 width=32) (actual time=52.592..98.111 rows=14105 loops=1)
          Hash Cond: (annotations.id = acl.annotation_id)
          Buffers: shared hit=3203 read=16991, temp read=1745 written=1745
          ->  Bitmap Heap Scan on annotations  (cost=1173.66..19997.51 rows=34740 width=32) (actual time=3.163..30.112 rows=36340 loops=1)
                Recheck Cond: ((document_id = '0f6ca8bb-2cc9-413e-8d3d-d25656c0d1c4'::uuid) AND (deleted_at IS NULL))
                Heap Blocks: exact=15785
                Buffers: shared hit=2711 read=13336
                ->  Bitmap Index Scan on annotations_document_idx  (cost=0.00..1164.97 rows=34740 width=0) (actual time=2.101..2.102 rows=36340 loops=1)
                      Index Cond: (document_id = '0f6ca8bb-2cc9-413e-8d3d-d25656c0d1c4'::uuid)
                      Buffers: shared read=262
          ->  Hash  (cost=8069.88..8069.88 rows=138946 width=16) (actual time=49.032..49.033 rows=388485 loops=1)
                Buckets: 262144 (originally 262144)  Batches: 4 (originally 2)  Memory Usage: 6618kB
                Buffers: shared hit=492 read=3655, temp written=1277
                ->  Index Only Scan using acl_principal_idx on acl  (cost=0.56..8069.88 rows=138946 width=16) (actual time=0.020..23.966 rows=388485 loops=1)
                      Index Cond: ((principal_id = ANY (<34 principals>)) AND (permission = 'read'::text))
                      Heap Fetches: 465
                      Buffers: shared hit=492 read=3655
  InitPlan 2
    ->  Aggregate  (cost=108.61..108.62 rows=1 width=8) (actual time=99.873..99.874 rows=1 loops=1)
          Buffers: shared hit=3203 read=16991, temp read=1745 written=1745
          ->  CTE Scan on matched  (cost=0.00..96.54 rows=4827 width=0) (actual time=52.592..99.493 rows=14105 loops=1)
                Buffers: shared hit=3203 read=16991, temp read=1745 written=1745
  InitPlan 3
    ->  Aggregate  (cost=108.61..108.62 rows=1 width=8) (actual time=0.833..0.833 rows=1 loops=1)
          ->  CTE Scan on matched matched_1  (cost=0.00..96.54 rows=4827 width=8) (actual time=0.001..0.405 rows=14105 loops=1)
  InitPlan 4
    ->  Aggregate  (cost=225.29..225.30 rows=1 width=32) (actual time=1.101..1.101 rows=1 loops=1)
          ->  Subquery Scan on agg  (cost=224.98..225.23 rows=20 width=40) (actual time=1.091..1.093 rows=20 loops=1)
                ->  Limit  (cost=224.98..225.03 rows=20 width=24) (actual time=1.087..1.089 rows=20 loops=1)
                      ->  Sort  (cost=224.98..237.05 rows=4827 width=24) (actual time=1.086..1.086 rows=20 loops=1)
                            Sort Key: matched_2.created_at DESC, matched_2.id DESC
                            Sort Method: top-N heapsort  Memory: 27kB
                            ->  CTE Scan on matched matched_2  (cost=0.00..96.54 rows=4827 width=24) (actual time=0.000..0.574 rows=14105 loops=1)
Planning:
  Buffers: shared hit=17
Planning Time: 0.130 ms
Execution Time: 102.300 ms
```

### search without filters (heavy): total and page ids

```
Result  (cost=69137.01..69137.02 rows=1 width=48) (actual time=242.515..242.615 rows=1 loops=1)
  Buffers: shared hit=20739 read=10055, temp read=13285 written=11332
  CTE matched
    ->  Gather  (cost=11485.70..55768.78 rows=136098 width=32) (actual time=53.786..146.389 rows=380754 loops=1)
          Workers Planned: 2
          Workers Launched: 2
          Buffers: shared hit=20739 read=10055, temp read=9379 written=9379
          ->  Hash Semi Join  (cost=10485.70..41158.98 rows=56708 width=32) (actual time=51.979..142.659 rows=126918 loops=3)
                Hash Cond: (annotations.id = acl.annotation_id)
                Buffers: shared hit=20739 read=10055, temp read=9379 written=9379
                ->  Parallel Seq Scan on annotations  (cost=0.00..22357.67 rows=408125 width=32) (actual time=0.006..22.357 rows=326621 loops=3)
                      Filter: (deleted_at IS NULL)
                      Rows Removed by Filter: 6713
                      Buffers: shared hit=12012 read=6179
                ->  Hash  (cost=8069.88..8069.88 rows=138946 width=16) (actual time=51.433..51.434 rows=388485 loops=3)
                      Buckets: 262144 (originally 262144)  Batches: 4 (originally 2)  Memory Usage: 6618kB
                      Buffers: shared hit=8587 read=3856, temp written=3831
                      ->  Index Only Scan using acl_principal_idx on acl  (cost=0.56..8069.88 rows=138946 width=16) (actual time=0.023..23.821 rows=388485 loops=3)
                            Index Cond: ((principal_id = ANY (<34 principals>)) AND (permission = 'read'::text))
                            Heap Fetches: 1395
                            Buffers: shared hit=8587 read=3856
  InitPlan 2
    ->  Aggregate  (cost=3062.20..3062.22 rows=1 width=8) (actual time=184.702..184.702 rows=1 loops=1)
          Buffers: shared hit=20739 read=10055, temp read=9379 written=11331
          ->  CTE Scan on matched  (cost=0.00..2721.96 rows=136098 width=0) (actual time=53.787..175.067 rows=380754 loops=1)
                Buffers: shared hit=20739 read=10055, temp read=9379 written=11331
  InitPlan 3
    ->  Aggregate  (cost=3062.20..3062.22 rows=1 width=8) (actual time=26.236..26.237 rows=1 loops=1)
          Buffers: temp read=1953 written=1
          ->  CTE Scan on matched matched_1  (cost=0.00..2721.96 rows=136098 width=8) (actual time=0.004..14.516 rows=380754 loops=1)
                Buffers: temp read=1953 written=1
  InitPlan 4
    ->  Aggregate  (cost=7243.79..7243.80 rows=1 width=32) (actual time=31.573..31.573 rows=1 loops=1)
          Buffers: temp read=1953
          ->  Subquery Scan on agg  (cost=7243.04..7243.66 rows=50 width=40) (actual time=31.553..31.560 rows=50 loops=1)
                Buffers: temp read=1953
                ->  Limit  (cost=7243.04..7243.16 rows=50 width=24) (actual time=31.548..31.552 rows=50 loops=1)
                      Buffers: temp read=1953
                      ->  Sort  (cost=7243.04..7583.28 rows=136098 width=24) (actual time=31.547..31.548 rows=50 loops=1)
                            Sort Key: matched_2.created_at DESC, matched_2.id DESC
                            Sort Method: top-N heapsort  Memory: 31kB
                            Buffers: temp read=1953
                            ->  CTE Scan on matched matched_2  (cost=0.00..2721.96 rows=136098 width=24) (actual time=0.002..17.503 rows=380754 loops=1)
                                  Buffers: temp read=1953
Planning:
  Buffers: shared hit=17
Planning Time: 0.197 ms
Execution Time: 243.594 ms
```
