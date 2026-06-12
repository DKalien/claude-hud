import { critical, label, getQuotaColor, quotaBar, RESET } from '../colors.js';
import { getAdaptiveBarWidth } from '../../utils/terminal.js';
import { progressLabel } from './label-align.js';
export function renderMimoLine(ctx, alignLabels = false) {
    const display = ctx.config?.display;
    const colors = ctx.config?.colors;
    if (display?.showMimoUsage === false) {
        return null;
    }
    const snapshot = ctx.mimoSnapshot;
    if (!snapshot) {
        return null;
    }
    const mimoLabel = progressLabel('label.mimo', colors, alignLabels);
    if (snapshot.error) {
        return `${mimoLabel} ${critical(snapshot.error, colors)}`;
    }
    const parts = [];
    if (snapshot.plan_name) {
        parts.push(label(`[${snapshot.plan_name}]`, colors));
    }
    if (snapshot.used_percentage !== null && snapshot.used_percentage !== undefined) {
        const barWidth = getAdaptiveBarWidth();
        const color = getQuotaColor(snapshot.used_percentage, colors);
        const bar = quotaBar(snapshot.used_percentage, barWidth, colors);
        parts.push(`${bar} ${color}${snapshot.used_percentage}%${RESET}`);
        if (snapshot.used_amount && snapshot.total_amount) {
            parts.push(label(`${snapshot.used_amount} / ${snapshot.total_amount}`, colors));
        }
    }
    if (snapshot.balance !== null && snapshot.balance !== undefined && snapshot.balance > 0) {
        const currency = snapshot.balance_currency ?? '¥';
        parts.push(label(`余额: ${currency}${snapshot.balance}`, colors));
    }
    if (parts.length === 0) {
        return null;
    }
    return `${mimoLabel} ${parts.join(' │ ')}`;
}
//# sourceMappingURL=mimo.js.map