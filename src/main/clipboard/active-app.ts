import { execFile, execFileSync } from 'child_process'

const UNKNOWN_APP = 'Unknown'

export interface PasteTargetContext {
  appName: string | null
  windowsProcessId: number | null
  windowsWindowHandle: string | null
}

function appIsPackaged(): boolean {
  return process.env.NODE_ENV === 'production'
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function runAppleScript(lines: string[], timeout = 400): string {
  try {
    const args = lines.flatMap((line) => ['-e', line])
    return execFileSync('osascript', args, { encoding: 'utf8', timeout }).trim()
  } catch {
    return ''
  }
}

function runPowerShell(script: string, timeout = 450): string {
  try {
    return execFileSync(
      'powershell',
      ['-Sta', '-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout }
    ).trim()
  } catch {
    return ''
  }
}

function getForegroundWindowContextWindows(): { processId: number | null; windowHandle: string | null } {
  if (process.platform !== 'win32') {
    return { processId: null, windowHandle: null }
  }

  const result = runPowerShell(
    `
Add-Type -Namespace Win32 -Name User32 -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr hWnd, out uint lpdwProcessId);
"@
$hWnd = [Win32.User32]::GetForegroundWindow()
if ($hWnd -eq [IntPtr]::Zero) { return }
$pid = 0
[void][Win32.User32]::GetWindowThreadProcessId($hWnd, [ref]$pid)
if ($pid -gt 0) { "$($hWnd.ToInt64())|$pid" }
`,
    420
  )

  const [windowHandleRaw, processIdRaw] = result.split('|')
  const processId = Number(processIdRaw)
  const windowHandle = typeof windowHandleRaw === 'string' && /^-?\d+$/.test(windowHandleRaw.trim())
    ? windowHandleRaw.trim()
    : null

  return {
    processId: Number.isInteger(processId) && processId > 0 ? processId : null,
    windowHandle
  }
}

export function getFrontmostAppName(): string {
  if (process.platform !== 'darwin') {
    return UNKNOWN_APP
  }

  const appName = runAppleScript(
    ['tell application "System Events" to return name of first application process whose frontmost is true'],
    400
  )

  return appName || UNKNOWN_APP
}

export function capturePasteTargetContext(): PasteTargetContext {
  if (process.platform === 'darwin') {
    return {
      appName: getFrontmostAppName(),
      windowsProcessId: null,
      windowsWindowHandle: null
    }
  }

  if (process.platform === 'win32') {
    const { processId, windowHandle } = getForegroundWindowContextWindows()
    if (!appIsPackaged()) {
      console.log('[ShearPlate] Captured Windows paste target', { processId, windowHandle })
    }
    return {
      appName: null,
      windowsProcessId: processId,
      windowsWindowHandle: windowHandle
    }
  }

  return {
    appName: null,
    windowsProcessId: null,
    windowsWindowHandle: null
  }
}

function buildWindowsPasteRelayScript(target: PasteTargetContext | null): string {
  const safePid = typeof target?.windowsProcessId === 'number' && target.windowsProcessId > 0
    ? target.windowsProcessId
    : 0
  const safeWindowHandle = target?.windowsWindowHandle && /^-?\d+$/.test(target.windowsWindowHandle)
    ? target.windowsWindowHandle
    : '0'

  return `
$targetPid = [int]${safePid}
$targetHwnd = [IntPtr]([Int64]${safeWindowHandle})

Add-Type -Namespace Win32 -Name User32 -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr hWnd, int nCmdShow);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool BringWindowToTop(System.IntPtr hWnd);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
"@

if ($targetHwnd -ne [IntPtr]::Zero -and [Win32.User32]::IsWindow($targetHwnd)) {
  [void][Win32.User32]::ShowWindowAsync($targetHwnd, 9)  # SW_RESTORE
  [void][Win32.User32]::SetForegroundWindow($targetHwnd)
  [void][Win32.User32]::BringWindowToTop($targetHwnd)
}

if ($targetPid -gt 0) {
  try {
    [void](New-Object -ComObject WScript.Shell).AppActivate([int]$targetPid)
  } catch {}
}

for ($i = 0; $i -lt 6; $i++) {
  if ($targetHwnd -eq [IntPtr]::Zero) { break }
  if ([Win32.User32]::GetForegroundWindow().ToInt64() -eq $targetHwnd.ToInt64()) { break }
  Start-Sleep -Milliseconds 12
}

Start-Sleep -Milliseconds 16

$KEYUP = 0x0002
[Win32.User32]::keybd_event(0x12, 0, $KEYUP, [UIntPtr]::Zero)  # Alt up
[Win32.User32]::keybd_event(0x11, 0, $KEYUP, [UIntPtr]::Zero)  # Ctrl up
[Win32.User32]::keybd_event(0x10, 0, $KEYUP, [UIntPtr]::Zero)  # Shift up

[Win32.User32]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)       # Ctrl down
[Win32.User32]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)       # V down
[Win32.User32]::keybd_event(0x56, 0, $KEYUP, [UIntPtr]::Zero)  # V up
[Win32.User32]::keybd_event(0x11, 0, $KEYUP, [UIntPtr]::Zero)  # Ctrl up
`
}

function execFileAsync(command: string, args: string[], timeout: number, label: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const details = [error.message, stderr?.trim(), stdout?.trim()].filter(Boolean).join(' | ')
        console.warn(`[ShearPlate] ${label} failed: ${details}`)
        resolve(false)
        return
      }

      resolve(true)
    })
  })
}

export async function pasteIntoPreviousTarget(target: PasteTargetContext | null): Promise<boolean> {
  if (process.platform === 'darwin') {
    const appName = target?.appName ?? null
    const resolvedAppName = appName && appName !== UNKNOWN_APP ? escapeAppleScriptString(appName) : null

    return execFileAsync(
      'osascript',
      resolvedAppName
        ? [
            '-e',
            `
            set targetAppName to "${resolvedAppName}"
            tell application "System Events"
              set currentFrontName to name of first application process whose frontmost is true
            end tell
            if currentFrontName is not targetAppName then tell application targetAppName to activate
            repeat 15 times
              tell application "System Events"
                set currentFrontName to name of first application process whose frontmost is true
              end tell
              if currentFrontName is targetAppName then exit repeat
              delay 0.04
            end repeat
            if currentFrontName is not targetAppName then error "Target app never became frontmost (" & currentFrontName & ")"
            tell application "System Events"
              key code 9 using command down
            end tell
            `
          ]
        : [
            '-e',
            `
            tell application "System Events"
              key code 9 using command down
            end tell
            `
          ],
      2200,
      'paste relay'
    )
  }

  if (process.platform === 'win32') {
    if (!appIsPackaged()) {
      console.log('[ShearPlate] Windows paste relay target', target)
    }
    return execFileAsync(
      'powershell',
      [
        '-Sta',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        buildWindowsPasteRelayScript(target)
      ],
      1600,
      'paste relay'
    )
  }

  return false
}
