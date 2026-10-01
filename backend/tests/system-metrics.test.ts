import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGpuPercent } from '../src/services/SystemService';

const header = '"(PDH-CSV 4.0)","\\\\DESKTOP\\GPU Engine(pid_1_engtype_3D)\\Utilization Percentage","\\\\DESKTOP\\GPU Engine(pid_2_engtype_3D)\\Utilization Percentage"';
const csv = (a: string, b: string) => `${header}\r\n"10/01/2026 12:00:00.000","${a}","${b}"\r\nThe command completed successfully.`;

test('GPU counter parser preserves real zero and aggregates valid engine readings', () => {
  assert.equal(parseGpuPercent(csv('0.000000', '0')), 0);
  assert.equal(parseGpuPercent(csv('12.75', '8.50')), 21);
  assert.equal(parseGpuPercent(csv('80', '50')), 100);
  assert.equal(parseGpuPercent(`\uFEFF${csv('2.5e1', '5')}`), 30);
});

test('GPU counter parser reports missing or empty samples as unknown', () => {
  for (const output of ['', 'Error: No valid counters.', header, `${header}\r\n"10/01/2026 12:00:00.000"`, csv('', ''), csv(' ', '0')]) {
    assert.equal(parseGpuPercent(output), null, output);
  }
});

test('GPU counter parser refuses malformed, partial and invalid numeric readings', () => {
  for (const value of ['NaN', 'Infinity', '-1', '101', '3junk', '0x10', '1,5']) {
    assert.equal(parseGpuPercent(csv(value, '20')), null, value);
  }
  assert.equal(parseGpuPercent(`${header}\r\n"timestamp","20","30`), null);
  assert.equal(parseGpuPercent('"timestamp","20","30"'), null);
});
