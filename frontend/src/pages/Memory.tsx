import { useState } from 'react';
import { Search, Plus, Tag, FileText, BookOpen, Edit3, Trash2, X, AlertTriangle, RefreshCw } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Card, Badge, Button, Segmented } from '@/components/ui';
import { useMemory } from '@/hooks/useMemory';
import { useAgents } from '@/hooks/useAgents';
import { useTheme } from '@/theme/useTheme';
import { shade } from '@/theme/engine';
import { usePrefs } from '@/lib/prefs';
import type { MemoryEntry, MemoryType, Importance } from '@/types';

type Filter = MemoryType | 'all';
const TYPE_BADGE: Record<MemoryType, 'accent'|'cyan'|'default'> = { fact:'accent', context:'cyan', instruction:'default', episodic:'default' };
const TYPE_ICON: Record<MemoryType, React.ElementType> = { fact:Tag, context:FileText, instruction:BookOpen, episodic:FileText };
const IMP_COLOR: Record<Importance, string> = { high:'#E8746B', medium:'#E8B36B', low:'#6FCF97' };

/** Add/edit form state — a subset of MemoryEntry the user actually fills in. */
interface MemoryDraft {
  type: MemoryType;
  content: string;
  agentId: string;
  importance: Importance;
  tags: string;   // comma-separated in the UI, split on submit
}

const EMPTY_DRAFT: MemoryDraft = { type: 'fact', content: '', agentId: '', importance: 'medium', tags: '' };

