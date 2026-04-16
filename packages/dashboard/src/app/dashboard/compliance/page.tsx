'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import {
  Shield, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  FileText, ClipboardList, ChevronRight, Zap, Ban,
} from 'lucide-react';

interface CategoryStat { status: string; score: number; detail: string; }

interface DashboardData {
  overallStatus: string;
  score: number;
  categories: Record<string, CategoryStat>;
  recentAuditCount: number;
  pendingBaaCount: number;
  expiredBaaCount: number;
}

interface ScanFinding {
  orgId: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  category: 'hipaa' | 'michigan';
  checkName: string;
  description: string;
  count: number;
  legalRef: string;
  recommendation: string;
  resourceIds: string[];
  blocksDeployment: boolean;
}

interface ScanResult {
  scannedAt: string;
  findings: ScanFinding[];
  summary: { total: number; violations: number; P0: number; P1: number; P2: number; P3: number };
  blocksDeployment: boolean;
}

interface LatestScanRow {
  id: string;
  checkName: string;
  detail: ScanFinding;
  lastCheckedAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  baa_coverage: 'BAA Coverage',
  audit_logging: 'Audit Logging',
  access_control: 'Access Control',
  encryption: 'Encryption',
  incident_response: 'Incident Response',
  training: 'Training Records',
};

const SEV_STYLES: Record<string, { badge: string; border: string; label: string }> = {
  P0: { badge: 'bg-red-100 text-red-700 border-red-200', border: 'border-l-red-500', label: 'P0 · Critical' },
  P1: { badge: 'bg-orange-100 text-orange-700 border-orange-200', border: 'border-l-orange-400', label: 'P1 · High' },
  P2: { badge: 'bg-amber-100 text-amber-700 border-amber-200', border: 'border-l-amber-400', label: 'P2 · Medium' },
  P3: { badge: 'bg-gray-100 text-gray-600 border-gray-200', border: 'border-l-gray-300', label: 'P3 · Low' },
};

function statusIcon(status: string, size = 18) {
  if (status === 'pass') return <CheckCircle2 size={size} className="text-emerald-500" />;
  if (status === 'warning') return <AlertTriangle size={size} className="text-amber-500" />;
  if (status === 'fail') return <XCircle size={size} className="text-red-500" />;
  return <AlertTriangle size={size} className="text-gray-400" />;
}

function statusBorder(status: string) {
  if (status === 'pass') return 'border-l-emerald-500';
  if (status === 'warning') return 'border-l-amber-400';
  if (status === 'fail') return 'border-l-red-500';
  return 'border-l-gray-300';
}

function statusScoreColor(score: number) {
  if (score >= 80) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function ScoreRing({ score }: { score: number }) {
  const color = statusScoreColor(score);
  const r = 52, circ = 2 * Math.PI * r, dash = (score / 100) * circ;
  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-90">
        <circle cx="72" cy="72" r={r} fill="none" stroke="#e5e7eb" strokeWidth="12" />
        <circle cx="72" cy="72" r={r} fill="none" stroke={color} strokeWidth="12"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>{score}</span>
        <span className="text-xs text-gray-500">/ 100</span>
      </div>
    </div>
  );
}

