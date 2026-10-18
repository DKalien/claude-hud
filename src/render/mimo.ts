import type { Frame } from './frame.js';
import { critical, getQuotaColor, label, quotaBar, RESET } from './colors.js';
import { barLabel, type LabelAlign } from './labels.js';

/** Render the fork-specific MIMO Token Plan snapshot as an orderable HUD element. */
export function renderMimoLine(f: Frame, align: LabelAlign = {}): string | null {
  const display = f.config?.display;
  if (display?.showMimoUsage !== true) return null;

  const snapshot = f.mimoSnapshot;
  if (!snapshot) return null;

  const colors = f.config?.colors;
  const prefix = `${barLabel('label.mimo', colors, align)} `;
  if (snapshot.error) return `${prefix}${critical(snapshot.error, colors)}`;

  const parts: string[] = [];
  if (snapshot.plan_name) parts.push(label(`[${snapshot.plan_name}]`, colors));

  if (snapshot.used_percentage !== null && snapshot.used_percentage !== undefined) {
    const color = getQuotaColor(snapshot.used_percentage, colors);
    const bar = quotaBar(snapshot.used_percentage, f.barWidth, colors);
    parts.push(`${bar} ${color}${snapshot.used_percentage}%${RESET}`);
    if (snapshot.used_amount && snapshot.total_amount) {
      parts.push(label(`${snapshot.used_amount} / ${snapshot.total_amount}`, colors));
    }
  }

  if (snapshot.balance !== null && snapshot.balance !== undefined && snapshot.balance > 0) {
    const currency = snapshot.balance_currency ?? '¥';
    parts.push(label(`余额: ${currency}${snapshot.balance}`, colors));
  }

  return parts.length > 0 ? `${prefix}${parts.join(' │ ')}` : null;
}
