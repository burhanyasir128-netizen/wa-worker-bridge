const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

// --- CONFIGURATION ---
const WORKER_URL = "https://sweet-band-04a4.btcosmetics44.workers.dev/"; // Apna Cloudflare Worker URL yahan dalein

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("Scan this QR Code on Koyeb Console:");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ WhatsApp Connected & Online 24/7!');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderID = msg.key.remoteJid;
        const senderNumber = senderID.split('@')[0];
        const pushName = msg.pushName || "User";
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (!messageText) return;

        try {
            // Cloudflare Worker ko data bhejna
            const response = await axios.post(WORKER_URL, {
                query: { sender: senderNumber, senderName: pushName, message: messageText },
                message: messageText
            });

            // Agar Worker se koi reply aaye to WhatsApp par bhej dena
            if (response.data && response.data.replies) {
                for (let reply of response.data.replies) {
                    await sock.sendMessage(senderID, { text: reply.message });
                }
            }
        } catch (error) {
            console.error("Worker Error:", error.message);
        }
    });
}

connectToWhatsApp();
