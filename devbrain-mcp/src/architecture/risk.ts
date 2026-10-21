import path from 'node:path';
import { locateExecution } from '../context/execution-evidence.js';
import { verificationReceipt, type VerificationReceipt } from '../context/verification-receipt.js';
import { readRepositoryText } from '../context/repository.js';
import { git } from '../lib/git.js';
import { diffArguments } from '../tools/get-diff.js';
import type { RepositoryModel } from './graph.js';
import type { ImpactReport, ImpactSeed } from './impact.js';

export const RISK_THRESHOLDS = Object.freeze({ low: 29, medium: 59 });
const WEIGHTS = Object.freeze({ breadth: 20, reach: 25, sensitive: 25, tests: 20, magnitude: 10 });
const generated = /(?:^|\/)(?:dist|build|coverage|generated|\.next)(?:\/|$)/i;
const config = /(?:^|\/)(?:Dockerfile[^/]*|docker-compose[^/]*\.ya?ml|compose\.ya?ml|\.github\/workflows\/[^/]+|package\.json|package-lock\.json|[^/]+\.config\.[cm]?[jt]s|tsconfig[^/]*\.json|pyproject\.toml|[^/]+\.ya?ml|[^/]+\.toml)$/i;
const authCode = /\b(?:authenticate|authorization|authorize|permission|password|passwd|bearer|oauth|token|csrf|crypto)\b/i;
const databaseCode = /(?:\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|DATABASE)|\b(?:migration|schema|prisma|sequelize|typeorm)\b)/i;

export interface RiskFactor { id: string; observed: unknown; contribution: number; explanation: string }
export interface RiskAssessment {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  factors: RiskFactor[];
  affectedFiles: { count: number; files: string[]; generatedExcluded: number };
  dependencyReach: { knownDependents: number; sharedModules: number; truncated: boolean };
  testEvidence: { relatedTests: number; status: 'present' | 'absent' | 'unknown'; executions: Array<{ receiptId: string; result: string; freshness: 'CURRENT' | 'STALE' | 'UNKNOWN' }> };
  unknowns: string[];
  recommendedVerification: string[];
}

function level(score: number): RiskAssessment['level'] { return score <= RISK_THRESHOLDS.low ? 'LOW' : score <= RISK_THRESHOLDS.medium ? 'MEDIUM' : 'HIGH'; }
function unique(values: string[]): string[] { return [...new Set(values)].sort(); }
function generatedFile(file: string): boolean { return generated.test(file); }

async function diffMagnitude(model: RepositoryModel, seed: ImpactSeed): Promise<{ added: number; deleted: number; known: boolean }> {
  if (seed.type !== 'diff' || !model.gitRepository) return { added: 0, deleted: 0, known: false };
  try {
    const input = { mode: seed.mode ?? 'working_tree', commit: seed.commit, from: seed.from, to: seed.to } as Parameters<typeof diffArguments>[0];
    const result = await git(model.root, diffArguments(input, 'numstat'));
    if (result.status !== 'completed') return { added: 0, deleted: 0, known: false };
    let added = 0; let deleted = 0;
    for (const line of result.stdout.split(/\r?\n/)) {
      const [a, d] = line.split('\t');
      if (a && d && /^\d+$/.test(a) && /^\d+$/.test(d)) { added += Number(a); deleted += Number(d); }
    }
    return { added, deleted, known: true };
  } catch { return { added: 0, deleted: 0, known: false }; }
}

async function executionEvidence(model: RepositoryModel, ids: string[]): Promise<{ executions: RiskAssessment['testEvidence']['executions']; failed: number; stale: number; unknown: number }> {
  const executions: RiskAssessment['testEvidence']['executions'] = [];
  for (const id of ids) {
    try {
      const item = await locateExecution(id);
      const receipt: VerificationReceipt = verificationReceipt(item);
      const source = item.metadata.git;
      const freshness = typeof source?.sha === 'string' && model.provenance.sha
        ? source.sha !== model.provenance.sha || source.dirty !== model.provenance.dirty ? 'STALE' : 'CURRENT'
        : 'UNKNOWN';
      executions.push({ receiptId: receipt.receiptId, result: receipt.result, freshness });
    } catch { executions.push({ receiptId: id, result: 'UNKNOWN', freshness: 'UNKNOWN' }); }
  }
  return { executions, failed: executions.filter((item) => item.result === 'FAILED').length, stale: executions.filter((item) => item.freshness === 'STALE').length, unknown: executions.filter((item) => item.result === 'UNKNOWN' || item.freshness === 'UNKNOWN').length };
}

