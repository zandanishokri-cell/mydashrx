'use client';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth';
import { Upload, X, Download, ChevronDown, ChevronUp, AlertCircle, CheckCircle2 } from 'lucide-react';

interface ImportResult {
  imported: number;
  errors: Array<{ row: number; field: string; message: string }>;
  warnings: Array<{ row: number; message: string }>;
}

interface Props {
  orgId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const TEMPLATE_CSV = `address,recipientName,recipientPhone,notes,rxNumber
"123 Main St, Detroit, MI 48201",Smith John,313-555-0100,Ring doorbell,RX-001
"456 Oak Ave, Ann Arbor, MI 48103",Johnson Mary,734-555-0200,,RX-002`;

export function CsvImportModal({ orgId, onClose, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const countRows = (f: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const lines = (e.target?.result as string).trim().split('\n');
      setRowCount(Math.max(0, lines.length - 1)); // exclude header
    };
    reader.readAsText(f);
  };

  const handleFile = (f: File) => {
    setFile(f);
    setResult(null);
    countRows(f);
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mydashrx-import-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const token = getAccessToken();
      const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const res = await fetch(`${base}/api/v1/orgs/${orgId}/stops/import`, {
        method: 'POST',
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        if (res.status === 402) {
          setResult({ imported: 0, errors: [{ row: 0, field: '', message: 'UPGRADE_REQUIRED' }], warnings: [] });
        } else {
          const msg = await res.text().catch(() => 'Upload failed');
          setResult({ imported: 0, errors: [{ row: 0, field: '', message: msg || 'Upload failed. Please try again.' }], warnings: [] });
        }
        return;
      }
      const data = await res.json() as ImportResult;
      setResult(data);
      if (data.imported > 0) onSuccess();
    } catch {
      setResult({ imported: 0, errors: [{ row: 0, field: '', message: 'Upload failed. Please try again.' }], warnings: [] });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Import Stops from CSV</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Drop zone */}
          {!result && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-[#0F4C81] bg-blue-50' : file ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              {file ? (
                <>
                  <CheckCircle2 size={28} className="text-green-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-800">{file.name}</p>
                  <p className="text-xs text-gray-500 mt-1">{rowCount} row{rowCount !== 1 ? 's' : ''} detected</p>
                </>
              ) : (
                <>
                  <Upload size={28} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-gray-600">Drop CSV here or click to browse</p>
                  <p className="text-xs text-gray-400 mt-1">Required columns: address, recipientName</p>
                </>
              )}
            </div>
          )}

          {/* Template download */}
          {!result && (
            <button onClick={downloadTemplate} className="flex items-center gap-1.5 text-xs text-[#0F4C81] hover:underline">
              <Download size={12} /> Download sample template
            </button>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-3">
              {result.imported > 0 && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <CheckCircle2 size={16} className="text-green-600 shrink-0" />
                  <p className="text-sm text-green-800 font-medium">{result.imported} stop{result.imported !== 1 ? 's' : ''} imported successfully.</p>
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <p className="text-xs text-amber-700">{result.warnings.length} geocoding warning{result.warnings.length !== 1 ? 's' : ''} — stops imported with 0,0 coordinates.</p>
                </div>
              )}

              {result.errors.length > 0 && result.errors[0]?.message === 'UPGRADE_REQUIRED' && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={15} className="text-red-500 shrink-0" />
                    <div>
                      <p className="text-sm text-red-800 font-medium">Monthly stop limit reached for your plan.</p>
                      <a href="/dashboard/billing" className="text-xs text-amber-600 font-medium hover:underline">
                        Upgrade your plan to import more stops →
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {result.errors.length > 0 && result.errors[0]?.message !== 'UPGRADE_REQUIRED' && (
                <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setErrorsOpen(v => !v)}
                    className="flex items-center justify-between w-full px-4 py-3 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <AlertCircle size={15} className="text-red-500 shrink-0" />
                      <span className="text-sm text-red-800 font-medium">{result.errors.length} row{result.errors.length !== 1 ? 's' : ''} failed to import</span>
                    </div>
                    {errorsOpen ? <ChevronUp size={14} className="text-red-400" /> : <ChevronDown size={14} className="text-red-400" />}
                  </button>
                  {errorsOpen && (
                    <div className="border-t border-red-100 px-4 pb-3 max-h-40 overflow-y-auto">
                      {result.errors.map((e, i) => (
                        <p key={i} className="text-xs text-red-700 py-1 border-b border-red-50 last:border-0">
                          Row {e.row}{e.field ? ` · ${e.field}` : ''}: {e.message}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={() => { setFile(null); setResult(null); setRowCount(0); }}
                className="text-xs text-[#0F4C81] hover:underline"
              >
                Import another file
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={!file || importing}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-[#0F4C81] text-white rounded-lg hover:bg-[#0a3860] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {importing ? (
                <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Importing…</>
              ) : (
                <><Upload size={13} /> Import {rowCount > 0 ? `${rowCount} stops` : 'CSV'}</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
