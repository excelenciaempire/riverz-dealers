"use client"

import Link from 'next/link'
import { UserPlus, MessageSquare, Radio, Zap, ArrowRight } from 'lucide-react'
import type { ComponentType } from 'react'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
}

const ACTIONS: Action[] = [
  { label: 'Abrir bandeja', href: '/bandeja', icon: MessageSquare },
  { label: 'Nuevo contacto', href: '/contactos', icon: UserPlus },
  { label: 'Nueva difusión', href: '/campanas/nueva', icon: Radio },
  { label: 'Nueva automatización', href: '/automatizaciones/nueva', icon: Zap },
]

export function QuickActions() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-foreground/30 hover:bg-accent"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
                <Icon className="h-4 w-4" />
              </div>
              <span className="truncate text-sm font-medium text-foreground">{a.label}</span>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        )
      })}
    </div>
  )
}
