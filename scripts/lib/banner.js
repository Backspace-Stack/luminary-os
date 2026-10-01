// =============================================================
// Luminary OS — official boot banner (scripts/lib/banner.js)
//
// One banner for every entry point (run / setup / doctor).
// Purple, top to bottom — Luminary's own violet identity, the
// same family as the app's --lum-accent. Clean ASCII fallback
// only for terminals that truly can't render color. Inspired by
// the Claude Code boot experience: a bold wordmark, a quiet
// tagline underneath, then diagnostics.
// =============================================================

'use strict';

const IS_WIN = process.platform === 'win32';

// Node's own color-support probe is the correct, maintained way
// to answer "will ANSI escapes render here" — it already accounts
// for Windows 10+ console-mode support, Windows Terminal, piped
// output, and CI. A hand-rolled WT_SESSION/TERM_PROGRAM check
// (the old approach) wrongly disables color in a plain
// double-clicked run.bat window, which is the #1 way people
// launch Luminary — so this is the single source of truth.
function supportsColor() {
  if (!process.stdout.isTTY) return false;
  if (typeof process.stdout.hasColors === 'function') return process.stdout.hasColors();
  return !IS_WIN || !!process.env.WT_SESSION || !!process.env.TERM_PROGRAM;
}

const FANCY = supportsColor();

// Luminary violet, top to bottom — brighter lavender at the crown,
// deepening into the app's true accent by the base. Purple start
// to finish; never drifts toward blue or cyan.
const GRADIENT = [147, 141, 135, 105, 99, 93];
const ESC = '\x1b[';
const reset = `${ESC}0m`;
const fg = (n) => `${ESC}38;5;${n}m`;
const dim = `${ESC}2m`;
const bold = `${ESC}1m`;

const ART = [
  '██╗     ██╗   ██╗███╗   ███╗██╗███╗   ██╗ █████╗ ██████╗ ██╗   ██╗',
  '██║     ██║   ██║████╗ ████║██║████╗  ██║██╔══██╗██╔══██╗╚██╗ ██╔╝',
  '██║     ██║   ██║██╔████╔██║██║██╔██╗ ██║███████║██████╔╝ ╚████╔╝ ',
  '██║     ██║   ██║██║╚██╔╝██║██║██║╚██╗██║██╔══██║██╔══██╗  ╚██╔╝  ',
  '███████╗╚██████╔╝██║ ╚═╝ ██║██║██║ ╚████║██║  ██║██║  ██║   ██║   ',
  '╚══════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝   ',
];

const ART_PLAIN = [
  ' _    _   _ __  __ ___ _   _   _   ______   __',
  '| |  | | | |  \\/  |_ _| \\ | | / \\ |  _ \\ \\ / /',
  '| |  | | | | |\\/| || ||  \\| |/ _ \\| |_) \\ V / ',
  '| |__| |_| | |  | || || |\\  / ___ \\  _ < | |  ',
  '|_____\\___/|_|  |_|___|_| \\/_/   \\_\\_| \\_\\|_|  ',
];

/**
 * Print the Luminary boot banner.
 * @param {string} subtitle e.g. '', 'Setup', 'Doctor'
 * @param {string} version  e.g. 'v0.1.0'
 */
function banner(subtitle = '', version = 'v0.1.0') {
  const label = subtitle ? `Luminary OS — ${subtitle}` : 'Luminary OS';
  console.log('');
  if (FANCY) {
    ART.forEach((line, i) => {
      console.log(`  ${fg(GRADIENT[i % GRADIENT.length])}${line}${reset}`);
    });
    console.log('');
    console.log(`  ${bold}${fg(141)}${label}${reset}  ${dim}${version}${reset}`);
    console.log(`  ${bold}${fg(135)}Nah I'd win${reset}${bold}${fg(135)}™${reset}`);
  } else {
    ART_PLAIN.forEach((line) => console.log(`  ${line}`));
    console.log('');
    console.log(`  ${label}  ${version}`);
    console.log("  Nah I'd win (TM)");
  }
  console.log('');
}

module.exports = { banner, supportsColor };
