export const YUBIKEY_ID_LENGTH = 12;
export const YUBIKEY_OTP_LENGTH = 44;

async function generateYubicoSignature(params, secretKeyB64) {
    if (!secretKeyB64) {
        throw new Error("Missing YUBICO_SECRET_KEY environment variable.");
    }

    const message = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
    const binary = atob(secretKeyB64);
    const keyBytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function verifyYubicoOTP(otp, clientId, secretKeyB64) {
    const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 40);
    const params = { id: clientId, otp, nonce };

    params['h'] = await generateYubicoSignature(params, secretKeyB64);

    const response = await fetch(`https://api.yubico.com/wsapi/2.0/verify?${new URLSearchParams(params)}`);
    if (!response.ok) return false;

    const text = await response.text();
    const responseParams = Object.fromEntries(
        text.trim().split(/\r?\n/).map(line => {
            const [key, ...rest] = line.split('=');
            return [key.trim(), rest.join('=').trim()];
        })
    );

    if (
        responseParams['status'] !== 'OK' ||
        responseParams['nonce'] !== nonce ||
        responseParams['otp'] !== otp ||
        !responseParams['h']
    ) {
        return false;
    }

    const receivedSignature = responseParams['h'];
    delete responseParams['h'];
    const expectedSignature = await generateYubicoSignature(responseParams, secretKeyB64);

    if (receivedSignature.length !== expectedSignature.length) return false;

    let mismatch = 0;
    for (let i = 0; i < receivedSignature.length; i++) {
        mismatch |= receivedSignature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }
    return mismatch === 0;
}
