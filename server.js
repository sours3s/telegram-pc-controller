const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const localtunnel = require('localtunnel');
const os = require('os');

// Token provided by user
const TOKEN = '8827267875:AAHILwtvs21Fz7Q8hbBYzOWYS6co2PHxwk0';
const PORT = process.env.PORT || 3000;
const CURRENT_VERSION = '1.1.0';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize Telegram Bot (polling mode)
const bot = new TelegramBot(TOKEN, { polling: true });

let adminChatId = null;
let publicUrl = '';

// Telegram Bot /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    if (!adminChatId) {
        adminChatId = chatId;
        console.log(`[AUTH] Admin set to Chat ID: ${adminChatId}`);
    }

    if (chatId !== adminChatId) {
        bot.sendMessage(chatId, '⛔ Доступ запрещен. Этот бот управляет чужим персональным компьютером.');
        return;
    }

    const webAppUrl = publicUrl || `http://localhost:${PORT}`;

    bot.sendMessage(chatId, '🖥️ *Панель управления ПК (v' + CURRENT_VERSION + ')*\n\nНажмите кнопку ниже, чтобы открыть расширенную панель управления.', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🚀 Открыть Web App панель', web_app: { url: webAppUrl } }]
            ]
        }
    });
});

// Helper for PowerShell execution (with -Sta for GUI/Screen operations)
function runPowerShell(cmd, useSta = false) {
    return new Promise((resolve, reject) => {
        const psFlag = useSta ? '-Sta' : '';
        exec(`powershell ${psFlag} -Command "${cmd}"`, { maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
            if (error) {
                reject(stderr || error.message);
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

// API: Version Check (Auto-Update)
app.get('/api/version', (req, res) => {
    res.json({
        success: true,
        version: CURRENT_VERSION,
        changelog: 'Добавлены расширенные функции управления ПК: питание, файлы, буфер обмена и авто-обновление.',
        updateUrl: publicUrl ? `${publicUrl}/update` : null
    });
});

// API: System Status
app.get('/api/status', async (req, res) => {
    try {
        const hostname = os.hostname();
        const arch = os.arch() === 'x64' ? '64-bit' : os.arch();
        const platform = `Windows ${arch}`;
        const uptime = os.uptime();
        res.json({ success: true, hostname, platform, uptime, publicUrl, version: CURRENT_VERSION });
    } catch (err) {
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// API: Take Screenshot (Returns Base64 to prevent any file transfer race conditions)
app.get('/api/screenshot', async (req, res) => {
    const screenshotPath = path.join(__dirname, 'screenshot.png');
    try {
        const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
        $bitmap.Save("${screenshotPath.replace(/\\/g, '\\\\')}", [System.Drawing.Imaging.ImageFormat]::Png)
        $graphics.Dispose()
        $bitmap.Dispose()
        `;

        await runPowerShell(psScript, true);

        if (fs.existsSync(screenshotPath)) {
            const bitmapBytes = fs.readFileSync(screenshotPath);
            const base64Image = `data:image/png;base64,${bitmapBytes.toString('base64')}`;
            // Clean up file
            try { fs.unlinkSync(screenshotPath); } catch(e) {}
            res.json({ success: true, image: base64Image });
        } else {
            res.status(500).json({ success: false, error: 'Screenshot file not created' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// API: Get Running Processes
app.get('/api/processes', async (req, res) => {
    try {
        const psCmd = `Get-Process | Select-Object Id, Name, WorkingSet | ConvertTo-Json -Compress`;
        const output = await runPowerShell(psCmd);
        let processes = JSON.parse(output);
        if (!Array.isArray(processes)) {
            processes = [processes];
        }
        const formatted = processes.map(p => ({
            id: p.Id,
            name: p.Name,
            memory: Math.round((p.WorkingSet || 0) / (1024 * 1024))
        })).sort((a, b) => b.memory - a.memory);

        res.json({ success: true, processes: formatted });
    } catch (err) {
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// API: Kill Process
app.post('/api/process/kill', async (req, res) => {
    const { pid } = req.body;
    if (!pid) {
        return res.status(400).json({ success: false, error: 'PID is required' });
    }
    try {
        await runPowerShell(`Stop-Process -Id ${pid} -Force`);
        res.json({ success: true, message: `Process ${pid} terminated.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// API: Execute Command
app.post('/api/exec', async (req, res) => {
    const { command } = req.body;
    if (!command) {
        return res.status(400).json({ success: false, error: 'Command is required' });
    }
    try {
        const output = await runPowerShell(command);
        res.json({ success: true, output });
    } catch (err) {
        res.json({ success: true, output: `ERROR:\n${err}` });
    }
});

// API: System Controls (Power / Lock / Sleep)
app.post('/api/system/control', async (req, res) => {
    const { action } = req.body;
    try {
        let cmd = '';
        if (action === 'shutdown') {
            cmd = 'shutdown /s /t 5';
        } else if (action === 'restart') {
            cmd = 'shutdown /r /t 5';
        } else if (action === 'lock') {
            cmd = 'rundll32.exe user32.dll,LockWorkStation';
        } else if (action === 'sleep') {
            cmd = 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0';
        } else {
            return res.status(400).json({ success: false, error: 'Unknown action' });
        }

        await runPowerShell(cmd);
        res.json({ success: true, message: `Действие ${action} выполнено.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// API: File Explorer (List directory contents)
app.post('/api/files', async (req, res) => {
    const dirPath = req.body.path || 'C:\\';
    try {
        const psCmd = `Get-ChildItem -Path "${dirPath}" -ErrorAction SilentlyContinue | Select-Object Name, FullName, Attributes, Length | ConvertTo-Json -Compress`;
        const output = await runPowerShell(psCmd);
        let items = output ? JSON.parse(output) : [];
        if (!Array.isArray(items)) {
            items = [items];
        }
        const formatted = items.map(item => ({
            name: item.Name,
            path: item.FullName,
            isDirectory: item.Attributes && item.Attributes.toString().includes('Directory'),
            size: item.Length ? Math.round(item.Length / 1024) : 0
        })).sort((a, b) => b.isDirectory - a.isDirectory);

        res.json({ success: true, currentPath: dirPath, items: formatted });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Не удалось открыть директорию: ' + err.toString() });
    }
});

// API: Clipboard (Get text)
app.get('/api/clipboard', async (req, res) => {
    try {
        const clip = await runPowerShell('Get-Clipboard');
        res.json({ success: true, clipboard: clip });
    } catch (err) {
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// API: Clipboard (Set text)
app.post('/api/clipboard', async (req, res) => {
    const { text } = req.body;
    try {
        await runPowerShell(`Set-Clipboard -Value "${text.replace(/"/g, '`"')}"`);
        res.json({ success: true, message: 'Буфер обмена обновлен' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.toString() });
    }
});

// Start Express Server
app.listen(PORT, async () => {
    console.log(`[SERVER] Running on http://localhost:${PORT}`);

    try {
        console.log('[TUNNEL] Starting localtunnel...');
        const tunnel = await localtunnel({ port: PORT });
        publicUrl = tunnel.url;
        console.log(`[TUNNEL] Public HTTPS URL established: ${publicUrl}`);

        bot.setChatMenuButton({
            menu_button: {
                type: 'web_app',
                text: 'Управление ПК v' + CURRENT_VERSION,
                web_app: { url: publicUrl }
            }
        }).catch(err => console.log('[BOT] Menu button update note:', err.message));

        tunnel.on('close', () => {
            console.log('[TUNNEL] Tunnel closed');
        });
    } catch (err) {
        console.log('[TUNNEL] Failed to start localtunnel:', err.message);
    }
});
