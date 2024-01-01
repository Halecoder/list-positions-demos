import { TimestampMark } from "list-formatting";
import { List } from "list-positions";
import { WebSocket, WebSocketServer } from "ws";
import { Message } from "../common/messages";

const heartbeatInterval = 30000;

export class RichTextServer {
  // To easily save and send the state to new clients, store the
  // text in a List.
  private readonly list: List<string>;
  // We don't need to inspect the formatting, so just store the marks directly.
  private readonly marks: TimestampMark[];

  private clients = new Set<WebSocket>();

  constructor(readonly wss: WebSocketServer) {
    this.list = new List();
    this.marks = [];

    this.wss.on("connection", (ws) => {
      ws.on("open", () => this.wsOpen(ws));
      ws.on("message", (data) => this.wsReceive(ws, data.toString()));
      ws.on("close", () => this.wsClose(ws));
      ws.on("error", (err) => {
        console.error(err);
        this.wsClose(ws);
      });
    });
  }

  private sendMessage(ws: WebSocket, msg: Message) {
    if (ws.readyState == WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private echo(origin: WebSocket, data: string) {
    for (const ws of this.clients) {
      if (ws === origin) continue;
      if (ws.readyState == WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  private wsOpen(ws: WebSocket) {
    this.startHeartbeats(ws);

    // Send the current state.
    this.sendMessage(ws, {
      type: "welcome",
      order: this.list.order.save(),
      list: this.list.save(),
      marks: this.marks,
    });

    this.clients.add(ws);
  }

  /**
   * Ping to keep connection alive.
   *
   * This is necessary on at least Heroku, which has a 55 second timeout:
   * https://devcenter.heroku.com/articles/websockets#timeouts
   */
  private startHeartbeats(ws: WebSocket) {
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else clearInterval(interval);
    }, heartbeatInterval);
  }

  private wsReceive(ws: WebSocket, data: string) {
    const msg = JSON.parse(data) as Message;
    switch (msg.type) {
      case "set":
        if (msg.meta) {
          this.list.order.receive([msg.meta]);
        }
        this.list.set(msg.startPos, ...msg.chars);
        this.echo(ws, data);
        break;
      case "delete":
        this.list.delete(msg.pos);
        this.echo(ws, data);
        break;
      case "mark":
        this.marks.push(msg.mark);
        this.echo(ws, data);
        break;
      default:
        throw new Error("Unknown message type: " + msg.type);
    }
  }

  private wsClose(ws: WebSocket) {
    this.clients.delete(ws);
  }
}