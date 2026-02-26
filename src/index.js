import { handleWebhook } from './handlers/webhook.js';
import { checkDividendsAndAlert } from './handlers/scheduler.js';

export default {
    async fetch(request, env, _ctx) {
        if (request.method === 'POST') {
            const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');

            if (secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
                console.warn("Unauthorized webhook attempt. Invalid secret token.");
                return new Response('Unauthorized', { status: 401 });
            }

            try {
                await handleWebhook(request, env);
            } catch (error) {
                console.error("Webhook processing error:", error);
            }
        }
        return new Response('OK', { status: 200 });
    },

    async scheduled(_event, env, _ctx) {
        try {
            await checkDividendsAndAlert(env);
        } catch (error) {
            console.error("Scheduled dividend alert error:", error);
        }
    },
};
