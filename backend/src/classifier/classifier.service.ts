import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { messageClassifications } from '../db/schema';
import { MESSAGE_OPTIONS, type MessageClassifier, UnreadableAnswerError } from './classifier.types';
import { GeminiClassifier } from './gemini.classifier';
import { StrandsClassifier } from './strands.classifier';

/** Settings, all from the environment (see .env.example). */
export function classifierConfig(get: (k: string) => string | undefined) {
  const n = (k: string, d: number) => {
    const v = Number(get(k));
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    provider: (get('CLASSIFIER_PROVIDER') ?? 'off').toLowerCase(),
    strandsUrl: get('CLASSIFIER_STRANDS_URL') || 'http://127.0.0.1:8000',
    // Pinned: a new checkpoint is a deliberate change here, then re-evaluated.
    strandsModel: get('CLASSIFIER_STRANDS_MODEL') || 'StrandsAgents/strands-decider-2B-hobson-v21',
    geminiModel: get('CLASSIFIER_GEMINI_MODEL') || 'gemini-flash-lite-latest',
    threshold: Math.min(1, n('CLASSIFIER_THRESHOLD', 0.7)),
    timeoutMs: n('CLASSIFIER_TIMEOUT_MS', 5000),
    perTenantPerHour: n('CLASSIFIER_TENANT_PER_HOUR', 120),
  };
}

/** Builds the configured classifier; null when switched off (the default). */
export function makeClassifier(get: (k: string) => string | undefined): MessageClassifier | null {
  const c = classifierConfig(get);
  if (c.provider === 'strands') return new StrandsClassifier(c.strandsUrl, c.strandsModel);
  if (c.provider === 'gemini') return new GeminiClassifier(() => get('GEMINI_API_KEY'), c.geminiModel);
  return null;
}

/**
 * Suggest-only classification of incoming messages ("shadow mode"). It runs
 * beside the existing flow and never changes it: whatever happens here -
 * a low score, a slow or absent service, a reply it cannot read, the
 * center's hourly allowance used up - the message is logged as "needs a
 * person" and the bot carries on as before. Each call carries one center's
 * one message only.
 */
