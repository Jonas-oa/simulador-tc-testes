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
    // Abre ocupando todo o monitor: sem barra de abas/endereço do navegador,
    // sem menu nativo e sem a barra de tarefas do Windows sobre a simulação.
    fullscreen: true,
    minWidth: 900,
    minHeight: 600,
    title: "Simulador TC Educacional",
    backgroundColor: "#0a0e14",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Sem preload — o app e puro frontend
    },
    // Sem menu nativo (mais parecido com app dedicado).
    autoHideMenuBar: true,
  });

  win.setMenuBarVisibility(false);
  win.loadURL("simulador://app/index.html");

  // F11 alterna a tela cheia e Esc permite sair dela, caso seja necessário
  // acessar outra janela sem encerrar o simulador.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === "Escape" && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
    }
  });

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
