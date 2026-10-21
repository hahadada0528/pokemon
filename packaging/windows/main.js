const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 8080;

function resourceRoot() {
  const bundled = path.join(process.resourcesPath, "pokedex-data");
  if (fs.existsSync(path.join(bundled, "pokedex", "index.html"))) return bundled;
  return path.resolve(__dirname, "..", "..");
}

function pressesPath() {
  const dir = path.join(app.getPath("userData"), "save");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "key_presses.json");
}

function readPresses(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Number(data.presses) || 0;
  } catch {
    return 0;
  }
}

function writePresses(file, presses) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ presses }));
  fs.renameSync(tmp, file);
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function startServer(root, pressesFile) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/data/key_presses.json") {
      const body = fs.existsSync(pressesFile)
        ? fs.readFileSync(pressesFile)
        : Buffer.from('{"presses":0}');
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(body);
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/pokedex/index.html";
    const filePath = path.normalize(path.join(root, rel));
    if (!filePath.startsWith(path.normalize(root))) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function watchKeys(pressesFile) {
  let presses = readPresses(pressesFile);
  writePresses(pressesFile, presses);
  try {
    const { GlobalKeyboardListener } = require("node-global-key-listener");
    const listener = new GlobalKeyboardListener();
    listener.addListener((event) => {
      if (event.state !== "DOWN") return;
      presses += 1;
      writePresses(pressesFile, presses);
    });
  } catch (err) {
    console.error("key listener unavailable", err);
  }
}

app.whenReady().then(async () => {
  const root = resourceRoot();
  const pressesFile = pressesPath();
  await startServer(root, pressesFile);
  watchKeys(pressesFile);
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 860,
    minHeight: 640,
    title: "宝可梦图鉴",
    backgroundColor: "#0d1a14",
    autoHideMenuBar: true,
  });
  win.loadURL(`http://127.0.0.1:${PORT}/pokedex/`);
});

app.on("window-all-closed", () => {
  app.quit();
});
