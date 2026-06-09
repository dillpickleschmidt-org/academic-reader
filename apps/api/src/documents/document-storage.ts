import type { Doc } from "@academic-reader/convex/convex/_generated/dataModel"

export interface DocumentLocation {
  userId: string
  documentId: string
}

export function tempDocumentPrefix(fileId: string) {
  return `temp_documents/${fileId}`
}

export function tempOriginalFileKey(fileId: string) {
  return `${tempDocumentPrefix(fileId)}/original.pdf`
}

export function documentLocation(
  doc: Pick<Doc<"documents">, "userId">,
  documentId: string,
): DocumentLocation {
  return { userId: doc.userId, documentId }
}

export function documentPrefix(location: DocumentLocation) {
  return `documents/${location.userId}/${location.documentId}`
}

export function originalFileKey(location: DocumentLocation) {
  return `${documentPrefix(location)}/original.pdf`
}

export function resultJsonKey(location: DocumentLocation) {
  return `${documentPrefix(location)}/result.json`
}

export function contentHtmlKey(location: DocumentLocation) {
  return `${documentPrefix(location)}/content.html`
}

export function contentMarkdownKey(location: DocumentLocation) {
  return `${documentPrefix(location)}/content.md`
}

export function imageKey(location: DocumentLocation, filename: string) {
  return `${documentPrefix(location)}/images/${filename}`
}

export function imageUrl(documentId: string, filename: string) {
  return `/api/assets/documents/${encodeURIComponent(documentId)}/images/${encodeURIComponent(filename)}`
}

export function audioUrl(documentId: string, blockId: string, voiceId: string) {
  return `/api/assets/documents/${encodeURIComponent(documentId)}/audio?${new URLSearchParams({ blockId, voiceId })}`
}
