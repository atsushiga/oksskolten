import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useIsTouchDevice } from './use-is-touch-device'

describe('useIsTouchDevice', () => {
  let mediaQueryListeners: Record<string, Array<(e: { matches: boolean }) => void>>
  let mediaQueryMatches: Record<string, boolean>
  let resizeListeners: Array<() => void>

  beforeEach(() => {
    mediaQueryListeners = {}
    mediaQueryMatches = {
      '(pointer: coarse)': false,
      '(hover: none)': false,
    }
    resizeListeners = []

    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      value: 0,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36',
      writable: true,
      configurable: true,
    })
    Object.defineProperty(window.navigator, 'userAgentData', {
      value: { mobile: false },
      writable: true,
      configurable: true,
    })

    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: mediaQueryMatches[query] ?? false,
      media: query,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        mediaQueryListeners[query] ??= []
        mediaQueryListeners[query]!.push(cb)
      },
      removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        mediaQueryListeners[query] = (mediaQueryListeners[query] ?? []).filter(l => l !== cb)
      },
    })))
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'resize') resizeListeners.push(listener as () => void)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener) => {
      if (type === 'resize') {
        resizeListeners = resizeListeners.filter(l => l !== listener)
      }
    })
  })

  it('returns false on non-touch device', () => {
    const { result } = renderHook(() => useIsTouchDevice())
    expect(result.current).toBe(false)
  })

  it('returns true on touch device', () => {
    mediaQueryMatches['(pointer: coarse)'] = true
    const { result } = renderHook(() => useIsTouchDevice())
    expect(result.current).toBe(true)
  })

  it('updates when pointer media query changes', () => {
    const { result } = renderHook(() => useIsTouchDevice())
    expect(result.current).toBe(false)

    act(() => {
      mediaQueryMatches['(pointer: coarse)'] = true
      ;(mediaQueryListeners['(pointer: coarse)'] ?? []).forEach(cb => cb({ matches: true }))
    })
    expect(result.current).toBe(true)
  })

  it('treats maxTouchPoints as touch support', () => {
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      value: 5,
      writable: true,
      configurable: true,
    })

    const { result } = renderHook(() => useIsTouchDevice())
    expect(result.current).toBe(true)
  })

  it('treats mobile user agent as touch support', () => {
    Object.defineProperty(window.navigator, 'userAgentData', {
      value: { mobile: true },
      writable: true,
      configurable: true,
    })

    const { result } = renderHook(() => useIsTouchDevice())
    expect(result.current).toBe(true)
  })

  it('recomputes on resize for device emulation changes', () => {
    const { result } = renderHook(() => useIsTouchDevice())
    expect(result.current).toBe(false)

    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      value: 5,
      writable: true,
      configurable: true,
    })

    act(() => {
      resizeListeners.forEach(listener => listener())
    })

    expect(result.current).toBe(true)
  })

  it('cleans up listener on unmount', () => {
    const { unmount } = renderHook(() => useIsTouchDevice())
    expect(mediaQueryListeners['(pointer: coarse)']).toHaveLength(1)
    expect(mediaQueryListeners['(hover: none)']).toHaveLength(1)
    expect(resizeListeners).toHaveLength(1)
    unmount()
    expect(mediaQueryListeners['(pointer: coarse)']).toHaveLength(0)
    expect(mediaQueryListeners['(hover: none)']).toHaveLength(0)
    expect(resizeListeners).toHaveLength(0)
  })
})