export async function assessRisk(model: RepositoryModel, report: ImpactReport, seed: ImpactSeed, executionIds: string[] = []): Promise<RiskAssessment> {
  const files = unique(report.changed.files);
  const analyzedFiles = files.filter((file) => !generatedFile(file));
  const directories = unique(analyzedFiles.map((file) => path.posix.dirname(file).split('/')[0] ?? '.'));
  const factors: RiskFactor[] = [];
  const unknowns: string[] = [];
  const add = (id: string, observed: unknown, contribution: number, explanation: string) => factors.push({ id, observed, contribution, explanation });

  const breadthFiles = Math.min(10, Math.max(0, (analyzedFiles.length - 1) * 2));
  const breadthDirs = Math.min(6, Math.max(0, (directories.length - 1) * 3));
  const crossSubsystem = directories.length > 1 ? Math.min(4, Math.max(0, WEIGHTS.breadth - breadthFiles - breadthDirs)) : 0;
  add('change_breadth_files', analyzedFiles.length, breadthFiles, `${analyzedFiles.length} non-generated affected files contribute up to 10 points.`);
  add('change_breadth_directories', directories.length, breadthDirs, `${directories.length} top-level modules contribute up to 6 points.`);
  add('change_breadth_cross_subsystem', directories.length > 1, crossSubsystem, directories.length > 1 ? 'The change crosses top-level subsystem boundaries.' : 'The change stays within one top-level subsystem.');

  const dependentFiles = unique(report.impacts.filter((impact) => impact.target.file && !files.includes(impact.target.file)).map((impact) => impact.target.file!).filter((file) => !generatedFile(file)));
  const sharedModules = files.filter((file) => (model.dependents.get(file) ?? []).length >= 3).length;
  const reachDependents = Math.min(15, dependentFiles.length * 2);
  const reachShared = Math.min(WEIGHTS.reach - 15, sharedModules * 5);
  add('dependency_reach_dependents', dependentFiles.length, reachDependents, `${dependentFiles.length} known downstream files contribute up to 15 points.`);
  add('dependency_reach_shared_modules', sharedModules, reachShared, sharedModules ? `${sharedModules} changed modules have at least three known dependents.` : 'No changed module has three or more known dependents.');
  if (model.truncated || report.truncated) unknowns.push('dependency graph or impact traversal was truncated');

  let auth = false; let database = false; let configFiles = 0;
  for (const file of analyzedFiles) {
    let text = model.modules.get(file)?.text ?? '';
    if (!text) { try { text = (await readRepositoryText(model.root, file)).text; } catch { /* binary or deleted file */ } }
    auth ||= authCode.test(text);
    database ||= databaseCode.test(text);
    if (/(?:migration|schema)/i.test(file) && !databaseCode.test(text)) unknowns.push(`database-like file ${file} lacked confirming schema or migration syntax`);
    if (config.test(file)) configFiles++;
  }
  const interfaceChange = report.impacts.some((impact) => impact.category === 'interface');
  add('sensitive_authentication', auth, auth ? 10 : 0, auth ? 'Authentication or security-control code was observed in changed content.' : 'No authentication/security-control marker was observed.');
  add('sensitive_database', database, database ? 8 : 0, database ? 'Database schema or migration evidence was observed.' : 'No database schema/migration evidence was observed.');
  add('sensitive_configuration', configFiles, Math.min(4, configFiles * 4), configFiles ? `${configFiles} configuration or package metadata files changed.` : 'No configuration or package metadata file changed.');
  add('sensitive_public_interface', interfaceChange, interfaceChange ? Math.min(3, Math.max(0, WEIGHTS.sensitive - 22)) : 0, interfaceChange ? 'A related route or public interface was found in the impact graph.' : 'No related public interface was found.');

  const relatedTests = unique(report.impacts.filter((impact) => impact.category === 'test' && impact.target.file).map((impact) => impact.target.file!));
  const evidence = await executionEvidence(model, executionIds);
  const testStatus: RiskAssessment['testEvidence']['status'] = executionIds.length
    ? (evidence.executions.some((item) => item.result !== 'UNKNOWN') ? 'present' : 'unknown')
    : relatedTests.length ? 'present' : model.truncated ? 'unknown' : 'absent';
  const missingTests = relatedTests.length || executionIds.length ? 0 : 10;
  const failedTests = Math.min(10, evidence.failed * 10);
  const staleTests = Math.min(Math.max(0, WEIGHTS.tests - missingTests - failedTests), evidence.stale * 5);
  add('test_evidence_related', relatedTests.length, 0, relatedTests.length ? `${relatedTests.length} related test files were discovered.` : 'No related test files were discovered; this is not proof that tests do not exist.');
  add('test_evidence_missing', testStatus, missingTests, missingTests ? 'Test coverage evidence is absent or unknown.' : 'Related test or execution evidence is available.');
  if (failedTests) add('test_evidence_failed', evidence.failed, failedTests, `${evidence.failed} recorded verification result(s) failed.`);
  if (staleTests) add('test_evidence_stale', evidence.stale, staleTests, `${evidence.stale} recorded verification result(s) are stale for this repository state.`);
  if (evidence.unknown) unknowns.push('some requested verification evidence lacks usable provenance');
  if (!relatedTests.length && !executionIds.length) unknowns.push('absence of related tests is not proof that tests do not exist');

  const magnitude = await diffMagnitude(model, seed);
  const changedLines = magnitude.added + magnitude.deleted;
  const magnitudeApplicable = seed.type === 'diff';
  const magnitudePoints = magnitude.known ? Math.min(WEIGHTS.magnitude, Math.ceil(changedLines / 25)) : 0;
  add('change_magnitude_lines', magnitude.known ? changedLines : magnitudeApplicable ? 'unknown' : 'not_applicable', magnitudePoints, magnitude.known ? `${changedLines} added/deleted lines contribute up to 10 points.` : magnitudeApplicable ? 'Diff magnitude is unavailable for the selected seed.' : 'Line magnitude is not applicable without a diff seed.');
  if (magnitudeApplicable && !magnitude.known) unknowns.push('diff magnitude was not available for the selected seed');
  if (files.length !== analyzedFiles.length) unknowns.push(`${files.length - analyzedFiles.length} generated file(s) were excluded from scoring`);
  if (!files.length) unknowns.push('seed did not resolve to an affected file');

  const score = Math.min(100, factors.reduce((sum, factor) => sum + factor.contribution, 0));
  const confidence: RiskAssessment['confidence'] = model.truncated || report.truncated || !report.seed.resolved ? 'LOW' : evidence.unknown || evidence.stale ? 'MEDIUM' : 'HIGH';
  const riskLevel = level(score);
  const recommendedVerification = riskLevel === 'HIGH'
    ? ['Run broader regression tests', 'Review security and compatibility impact', 'Inspect migrations or configuration changes', 'Consider manual review before release']
    : riskLevel === 'MEDIUM'
      ? ['Run targeted and subsystem tests', 'Review affected interfaces', 'Verify related build paths']
      : ['Run focused tests', 'Run relevant lint/type-check'];
  return { score, level: riskLevel, confidence, factors, affectedFiles: { count: files.length, files, generatedExcluded: files.length - analyzedFiles.length }, dependencyReach: { knownDependents: dependentFiles.length, sharedModules, truncated: model.truncated || report.truncated }, testEvidence: { relatedTests: relatedTests.length, status: testStatus, executions: evidence.executions }, unknowns: unique(unknowns), recommendedVerification };
}
