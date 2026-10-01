import { useState } from 'react';
import { Code, FlaskConical, Home, MessageSquare, Cpu, Activity, Play, Pause, AlertTriangle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, Badge, Button, StatusDot } from '@/components/ui';
import { staggerParent, riseIn, springGentle } from '@/lib/motion';
import { useAgents } from '@/hooks/useAgents';
import { useModels } from '@/hooks/useModels';
import { useTheme } from '@/theme/useTheme';
import type { AgentStatus } from '@/types';

// The first slot follows the theme accent; the rest stay stable
// so agents remain recognizable across themes.
const AGENT_META: Record<string, { Icon: React.ElementType; color?: string }> = {
  'conversation-agent': { Icon: MessageSquare },
  'coding-agent':       { Icon: Code,          color: '#8FC6E8' },
  'research-agent':     { Icon: FlaskConical,  color: '#6FCF97' },
  'home-agent':         { Icon: Home,          color: '#E8B36B' },
};

const STATUS_BADGE: Record<AgentStatus, 'accent'|'cyan'|'default'|'error'> = {
  active: 'accent', running: 'cyan', idle: 'default', error: 'error', disabled: 'default',
};

export default function Agents() {
  const { agents, loading, error, activate, pause, setModel, clearError } = useAgents();
  const { models } = useModels();
  const [theme] = useTheme();
  const [savingAgent, setSavingAgent] = useState<string | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);

  // Agents can only be assigned models that can actually run —
  // Ollama models and GGUF files when the runtime is available.
  const runnableModels = models.filter(m => m.runnable !== false && m.type !== 'embedding');
  const modelsAvailable = runnableModels.length > 0;
  /** Display name for an assigned model id (GGUF ids are file paths). */
  const modelLabel = (id: string) => models.find(m => m.id === id)?.name ?? (id.split(/[\\/]/).pop() ?? id);

  const handleModelChange = async (agentId: string, model: string) => {
    if (!model) return;
    setSavingAgent(agentId);
    try { await setModel(agentId, model); } finally { setSavingAgent(null); }
  };

  const runAgentAction = async (id: string, action: (agentId: string) => Promise<void>) => {
    if (busyAgent) return;
    setBusyAgent(id);
    try { await action(id); } finally { setBusyAgent(null); }
  };

  return (
    <div className="flex-1 overflow-y-auto">
    <div className="mx-auto" style={{ maxWidth: 1560, padding: 'clamp(16px, 2.4vw, 28px)' }}>
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 px-4 py-3 mb-5 lum-glass" style={{ borderColor: 'rgba(232,116,107,0.35)' }}>
            <AlertTriangle size={14} color="var(--lum-danger)" style={{ flexShrink: 0 }} />
            <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--lum-danger)', flex: 1 }}>{error}</div>
            <button onClick={clearError} title="Dismiss" style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }}><X size={13} color="var(--lum-danger)" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {loading && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
          {[0, 1, 2, 3].map(i => (
            <Card key={i} style={{ padding: 20 }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="lum-skeleton" style={{ width: 46, height: 46, borderRadius: 14 }} />
                <div className="flex-1 space-y-2">
                  <div className="lum-skeleton" style={{ height: 14, width: '45%' }} />
                  <div className="lum-skeleton" style={{ height: 10, width: '30%' }} />
                </div>
              </div>
              <div className="lum-skeleton" style={{ height: 11, width: '90%' }} />
            </Card>
          ))}
        </div>
      )}

      <motion.div variants={staggerParent} initial="initial" animate="enter"
        className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))' }}>
        {agents.map(agent => {
          const meta = AGENT_META[agent.id] ?? { Icon: MessageSquare };
          const { Icon } = meta;
          const color = meta.color ?? theme.accent;
          const isLive = agent.status === 'active' || agent.status === 'running';
          return (
            <motion.div key={agent.id} variants={riseIn}>
              <Card hover reflect style={{ padding: 0, height: '100%' }}>
                <div className="p-5 pb-4">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3.5">
                      {/* Agent avatar — breathes while live */}
                      <motion.div
                        className="flex items-center justify-center rounded-[14px] flex-shrink-0"
                        animate={isLive ? { scale: [1, 1.035, 1] } : { scale: 1 }}
                        transition={isLive ? { duration: 3.6, repeat: Infinity, ease: 'easeInOut' } : springGentle}
                        style={{
                          width: 46, height: 46,
                          background: `linear-gradient(160deg, ${color}30, ${color}14)`,
                          border: `1px solid ${color}45`,
                          boxShadow: isLive ? `0 0 22px ${color}38, inset 0 1px 0 rgba(255,255,255,0.12)` : `inset 0 1px 0 rgba(255,255,255,0.08)`,
                          transition: 'box-shadow 0.6s ease',
                        }}>
                        <Icon size={20} color={color} />
                      </motion.div>
                      <div>
                        <div className="text-[15px] font-bold tracking-tight" style={{ color: 'var(--lum-aurora)' }}>{agent.name}</div>
                        <div className="text-[11px]" style={{ color: 'var(--lum-text-muted)' }}>{agent.role}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusDot status={agent.status} />
                      <Badge variant={STATUS_BADGE[agent.status]}>{agent.status}</Badge>
                    </div>
                  </div>
                  <p className="text-[12px] leading-relaxed mb-4" style={{ color: 'var(--lum-text-secondary)' }}>{agent.description}</p>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5" style={{ minWidth: 0 }}>
                      <Cpu size={11} color="var(--lum-text-muted)" style={{ flexShrink: 0 }} />
                      {/* Assigned model — a real runnable model, persisted per agent */}
                      <select
                        value={agent.defaultModel || ''}
                        disabled={!modelsAvailable || savingAgent === agent.id}
                        onChange={e => handleModelChange(agent.id, e.target.value)}
                        title={modelsAvailable ? 'Assign a local model to this agent' : 'No runnable models available'}
                        className="font-mono text-[11px] lum-glass-subtle"
                        style={{
                          color: agent.defaultModel ? 'var(--lum-text)' : 'var(--lum-text-muted)',
                          padding: '4px 8px',
                          outline: 'none',
                          cursor: modelsAvailable ? 'pointer' : 'not-allowed',
                          maxWidth: 210,
                          opacity: savingAgent === agent.id ? 0.5 : 1,
                          transition: 'opacity 0.2s',
                        }}>
                        <option value="" disabled>
                          {modelsAvailable ? 'Select model…' : 'No models available'}
                        </option>
                        {/* Keep a stale assignment visible even if the model was deleted */}
                        {agent.defaultModel && !runnableModels.some(m => m.id === agent.defaultModel) && (
                          <option value={agent.defaultModel} disabled>{modelLabel(agent.defaultModel)} (not installed)</option>
                        )}
                        {runnableModels.map(m => (
                          <option key={m.id} value={m.id}>
                            {m.name}{m.providerId === 'local' ? ' (GGUF)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <Activity size={11} color={isLive ? color : 'var(--lum-text-muted)'} />
                      <span className="text-[11px]" style={{ color: 'var(--lum-text-muted)' }}>
                        {agent.activeTasks > 0
                          ? `${agent.activeTasks} task${agent.activeTasks !== 1 ? 's' : ''} running`
                          : 'no active task'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  {agent.status !== 'idle'
                    ? <Button variant="danger"  size="sm" disabled={busyAgent !== null} onClick={() => void runAgentAction(agent.id, pause)}><Pause size={11} /> Pause</Button>
                    : <Button variant="success" size="sm" disabled={busyAgent !== null} onClick={() => void runAgentAction(agent.id, activate)}><Play size={11} /> Activate</Button>
                  }
                  <span className="text-[11px] ml-auto truncate" style={{ color: 'var(--lum-text-muted)', maxWidth: '60%' }}
                    title={agent.defaultModel || undefined}>
                    {agent.defaultModel
                      ? <>Assigned: <span className="font-mono" style={{ color: 'var(--lum-text-secondary)' }}>{modelLabel(agent.defaultModel)}</span></>
                      : 'No model assigned — first runnable model will be used'}
                  </span>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
    </div>
  );
}
