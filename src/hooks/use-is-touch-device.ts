import { useState, useEffect } from 'react'

function detectTouchDevice(): boolean {
  if (typeof window === 'undefined') return false

  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const noHover = window.matchMedia('(hover: none)').matches
  const maxTouchPoints = nav.maxTouchPoints > 0
  const mobileUAData = !!nav.userAgentData?.mobile
  const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)

  return coarsePointer || noHover || maxTouchPoints || mobileUAData || mobileUserAgent
}

export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(() => detectTouchDevice())

  useEffect(() => {
    const pointerQuery = window.matchMedia('(pointer: coarse)')
    const hoverQuery = window.matchMedia('(hover: none)')
    const updateTouchState = () => setIsTouch(detectTouchDevice())

    pointerQuery.addEventListener('change', updateTouchState)
    hoverQuery.addEventListener('change', updateTouchState)
    window.addEventListener('resize', updateTouchState)

    return () => {
      pointerQuery.removeEventListener('change', updateTouchState)
      hoverQuery.removeEventListener('change', updateTouchState)
      window.removeEventListener('resize', updateTouchState)
    }
  }, [])

  return isTouch
}
