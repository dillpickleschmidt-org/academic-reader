import { Effect } from "effect"
import * as mupdf from "mupdf"
import type { ConvexSession } from "../services/convex-client"
import type { StorageService } from "../services/storage"
import { documentLocation, originalFileKey } from "./document-storage"

export function extractDocumentPage(
  storage: StorageService,
  convex: ConvexSession,
  documentId: string,
  pageNum: number,
) {
  return Effect.gen(function* () {
    const doc = yield* Effect.tryPromise({
      try: () => convex.getDocument(documentId),
      catch: (e) => e as Error,
    })
    const pdf = yield* storage.readFile(originalFileKey(documentLocation(doc, documentId)))
    const srcDoc = mupdf.Document.openDocument(pdf, "application/pdf")
    try {
      const pageCount = srcDoc.countPages()
      if (pageNum >= pageCount) throw new Error("Page number out of range")
      const srcPdf = srcDoc.asPDF()
      if (!srcPdf) throw new Error("Not a valid PDF")
      const destDoc = new mupdf.PDFDocument()
      try {
        destDoc.graftPage(0, srcPdf, pageNum)
        return destDoc.saveToBuffer().asUint8Array()
      } finally {
        destDoc.destroy()
      }
    } finally {
      srcDoc.destroy()
    }
  })
}
