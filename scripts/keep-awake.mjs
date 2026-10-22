import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Scoped to the tunnel process: keep Windows awake, but allow the display to sleep
// and keep the normal lock screen. No power-plan or firewall settings are changed.
export async function keepAwakeFor(pid) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid)) return null;
  const script = `
$target = [System.Diagnostics.Process]::GetProcessById(${pid})
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class RoxyStudioPower { [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint value); }'
try {
  $result = [RoxyStudioPower]::SetThreadExecutionState([uint32]2147483649)
  if ($result -eq 0) { exit 1 }
  $target.WaitForExit()
} finally { [void][RoxyStudioPower]::SetThreadExecutionState([uint32]2147483648) }
`;
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const stdout = fileURLToPath(new URL('../.data/remote/keep-awake.stdout.log', import.meta.url));
  const stderr = fileURLToPath(new URL('../.data/remote/keep-awake.stderr.log', import.meta.url));
  const pidPath = fileURLToPath(new URL('../.data/remote/keep-awake.pid', import.meta.url));
  const launcher = `$helper = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${Buffer.from(script, 'utf16le').toString('base64')}' -WindowStyle Hidden -RedirectStandardOutput ${quote(stdout)} -RedirectStandardError ${quote(stderr)} -PassThru; [System.IO.File]::WriteAllText(${quote(pidPath)}, [string]$helper.Id)`;
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(launcher, 'utf16le').toString('base64')
    ],
    { windowsHide: true, stdio: 'ignore' }
  );
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Windows wake launcher failed.'))
    );
  });
  const helperPid = Number((await readFile(pidPath, 'utf8')).trim());
  if (!Number.isSafeInteger(helperPid) || helperPid < 1)
    throw new Error('Windows wake helper did not start.');
  return helperPid;
}
