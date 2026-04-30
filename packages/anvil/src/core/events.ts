import type * as http from 'node:http';

export type NoteEventType = 'note_created' | 'note_updated' | 'note_deleted';

export interface NoteEvent {
  type: NoteEventType;
  noteId: string;
  modifiedAt: string;
}

const clients = new Set<http.ServerResponse>();

export function addSseClient(res: http.ServerResponse): void {
  clients.add(res);
}

export function removeSseClient(res: http.ServerResponse): void {
  clients.delete(res);
}

export function broadcast(event: NoteEvent): void {
  if (clients.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}
