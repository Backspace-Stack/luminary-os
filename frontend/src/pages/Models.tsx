import { useCallback, useRef, useState } from 'react';
import {
  Search, Download, Play, StopCircle, Trash2, RefreshCw, AlertTriangle, X,
  FolderOpen, CircleOff, UploadCloud, MemoryStick, Layers,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, Badge, Button, StatusDot, ProgressBar, AnimatedNumber } from '@/components/ui';
import { springGentle } from '@/lib/motion';
import { modelsApi } from '@/services/api';
import { useModels } from '@/hooks/useModels';
import type { LLMModel } from '@/types';

type Filter = 'all' | 'general' | 'coding' | 'embedding' | 'vision';

const TYPE_BADGE: Record<string, 'cyan'|'accent'|'default'|'warning'> = {
  coding: 'cyan', embedding: 'accent', vision: 'warning', general: 'default',
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Small labelled metadata cell inside a model card. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9.5px] font-semibold uppercase tracking-widest mb-0.5" style={{ color: 'var(--lum-text-muted)' }}>{label}</div>
      <div className="text-[12px] font-mono truncate" style={{ color: 'var(--lum-text-secondary)' }} title={value}>{value}</div>
    </div>
  );
}

export default function Models() {
  const {
    models, running, health, localHealth, loading, error, eventStatus,
    refresh, loadModel, unloadModel, deleteModel,
    pullModel, cancelPull, pulling, clearError,
  } = useModels();
  const [filter, setFilter]       = useState<Filter>('all');
  const [search, setSearch]       = useState('');
  const [showPull, setShowPull]   = useState(false);
  const [pullName, setPullName]   = useState('');
  const [busyModel, setBusyModel] = useState<string | null>(null);

  // Drag-and-drop GGUF install
  const [dragOver, setDragOver]   = useState(false);
  const dragDepth                 = useRef(0);
  const [upload, setUpload]       = useState<{ name: string; fraction: number } | null>(null);
  const uploadAbort               = useRef<AbortController | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const ollamaUp = health?.status === 'connected';
  const ggufNoRuntime = models.some(m => m.providerId === 'local' && m.runnable === false);
  const anyProviderUp = ollamaUp || models.some(m => m.providerId === 'local');

  const filtered = models.filter(
    m => (filter === 'all' || m.type === filter) && m.name.toLowerCase().includes(search.toLowerCase())
  );
  const totalBytes    = models.reduce((sum, m) => sum + (m.sizeBytes ?? 0), 0);
  const inMemoryBytes = running.reduce((sum, r) => sum + r.sizeBytes, 0);
  const runningByName = new Map(running.map(r => [r.name, r]));

  /** Memory usage for a model if it is currently loaded. */
  const memoryFor = (m: LLMModel) => {
    const r = runningByName.get(m.name) ?? (m.filePath ? runningByName.get(m.filePath.split(/[\\/]/).pop() ?? '') : undefined);
    return r ? r.sizeBytes : null;
  };

  const withBusy = async (id: string, action: (id: string) => Promise<void>) => {
    setBusyModel(id);
    try { await action(id); } finally { setBusyModel(null); }
  };

  const handleDelete = (id: string) => {
    if (window.confirm(`Permanently delete "${id}" from Ollama? This removes the model from disk.`)) {
      withBusy(id, deleteModel);
    }
  };

  const startPull = () => {
    const name = pullName.trim();
    if (!name || pulling) return;
    setShowPull(false);
    setPullName('');
    pullModel(name);
  };

  const pullPercent = pulling?.total && pulling.completed != null
    ? Math.round((pulling.completed / pulling.total) * 100)
    : null;

  // ── Drag-and-drop handlers ─────────────────────────────────
  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    const file = Array.from(e.dataTransfer.files).find(f => f.name.toLowerCase().endsWith('.gguf'));
    if (!file) {
      setUploadError('Only .gguf model files can be dropped here.');
      return;
    }
    setUploadError(null);
    const controller = new AbortController();
    uploadAbort.current = controller;
    setUpload({ name: file.name, fraction: 0 });
    try {
      await modelsApi.upload(file, (fraction) => setUpload({ name: file.name, fraction }), controller.signal);
      await refresh(); // watcher will also push SSE — this is belt-and-braces
    } catch (err) {
      if (!controller.signal.aborted) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      }
    } finally {
      setUpload(null);
      uploadAbort.current = null;
    }
  }, [refresh]);

  return (
    <div
      className="relative flex-1 overflow-y-auto"
      onDragEnter={(e) => { e.preventDefault(); dragDepth.current++; setDragOver(true); }}
      onDragLeave={() => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragOver(false); } }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
    <div className="mx-auto space-y-5" style={{ maxWidth: 1560, padding: 'clamp(16px, 2.4vw, 28px)' }}>
      {/* Drop overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
            style={{ background: 'rgba(6,8,15,0.6)', backdropFilter: 'blur(6px)' }}>
            <motion.div
              initial={{ scale: 0.92, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              transition={springGentle}
              className="lum-glass lum-reflect flex flex-col items-center gap-3 px-12 py-10"
              style={{ border: '1.5px dashed rgb(var(--lum-accent-rgb) / 0.5)' }}>
              <UploadCloud size={34} color="var(--lum-violet)" />
              <div className="text-[15px] font-semibold" style={{ color: 'var(--lum-aurora)' }}>Drop GGUF to install</div>
              <div className="text-[12px]" style={{ color: 'var(--lum-text-muted)' }}>
                The file is placed in your models folder and registered automatically
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Honest error banners */}
      <AnimatePresence>
        {(error || uploadError) && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 px-4 py-3 lum-glass" style={{ borderColor: 'rgba(232,116,107,0.35)' }}>
            <AlertTriangle size={14} color="var(--lum-danger)" style={{ flexShrink: 0 }} />
            <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--lum-danger)', flex: 1 }}>{error ?? uploadError}</div>
            {error && <Button variant="danger" size="sm" onClick={refresh}><RefreshCw size={11} /> Retry</Button>}
            <button onClick={() => { clearError(); setUploadError(null); }} title="Dismiss"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 2 }}>
              <X size={13} color="var(--lum-danger)" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {!error && health && !ollamaUp && (
        <div className="flex items-center gap-2.5 px-4 py-3 lum-glass" style={{ borderColor: 'rgba(232,179,107,0.3)' }}>
          <AlertTriangle size={14} color="var(--lum-warning)" style={{ flexShrink: 0 }} />
          <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--lum-warning)', flex: 1 }}>
            Ollama is not reachable — {health.message ?? 'unknown error'}
          </div>
          <Button variant="ghost" size="sm" onClick={refresh}><RefreshCw size={11} /> Retry</Button>
        </div>
      )}

      {ggufNoRuntime && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 lum-glass" style={{ borderColor: 'rgba(232,179,107,0.22)' }}>
          <CircleOff size={13} color="var(--lum-warning)" style={{ flexShrink: 0 }} />
          <div className="text-[12px] leading-relaxed" style={{ color: 'var(--lum-warning)' }}>
            GGUF files discovered but the runtime is unavailable — these models are listed and cannot run yet.
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          {(['all', 'general', 'coding', 'embedding', 'vision'] as Filter[]).map(f => (
            <motion.button key={f} onClick={() => setFilter(f)} whileTap={{ scale: 0.95 }}
              className="relative px-3.5 py-1.5 rounded-[10px] text-[12px] font-medium capitalize"
              style={{
                border: '1px solid transparent',
                background: 'transparent',
                color: filter === f ? 'var(--lum-aurora)' : 'var(--lum-text-secondary)',
                cursor: 'pointer', transition: 'color 0.2s',
              }}>
              {filter === f && (
                <motion.span layoutId="model-filter-pill" transition={springGentle}
                  className="absolute inset-0 rounded-[10px]"
                  style={{ background: 'var(--lum-violet-soft)', border: '1px solid rgb(var(--lum-accent-rgb) / 0.3)' }} />
              )}
              <span className="relative">{f}</span>
            </motion.button>
          ))}
        </div>
        <div className="flex gap-2.5">
          <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] lum-glass-subtle">
            <Search size={13} color="var(--lum-text-muted)" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models…"
              style={{ background: 'transparent', border: 'none', color: 'var(--lum-text)', fontSize: 12, outline: 'none', width: 150 }} />
          </div>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw size={13} /> Refresh
          </Button>
          <Button variant="accent" size="sm" onClick={() => setShowPull(v => !v)} disabled={!ollamaUp || !!pulling}>
            <Download size={13} /> Pull Model
          </Button>
        </div>
      </div>
      <div role="status" aria-live="polite" className="text-[11px]" style={{ color: 'var(--lum-text-muted)' }}>
        {eventStatus === 'connected' ? 'Live model updates connected'
          : eventStatus === 'unauthorized' ? 'Live model updates need API access. Check your authentication configuration.'
          : eventStatus === 'reconnecting' ? 'Reconnecting live model updates… You can still refresh manually.'
          : 'Connecting live model updates…'}
      </div>

      {/* Pull input panel */}
      <AnimatePresence>
        {showPull && !pulling && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            style={{ overflow: 'hidden' }}>
            <Card style={{ padding: 14 }}>
              <div className="flex items-center gap-3">
                <input value={pullName} onChange={e => setPullName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') startPull(); }}
                  placeholder='Model name from the Ollama registry — e.g. "llama3.2:3b" or "qwen2.5-coder:7b"'
                  autoFocus
                  className="lum-glass-subtle"
                  style={{ flex: 1, color: 'var(--lum-text)', fontSize: 13, outline: 'none', padding: '8px 12px' }} />
                <Button variant="accent" size="sm" onClick={startPull} disabled={!pullName.trim()}>
                  <Download size={12} /> Pull
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setShowPull(false); setPullName(''); }}>Cancel</Button>
              </div>
              <div className="text-[11px] mt-2" style={{ color: 'var(--lum-text-muted)' }}>
                Browse available models at ollama.com/library — or drop a .gguf file anywhere on this page.
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live progress: pull or upload */}
      <AnimatePresence>
        {(pulling || upload) && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card reflect style={{ padding: 14 }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[12.5px] font-medium" style={{ color: 'var(--lum-text)' }}>
                  {pulling ? <>Pulling <span className="font-mono" style={{ color: 'var(--lum-violet)' }}>{pulling.name}</span></>
                           : <>Installing <span className="font-mono" style={{ color: 'var(--lum-violet)' }}>{upload!.name}</span></>}
                </div>
                {pulling
                  ? <Button variant="danger" size="sm" onClick={cancelPull}><StopCircle size={11} /> Cancel</Button>
                  : <Button variant="danger" size="sm" onClick={() => uploadAbort.current?.abort()}><StopCircle size={11} /> Cancel</Button>}
              </div>
              <ProgressBar value={pulling ? (pullPercent ?? 0) : Math.round((upload!.fraction) * 100)} />
              <div className="flex justify-between mt-2">
                <span className="text-[11px]" style={{ color: 'var(--lum-text-muted)' }}>
                  {pulling ? pulling.status : 'Copying into models folder…'}
                </span>
                <span className="text-[11px] font-mono" style={{ color: 'var(--lum-text-muted)' }}>
                  {pulling && pullPercent != null
                    ? `${formatBytes(pulling.completed ?? 0)} / ${formatBytes(pulling.total ?? 0)} (${pullPercent}%)`
                    : upload ? `${Math.round(upload.fraction * 100)}%` : ''}
                </span>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real statistics */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[
          { l: 'Installed',  v: anyProviderUp ? models.length : null, fmt: (v: number) => String(Math.round(v)) },
          { l: 'Loaded',     v: ollamaUp || running.length > 0 ? running.length : null, fmt: (v: number) => String(Math.round(v)) },
          { l: 'Total Size', v: anyProviderUp ? totalBytes : null, fmt: formatBytes },
          { l: 'In Memory',  v: ollamaUp || running.length > 0 ? inMemoryBytes : null, fmt: formatBytes },
        ].map(({ l, v, fmt }) => (
          <Card key={l} reflect style={{ padding: 15 }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: 'var(--lum-text-muted)' }}>{l}</div>
            <div className="text-[21px] font-bold tabular" style={{ color: 'var(--lum-aurora)', letterSpacing: '-0.02em' }}>
              {v === null ? '—' : <AnimatedNumber value={v} format={fmt} />}
            </div>
          </Card>
        ))}
      </div>

      {/* Model cards */}
      {loading && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
          {[0, 1].map(i => (
            <Card key={i} style={{ padding: 18 }}>
              <div className="lum-skeleton mb-3" style={{ height: 16, width: '55%' }} />
              <div className="lum-skeleton mb-2" style={{ height: 11, width: '85%' }} />
              <div className="lum-skeleton" style={{ height: 11, width: '70%' }} />
            </Card>
          ))}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <Card style={{ padding: '40px 24px' }}>
          <div className="flex flex-col items-center gap-3 text-center">
            <Layers size={26} style={{ color: 'var(--lum-text-muted)', opacity: 0.5 }} />
            <div className="text-[13px]" style={{ color: 'var(--lum-text-secondary)' }}>
              {models.length > 0
                ? 'No models match the current filter.'
                : !ollamaUp
                  ? 'No models found. Start Ollama, drop a .gguf here, or pull one once Ollama is up.'
                  : 'No models installed yet — use "Pull Model", or drop a .gguf file anywhere on this page.'}
            </div>
          </div>
        </Card>
      )}

      <motion.div layout className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
        <AnimatePresence initial={false}>
          {filtered.map((m) => {
            const memBytes = memoryFor(m);
            const isLoaded = m.status === 'loaded';
            return (
              <motion.div key={m.id}
                layout
                initial={{ opacity: 0, scale: 0.96, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -8 }}
                transition={springGentle}>
                <Card hover reflect style={{ padding: 18, height: '100%' }}>
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3 mb-3.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <StatusDot status={m.status} />
                      <div className="min-w-0">
                        <div className="font-mono text-[13.5px] font-semibold truncate" style={{ color: 'var(--lum-aurora)' }}
                          title={m.filePath ?? m.name}>{m.name}</div>
                        {m.providerId === 'local' && m.filePath && (
                          <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--lum-text-muted)' }} title={m.filePath}>
                            {m.filePath}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-shrink-0">
                      <Badge variant={m.providerId === 'local' ? 'warning' : 'cyan'}>
                        {m.providerId === 'local' ? 'GGUF' : 'Ollama'}
                      </Badge>
                      <Badge variant={TYPE_BADGE[m.type] ?? 'default'}>{m.type}</Badge>
                    </div>
                  </div>

                  {/* Metadata grid */}
                  <div className="grid grid-cols-4 gap-3 mb-4">
                    <Meta label="Arch" value={m.family} />
                    <Meta label="Params" value={m.parameterSize ?? '—'} />
                    <Meta label="Context" value={m.contextLength ? m.contextLength.toLocaleString() : '—'} />
                    <Meta label="Quant" value={m.quantization} />
                  </div>

                  {/* Footer: size / memory / actions */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 text-[11.5px]" style={{ color: 'var(--lum-text-muted)' }}>
                      <span>{m.sizeLabel}</span>
                      {isLoaded && memBytes != null && (
                        <span className="flex items-center gap-1" style={{ color: 'var(--lum-success)' }}>
                          <MemoryStick size={11} /> {formatBytes(memBytes)} in memory
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2 items-center">
                      {m.runnable === false ? (
                        <span className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--lum-warning)' }}
                          title="No GGUF runtime available — this model is discovered but cannot run yet.">
                          <CircleOff size={11} /> No runtime
                        </span>
                      ) : (
                        <>
                          {isLoaded
                            ? <Button variant="danger" size="sm" disabled={busyModel === m.id} onClick={() => withBusy(m.id, unloadModel)}><StopCircle size={11} /> Unload</Button>
                            : <Button variant="success" size="sm" disabled={busyModel === m.id} onClick={() => withBusy(m.id, loadModel)}><Play size={11} /> {busyModel === m.id ? 'Loading…' : 'Load'}</Button>}
                          {m.providerId !== 'local' && (
                            <Button variant="ghost" size="sm" disabled={busyModel === m.id} onClick={() => handleDelete(m.id)}><Trash2 size={11} /></Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>

      {/* GGUF folder status line */}
      {localHealth && (
        <div className="text-[11px] px-1 flex items-center gap-1.5" style={{ color: 'var(--lum-text-muted)' }}>
          <FolderOpen size={11} />
          {localHealth.message ?? 'GGUF folder status unknown'}
        </div>
      )}
    </div>
    </div>
  );
}
