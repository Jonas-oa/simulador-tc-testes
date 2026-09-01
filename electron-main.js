/**
 * electron-main.js
 * Processo principal do Electron para o Simulador TC Educacional.
 *
 * Abre o index.html diretamente como arquivo local usando o protocolo
 * personalizado "simulador://", que contorna as restricoes CORS/fetch
 * do protocolo file:// sem precisar de servidor HTTP externo.
 */
const { app, BrowserWindow, protocol, net } = require("electron");
const path = require("path");
const fs   = require("fs");

// Registra um protocolo personalizado que serve os arquivos do projeto
// como se fossem HTTP, permitindo que fetch() e Three.js funcionem
// sem as restricoes do protocolo file://.
const ROOT = __dirname;

function registerSimuladorProtocol() {
  protocol.handle("simulador", (request) => {
    const url = new URL(request.url);
    // Remove o "host" ficticio (simulador://app/caminho -> /caminho)
    let rel = url.pathname.replace(/^\/app/, "");
    if (!rel || rel === "/") rel = "/index.html";
    const filePath = path.join(ROOT, rel);
    return net.fetch("file://" + filePath);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: "Simulador TC Educacional",
    backgroundColor: "#0a0e14",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Sem preload — o app e puro frontend
    },
    // Sem menu nativo (mais parecido com app dedicado)
    autoHideMenuBar: true,
  });

  win.loadURL("simulador://app/index.html");

  // Em desenvolvimento, abre as DevTools automaticamente:
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  registerSimuladorProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});