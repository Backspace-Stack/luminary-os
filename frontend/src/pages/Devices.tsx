import { Globe, Laptop, Cpu, Video, Eye, Power, Plus, Wifi } from 'lucide-react';
import { Card, Badge, Button, StatusDot } from '@/components/ui';
import { useDevices } from '@/hooks/useDevices';
import { useTheme } from '@/theme/useTheme';
import type { DeviceStatus, DeviceType } from '@/types';

// color: undefined → follows the theme accent
const TYPE_META: Record<DeviceType, { Icon: React.ElementType; color?: string }> = {
  browser: { Icon: Globe },
  windows: { Icon: Laptop,  color: '#8FC6E8' },
  esp32:   { Icon: Cpu,     color: '#E8B36B' },
  camera:  { Icon: Video,   color: '#6FCF97' },
  linux:   { Icon: Laptop,  color: '#8892A4' },
  macos:   { Icon: Laptop,  color: '#8892A4' },
};
const STATUS_BADGE: Record<DeviceStatus, 'success'|'cyan'|'error'|'warning'> = {
  connected:'success', streaming:'cyan', offline:'error', pairing:'warning',
};

export default function Devices() {
  const { devices, loading, connect, disconnect } = useDevices();
  const [theme] = useTheme();

  const online    = devices.filter(d => d.status !== 'offline').length;
  const streaming = devices.filter(d => d.status === 'streaming').length;
  const offline   = devices.filter(d => d.status === 'offline').length;

  return (
    <div className="flex-1 overflow-y-auto">
    <div className="mx-auto space-y-5" style={{ maxWidth: 1560, padding: 'clamp(16px, 2.4vw, 28px)' }}>
      {/* No pairing/registration endpoint exists yet on the backend —
          devices only appear once a device adapter registers itself
          (see DeviceService). Disabled + honest, not a fake success. */}
      <div className="flex justify-end">
        <Button variant="accent" disabled title="Device pairing isn't implemented on the backend yet — devices appear here once a device adapter registers itself.">
          <Plus size={14} /> Add Device
        </Button>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        {[{l:'Total',v:devices.length},{l:'Online',v:online},{l:'Streaming',v:streaming},{l:'Offline',v:offline}].map(({l,v}) => (
          <Card key={l} style={{ padding:14 }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color:'var(--lum-text-muted)' }}>{l}</div>
            <div className="text-[20px] font-bold" style={{ color:'var(--lum-text)' }}>{v}</div>
          </Card>
        ))}
      </div>

      {loading && <div className="text-[12px] p-4" style={{ color:'var(--lum-text-muted)' }}>Loading devices…</div>}

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
        {devices.map(device => {
          const meta = TYPE_META[device.type] ?? TYPE_META.esp32;
          const { Icon } = meta;
          const color = meta.color ?? theme.accent;
          const isOffline = device.status === 'offline';
          return (
            <Card key={device.id} hover style={{ padding:0 }}>
              <div className="p-5 pb-4">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center justify-center rounded-xl"
                    style={{ width:46, height:46, background:`${color}1A`, border:`1px solid ${color}33` }}>
                    <Icon size={20} color={color} />
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusDot status={device.status} />
                    <Badge variant={STATUS_BADGE[device.status]}>{device.status}</Badge>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="text-[14px] font-semibold mb-0.5" style={{ color:'var(--lum-text)' }}>{device.name}</div>
                  <div className="text-[11px] font-mono" style={{ color:'var(--lum-text-muted)' }}>{device.version}</div>
                </div>

                <div className="space-y-1.5 mb-3">
                  {[{l:'IP Address',v:device.ipAddress},{l:'Last seen',v:device.lastSeenAt}].map(({l,v}) => (
                    <div key={l} className="flex justify-between">
                      <span className="text-[11px]" style={{ color:'var(--lum-text-muted)' }}>{l}</span>
                      <span className="font-mono text-[11px]" style={{ color:'var(--lum-text-secondary)' }}>{v}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1">
                  {device.capabilities.map(cap => (
                    <span key={cap} className="px-1.5 py-0.5 rounded text-[10px]"
                      style={{ background:'rgba(255,255,255,0.04)', color:'var(--lum-text-muted)' }}>{cap}</span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 px-5 py-3" style={{ borderTop:'1px solid rgba(255,255,255,0.06)' }}>
                {isOffline
                  ? <Button variant="accent"  size="sm" onClick={() => connect(device.id)}><Wifi size={11} /> Reconnect</Button>
                  // No live-view/inspector endpoint exists on the backend yet —
                  // disabled + honest rather than a button that does nothing.
                  : <Button variant="default" size="sm" disabled title="Live device inspection isn't implemented on the backend yet">
                      <Eye size={11} /> Inspect
                    </Button>}
                <Button variant="ghost" size="sm" style={{ marginLeft:'auto' }}
                  onClick={() => isOffline ? connect(device.id) : disconnect(device.id)}>
                  <Power size={11} />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
    </div>
  );
}
