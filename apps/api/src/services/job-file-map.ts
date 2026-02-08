import { Context, Effect, Layer, Ref, HashMap } from "effect"

export type WorkerType = "marker" | "lightonocr" | "chandra"

export interface JobFileEntry {
  fileId: string
  userId?: string
  documentPath: string
  workerType: WorkerType
  filename?: string
  mimeType?: string
  processingMode?: string
}

export interface JobFileMapService {
  set(jobId: string, entry: JobFileEntry): Effect.Effect<void>
  get(jobId: string): Effect.Effect<JobFileEntry | undefined>
  remove(jobId: string): Effect.Effect<void>
}

export class JobFileMap extends Context.Tag("JobFileMap")<JobFileMap, JobFileMapService>() {
  static Live = Layer.effect(
    JobFileMap,
    Effect.gen(function* () {
      const ref = yield* Ref.make(HashMap.empty<string, JobFileEntry>())

      return {
        set: (jobId, entry) => Ref.update(ref, HashMap.set(jobId, entry)),
        get: (jobId) => Effect.map(Ref.get(ref), (map) => HashMap.get(map, jobId).pipe(
          (opt) => opt._tag === "Some" ? opt.value : undefined
        )),
        remove: (jobId) => Ref.update(ref, HashMap.remove(jobId)),
      }
    }),
  )
}

export function prefixJobId(rawId: string, worker: WorkerType): string {
  return `${worker}:${rawId}`
}

export function parseJobId(jobId: string): { worker: WorkerType, rawId: string } {
  if (jobId.startsWith("chandra:")) return { worker: "chandra", rawId: jobId.slice(8) }
  if (jobId.startsWith("lightonocr:")) return { worker: "lightonocr", rawId: jobId.slice(11) }
  if (jobId.startsWith("marker:")) return { worker: "marker", rawId: jobId.slice(7) }
  return { worker: "marker", rawId: jobId }
}

export function getWorkerFromProcessingMode(processingMode?: string): WorkerType {
  if (processingMode === "aggressive") return "chandra"
  if (processingMode === "balanced") return "lightonocr"
  return "marker"
}
