import type { MediaListItem, SearchDebug, SearchFilters } from '@tma/shared';
import type { AiGateway } from '../ai/gateway.js';
import type { AppContext } from '../context.js';
import { queryMedia } from '../media/queries.js';
import { knnSearch, vectorCount } from '../vector/store.js';
import { searchFts } from './fts.js';

const RRF_K = 60;
const FTS_CANDIDATES = 100;
const VECTOR_CANDIDATES = 50;

export interface HybridSearchOptions {
  query: string;
  filters: SearchFilters;
  limit: number;
}

export interface HybridSearchResult {
  items: MediaListItem[];
  debug: SearchDebug;
  candidates: { fts: number[]; vector: number[]; fused: number[] };
}

/**
 * Hybrid 检索：结构化过滤 + FTS + 向量三路召回，RRF 融合后按序取结果。
 * 未配置 embedding 时自动降级为 FTS/LIKE（debug 里可见）。
 */
export async function hybridSearch(
  ctx: AppContext,
  gateway: AiGateway,
  opts: HybridSearchOptions,
): Promise<HybridSearchResult> {
  const started = Date.now();

  const fts = searchFts(ctx.sqlite, opts.query, FTS_CANDIDATES);
  const ftsIds = fts.hits.map((h) => h.docId);

  let vectorIds: number[] = [];
  const canVector = gateway.embedEnabled && vectorCount(ctx.sqlite) > 0;

  if (canVector) {
    try {
      await gateway.withRun('search', opts.query, async (runId) => {
        gateway.recordStep(runId, {
          type: 'retrieval',
          toolName: 'fts',
          input: { query: opts.query },
          output: { hits: ftsIds.length, strategy: fts.strategy },
          status: 'succeeded',
        });
        const response = await gateway.runEmbed(
          { input: [opts.query] },
          { runId, label: 'search.query_embedding' },
        );
        const queryVector = response.vectors[0];
        if (queryVector) {
          const hits = knnSearch(ctx.sqlite, queryVector, VECTOR_CANDIDATES);
          vectorIds = hits.map((h) => h.assetId);
          gateway.recordStep(runId, {
            type: 'retrieval',
            toolName: 'vector',
            input: { k: VECTOR_CANDIDATES, dim: queryVector.length },
            output: {
              hits: hits.length,
              top: hits.slice(0, 5).map((h) => ({ assetId: h.assetId, distance: Number(h.distance.toFixed(4)) })),
            },
            status: 'succeeded',
          });
        }
      });
    } catch (err) {
      ctx.logger.warn({ err }, '向量检索失败，降级为 FTS/LIKE');
      vectorIds = [];
    }
  }

  // RRF 融合
  const fused = new Map<number, number>();
  ftsIds.forEach((id, i) => {
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  vectorIds.forEach((id, i) => {
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + i + 1));
  });
  const rankedIds = [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  const items =
    rankedIds.length > 0
      ? queryMedia(ctx.sqlite, {
          filters: opts.filters,
          limit: opts.limit,
          candidateIds: rankedIds,
          order: 'relevance',
        }).items
      : [];

  const strategy: SearchDebug['strategy'] =
    vectorIds.length > 0 ? 'hybrid' : fts.strategy;

  return {
    items,
    debug: {
      strategy,
      ftsHits: ftsIds.length,
      vectorHits: vectorIds.length,
      reranked: items.length,
      tookMs: Date.now() - started,
    },
    candidates: { fts: ftsIds, vector: vectorIds, fused: rankedIds },
  };
}
