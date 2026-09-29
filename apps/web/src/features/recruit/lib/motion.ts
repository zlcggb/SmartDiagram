import { useLayoutEffect, type RefObject } from 'react'
import gsap from 'gsap'

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Orchestrated entrance for a routed page: title glyphs, then every [data-recruit-reveal] block. */
export function usePageMotion(scopeRef: RefObject<HTMLElement | null>, routeKey: string) {
  useLayoutEffect(() => {
    const scope = scopeRef.current
    if (!scope || prefersReducedMotion()) return
    const context = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: 'power3.out' } })
      const chars = gsap.utils.toArray<HTMLElement>('.rx-char', scope)
      if (chars.length) {
        timeline.fromTo(
          chars,
          { yPercent: 110, autoAlpha: 0 },
          { yPercent: 0, autoAlpha: 1, duration: 0.7, stagger: 0.028 },
        )
      }
      const fades = gsap.utils.toArray<HTMLElement>('.rx-header-fade', scope)
      if (fades.length) {
        timeline.fromTo(
          fades,
          { y: 10, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.5, stagger: 0.06 },
          chars.length ? '-=0.45' : 0,
        )
      }
      const blocks = gsap.utils.toArray<HTMLElement>('[data-recruit-reveal]', scope)
        .filter((element) => !element.classList.contains('recruit-page__header'))
      if (blocks.length) {
        timeline.fromTo(
          blocks,
          { y: 26, autoAlpha: 0, scale: 0.985 },
          { y: 0, autoAlpha: 1, scale: 1, duration: 0.75, stagger: 0.07, clearProps: 'transform' },
          '-=0.35',
        )
      }
    }, scope)
    return () => context.revert()
  }, [scopeRef, routeKey])
}
