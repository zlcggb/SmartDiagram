import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Cpu, Search, Sparkles, X } from 'lucide-react'

interface Option {
  value: string
  group: string
}

const POPOVER_MAX_HEIGHT = 340
const POPOVER_MIN_HEIGHT = 220

function modelFamily(model: string): string {
  const head = model.split(/[-_/:.]/)[0]?.toLowerCase() || ''
  if (/^(gpt|o\d|codex|chatgpt)$/.test(head)) return 'OpenAI'
  if (head === 'gemini') return 'Gemini'
  if (head === 'claude') return 'Claude'
  if (head === 'deepseek') return 'DeepSeek'
  if (/^(qwen|qwq)$/.test(head)) return 'Qwen'
  if (head === 'kimi' || head === 'moonshot') return 'Kimi'
  return '其他'
}

// position: fixed is relative to the nearest transformed/filtered ancestor, not always the viewport.
function fixedOrigin(element: Element): { top: number; left: number; bottom: number } {
  for (let node: Element | null = element; node && node !== document.documentElement; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (
      style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none'
      || style.backdropFilter !== 'none' || /paint|layout|strict|content/.test(style.contain)
      || /transform|filter/.test(style.willChange)
    ) {
      const box = node.getBoundingClientRect()
      return { top: box.top, left: box.left, bottom: box.bottom }
    }
  }
  return { top: 0, left: 0, bottom: window.innerHeight }
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1
  if (index < 0) return <>{text}</>
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + query.length)}</mark>{text.slice(index + query.length)}</>
}

export function ModelSelect({
  value,
  onChange,
  models,
  defaultModel,
  label,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  models: string[]
  defaultModel: string
  label: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<{ left: number; width: number; maxHeight: number; top?: number; bottom?: number; target: Element } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const trimmed = query.trim()
  const options = useMemo<Option[]>(() => {
    const matched = models.filter((model) => !trimmed || model.toLowerCase().includes(trimmed.toLowerCase()))
    const grouped = matched.map((model) => ({ value: model, group: modelFamily(model) }))
    const order = [...new Set(grouped.map((item) => item.group))].sort((a, b) => (a === '其他' ? 1 : b === '其他' ? -1 : 0))
    const sorted = order.flatMap((group) => grouped.filter((item) => item.group === group))
    const head: Option[] = trimmed ? [] : [{ value: '', group: '' }]
    const custom: Option[] = trimmed && !models.includes(trimmed) ? [{ value: trimmed, group: '自定义' }] : []
    return [...head, ...custom, ...sorted]
  }, [models, trimmed])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const box = trigger.getBoundingClientRect()
      const below = window.innerHeight - box.bottom
      // Inside a modal <dialog> the popover must live in the dialog's top layer to stay visible.
      const target = trigger.closest('dialog') ?? trigger.closest('.recruit-shell') ?? document.body
      const origin = fixedOrigin(target)
      const left = box.left - origin.left
      const flip = below < POPOVER_MIN_HEIGHT + 16 && box.top > below
      const maxHeight = Math.min(POPOVER_MAX_HEIGHT, (flip ? box.top : below) - 16)
      setRect(flip
        ? { left, width: box.width, maxHeight, bottom: origin.bottom - box.top + 6, target }
        : { left, width: box.width, maxHeight, top: box.bottom + 6 - origin.top, target })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    searchRef.current?.focus()
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointer)
    return () => document.removeEventListener('pointerdown', handlePointer)
  }, [open])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  function toggle() {
    if (disabled) return
    if (!open) {
      setQuery('')
      const index = options.findIndex((option) => option.value === value)
      setActive(Math.max(0, index))
    }
    setOpen(!open)
  }

  function choose(next: string) {
    onChange(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(options.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = options[active]
      if (option) choose(option.value)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
  }

  return (
    <div className="rx-model-select">
      <span className="rx-model-select__label"><Cpu size={11} /> {label}</span>
      <div className="rx-model-select__control">
        <button
          ref={triggerRef}
          type="button"
          className={`rx-model-select__trigger${open ? ' is-open' : ''}`}
          onClick={toggle}
          onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); toggle() } }}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="rx-model-select__icon" aria-hidden="true"><Sparkles size={13} /></span>
          {value ? (
            <span className="rx-model-select__value">{value}</span>
          ) : (
            <span className="rx-model-select__value is-default">
              {defaultModel || '系统默认模型'}
              <em>默认</em>
            </span>
          )}
          <ChevronDown size={15} className="rx-model-select__chevron" />
        </button>
        {value && !disabled ? (
          <button type="button" className="rx-model-select__clear" aria-label="恢复默认模型" onClick={() => onChange('')}>
            <X size={12} />
          </button>
        ) : null}
      </div>
      {open && rect ? createPortal(
        <div
          ref={popoverRef}
          className={`rx-model-popover${rect.bottom !== undefined ? ' is-above' : ''}`}
          style={{ left: rect.left, width: Math.max(rect.width, 280), maxHeight: rect.maxHeight, top: rect.top, bottom: rect.bottom }}
          onKeyDown={handleKeyDown}
        >
          <label className="rx-model-popover__search">
            <Search size={14} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActive(0) }}
              placeholder="搜索或输入模型 ID"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd>{options.length - (trimmed ? 0 : 1)}</kbd>
          </label>
          <div ref={listRef} className="rx-model-popover__list" role="listbox">
            {options.map((option, index) => {
              const showGroup = option.group && option.group !== options[index - 1]?.group
              const selected = option.value === value
              return (
                <div key={`${option.group}:${option.value}`}>
                  {showGroup ? <p className="rx-model-popover__group">{option.group}</p> : null}
                  <button
                    type="button"
                    role="option"
                    data-index={index}
                    aria-selected={selected}
                    className={`rx-model-popover__option${index === active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}
                    onPointerEnter={() => setActive(index)}
                    onClick={() => choose(option.value)}
                  >
                    {option.value ? (
                      <span><Highlight text={option.value} query={trimmed} /></span>
                    ) : (
                      <span className="rx-model-popover__default">跟随默认 <em>{defaultModel || '系统默认'}</em></span>
                    )}
                    {option.group === '自定义' ? <small>使用此 ID</small> : null}
                    {selected ? <Check size={14} /> : null}
                  </button>
                </div>
              )
            })}
            {!options.length ? <p className="rx-model-popover__empty">没有匹配的模型</p> : null}
          </div>
        </div>,
        rect.target,
      ) : null}
    </div>
  )
}
