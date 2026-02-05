import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@repo/core/ui/primitives/alert-dialog"

interface DeleteDocumentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  filename: string
  threadCount: number
  onKeepThreads: () => void
  onDeleteAll: () => void
}

export function DeleteDocumentDialog({
  open,
  onOpenChange,
  filename,
  threadCount,
  onKeepThreads,
  onDeleteAll,
}: DeleteDocumentDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{filename}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This document has {threadCount} chat{" "}
            {threadCount === 1 ? "thread" : "threads"}. What would you like to
            do with them?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="outline" onClick={onKeepThreads}>
            Keep threads
          </AlertDialogAction>
          <AlertDialogAction variant="destructive" onClick={onDeleteAll}>
            Delete all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
