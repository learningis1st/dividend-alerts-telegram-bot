import { sendMessage, escapeHTML } from '../utils/telegram.js';
import { getTodayDividendEvents, getAllActiveUserWatchlists, setSubscriptionStatus } from '../db/repository.js';
import { sleep } from '../utils/helpers.js';

function formatDividendAlertMessage(userResults) {
    let msg = "🚨 <b>Dividend Events Today</b> 🚨\n\n";
    userResults.forEach(row => {
        msg += `<b>${escapeHTML(row.symbol)}</b>\n`;
        if (row.divPayAmount != null) msg += `Amount: $${row.divPayAmount}\n`;
        msg += row.isExDivToday
            ? `Ex-Div Date: ${row.divExDate || 'N/A'}\nPay Date: ${row.divPayDate || 'N/A'}\n\n`
            : `Pay Date: ${row.divPayDate || 'N/A'}\n\n`;
    });
    return msg;
}

export async function checkDividendsAndAlert(env) {
    const userWatchlists = await getAllActiveUserWatchlists(env);
    if (!userWatchlists?.length) return;

    const uniqueSymbolsSet = new Set();
    userWatchlists.forEach(({ symbols }) => symbols.forEach(symbol => uniqueSymbolsSet.add(symbol)));
    if (!uniqueSymbolsSet.size) return;

    const allUniqueSymbols = Array.from(uniqueSymbolsSet);
    const masterResults = await getTodayDividendEvents(env, allUniqueSymbols);
    if (!masterResults?.length) return;

    const dividendDataMap = new Map(masterResults.map(row => [row.symbol, row]));

    for (const { chatId, symbols } of userWatchlists) {
        try {
            const userResults = symbols.map(symbol => dividendDataMap.get(symbol)).filter(Boolean);
            if (!userResults.length) continue;

            const msg = formatDividendAlertMessage(userResults);
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);

            await sleep(35);

        } catch (error) {
            console.error(`Failed to process dividend alerts for user ${chatId}:`, error);

            if (error.message === 'FORBIDDEN_BOT_BLOCKED') {
                console.log(`User ${chatId} blocked the bot. Setting is_active to 0.`);
                await setSubscriptionStatus(env, chatId, false);
            }
        }
    }
}
