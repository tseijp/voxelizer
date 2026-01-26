const createTask = <T>(resolve: (_: T) => void, start: (signal: AbortSignal) => Promise<T>, priority = 0, tag = '') => {
        return { start, resolve, priority, started: false, isHigh: priority > 0, ctrl: new AbortController(), tag, done: false } as QueueTask
}

const createQueue = () => {
        const items = [] as QueueTask[]
        const sort = () => void items.sort((a, b) => b.priority - a.priority)
        const add = (task: QueueTask) => items.push(task)
        const shift = () => items.shift()
        const remove = (task: QueueTask) => {
                const index = items.indexOf(task)
                if (index >= 0) items.splice(index, 1)
        }
        return { add, shift, sort, remove, size: () => items.length }
}

export const createQueues = (limit = 4, lowLimit = 1) => {
        let _high = 0
        let _low = 0
        const high = createQueue()
        const low = createQueue()
        const _finish = (task: QueueTask) => {
                if (task.done) return
                task.done = true
                if (task.isHigh) _high = Math.max(0, _high - 1)
                else _low = Math.max(0, _low - 1)
                _pump()
        }
        const _launch = (task: QueueTask, isHigh = false) => {
                task.started = true
                task.isHigh = isHigh
                if (isHigh) _high++
                else _low++
                task.start(task.ctrl.signal)
                        .then((x) => {
                                if (task.done) return
                                task.resolve(x)
                        })
                        .catch(() => {
                                if (task.done) return
                                task.resolve(undefined as unknown as QueueValue)
                        })
                        .finally(() => _finish(task))
        }
        const _pump = () => {
                const tick = () => {
                        high.sort()
                        low.sort()
                        if (_high + _low >= limit) return
                        if (high.size() > 0) {
                                const task = high.shift() as QueueTask
                                _launch(task, true)
                                return tick()
                        }
                        if (low.size() <= 0 || _low >= lowLimit) return
                        _launch(low.shift() as QueueTask, false)
                        return tick()
                }
                tick()
        }
        const _bucket = (task: QueueTask, target: Queue) => {
                ;(task.isHigh ? high : low).remove(task)
                target.add(task)
        }
        const schedule = <T>(start: (signal: AbortSignal) => Promise<T>, priority = 0, tag = '') => {
                let resolve = (_: T) => {}
                const promise = new Promise<T>((r) => (resolve = r))
                const task = createTask(resolve, start, priority, tag)
                ;(task.isHigh ? high : low).add(task)
                _pump()
                return { promise, task }
        }
        const tune = (task?: QueueTask, priority = 0) => {
                if (!task || task.priority === priority) return
                const nextHigh = priority > 0
                const prevHigh = task.isHigh
                task.priority = priority
                if (task.started) {
                        if (prevHigh && !nextHigh) {
                                task.isHigh = false
                                _high = Math.max(0, _high - 1)
                                _low++
                        }
                        if (!prevHigh && nextHigh) {
                                task.isHigh = true
                                _low = Math.max(0, _low - 1)
                                _high++
                        }
                        _pump()
                        return
                }
                if (prevHigh !== nextHigh) {
                        _bucket(task, nextHigh ? high : low)
                        task.isHigh = nextHigh
                }
                _pump()
        }
        const abort = (task?: QueueTask) => {
                if (!task || task.done) return
                if (task.started) {
                        task.ctrl.abort()
                        task.resolve(undefined as unknown as QueueValue)
                        _finish(task)
                        return
                }
                ;(task.isHigh ? high : low).remove(task)
                task.done = true
                task.resolve(undefined as unknown as QueueValue)
                _pump()
        }
        return { schedule, tune, abort }
}

export type Queue = ReturnType<typeof createQueue>
export type Queues = ReturnType<typeof createQueues>
type QueueValue = unknown
export type QueueTask<T = QueueValue> = {
        start: (signal: AbortSignal) => Promise<T>
        resolve: (data: T) => void
        priority: number
        started: boolean
        isHigh: boolean
        ctrl: AbortController
        tag: string
        done: boolean
}
