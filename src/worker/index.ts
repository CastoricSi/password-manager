import { Hono } from "hono";

import * as google from "./googleAuth";
import * as shares from "./shares";

// The app itself is fully client-side (served from `assets`). The Worker only
// brokers Google sign-in for sync and keeps small "shared with you" notices;
// book contents never pass through it.
const app = new Hono<{ Bindings: Env & google.AuthEnv }>();

app.get("/api/sync/config", google.config);
app.get("/api/auth/google/start", google.start);
app.get("/api/auth/google/callback", google.callback);
app.post("/api/auth/google/token", google.token);
app.post("/api/auth/google/disconnect", google.disconnect);

app.get("/api/shares", shares.list);
app.post("/api/shares", shares.create);
app.delete("/api/shares/:fileId", shares.remove);

app.all("/api/*", (c) => c.notFound());

export default app;
