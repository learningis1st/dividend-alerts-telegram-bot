import { verifyYubicoOTP, YUBIKEY_ID_LENGTH, YUBIKEY_OTP_LENGTH } from '../utils/yubico.js';
import { sendMessage, escapeHTML } from '../utils/telegram.js';
import { getNYDateString } from '../utils/helpers.js';
import {
    getUserSymbols,
    getEquityFundamentals,
    getUserByChatId,
    checkUserLayoutExists,
    upsertTelegramUser,
    setSubscriptionStatus,
    deleteTelegramUser
} from '../db/repository.js';

function getErrorMessage(errorCode) {
    switch(errorCode) {
        case 'NOT_LOGGED_IN': return "🔒 Please <code>/login &lt;YubiKey OTP&gt;</code> first to view your watchlist.";
        case 'EMPTY_WATCHLIST': return "Your watchlist is currently empty.";
        case 'NO_SYMBOLS': return "No symbols found in your dashboard layout.";
        case 'PARSE_ERROR': return "Error parsing your watchlist layout.";
        default: return "An unknown error occurred.";
    }
}

function formatWatchlistMessage(symbols, results) {
    let dividendMsg = "";
    const nonDividendSymbols = [];
    const todayStr = getNYDateString();

    for (const symbol of symbols) {
        const row = results.find(r => r.symbol === symbol);

        if (row && (row.divYield || row.divPayAmount || row.divExDate || row.nextDivExDate)) {
            dividendMsg += `<b>${escapeHTML(row.symbol)}</b>\n`;
            if (row.divYield) dividendMsg += `Yield: ${row.divYield.toFixed(2)}%\n`;
            if (row.divPayAmount) dividendMsg += `Amount: $${row.divPayAmount}\n`;

            let upcomingExDate = null;
            if (row.divExDate && row.divExDate >= todayStr) {
                upcomingExDate = row.divExDate;
            } else if (row.nextDivExDate && row.nextDivExDate >= todayStr) {
                upcomingExDate = row.nextDivExDate;
            } else {
                upcomingExDate = row.nextDivExDate || row.divExDate;
            }

            if (upcomingExDate) dividendMsg += `Next Ex-Div: ${upcomingExDate}\n`;
            dividendMsg += '\n';
        } else {
            const isEquity = /^[A-Za-z/.-]{1,5}$/.test(symbol);
            if (isEquity) nonDividendSymbols.push(symbol);
        }
    }

    let msg = "📊 <b>Your Watchlist</b>\n\n";
    if (dividendMsg) msg += dividendMsg;
    else if (nonDividendSymbols.length === 0) msg += "No fundamental data available yet. Please wait for the tracker to run.\n\n";

    if (nonDividendSymbols.length > 0) {
        msg += "\n<b>Non-Dividend Paying / Unknown</b>\n";
        msg += nonDividendSymbols.map(escapeHTML).join(', ') + "\n";
    }
    return msg;
}

async function handleStart(chatId, env) {
    await setSubscriptionStatus(env, chatId, true);
    const user = await getUserByChatId(env, chatId);
    const msg = (user && user.user_id)
        ? "👋 Welcome back! You are already logged in and subscribed to dividend alerts.\n\nUse /watchlist to view your tracked symbols."
        : "👋 Welcome! You are now subscribed to dividend alerts.\n\nPlease register your YubiKey <a href='https://dashboard.learningis1.st/signup'>here</a> if you haven't already.\n\nTo link your Trader Dashboard account, touch your YubiKey and reply with:\n<code>/login &lt;OTP&gt;</code>";
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

async function handleLogin(chatId, args, env) {
    if (args.length !== 1) return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ Usage: <code>/login &lt;YubiKey OTP&gt;</code>");

    const otp = args[0];
    if (otp.length !== YUBIKEY_OTP_LENGTH) return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ Invalid OTP length. A YubiKey OTP must be exactly 44 characters long.");

    const yubikeyId = otp.substring(0, YUBIKEY_ID_LENGTH).toLowerCase();

    try {
        const isValid = await verifyYubicoOTP(otp, env.YUBICO_CLIENT_ID, env.YUBICO_SECRET_KEY);
        if (!isValid) return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "❌ Invalid OTP. Please try again.");

        const existingUser = await checkUserLayoutExists(env, yubikeyId);
        if (!existingUser) return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🚫 Unauthorized Device ID. You must set up your Trader Dashboard before using this bot.");

        const currentUser = await getUserByChatId(env, chatId);

        if (currentUser && currentUser.user_id === yubikeyId) {
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "✅ You are already authenticated with this YubiKey. No changes were made.");
        } else if (currentUser && currentUser.user_id) {
            await upsertTelegramUser(env, chatId, yubikeyId);
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ Successfully authenticated! Your old YubiKey account (${currentUser.user_id}) has been overwritten with the new one.`);
        } else {
            await upsertTelegramUser(env, chatId, yubikeyId);
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "✅ Successfully authenticated and linked your account! Use /watchlist to view your tracked symbols.");
        }
    } catch (e) {
        console.error("Authentication error:", e);
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⚠️ Authentication service unavailable.");
    }
}

async function handleWatchlist(chatId, env) {
    const { symbols, errorCode } = await getUserSymbols(env, chatId);
    if (errorCode) return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, getErrorMessage(errorCode));

    const results = await getEquityFundamentals(env, symbols);
    const msg = formatWatchlistMessage(symbols, results);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

export async function handleWebhook(request, env) {
    const update = await request.json();
    if (!update.message?.text) return;

    const chatId = update.message.chat.id;
    const text = update.message.text.trim();

    const parts = text.split(/\s+/);
    let command = parts[0];
    const args = parts.slice(1);

    if (command.includes('@')) {
        command = command.split('@')[0];
    }

    switch (command) {
        case '/start':
            await handleStart(chatId, env);
            break;
        case '/stop':
            await setSubscriptionStatus(env, chatId, false);
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "🔕 You have been unsubscribed from alerts.");
            break;
        case '/login':
            await handleLogin(chatId, args, env);
            break;
        case '/logout': {
            const wasDeleted = await deleteTelegramUser(env, chatId);
            const logoutMsg = wasDeleted ? "🔓 Logged out. Your account has been unlinked." : "⚠️ You are not currently logged in.";
            await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, logoutMsg);
            break;
        }
        case '/watchlist':
            await handleWatchlist(chatId, env);
            break;
    }
}
