import { execFile, execFileSync } from 'child_process'

const UNKNOWN_APP = 'Unknown'

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

export async function pasteIntoPreviousTarget(appName: string | null): Promise<boolean> {
  if (process.platform === 'darwin') {
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
    return execFileAsync(
      'powershell',
      [
        '-Sta',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 120; [System.Windows.Forms.SendKeys]::SendWait("^v")'
      ],
      1800,
      'paste relay'
    )
  }

  return false
}