function ScanFindingCard({ f }: { f: ScanFinding }) {
  const sev = SEV_STYLES[f.severity] ?? SEV_STYLES.P3;
  return (
    <div className={`bg-white rounded-xl border border-gray-100 border-l-4 ${sev.border} p-4`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${sev.badge}`}>{sev.label}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200 uppercase">{f.category}</span>
            {f.blocksDeployment && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 flex items-center gap-1">
                <Ban size={10} /> Blocks Deploy
              </span>
            )}
          </div>
          <p className="text-sm font-semibold text-gray-900">{f.checkName}</p>
        </div>
        <span className="text-xs text-gray-400 shrink-0">{f.count} affected</span>
      </div>
      <p className="text-xs text-gray-500 mb-2">{f.description}</p>
      <div className="text-xs text-gray-400 mb-1"><span className="font-medium text-gray-600">Fix:</span> {f.recommendation}</div>
      <div className="text-xs text-gray-400"><span className="font-medium text-gray-600">Legal:</span> {f.legalRef}</div>
      {f.resourceIds.length > 0 && (
        <div className="text-xs text-gray-400 mt-1">
          <span className="font-medium text-gray-600">Affected IDs:</span>{' '}
          {f.resourceIds.slice(0, 3).join(', ')}{f.resourceIds.length > 3 ? ` +${f.resourceIds.length - 3} more` : ''}
        </div>
      )}
    </div>
  );
}

export default function CompliancePage() {
  const [user] = useState(getUser);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanLoadedAt, setScanLoadedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await api.get<DashboardData>(`/orgs/${user.orgId}/compliance/dashboard`);
      setData(result);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [user]);

  const loadLatestScan = useCallback(async () => {
    if (!user) return;
    try {
      const rows = await api.get<LatestScanRow[]>(`/orgs/${user.orgId}/compliance/scan/latest`);
      if (!rows.length) return;
      const findings = rows.map((r) => r.detail);
      const p0 = findings.filter((f) => f.severity === 'P0').length;
      const p1 = findings.filter((f) => f.severity === 'P1').length;
      const p2 = findings.filter((f) => f.severity === 'P2').length;
      const p3 = findings.filter((f) => f.severity === 'P3').length;
      setScanResult({
        scannedAt: rows[0].createdAt,
        findings,
        summary: { total: findings.length, violations: findings.filter((f) => f.count > 0).length, P0: p0, P1: p1, P2: p2, P3: p3 },
        blocksDeployment: findings.some((f) => f.blocksDeployment && f.count > 0),
      });
      setScanLoadedAt(rows[0].lastCheckedAt);
    } catch { /* no scan yet */ }
  }, [user]);

  useEffect(() => { load(); loadLatestScan(); }, [load, loadLatestScan]);

  const runChecks = async () => {
    if (!user || running) return;
    setRunning(true);
    try {
      await api.post(`/orgs/${user.orgId}/compliance/checks/run`, {});
      setLastRun(new Date());
      await load();
    } catch { /* ignore */ }
    finally { setRunning(false); }
  };

  const runScan = async () => {
    if (!user || scanning) return;
    setScanning(true);
    try {
      const result = await api.post<ScanResult>(`/orgs/${user.orgId}/compliance/scan`, {});
      setScanResult(result);
      setScanLoadedAt(result.scannedAt);
    } catch { /* ignore */ }
    finally { setScanning(false); }
  };

  const overallColor = data?.overallStatus === 'pass'
    ? 'text-emerald-600' : data?.overallStatus === 'warning'
    ? 'text-amber-600' : 'text-red-600';

  const activeFindings = scanResult?.findings.filter((f) => f.count > 0) ?? [];
  const hasBlockers = scanResult?.blocksDeployment && activeFindings.some((f) => f.blocksDeployment);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Shield size={22} className="text-[#0F4C81]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
              HIPAA Compliance Center
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">Monitor your organization's HIPAA &amp; Michigan compliance posture</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runChecks} disabled={running || loading}
            className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors">
            <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
            {running ? 'Running…' : 'Run Checks'}
          </button>
          <button onClick={runScan} disabled={scanning}
            className="flex items-center gap-2 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-blue-900 disabled:opacity-50 transition-colors">
            <Zap size={14} className={scanning ? 'animate-pulse' : ''} />
            {scanning ? 'Scanning…' : 'Run Live Scan'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6,7].map(i => <div key={i} className="h-28 bg-white rounded-xl border border-gray-100 animate-pulse" />)}
        </div>
      ) : !data ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
          Failed to load compliance data. Run checks to initialize.
        </div>
      ) : (
        <>
          {/* Overview row */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 p-6 flex items-center gap-6 lg:col-span-1">
              <ScoreRing score={data.score} />
              <div>
                <p className="text-xs text-gray-500 mb-1">Overall Status</p>
                <p className={`text-lg font-bold capitalize ${overallColor}`} style={{ fontFamily: 'var(--font-sora)' }}>
                  {data.overallStatus === 'pass' ? 'Compliant' : data.overallStatus === 'warning' ? 'Needs Attention' : 'Non-Compliant'}
                </p>
                {lastRun && <p className="text-xs text-gray-400 mt-2">Checks: {lastRun.toLocaleTimeString()}</p>}
              </div>
            </div>
            <div className="lg:col-span-3 grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-500 mb-1">Audit Events (7d)</p>
                <p className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>{data.recentAuditCount.toLocaleString()}</p>
                <Link href="/dashboard/compliance/audit" className="text-xs text-[#0F4C81] flex items-center gap-0.5 mt-2 hover:underline">View logs <ChevronRight size={12} /></Link>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-500 mb-1">Pending BAAs</p>
                <p className={`text-2xl font-bold ${data.pendingBaaCount > 0 ? 'text-amber-500' : 'text-gray-900'}`} style={{ fontFamily: 'var(--font-sora)' }}>{data.pendingBaaCount}</p>
                <Link href="/dashboard/compliance/baa" className="text-xs text-[#0F4C81] flex items-center gap-0.5 mt-2 hover:underline">Manage BAAs <ChevronRight size={12} /></Link>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-500 mb-1">Expired BAAs</p>
                <p className={`text-2xl font-bold ${data.expiredBaaCount > 0 ? 'text-red-500' : 'text-gray-900'}`} style={{ fontFamily: 'var(--font-sora)' }}>{data.expiredBaaCount}</p>
                <span className="text-xs text-gray-400 mt-2 block">{data.expiredBaaCount === 0 ? 'All current' : 'Requires renewal'}</span>
              </div>
            </div>
          </div>

          {/* Category cards */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Compliance Categories</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                const cat = data.categories[key] ?? { status: 'unknown', score: 0, detail: 'Not evaluated' };
                return (
                  <div key={key} className={`bg-white rounded-xl border border-gray-100 border-l-4 ${statusBorder(cat.status)} p-4`}>
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-800">{label}</span>
                      {statusIcon(cat.status)}
                    </div>
                    <p className="text-xs text-gray-500 mb-3 min-h-[2.5rem]">{cat.detail}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${cat.score}%`, background: statusScoreColor(cat.score) }} />
                      </div>
                      <span className="text-xs font-medium text-gray-600 w-10 text-right">{cat.score}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Automated Scanner Results */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-gray-700">Automated Scanner Findings</h2>
                {scanLoadedAt && (
                  <span className="text-xs text-gray-400">
                    Last scan: {new Date(scanLoadedAt).toLocaleString()}
                  </span>
                )}
              </div>
              {scanResult && (
                <div className="flex items-center gap-2">
                  {(['P0','P1','P2','P3'] as const).map((sev) => {
                    const count = scanResult.summary[sev];
                    if (!count) return null;
                    const s = SEV_STYLES[sev];
                    return (
                      <span key={sev} className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${s.badge}`}>
                        {count} {sev}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Deploy blocker banner */}
            {hasBlockers && (
              <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">
                <Ban size={18} className="text-red-500 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-red-700">Deployment Blocked</p>
                  <p className="text-xs text-red-600">
                    {activeFindings.filter((f) => f.blocksDeployment).length} critical violation(s) must be resolved before deployment.
                  </p>
                </div>
              </div>
            )}

            {!scanResult ? (
              <div className="bg-white rounded-xl border border-gray-100 border-dashed px-6 py-10 text-center">
                <Zap size={28} className="text-gray-300 mx-auto mb-3" />
                <p className="text-sm font-medium text-gray-500 mb-1">No scan results yet</p>
                <p className="text-xs text-gray-400 mb-4">Run a live scan to detect real compliance violations across your database.</p>
                <button onClick={runScan} disabled={scanning}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-blue-900 disabled:opacity-50 transition-colors">
                  <Zap size={14} />
                  {scanning ? 'Scanning…' : 'Run First Scan'}
                </button>
              </div>
            ) : activeFindings.length === 0 ? (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-6 py-8 text-center">
                <CheckCircle2 size={28} className="text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-semibold text-emerald-700">No violations detected</p>
                <p className="text-xs text-emerald-600 mt-1">All {scanResult.summary.total} checks passed. Safe to deploy.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* P0 first, then P1, P2, P3 */}
                {(['P0','P1','P2','P3'] as const).flatMap((sev) =>
                  activeFindings.filter((f) => f.severity === sev).map((f, i) => (
                    <ScanFindingCard key={`${sev}-${i}`} f={f} />
                  ))
                )}
              </div>
            )}
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link href="/dashboard/compliance/baa"
              className="flex items-center gap-4 bg-white rounded-xl border border-gray-100 p-4 hover:border-[#0F4C81] transition-colors group">
              <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                <FileText size={20} className="text-[#0F4C81]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800">BAA Registry</p>
                <p className="text-xs text-gray-500">Manage Business Associate Agreements</p>
              </div>
              <ChevronRight size={16} className="text-gray-400 group-hover:text-[#0F4C81]" />
            </Link>
            <Link href="/dashboard/compliance/audit"
              className="flex items-center gap-4 bg-white rounded-xl border border-gray-100 p-4 hover:border-[#0F4C81] transition-colors group">
              <div className="p-2 bg-teal-50 rounded-lg group-hover:bg-teal-100 transition-colors">
                <ClipboardList size={20} className="text-[#00B8A9]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800">Audit Log Viewer</p>
                <p className="text-xs text-gray-500">Review all system access events</p>
              </div>
              <ChevronRight size={16} className="text-gray-400 group-hover:text-[#00B8A9]" />
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
