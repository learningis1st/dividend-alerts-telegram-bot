import { sleep } from './helpers.js';

export function escapeHTML(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function sanitizeForTelegram(text) {
    return text
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<hr\s*\/?>/gi, '\n---\n')
        .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '[Image: $1]')
        .replace(/<img[^>]*>/gi, '[Image]')
        .replace(/<(meta|link|input)[^>]*>/gi, '');
}

const VOID_ELEMENTS = new Set(['br', 'hr', 'img', 'meta', 'link', 'input']);

function getOpenTags(htmlStr) {
    const regex = /<\/?([a-z]+)[^>]*>/gi;
    const tags = [];
    let match;

    while ((match = regex.exec(htmlStr)) !== null) {
        const tagName = match[1].toLowerCase();

        if (VOID_ELEMENTS.has(tagName)) continue;

        if (match[0].startsWith('</')) {
            for (let i = tags.length - 1; i >= 0; i--) {
                const openTagName = tags[i].match(/<([a-z]+)/i);
                if (openTagName && openTagName[1].toLowerCase() === tagName) {
                    tags.splice(i, 1);
                    break;
                }
            }
        } else {
            tags.push(match[0]);
        }
    }
    return tags;
}

function generateClosingTags(openTags) {
    return openTags.slice().reverse().map(t => {
        const match = t.match(/<([a-z]+)/i);
        return match ? `</${match[1]}>` : '';
    }).join('');
}

export async function sendMessage(token, chatId, text) {
    text = sanitizeForTelegram(text);

    const TELEGRAM_MAX = 4096;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    const chunks = [];
    let currentChunk = '';
    const lines = text.split('\n');

    for (let line of lines) {
        let openTags = getOpenTags(currentChunk);
        let closingTags = generateClosingTags(openTags);
        let maxAllowedLength = TELEGRAM_MAX - closingTags.length - 1;

        if (currentChunk.length + line.length > maxAllowedLength) {

            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim() + closingTags);
                currentChunk = openTags.join('');
            }

            while (currentChunk.length + line.length > (TELEGRAM_MAX - generateClosingTags(getOpenTags(currentChunk)).length - 1)) {

                openTags = getOpenTags(currentChunk);
                closingTags = generateClosingTags(openTags);
                maxAllowedLength = TELEGRAM_MAX - closingTags.length - 1;

                let splitIndex = line.lastIndexOf(' ', maxAllowedLength - currentChunk.length);

                if (splitIndex === -1 || splitIndex <= 0) {
                    splitIndex = maxAllowedLength - currentChunk.length;
                }

                if (splitIndex <= 0) splitIndex = 1;

                let inTag = false;
                for (let i = 0; i < splitIndex; i++) {
                    if (line[i] === '<') inTag = true;
                    if (line[i] === '>') inTag = false;
                }

                if (inTag) {
                    const newSplit = line.lastIndexOf('<', splitIndex);
                    if (newSplit >= 0) splitIndex = newSplit;
                }

                let chunkPart = line.slice(0, splitIndex);
                currentChunk += chunkPart;

                openTags = getOpenTags(currentChunk);
                closingTags = generateClosingTags(openTags);

                chunks.push(currentChunk.trim() + closingTags);

                line = line.slice(splitIndex).trim();
                currentChunk = openTags.join('');
            }
            currentChunk += line + '\n';
        } else {
            currentChunk += line + '\n';
        }
    }

    if (currentChunk.trim()) {
        const openTags = getOpenTags(currentChunk);
        const closingTags = generateClosingTags(openTags);
        chunks.push(currentChunk.trim() + closingTags);
    }

    for (let i = 0; i < chunks.length; i++) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: chunks[i], parse_mode: 'HTML' })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to send chunk ${i+1} to ${chatId}:`, errorText);

            if (response.status === 403) {
                throw new Error('FORBIDDEN_BOT_BLOCKED');
            }
        } else {
            await response.text();
        }

        if (i < chunks.length - 1) {
            await sleep(500);
        }
    }
}
