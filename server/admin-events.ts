import type { Request, Response } from "express";
import { sql } from "./db";

const streams = new Set<Response>();

export async function startAdminEvents() {
  const refresh = () => {
    for (const response of streams) {
      if (!response.write("event: change\ndata: {}\n\n")) response.end();
    }
  };
  // LISTEN also catches committed changes from other API processes.
  await sql.listen("admin_changes", refresh, refresh);
}

export function streamAdminEvents(_request: Request, response: Response) {
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();
  streams.add(response);
  response.write("retry: 1000\nevent: change\ndata: {}\n\n");
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
  // Reconnecting checks session expiry and revocation through requireAdmin.
  const expiry = setTimeout(() => response.end(), 60_000);
  response.on("close", () => {
    streams.delete(response);
    clearInterval(heartbeat);
    clearTimeout(expiry);
  });
}

export function closeAdminEvents() {
  for (const response of streams) response.end();
}
