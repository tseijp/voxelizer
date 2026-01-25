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
        const _finally = (isHigh = true) => {
                if (isHigh) _high--
                else _low--
                _pump()
        }
        const _launch = (task: QueueTask, isHigh = false) => {
                task.started = true
                task.isHigh = isHigh
                if (isHigh) _high++
                else _low++
                task.start().then((x) => task.resolve(x)).catch(() => task.resolve(undefined as T)).finally(() => _finally(isHigh))
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
        const schedule = <T>(start: () => Promise<T>, priority = 0) => {
                let resolve = (_: T) => {}
                const promise = new Promise<T>((r) => (resolve = r))
                const task = { start, resolve, priority, started: false, isHigh: priority > 0 } as QueueTask<T>
                ;(task.isHigh ? high : low).add(task)
                _pump()
                return { promise, task }
        }
        const bump = <T>(task?: QueueTask<T>, priority = 0) => {
                if (!task || task.priority >= priority) return
                const isHigh = priority > 0
                task.priority = priority
                if (task.started) {
                        if (!task.isHigh && isHigh) {
                                task.isHigh = true
                                _low = Math.max(0, _low - 1)
                                _high++
                                _pump()
                        }
                        return
                }
                if (task.isHigh !== isHigh) {
                        _bucket(task, isHigh ? high : low)
                        task.isHigh = isHigh
                }
                _pump()
        }
        return { schedule, bump }
}

export type Queue = ReturnType<typeof createQueue>
export type Queues = ReturnType<typeof createQueues>
export type QueueTask<T = unknown> = {
        start: () => Promise<T>
        resolve: (data: T) => void
        priority: number
        started: boolean
        isHigh: boolean
}
