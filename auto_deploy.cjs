const { spawn } = require('child_process');

const PK = "APrivateKey1zkp3c9xLUipKgyRHmiMaDQRvuFBEikfJtV2rvK3RHK8K97C";
const ENDPOINT = "https://api.explorer.provable.com/v1";

const programs = [
    { dir: 'programs/autoperp_core', name: 'autoperp_core_v8.aleo' },
    { dir: 'programs/autoperp_core_private', name: 'autoperp_core_private_v8.aleo' },
];

let currentIndex = 0;

function deployNext() {
    if (currentIndex >= programs.length) {
        console.log('\n✅ All deployments complete!');
        return;
    }

    const prog = programs[currentIndex];
    console.log(`\n========================================`);
    console.log(`Deploying ${prog.name} from ${prog.dir}`);
    console.log(`========================================\n`);

    // Convert Windows path to WSL path
    const wslDir = prog.dir.replace(/\\/g, '/');

    const child = spawn('wsl', [
        'bash', '-lc',
        `cd ${wslDir} && ~/.cargo/bin/leo deploy --network testnet --endpoint ${ENDPOINT} --private-key ${PK} --broadcast`
    ], {
        cwd: 'G:\\AutoPerp\\AutoPerp',
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    let fullOutput = '';

    child.stdout.on('data', (data) => {
        const text = data.toString();
        fullOutput += text;
        process.stdout.write(text);

        // Auto-answer "yes" to any y/n prompts
        if (text.includes('(y/n)') || text.includes('proceed')) {
            setTimeout(() => {
                console.log('\n[AUTO-DEPLOY] >>> Sending "y"');
                child.stdin.write('y\n');
            }, 500);
        }
    });

    child.stderr.on('data', (data) => {
        const text = data.toString();
        fullOutput += text;
        process.stderr.write(text);

        if (text.includes('(y/n)') || text.includes('proceed')) {
            setTimeout(() => {
                console.log('\n[AUTO-DEPLOY] >>> Sending "y"');
                child.stdin.write('y\n');
            }, 500);
        }
    });

    child.on('close', (code) => {
        console.log(`\n[AUTO-DEPLOY] ${prog.name} exited with code ${code}`);
        if (code === 0) {
            console.log(`[AUTO-DEPLOY] ✅ ${prog.name} deployed successfully!`);
        } else {
            console.log(`[AUTO-DEPLOY] ❌ ${prog.name} deployment failed.`);
            console.log('[AUTO-DEPLOY] Full output length:', fullOutput.length);
        }
        currentIndex++;
        deployNext();
    });
}

deployNext();
