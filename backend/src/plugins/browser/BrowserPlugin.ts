// ============================================================
// BrowserPlugin — Real, dependency-free browser & media control.
//
// Implemented (real):
//   • openUrl(url)   — opens a validated http/https URL in the user's
//                      default browser via the OS (PowerShell Start-Process
//                      on Windows, `open` on macOS, `xdg-open` on Linux).
//   • playPause / next / previous — sends the corresponding media key.
//                      Windows only, via a tiny inline user32.dll
//                      keybd_event call through PowerShell (no new
//                      dependency). Other platforms return an honest
//                      notImplemented rather than pretending.
//
// Still honest stubs (need a controlled/headless browser we don't run):
//   navigate, screenshot, click, fill, extract-text, search →
//   notImplemented. Nothing here fabricates a result.
// ============================================================

import { execFile } from 'child_process';
import { promisify } from 'util';
import { BasePlugin } from '../BasePlugin';
import type { PluginAction, PluginResult, PluginManifest } from '../../core/types/IPlugin';

const execFileAsync = promisify(execFile);

/** Windows virtual-key codes for the media transport keys. */
const MEDIA_VK = {
  playPause: 0xB3, // VK_MEDIA_PLAY_PAUSE
  next: 0xB0,      // VK_MEDIA_NEXT_TRACK
  previous: 0xB1,  // VK_MEDIA_PREV_TRACK
} as const;

const OPEN_TIMEOUT_MS = 10_000;

export class BrowserPlugin extends BasePlugin {
  readonly manifest: PluginManifest = {
    id: 'browser-plugin',
    name: 'Browser Plugin',
    version: '0.2.0',
    description: 'Opens URLs in the default browser and sends media transport keys. Page automation is not yet connected.',
    capabilities: [
      {
        action: 'openUrl',
        description: 'Open an http/https URL in the system default web browser.',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string', description: 'An absolute http:// or https:// URL.' } },
          required: ['url'],
        },
        requiresConfirmation: false,
      },
      {
        action: 'playPause',
        description: 'Send the Play/Pause media key to the OS (toggles the active media session).',
        requiresConfirmation: false,
      },
      {
        action: 'next',
        description: 'Send the Next-Track media key to the OS.',
        requiresConfirmation: false,
      },
      {
        action: 'previous',
        description: 'Send the Previous-Track media key to the OS.',
        requiresConfirmation: false,
      },
      // Page automation — honest stubs until a controlled browser is wired.
      { action: 'navigate',     description: 'Navigate a controlled browser page to a URL (not yet available).' },
      { action: 'screenshot',   description: 'Screenshot the current page (not yet available).' },
      { action: 'click',        description: 'Click an element by selector (not yet available).' },
      { action: 'fill',         description: 'Fill a form field (not yet available).' },
      { action: 'extract-text', description: 'Extract visible text from the page (not yet available).' },
      { action: 'search',       description: 'Search a query via a controlled browser (not yet available).' },
    ],
  };

  protected async onInitialize(): Promise<void> {
    this.logger.info(`BrowserPlugin ready — openUrl + media keys (platform=${process.platform})`);
  }

  async execute(action: PluginAction): Promise<PluginResult> {
    this.logger.debug(`execute: ${action.action}`, { requestId: action.requestId });
    switch (action.action) {
      case 'openUrl':   return this.openUrl(action);
      case 'playPause': return this.sendMediaKey('playPause', action);
      case 'next':      return this.sendMediaKey('next', action);
      case 'previous':  return this.sendMediaKey('previous', action);

      // Not implemented — honest, never faked.
      case 'navigate':
      case 'screenshot':
      case 'click':
      case 'fill':
      case 'extract-text':
      case 'search':
        return this.notImplemented(action.action);

      default:
        return this.notImplemented(action.action);
    }
  }

  // ── openUrl ────────────────────────────────────────────────────

  private async openUrl(action: PluginAction): Promise<PluginResult> {
    const raw = action.payload.url;
    if (typeof raw !== 'string' || raw.trim() === '') {
      return { success: false, error: 'openUrl requires a "url" string.' };
    }
    // Validate strictly: only real http/https URLs. This both prevents
    // opening arbitrary local files/protocols (file:, javascript:, …) and
    // guarantees a well-formed value we can hand to the OS opener safely.
    let parsed: URL;
    try {
      parsed = new URL(raw.trim());
    } catch {
      return { success: false, error: `openUrl: "${raw}" is not a valid URL.` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: `openUrl: only http/https URLs are allowed (got "${parsed.protocol}").` };
    }
    const url = parsed.toString();

    try {
      if (process.platform === 'win32') {
        // PowerShell Start-Process handles a URL with '&' in the query
        // string correctly (unlike cmd's `start`). Single-quote the value
        // as a PowerShell literal and double any embedded single quote so
        // nothing in the URL can break out into a command.
        const safe = url.replace(/'/g, "''");
        await execFileAsync(
          'powershell',
          ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${safe}'`],
          { timeout: OPEN_TIMEOUT_MS },
        );
      } else if (process.platform === 'darwin') {
        // execFile passes the url as a single argv item — no shell, no injection.
        await execFileAsync('open', [url], { timeout: OPEN_TIMEOUT_MS });
      } else {
        await execFileAsync('xdg-open', [url], { timeout: OPEN_TIMEOUT_MS });
      }
      this.logger.info(`openUrl launched ${url}`, { requestId: action.requestId });
      return { success: true, data: { url, opened: true } };
    } catch (err) {
      return { success: false, error: `openUrl failed to launch the browser: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // ── Media keys ─────────────────────────────────────────────────

  private async sendMediaKey(key: keyof typeof MEDIA_VK, action: PluginAction): Promise<PluginResult> {
    if (process.platform !== 'win32') {
      // Simulating media keys off Windows needs extra tooling (AppleScript /
      // playerctl / xdotool) that isn't guaranteed present — stay honest.
      return {
        success: false,
        error: `Media key "${key}" is only implemented on Windows in this build (platform=${process.platform}).`,
      };
    }
    const vk = MEDIA_VK[key];
    // Inline C# calls user32.dll keybd_event to press+release the media key.
    // vk is a hardcoded integer from MEDIA_VK — never caller input — so the
    // interpolated script carries no untrusted data.
    const script =
      '$s = @"\n' +
      'using System;\n' +
      'using System.Runtime.InteropServices;\n' +
      'public class LumMedia { [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e); }\n' +
      '"@\n' +
      'Add-Type $s\n' +
      `[LumMedia]::keybd_event(${vk},0,0,[UIntPtr]::Zero);` +      // key down
      `[LumMedia]::keybd_event(${vk},0,2,[UIntPtr]::Zero);`;       // key up (KEYEVENTF_KEYUP = 2)

    try {
      await execFileAsync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { timeout: OPEN_TIMEOUT_MS },
      );
      this.logger.info(`media key sent: ${key}`, { requestId: action.requestId });
      return { success: true, data: { key, sent: true } };
    } catch (err) {
      return { success: false, error: `Media key "${key}" failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
