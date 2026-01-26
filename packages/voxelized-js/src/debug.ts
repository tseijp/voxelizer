import type { WorkerMode } from './scene'

export type DebugTaskPhase = 'start' | 'done' | 'abort'

type TaskDebugEvent = {
        type: 'task'
        phase: DebugTaskPhase
        mode: WorkerMode
        i: number
        j: number
        ticket: number
        ts: number
}

type ViewDebugEvent = {
        type: 'view'
        ts: number
        anchor: [number, number]
        visible: number[][]
        prebuild: number[][]
        prefetch: number[][]
        slots: { i: number; j: number; slot: number; ready: boolean }[]
}

type CacheDebugEvent = {
        type: 'cache'
        action: 'set' | 'release' | 'ready'
        i: number
        j: number
        slot: number
        ts: number
}

export type DebugEvent = TaskDebugEvent | ViewDebugEvent | CacheDebugEvent

const listeners = new Set<(event: DebugEvent) => void>()

export const onDebug = (handler: (event: DebugEvent) => void) => {
        listeners.add(handler)
        return () => void listeners.delete(handler)
}

export const debugEnabled = () => listeners.size > 0

export const emitDebug = (event: DebugEvent) => {
        listeners.forEach((fn) => fn(event))
}
