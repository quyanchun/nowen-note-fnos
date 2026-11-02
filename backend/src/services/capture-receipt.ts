import type Database from "better-sqlite3";

// Only in-process requests can install a receipt. HTTP headers cannot forge it.
const receipts = new WeakMap<Request, (db: Database.Database, noteId: string) => void>();
const imageReceipts = new WeakSet<Request>();
const validations = new WeakMap<Request,(db:Database.Database)=>void>();

export function registerCaptureReceipt(request: Request, commit: (db: Database.Database, noteId: string) => void, handlesInlineImages = false, validate?: (db:Database.Database)=>void): void {
  receipts.set(request, commit);
  if(validate)validations.set(request,validate);
  if(handlesInlineImages)imageReceipts.add(request);
}

export const captureHandlesInlineImages=(request:Request)=>imageReceipts.has(request);

export function commitCaptureReceipt(request: Request, db: Database.Database, noteId: string): void {
  receipts.get(request)?.(db, noteId);
}

export function validateCaptureReceipt(request:Request,db:Database.Database):void {validations.get(request)?.(db);}
