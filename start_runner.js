const { spawn, execSync } = require('child_process');
const path = require('path');

const projectDir = __dirname;
const cloudflaredPath = path.resolve(projectDir, '..', 'cloudflared.exe');

console.log('\x1b[36m====================================================\x1b[0m');
console.log('\x1b[33m  جاري تشغيل منصة التبادل السكني وإنشاء الرابط...   \x1b[0m');
console.log('\x1b[36m====================================================\x1b[0m');

// 1. Check if server is already running on port 3000
fetch('http://localhost:3000').catch(() => {
  const server = spawn('node', ['server.js'], {
    cwd: projectDir,
    stdio: 'ignore',
    detached: true
  });
  server.unref();
  console.log('1. تم تشغيل سيرفر المنصة بنجاح.');
}).then(() => {
  console.log('1. سيرفر المنصة جاهز ويعمل.');
});

// 2. Start Cloudflare tunnel
console.log('2. جاري الاتصال وتوليد الرابط العام...');

const cf = spawn(cloudflaredPath, ['tunnel', '--url', 'http://localhost:3000']);

let foundUrl = false;

cf.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (match && !foundUrl) {
    foundUrl = true;
    const url = match[0];
    
    console.log('\n\x1b[32m======================================================\x1b[0m');
    console.log('\x1b[1m\x1b[32m🎉 تم إنشاء رابط المنصة بنجاح:\x1b[0m');
    console.log('\x1b[1m\x1b[36m🔗 ' + url + '\x1b[0m');
    console.log('\x1b[32m======================================================\x1b[0m\n');
    console.log('📋 تم نسخ الرابط تلقائياً إلى الحافظة (Clipboard)!');
    console.log('👉 يمكنك الآن الضغط على (Ctrl + V) في واتساب ولصقه فوراً للزملاء.\n');
    console.log('⚠️ هام جداً: اترك هذه النافذة مفتوحة (يمكنك تصغيرها Minimize) طالما الموقع شغال.\n');

    try {
      execSync(`powershell -command "Set-Clipboard -Value '${url}'"`);
      execSync(`start ${url}`);
    } catch (e) {}
  }
});

cf.on('close', (code) => {
  console.log(`توقف النفق مع كود: ${code}`);
});
