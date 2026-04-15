'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import {
  Shield, CheckCircle2, AlertTriangle, XCircle, RefreshCw,
  FileText, ClipboardList, ChevronRight,
} from 'lucide-react';

interface CategoryStat {
  status: string;
  score: number;
  detail: string;
}

interface DashboardData {
  overallStatus: string;
  score: number;
  categories: Record<string, CategoryStat>;
  recentAuditCount: number;
  pendingBaaCount: number;
  expiredBaaCount: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  baa_coverage: 'BAA Coverage',
  audit_logging: 'Audit Logging',
  access_control: 'Access Control',
  encryption: 'Encryption',
  incident_response: 'Incident Response',
  training: 'Training Records',
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
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-90">
        <circle cx="72" cy="72" r={r} fill="none" stroke="#e5e7eb" strokeWidth="12" />
        <circle
          cx="72" cy="72" r={r} fill="none"
          stroke={color} strokeWidth="12"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>{score}</span>
        <span className="text-xs text-gray-500">/ 100</span>
      </div>
    </div>
  );
}

export default function CompliancePage() {
  const [user] = useState(getUser);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const result = await api.get<DashboardData>(`/orgs/${user.orgId}/compliance/dashboard`);
      setData(result);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [user]);

  useEffect(() => { load(); }, [load]);

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

  const overallColor = data?.overallStatus === 'pass'
    ? 'text-emerald-600'
    : data?.overallStatus === 'warning'
    ? 'text-amber-600'
    : 'text-red-600';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Shield size={22} className="text-[#0F4C81]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
              HIPAA Compliance Center
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Monitor your organization's HIPAA compliance posture
            </p>
          </div>
        </div>
        <button
          onClick={runChecks}
          disabled={running || loading}
          className="flex items-center gap-2 px-4 py-2 bg-[#0F4C81] text-white text-sm font-medium rounded-lg hover:bg-blue-900 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Running…' : 'Run Checks'}
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6,7].map(i => (
            <div key={i} className="h-28 bg-white rounded-xl border border-gray-100 animate-pulse" />
          ))}
        </div>
      ) : !data ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
          Failed to load compliance data. Run checks to initialize.
        </div>
      ) : (
        <>
          {/* Overview row */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Score card */}
            <div className="bg-white rounded-xl border border-gray-100 p-6 flex items-center gap-6 lg:col-span-1">
              <ScoreRing score={data.score} />
              <div>
                <p className="text-xs text-gray-500 mb-1">Overall Status</p>
                <p className={`text-lg font-bold capitalize ${overallColor}`} style={{ fontFamily: 'var(--font-sora)' }}>
                  {data.overallStatus === 'pass' ? 'Compliant' : data.overallStatus === 'warning' ? 'Needs Attention' : 'Non-Compliant'}
                </p>
                {lastRun && (
                  <p className="text-xs text-gray-400 mt-2">Last run: {lastRun.toLocaleTimeString()}</p>
                )}
              </div>
            </div>

            {/* Summary stats */}
            <div className="lg:col-span-3 grid grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-500 mb-1">Audit Events (7d)</p>
                <p className="text-2xl font-bold text-gray-900" style={{ fontFamily: 'var(--font-sora)' }}>
                  {data.recentAuditCount.toLocaleString()}
                </p>
                <Link href="/dashboard/compliance/audit" className="text-xs text-[#0F4C81] flex items-center gap-0.5 mt-2 hover:underline">
                  View logs <ChevronRight size={12} />
                </Link>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-500 mb-1">Pending BAAs</p>
                <p className={`text-2xl font-bold ${data.pendingBaaCount > 0 ? 'text-amber-500' : 'text-gray-900'}`} style={{ fontFamily: 'var(--font-sora)' }}>
                  {data.pendingBaaCount}
                </p>
                <Link href="/dashboard/compliance/baa" className="text-xs text-[#0F4C81] flex items-center gap-0.5 mt-2 hover:underline">
                  Manage BAAs <ChevronRight size={12} />
                </Link>
              </div>
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <p className="text-xs text-gray-500 mb-1">Expired BAAs</p>
                <p className={`text-2xl font-bold ${data.expiredBaaCount > 0 ? 'text-red-500' : 'text-gray-900'}`} style={{ fontFamily: 'var(--font-sora)' }}>
                  {data.expiredBaaCount}
                </p>
                <span className="text-xs text-gray-400 mt-2 block">
                  {data.expiredBaaCount === 0 ? 'All current' : 'Requires renewal'}
                </span>
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
                  <div
                    key={key}
                    className={`bg-white rounded-xl border border-gray-100 border-l-4 ${statusBorder(cat.status)} p-4`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-800">{label}</span>
                      {statusIcon(cat.status)}
                    </div>
                    <p className="text-xs text-gray-500 mb-3 min-h-[2.5rem]">{cat.detail}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full transition-all duration-500"
                          style={{
                            width: `${cat.score}%`,
                            background: statusScoreColor(cat.score),
                          }}
                        />
                      </div>
                      <span className="text-xs font-medium text-gray-600 w-10 text-right">{cat.score}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href="/dashboard/compliance/baa"
              className="flex items-center gap-4 bg-white rounded-xl border border-gray-100 p-4 hover:border-[#0F4C81] transition-colors group"
            >
              <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                <FileText size={20} className="text-[#0F4C81]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-800">BAA Registry</p>
                <p className="text-xs text-gray-500">Manage Business Associate Agreements</p>
              </div>
              <ChevronRight size={16} className="text-gray-400 group-hover:text-[#0F4C81]" />
            </Link>
            <Link
              href="/dashboard/compliance/audit"
              className="flex items-center gap-4 bg-white rounded-xl border border-gray-100 p-4 hover:border-[#0F4C81] transition-colors group"
            >
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
