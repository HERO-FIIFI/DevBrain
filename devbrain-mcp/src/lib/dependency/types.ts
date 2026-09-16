export type DependencyType = 'production' | 'development' | 'optional' | 'peer';
export interface DependencyItem { name: string; declaredVersion: string; installedVersion: string | null; dependencyType: DependencyType; ecosystem: 'node' | 'python'; source: string }
export interface CheckResult { status: 'complete' | 'partial' | 'offline' | 'not_run' | 'unsupported' | 'error'; networkUsed: boolean; networkAvailable: boolean | null; source: string; findings?: unknown[]; summary?: Record<string, number>; reason?: string }
export interface DependencyAdapter {
  name: string;
  ecosystem: 'node' | 'python';
  inventory(root: string): Promise<DependencyItem[]>;
  outdated(root: string): Promise<CheckResult>;
  vulnerabilities(root: string): Promise<CheckResult>;
}