/** Add/edit modal — a real form over the real memory CRUD endpoints. */
function MemoryModal({
  editing, onClose, onSave,
}: {
  editing: MemoryEntry | null;
  onClose: () => void;
  onSave: (draft: MemoryDraft) => Promise<void>;
}) {
  const { agents } = useAgents();
  const [draft, setDraft] = useState<MemoryDraft>(() => editing
    ? { type: editing.type, content: editing.content, agentId: editing.agentId, importance: editing.importance, tags: editing.tags.join(', ') }
    : { ...EMPTY_DRAFT, agentId: agents[0]?.id ?? '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = draft.content.trim().length > 0 && draft.agentId.trim().length > 0;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save memory');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 60, background: 'rgb(6 8 15 / 0.55)', backdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        className="lum-glass lum-reflect"
        style={{ width: 'min(520px, 100%)', padding: 22 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-[14px] font-semibold" style={{ color: 'var(--lum-aurora)' }}>
            {editing ? 'Edit memory' : 'Add memory'}
          </div>
          <button onClick={onClose} title="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 2, color: 'var(--lum-text-muted)' }}>
            <X size={15} />
          </button>
        </div>

        <div className="mb-3.5">
          <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--lum-text-secondary)' }}>Type</div>
          <Segmented
            value={draft.type}
            onChange={(type) => setDraft(d => ({ ...d, type }))}
            options={[
              { value: 'fact', label: 'Fact' },
              { value: 'context', label: 'Context' },
              { value: 'instruction', label: 'Instruction' },
              { value: 'episodic', label: 'Episodic' },
            ]}
          />
        </div>

        <div className="mb-3.5">
          <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--lum-text-secondary)' }}>Content</div>
          <textarea
            value={draft.content}
            onChange={(e) => setDraft(d => ({ ...d, content: e.target.value }))}
            placeholder="What should Luminary remember?"
            rows={3}
            autoFocus
            className="lum-glass-subtle"
            style={{ width: '100%', padding: '9px 12px', color: 'var(--lum-text)', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>

        <div className="grid gap-3.5 mb-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--lum-text-secondary)' }}>Agent</div>
            <select
              value={draft.agentId}
              onChange={(e) => setDraft(d => ({ ...d, agentId: e.target.value }))}
              className="lum-glass-subtle"
              style={{ width: '100%', padding: '8px 10px', color: 'var(--lum-text)', fontSize: 12.5, outline: 'none' }}
            >
              <option value="" disabled>Select agent…</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--lum-text-secondary)' }}>Importance</div>
            <Segmented
              value={draft.importance}
              onChange={(importance) => setDraft(d => ({ ...d, importance }))}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Med' },
                { value: 'high', label: 'High' },
              ]}
            />
          </div>
        </div>

        <div className="mb-5">
          <div className="text-[11px] font-medium mb-1.5" style={{ color: 'var(--lum-text-secondary)' }}>Tags</div>
          <input
            value={draft.tags}
            onChange={(e) => setDraft(d => ({ ...d, tags: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="comma, separated, tags"
            className="lum-glass-subtle"
            style={{ width: '100%', padding: '8px 12px', color: 'var(--lum-text)', fontSize: 12.5, outline: 'none' }}
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 mb-4 text-[12px]" style={{ color: 'var(--lum-danger)' }}>
            <AlertTriangle size={12} /> {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="accent" size="sm" onClick={submit} disabled={!valid || saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add memory'}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Memory() {
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const { memories, loading, error, remove, create, update, refresh, clearError } = useMemory();
  const [prefs] = usePrefs();
  const [deleting, setDeleting] = useState<string | null>(null);
  const { agents } = useAgents();
  const [theme] = useTheme();
  const [modal, setModal] = useState<{ editing: MemoryEntry | null } | null>(null);

  const deleteMemory = async (memory: MemoryEntry) => {
    if (deleting) return;
    if (prefs.confirmDelete && !window.confirm('Delete this memory permanently?')) return;
    setDeleting(memory.id);
    try { await remove(memory.id); } finally { setDeleting(null); }
  };

  const saveMemory = async (draft: MemoryDraft) => {
    const agentName = agents.find(a => a.id === draft.agentId)?.name ?? draft.agentId;
    const tags = draft.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (modal?.editing) {
      await update(modal.editing.id, { type: draft.type, content: draft.content, agentId: draft.agentId, agentName, importance: draft.importance, tags });
    } else {
      await create({ type: draft.type, content: draft.content, agentId: draft.agentId, agentName, importance: draft.importance, tags, createdAt: new Date().toISOString() });
    }
  };
  // Concrete hex values so `${color}1A` alpha suffixes stay valid
  const TYPE_COLOR: Record<MemoryType, string> = {
    fact: theme.accent, context: '#8FC6E8',
    instruction: shade(theme.accent, 0.16), episodic: '#6FCF97',
  };

  const filters: Filter[] = ['all','fact','context','instruction'];
  const filtered = memories.filter(
    m => (filter === 'all' || m.type === filter) &&
         m.content.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 overflow-y-auto">
    <div className="mx-auto space-y-5" style={{ maxWidth: 1280, padding: 'clamp(16px, 2.4vw, 28px)' }}>
      {error && (
        <div role="alert" className="flex items-center gap-2.5 px-4 py-3 lum-glass" style={{ borderColor: 'rgba(232,116,107,0.35)' }}>
          <AlertTriangle size={14} color="var(--lum-danger)" />
          <p className="flex-1 text-[12.5px]" style={{ color: 'var(--lum-danger)' }}>{error}</p>
          <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}><RefreshCw size={11} /> Retry</Button>
          <button onClick={clearError} title="Dismiss" style={{ color: 'var(--lum-danger)', background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={13} /></button>
        </div>
      )}
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {filters.map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium capitalize transition-all"
              style={{ border:`1px solid ${filter===f?'var(--lum-accent)':'rgba(255,255,255,0.06)'}`, background:filter===f?'rgb(var(--lum-accent-rgb) / 0.12)':'transparent', color:filter===f?'var(--lum-accent)':'#8892A4', cursor:'pointer' }}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex gap-2.5">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background:'rgba(255,255,255,0.035)', border:'1px solid rgba(255,255,255,0.07)' }}>
            <Search size={13} color="var(--lum-text-muted)" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search memories…"
              style={{ background:'transparent', border:'none', color:'var(--lum-text)', fontSize:12, outline:'none', width:150 }} />
          </div>
          <Button variant="accent" size="sm" onClick={() => setModal({ editing: null })}><Plus size={13} /> Add Memory</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[
          { l:'Total',          v: memories.length },
          { l:'Facts',          v: memories.filter(m => m.type === 'fact').length },
          { l:'Instructions',   v: memories.filter(m => m.type === 'instruction').length },
          { l:'High Priority',  v: memories.filter(m => m.importance === 'high').length },
        ].map(({ l, v }) => (
          <Card key={l} style={{ padding:14 }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color:'var(--lum-text-muted)' }}>{l}</div>
            <div className="text-[20px] font-bold" style={{ color:'var(--lum-text)' }}>{v}</div>
          </Card>
        ))}
      </div>

      {loading && <div className="text-[12px] p-4" style={{ color:'var(--lum-text-muted)' }}>Loading memories…</div>}

      {!loading && !error && filtered.length === 0 && (
        <Card style={{ padding: '40px 24px' }}>
          <div className="flex flex-col items-center gap-3 text-center">
            <FileText size={26} style={{ color: 'var(--lum-text-muted)', opacity: 0.5 }} />
            <div className="text-[13px]" style={{ color: 'var(--lum-text-secondary)' }}>
              {memories.length > 0 ? 'No memories match the current filter.' : 'No memories yet — Luminary will remember facts, context and instructions as agents pick them up, or add one yourself.'}
            </div>
          </div>
        </Card>
      )}

      {/* Entries */}
      <div className="space-y-2.5">
        {filtered.map(mem => {
          const Icon = TYPE_ICON[mem.type] ?? FileText;
          const typeColor = TYPE_COLOR[mem.type] ?? theme.accent;
          return (
            <Card key={mem.id} hover style={{ padding:0 }}>
              <div className="flex gap-4 px-5 py-4">
                <div className="flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5"
                  style={{ width:36, height:36, background:`${typeColor}1A`, border:`1px solid ${typeColor}28` }}>
                  <Icon size={14} color={typeColor} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-2">
                    <Badge variant={TYPE_BADGE[mem.type] ?? 'default'}>{mem.type}</Badge>
                    <span className="inline-block rounded-full flex-shrink-0"
                      style={{ width:6, height:6, background:IMP_COLOR[mem.importance] }} />
                    <span className="text-[10px] uppercase tracking-wide" style={{ color:'var(--lum-text-muted)' }}>{mem.importance}</span>
                    <span className="ml-auto text-[10px]" style={{ color:'var(--lum-text-muted)' }}>{mem.createdAt}</span>
                  </div>
                  <div className="text-[13px] leading-relaxed mb-2.5" style={{ color:'var(--lum-text)' }}>{mem.content}</div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px]" style={{ color:'var(--lum-text-muted)' }}>via {mem.agentName}</span>
                    <div className="flex gap-1.5">
                      {mem.tags.map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{ background:'rgba(255,255,255,0.04)', color:'var(--lum-text-muted)' }}>{tag}</span>
                      ))}
                    </div>
                    <div className="flex gap-1.5 ml-auto">
                      <Button variant="ghost" size="sm" onClick={() => setModal({ editing: mem })}><Edit3 size={11} /></Button>
                      <Button variant="ghost" size="sm" title="Delete memory" disabled={deleting !== null} onClick={() => void deleteMemory(mem)}><Trash2 size={11} /></Button>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>

    <AnimatePresence>
      {modal && (
        <MemoryModal
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSave={saveMemory}
        />
      )}
    </AnimatePresence>
    </div>
  );
}
