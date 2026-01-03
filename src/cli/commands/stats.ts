/**
 * Stats command - show statistics and quality metrics
 */

import type { ArgumentsCamelCase, Argv } from 'yargs';
import { StalenessChecker } from '../../reviewer/staleness.ts';
import { closeConnection, getConnection } from '../../stores/connection.ts';
import { EventStore } from '../../stores/events.ts';
import { MemoryObjectStore } from '../../stores/memory-objects.ts';
import { SessionStore } from '../../stores/sessions.ts';
import { getConfidenceTierEmoji } from '../../utils/confidence.ts';
import { colorize, table } from '../utils.ts';

interface StatsArgs {
  json: boolean;
  quality: boolean;
}

export const command = 'stats';
export const describe = 'Show database statistics and quality metrics';

export function builder(yargs: Argv): Argv<StatsArgs> {
  return yargs
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output as JSON',
    })
    .option('quality', {
      alias: 'q',
      type: 'boolean',
      default: false,
      describe: 'Show detailed quality metrics',
    }) as Argv<StatsArgs>;
}

export async function handler(argv: ArgumentsCamelCase<StatsArgs>): Promise<void> {
  const db = getConnection();
  const objects = new MemoryObjectStore(db);
  const events = new EventStore(db);
  const sessions = new SessionStore(db);
  const stalenessChecker = new StalenessChecker(db);

  try {
    const statusCounts = objects.countByStatus();
    const eventCount = events.count();
    const sessionCount = sessions.count();

    // Get all active objects for quality analysis
    const activeObjects = objects.list({ status: ['active'], limit: 10000 });

    // Calculate quality metrics
    const qualityMetrics = calculateQualityMetrics(activeObjects);
    const stalenessSummary = stalenessChecker.getSummary();

    const stats = {
      sessions: sessionCount,
      events: eventCount,
      objects: {
        total:
          statusCounts.active + statusCounts.stale + statusCounts.superseded + statusCounts.retired,
        ...statusCounts,
      },
      quality: qualityMetrics,
      staleness: {
        total: stalenessSummary.total,
        verified: stalenessSummary.verified,
        needsReview: stalenessSummary.needsReview,
        stale: stalenessSummary.stale,
      },
    };

    if (argv.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    // Text output
    console.log(colorize('Alexandria Statistics', 'bold'));
    console.log();

    console.log(colorize('Overview', 'cyan'));
    console.log(`  Sessions: ${stats.sessions}`);
    console.log(`  Events: ${stats.events}`);
    console.log(`  Memory Objects: ${stats.objects.total}`);
    console.log();

    console.log(colorize('Objects by Status', 'cyan'));
    const statusRows = [
      ['Active', String(statusCounts.active)],
      ['Stale', String(statusCounts.stale)],
      ['Superseded', String(statusCounts.superseded)],
      ['Retired', String(statusCounts.retired)],
    ];
    console.log(table(['Status', 'Count'], statusRows));
    console.log();

    // Type distribution
    console.log(colorize('Objects by Type', 'cyan'));
    const typeRows = Object.entries(qualityMetrics.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => [type, String(count)]);
    console.log(table(['Type', 'Count'], typeRows));
    console.log();

    // Quality metrics
    console.log(colorize('Quality Metrics', 'cyan'));
    const codeRefRate = (qualityMetrics.withCodeRefs / Math.max(activeObjects.length, 1)) * 100;
    const approvedRate = (qualityMetrics.approved / Math.max(activeObjects.length, 1)) * 100;
    const evidenceRate = (qualityMetrics.withEvidence / Math.max(activeObjects.length, 1)) * 100;

    console.log(
      `  Code-linked memories: ${qualityMetrics.withCodeRefs}/${activeObjects.length} (${codeRefRate.toFixed(0)}%)`,
    );
    console.log(
      `  Approved memories: ${qualityMetrics.approved}/${activeObjects.length} (${approvedRate.toFixed(0)}%)`,
    );
    console.log(
      `  With evidence: ${qualityMetrics.withEvidence}/${activeObjects.length} (${evidenceRate.toFixed(0)}%)`,
    );
    console.log();

    // Confidence tier distribution
    console.log(colorize('Confidence Tiers', 'cyan'));
    const tierRows = [
      [`${getConfidenceTierEmoji('grounded')} Grounded`, String(qualityMetrics.byTier.grounded)],
      [`${getConfidenceTierEmoji('observed')} Observed`, String(qualityMetrics.byTier.observed)],
      [`${getConfidenceTierEmoji('inferred')} Inferred`, String(qualityMetrics.byTier.inferred)],
      [
        `${getConfidenceTierEmoji('hypothesis')} Hypothesis`,
        String(qualityMetrics.byTier.hypothesis),
      ],
    ];
    console.log(table(['Tier', 'Count'], tierRows));
    console.log();

    // Staleness summary
    if (stalenessSummary.total > 0) {
      console.log(colorize('Code Freshness', 'cyan'));
      console.log(`  Verified: ${stalenessSummary.verified}/${stalenessSummary.total}`);
      console.log(`  Needs review: ${stalenessSummary.needsReview}`);
      console.log(`  Stale: ${stalenessSummary.stale}`);
      console.log();
    }

    // Health score
    const healthScore = calculateHealthScore(qualityMetrics, activeObjects.length);
    const healthEmoji = healthScore >= 80 ? '🟢' : healthScore >= 60 ? '🟡' : '🔴';
    console.log(colorize('Health Score', 'cyan'));
    console.log(`  ${healthEmoji} ${healthScore}/100`);

    // Recommendations
    if (argv.quality || healthScore < 80) {
      console.log();
      console.log(colorize('Recommendations', 'yellow'));
      const recommendations = getRecommendations(
        qualityMetrics,
        activeObjects.length,
        stalenessSummary,
      );
      for (const rec of recommendations) {
        console.log(`  • ${rec}`);
      }
    }
  } finally {
    closeConnection();
  }
}

interface QualityMetrics {
  withCodeRefs: number;
  approved: number;
  pending: number;
  withEvidence: number;
  byType: Record<string, number>;
  byTier: {
    grounded: number;
    observed: number;
    inferred: number;
    hypothesis: number;
  };
}

function calculateQualityMetrics(objects: any[]): QualityMetrics {
  const metrics: QualityMetrics = {
    withCodeRefs: 0,
    approved: 0,
    pending: 0,
    withEvidence: 0,
    byType: {},
    byTier: { grounded: 0, observed: 0, inferred: 0, hypothesis: 0 },
  };

  for (const obj of objects) {
    // Code refs
    if (obj.codeRefs && obj.codeRefs.length > 0) {
      metrics.withCodeRefs++;
    }

    // Review status
    if (obj.reviewStatus === 'approved') {
      metrics.approved++;
    } else if (obj.reviewStatus === 'pending') {
      metrics.pending++;
    }

    // Evidence
    if (obj.evidenceEventIds && obj.evidenceEventIds.length > 0) {
      metrics.withEvidence++;
    }

    // Type distribution
    metrics.byType[obj.objectType] = (metrics.byType[obj.objectType] || 0) + 1;

    // Confidence tier
    const tier = obj.confidenceTier || 'inferred';
    if (tier in metrics.byTier) {
      metrics.byTier[tier as keyof typeof metrics.byTier]++;
    }
  }

  return metrics;
}

function calculateHealthScore(metrics: QualityMetrics, total: number): number {
  if (total === 0) return 100;

  // Weights for different quality factors
  const codeRefWeight = 30; // 30% for code-linked memories
  const approvedWeight = 25; // 25% for approved memories
  const evidenceWeight = 20; // 20% for evidence-backed
  const tierWeight = 25; // 25% for confidence tier distribution

  const codeRefScore = (metrics.withCodeRefs / total) * codeRefWeight;
  const approvedScore = (metrics.approved / total) * approvedWeight;
  const evidenceScore = (metrics.withEvidence / total) * evidenceWeight;

  // Tier score: prefer grounded/observed over inferred/hypothesis
  const tierTotal =
    metrics.byTier.grounded +
    metrics.byTier.observed +
    metrics.byTier.inferred +
    metrics.byTier.hypothesis;
  const goodTiers = metrics.byTier.grounded + metrics.byTier.observed;
  const tierScore = tierTotal > 0 ? (goodTiers / tierTotal) * tierWeight : tierWeight / 2;

  return Math.round(codeRefScore + approvedScore + evidenceScore + tierScore);
}

function getRecommendations(
  metrics: QualityMetrics,
  total: number,
  staleness: { needsReview: number; stale: number },
): string[] {
  const recommendations: string[] = [];

  if (total === 0) {
    recommendations.push('No memories yet. Start by adding decisions: alex add-decision');
    return recommendations;
  }

  const codeRefRate = metrics.withCodeRefs / total;
  const approvedRate = metrics.approved / total;
  const pendingRate = metrics.pending / total;

  if (codeRefRate < 0.5) {
    recommendations.push(`Link memories to code: alex link <memory-id> <file-path>`);
  }

  if (pendingRate > 0.3) {
    recommendations.push(`Review pending memories: alex review`);
  }

  if (staleness.needsReview > 0) {
    recommendations.push(`${staleness.needsReview} memories need freshness review: alex check`);
  }

  if (staleness.stale > 0) {
    recommendations.push(`${staleness.stale} stale memories found: alex revalidate`);
  }

  if (metrics.byTier.hypothesis > total * 0.2) {
    recommendations.push(`Many unverified memories. Add evidence or approve: alex review`);
  }

  if (recommendations.length === 0) {
    recommendations.push('Memory quality looks good! 👍');
  }

  return recommendations;
}
