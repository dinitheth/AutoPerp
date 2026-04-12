const { spawn } = require('child_process');

const PK = "APrivateKey1zkp3c9xLUipKgyRHmiMaDQRvuFBEikfJtV2rvK3RHK8K97C";

function deployProgram(path, name) {
    return new Promise((resolve, reject) => {
        console.log(`Starting deployment for ${name} at ${path}`);
        const cp = spawn('wsl', [
            '~/.cargo/bin/leo',
            'deploy',
            '--network', 'testnet',
            '--endpoint', 'https://api.explorer.provable.com/v1',
            '--private-key', PK,
            '--broadcast'
        ], {
            cwd: path,
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        cp.stdout.on('data', data => {
            const output = data.toString();
            process.stdout.write(output);
            if (output.toLowerCase().includes('proceed')) {
                console.log('\n[Auto-Deployer] Detected prompt. Automatically sending "y"');
                cp.stdin.write('y\n');
            }
        });

        cp.stderr.on('data', data => {
            process.stderr.write(data.toString());
        });

        cp.on('close', code => {
            if (code === 0) {
                console.log(`[Auto-Deployer] Deployment for ${name} completed successfully.`);
                resolve();
            } else {
                console.error(`[Auto-Deployer] Deployment for ${name} failed with code ${code}`);
                reject(new Error(`Deployment failed with code ${code}`));
            }
        });
    });
}

async function run() {
    try {
        await deployProgram('programs/autoperp_core', 'autoperp_core_v8.aleo');
        await deployProgram('programs/autoperp_core_private', 'autoperp_core_private_v8.aleo');
        console.log("All deployments finished successfully.");
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

run();
