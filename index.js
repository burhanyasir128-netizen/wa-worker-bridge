const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const { Boom } = require('@hapi/boom');

const WORKER_URL = "https://sweet-band-04a4.btcosmetics44.workers.dev/"; // <-- Apna Cloudflare Worker URL yahan paste karein
const AUTH_DIR = './auth_info_baileys'; // Render par session files yahan save hongi

const delay = ms => new Promise(res => setTimeout(res, ms));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR); 
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true, // QR code print karne ke liye
        logger: pino({ level: 'silent' }),
        browser: ["Ubuntu", "Chrome", "20.0.04"], // Browser details for WhatsApp Web
        syncFullHistory: false
    });

    // --- PAIRING CODE / QR CODE LOGIC ---
    if (!sock.authState.creds.registered) {
        const phoneNumber = process.env.PHONE_NUMBER; // Render Environment Variable se number uthana
        if (!phoneNumber || phoneNumber.length < 10) {
            console.error("⚠️ Error: PHONE_NUMBER environment variable is not set correctly.");
            require('fs').rmSync(`./${AUTH_DIR}`, { recursive: true, force: true });
            return; 
        }

        try {
            console.log(`Attempting to get pairing code for number: ${phoneNumber}...`);
            await delay(5000); 
            const code = await sock.requestPairingCode(phoneNumber);
            
            console.log("-----------------------------------------");
            console.log("YOUR WHATSAPP PAIRING CODE:");
            console.log(code); 
            console.log("-----------------------------------------");
        } catch (error) {
            console.warn("❌ Failed to get pairing code:", error.message, ". Trying QR code instead...");
            // Pairing code fail hone par QR code dikhega
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) { 
            console.log("-----------------------------------------");
            console.log("SCAN THIS QR CODE IN WHATSAPP (Linked Devices):");
            qrcode.generate(qr, { small: true });
            console.log("-----------------------------------------");
        }
        
        if (connection === 'close') {
            let reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === DisconnectReason.badSession || reason === DisconnectReason.loggedOut) {
                console.log('❌ Bad Session / Logged Out. Deleting session and starting new...');
                require('fs').rmSync(`./${AUTH_DIR}`, { recursive: true, force: true }); 
                startBot(); 
            } else {
                console.log('Connection closed. Reconnecting in 5 seconds...');
                await delay(5000); 
                startBot(); 
            }
        } else if (connection === 'open') {
            console.log('✅ BOT IS ONLINE 24/7 ON RENDER!');
        }
    });

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderID = msg.key.remoteJid;
        const senderNumber = senderID.split('@')[0];
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (!messageText) return;

        try {
            const response = await axios.post(WORKER_URL, {
                query: { sender: senderNumber, message: messageText },
                message: messageText
            });

            if (response.data && response.data.replies) {
                for (let reply of response.data.replies) {
                    await sock.sendMessage(senderID, { text: reply.message });
                }
            }
        } catch (error) {
            console.error("Worker API Call Error:", error.message);
        }
    });

    // --- RENDER COMPATIBILITY: HTTP SERVER TO KEEP IT AWAKE ---
    const express = require('express'); // Express framework add karna padega
    const app = express();
    app.get('/', (req, res) => res.send('Bot is Running!'));
    app.listen(PORT, () => console.log(`HTTP Server running on port ${PORT}`));
}

// Ensure PORT is defined for Render
const PORT = process.env.PORT || 10000; // Render default port

startBot();

process.on('unhandledRejection', (reason, promise) => { console.error('Unhandled Rejection at:', promise, 'reason:', reason); });
process.on('uncaughtException', (err) => { console.error('Uncaught Exception at:', err); process.exit(1); });
