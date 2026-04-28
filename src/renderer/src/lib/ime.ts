const IME_CONFIRM_GRACE_MS = 120

let imeCompositionActive = false
let lastImeCompositionEndAt = 0

export function startImeComposition() {
  imeCompositionActive = true
}

export function finishImeComposition() {
  imeCompositionActive = false
  lastImeCompositionEndAt = Date.now()
}

export function cancelImeComposition() {
  imeCompositionActive = false
}

export function shouldDeferHotkeysToIme(event: KeyboardEvent) {
  if (event.isComposing || event.key === 'Process' || event.keyCode === 229) {
    return true
  }

  if (imeCompositionActive) {
    return true
  }

  return event.key === 'Enter' && Date.now() - lastImeCompositionEndAt < IME_CONFIRM_GRACE_MS
}
