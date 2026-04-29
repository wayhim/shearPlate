import { execFile, execFileSync } from 'child_process'
import { dialog, shell, systemPreferences } from 'electron'

const UNKNOWN_APP = 'Unknown'
let hasShownMacPastePermissionDialog = false

export interface PasteTargetContext {
  appName: string | null
  macProcessId: number | null
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

function getForegroundAppContextMac(): { appName: string | null; processId: number | null } {
  if (process.platform !== 'darwin') {
    return { appName: null, processId: null }
  }

  const result = runAppleScript(
    ['tell application "System Events" to tell first application process whose frontmost is true to return {name, unix id}'],
    400
  )

  const [appNameRaw, processIdRaw] = result.split(',')
  const appName = appNameRaw?.trim() || null
  const processId = Number(processIdRaw?.trim())

  return {
    appName,
    processId: Number.isInteger(processId) && processId > 0 ? processId : null
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

  const { appName } = getForegroundAppContextMac()

  return appName || UNKNOWN_APP
}

export function capturePasteTargetContext(): PasteTargetContext {
  if (process.platform === 'darwin') {
    const { appName, processId } = getForegroundAppContextMac()
    return {
      appName,
      macProcessId: processId,
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
      macProcessId: null,
      windowsProcessId: processId,
      windowsWindowHandle: windowHandle
    }
  }

  return {
    appName: null,
    macProcessId: null,
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

function openMacPrivacySettings(section: 'Accessibility' | 'Automation'): void {
  void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${section}`)
}

function promptForMacPastePermissions(errorDetails: string): void {
  if (process.platform !== 'darwin' || hasShownMacPastePermissionDialog) {
    return
  }

  hasShownMacPastePermissionDialog = true
  systemPreferences.isTrustedAccessibilityClient(true)

  void dialog.showMessageBox({
    type: 'warning',
    buttons: ['打开辅助功能设置', '打开自动化设置', '稍后处理'],
    defaultId: 0,
    cancelId: 2,
    title: 'ShearPlate 需要 macOS 权限',
    message: '自动粘贴到当前输入区域需要额外系统权限。',
    detail: [
      '请在“系统设置 -> 隐私与安全性”中允许 ShearPlate 发送按键。',
      '如果系统还提示自动化，也需要允许 ShearPlate 控制 “System Events” 和目标应用。',
      '',
      `最近一次系统错误：${errorDetails}`
    ].join('\n')
  }).then(({ response }) => {
    if (response === 0) {
      openMacPrivacySettings('Accessibility')
      return
    }

    if (response === 1) {
      openMacPrivacySettings('Automation')
    }
  })
}

function ensureMacPastePermissions(): boolean {
  if (process.platform !== 'darwin') {
    return true
  }

  const trusted = systemPreferences.isTrustedAccessibilityClient(false)
  if (trusted) {
    return true
  }

  promptForMacPastePermissions('当前应用尚未获得“辅助功能”权限。')
  return false
}

function execFileAsync(command: string, args: string[], timeout: number, label: string): Promise<{ ok: boolean; details: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const details = [error.message, stderr?.trim(), stdout?.trim()].filter(Boolean).join(' | ')
        console.warn(`[ShearPlate] ${label} failed: ${details}`)
        resolve({ ok: false, details })
        return
      }

      resolve({ ok: true, details: '' })
    })
  })
}

export async function pasteIntoPreviousTarget(target: PasteTargetContext | null): Promise<boolean> {
  if (process.platform === 'darwin') {
    if (!ensureMacPastePermissions()) {
      return false
    }

    const appName = target?.appName ?? null
    const targetPid = typeof target?.macProcessId === 'number' && target.macProcessId > 0 ? target.macProcessId : 0
    const resolvedAppName = appName && appName !== UNKNOWN_APP ? escapeAppleScriptString(appName) : ''

    const result = await execFileAsync(
      'osascript',
      targetPid > 0 || resolvedAppName
        ? [
            '-e',
            `
            set targetPid to ${targetPid}
            set targetActivated to false
            set targetAppName to "${resolvedAppName}"
            tell application "System Events"
              if targetPid > 0 and exists (first application process whose unix id is targetPid) then
                set frontmost of first application process whose unix id is targetPid to true
              else if targetAppName is not "" then
                tell application targetAppName to activate
              end if
            end tell
            repeat 20 times
              tell application "System Events"
                if targetPid > 0 and exists (first application process whose unix id is targetPid) then
                  set targetActivated to frontmost of first application process whose unix id is targetPid
                else if targetAppName is not "" then
                  set targetActivated to name of first application process whose frontmost is true is targetAppName
                else
                  set targetActivated to true
                end if
              end tell
              if targetActivated then exit repeat
              delay 0.03
            end repeat
            if not targetActivated then error "Target app never became frontmost"
            delay 0.05
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

    if (!result.ok && /\(1002\)|not allowed|不允许发送按键/i.test(result.details)) {
      promptForMacPastePermissions(result.details)
    }

    return result.ok
  }

  if (process.platform === 'win32') {
    if (!appIsPackaged()) {
      console.log('[ShearPlate] Windows paste relay target', target)
    }
    const result = await execFileAsync(
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
    return result.ok
  }

  return false
}
