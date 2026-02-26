import { getNYDateString } from '../utils/helpers.js';

function extractUniqueSymbols(layoutString) {
    const layout = JSON.parse(layoutString);
    return [...new Set(layout.map(w => w.symbol).filter(Boolean))];
}

export async function getUserByChatId(env, chatId) {
    return await env.DB.prepare('SELECT user_id FROM telegram_users WHERE chat_id = ?').bind(chatId).first();
}

export async function checkUserLayoutExists(env, userId) {
    return await env.DB.prepare('SELECT user_id FROM user_layouts WHERE user_id = ?').bind(userId).first();
}

export async function getUserSymbols(env, chatId) {
    const userRec = await getUserByChatId(env, chatId);
    if (!userRec?.user_id) return { errorCode: "NOT_LOGGED_IN" };

    const layoutRec = await env.DB.prepare('SELECT layout FROM user_layouts WHERE user_id = ?').bind(userRec.user_id).first();
    if (!layoutRec?.layout) return { errorCode: "EMPTY_WATCHLIST" };

    try {
        const symbols = extractUniqueSymbols(layoutRec.layout);
        return symbols.length ? { symbols } : { errorCode: "NO_SYMBOLS" };
    } catch {
        return { errorCode: "PARSE_ERROR" };
    }
}

export async function upsertTelegramUser(env, chatId, userId) {
    await env.DB.prepare(`
        INSERT INTO telegram_users (chat_id, user_id, is_active)
        VALUES (?, ?, 1)
            ON CONFLICT(chat_id) DO UPDATE SET user_id = excluded.user_id, is_active = 1
    `).bind(chatId, userId).run();
}

export async function setSubscriptionStatus(env, chatId, isActive) {
    await env.DB.prepare(`
        INSERT INTO telegram_users (chat_id, is_active) 
        VALUES (?, ?) 
        ON CONFLICT(chat_id) DO UPDATE SET is_active = excluded.is_active
    `).bind(chatId, isActive ? 1 : 0).run();
}

export async function deleteTelegramUser(env, chatId) {
    const result = await env.DB.prepare('DELETE FROM telegram_users WHERE chat_id = ?').bind(chatId).run();
    return result.meta.changes > 0;
}

export async function getEquityFundamentals(env, symbols) {
    if (!symbols?.length) return [];

    const CHUNK_SIZE = 50;
    const statements = [];

    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
        const chunk = symbols.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');

        statements.push(
            env.DB.prepare(
                `SELECT * FROM equity_fundamentals WHERE symbol IN (${placeholders})`
            ).bind(...chunk)
        );
    }

    const batchResults = await env.DB.batch(statements);
    return batchResults.flatMap(res => res.results || []);
}

export async function getTodayDividendEvents(env, symbols) {
    if (!symbols?.length) return [];

    const todayStr = getNYDateString();
    const CHUNK_SIZE = 50;
    const statements = [];

    for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
        const chunk = symbols.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');

        const query = `
            SELECT symbol, divPayAmount, divExDate, divPayDate,
                   (date(divExDate) = date('${todayStr}')) as isExDivToday
            FROM equity_fundamentals
            WHERE symbol IN (${placeholders})
              AND (date(divExDate) = date('${todayStr}') OR date(divPayDate) = date('${todayStr}'))
        `;

        statements.push(env.DB.prepare(query).bind(...chunk));
    }

    const batchResults = await env.DB.batch(statements);
    return batchResults.flatMap(res => res.results || []);
}

export async function getAllActiveUserWatchlists(env) {
    const query = `
        SELECT t.chat_id, l.layout 
        FROM telegram_users t
        JOIN user_layouts l ON t.user_id = l.user_id
        WHERE t.is_active = 1 AND t.user_id IS NOT NULL
    `;
    const { results } = await env.DB.prepare(query).all();

    const userWatchlists = [];
    if (!results) return userWatchlists;

    for (const row of results) {
        try {
            if (row.layout) {
                const symbols = extractUniqueSymbols(row.layout);
                if (symbols.length > 0) {
                    userWatchlists.push({ chatId: row.chat_id, symbols });
                }
            }
        } catch (e) {
            console.error(`Failed to parse layout for chat_id ${row.chat_id}:`, e);
        }
    }
    return userWatchlists;
}