@Injectable()
export class ClassifierService {
  private readonly logger = new Logger(ClassifierService.name);
  private override: MessageClassifier | null | undefined;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
  ) {}

  private get = (k: string) => this.config.get<string>(k);

  settings() {
    return classifierConfig(this.get);
  }

  /** Tests (and the evaluation script) put their own classifier in. */
  use(classifier: MessageClassifier | null | undefined) {
    this.override = classifier;
  }

  private classifier() {
    return this.override !== undefined ? this.override : makeClassifier(this.get);
  }

  /** Never throws and never blocks the caller: start it with `void`. */
  async shadow(tenantId: string, text: string, source: string, sourceRef?: string | null, ruleAction?: string | null) {
    try {
      return await this.classifyAndLog(tenantId, text, source, sourceRef ?? null, ruleAction ?? null);
    } catch (err) {
      this.logger.warn(`shadow classification failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async classifyAndLog(tenantId: string, rawText: string, source: string, sourceRef: string | null, ruleAction: string | null) {
    const classifier = this.classifier();
    if (!classifier) return null;
    const text = rawText.trim().slice(0, 1000);
    if (!text) return null;
    const cfg = this.settings();
    const base = { tenantId, source, sourceRef, inputText: text, options: MESSAGE_OPTIONS, provider: classifier.provider, modelVersion: classifier.modelVersion, ruleAction };

    // The center's hourly allowance (counted in the database, so it holds
    // across restarts and several servers).
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(messageClassifications)
      .where(
        and(
          eq(messageClassifications.tenantId, tenantId),
          gte(messageClassifications.createdAt, new Date(Date.now() - 3_600_000)),
          // Calls made, whatever their outcome; the refused ones do not count.
          sql`${messageClassifications.error} is distinct from 'RATE_LIMITED'`,
        ),
      );
    if (n >= cfg.perTenantPerHour) {
      const [row] = await this.db.insert(messageClassifications).values({ ...base, status: 'NEEDS_HUMAN', error: 'RATE_LIMITED' }).returning();
      return row;
    }

    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const r = await classifier.classify({ text, options: MESSAGE_OPTIONS }, ctrl.signal);
      const sure = r.probability >= cfg.threshold;
      const [row] = await this.db
        .insert(messageClassifications)
        .values({
          ...base,
          modelVersion: r.servedBy && r.servedBy !== classifier.modelVersion ? `${classifier.modelVersion} (served: ${r.servedBy})` : classifier.modelVersion,
          chosen: r.choice,
          probability: r.probability,
          probabilities: r.probabilities ?? null,
          status: sure ? 'SUGGESTED' : 'NEEDS_HUMAN',
          error: sure ? null : 'LOW_CONFIDENCE',
          latencyMs: Date.now() - started,
        })
        .returning();
      return row;
    } catch (err) {
      const error = ctrl.signal.aborted ? 'TIMEOUT' : err instanceof UnreadableAnswerError ? 'UNREADABLE_ANSWER' : `UNAVAILABLE: ${(err as Error).message}`.slice(0, 300);
      const [row] = await this.db
        .insert(messageClassifications)
        .values({ ...base, status: 'NEEDS_HUMAN', error, latencyMs: Date.now() - started })
        .returning();
      return row;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- review: the model's guess against the person's answer ----

  async list(tenantId: string, q: { labeled?: string }) {
    const where = [eq(messageClassifications.tenantId, tenantId)];
    if (q.labeled === 'yes') where.push(isNotNull(messageClassifications.finalLabel));
    if (q.labeled === 'no') where.push(isNull(messageClassifications.finalLabel));
    const items = await this.db
      .select()
      .from(messageClassifications)
      .where(and(...where))
      .orderBy(desc(messageClassifications.createdAt))
      .limit(300);
    return { items, stats: await this.stats(tenantId), options: MESSAGE_OPTIONS, settings: this.publicSettings() };
  }

  private publicSettings() {
    const c = this.settings();
    const cl = this.classifier();
    return { provider: cl?.provider ?? 'off', modelVersion: cl?.modelVersion ?? null, threshold: c.threshold, perTenantPerHour: c.perTenantPerHour };
  }

  /**
   * Accuracy over the messages a person has labelled: overall, for the
   * confident suggestions alone, and a confusion matrix (person -> model).
   */
  async stats(tenantId: string) {
    const rows = await this.db
      .select({ chosen: messageClassifications.chosen, finalLabel: messageClassifications.finalLabel, status: messageClassifications.status })
      .from(messageClassifications)
      .where(and(eq(messageClassifications.tenantId, tenantId), isNotNull(messageClassifications.finalLabel)));
    return summarize(rows);
  }

  async label(tenantId: string, userId: string, id: string, dto: { finalLabel: string; finalAction?: string }) {
    if (!(dto.finalLabel in MESSAGE_OPTIONS)) throw new BadRequestException("Variant noto'g'ri");
    const [row] = await this.db
      .update(messageClassifications)
      .set({ finalLabel: dto.finalLabel, finalAction: dto.finalAction?.trim().slice(0, 300) || null, decidedByUserId: userId, decidedAt: new Date() })
      .where(and(eq(messageClassifications.id, id), eq(messageClassifications.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Topilmadi');
    return row;
  }
}

/** Accuracy and the confusion matrix (rows: the person's label, columns: the model's). */
export function summarize(rows: Array<{ chosen: string | null; finalLabel: string | null; status: string }>) {
  const labelled = rows.filter((r) => r.finalLabel);
  const answered = labelled.filter((r) => r.chosen);
  const correct = answered.filter((r) => r.chosen === r.finalLabel).length;
  const confident = labelled.filter((r) => r.status === 'SUGGESTED');
  const confidentCorrect = confident.filter((r) => r.chosen === r.finalLabel).length;
  const keys = [...Object.keys(MESSAGE_OPTIONS), 'none'];
  const matrix: Record<string, Record<string, number>> = Object.fromEntries(keys.map((k) => [k, Object.fromEntries(keys.map((c) => [c, 0]))]));
  for (const r of labelled) {
    const truth = r.finalLabel && r.finalLabel in matrix ? r.finalLabel : 'none';
    const guess = r.chosen && r.chosen in matrix ? r.chosen : 'none';
    matrix[truth][guess]++;
  }
  return {
    labelled: labelled.length,
    answered: answered.length,
    accuracy: answered.length ? correct / answered.length : null,
    // How often the model would have been right had confident suggestions been used.
    confident: confident.length,
    confidentAccuracy: confident.length ? confidentCorrect / confident.length : null,
    needsHuman: labelled.length - confident.length,
    matrix,
  };
}
