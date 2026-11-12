import { app, BrowserWindow, session } from "electron"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// This variable will be set by vite-plugin-electron
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"]

function createWindow() {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 1440,
    height: 1080,
    webPreferences: {
      // If you're using a preload script, specify it here
      // preload: path.join(__dirname, 'preload.js'),
    },
  })

  session.defaultSession.on("will-download", (event, item, webContents) => {
    // Get the filename from the <a> link's 'download' attribute
    const fileName = item.getFilename()

    // Get the user's "Downloads" folder path
    const downloadsPath = app.getPath("downloads")

    // Construct the full save path
    const savePath = path.join(downloadsPath, fileName)

    // Tell Electron to save the file to this path
    // This stops the "Save As" dialog from appearing
    item.setSavePath(savePath)

    // (Optional but recommended) Log the download status
    item.on("done", (e, state) => {
      if (state === "completed") {
        console.log(`Download completed: ${savePath}`)
        // You could even send a message back to your Vue app
        // webContents.send('download-complete', savePath);
      } else {
        console.error(`Download failed: ${state}`)
      }
    })
  })

  if (VITE_DEV_SERVER_URL) {
    // 1. Development: Load the Vite dev server URL
    win.loadURL(VITE_DEV_SERVER_URL)
    // Optional: Open dev tools
    win.webContents.openDevTools()
  } else {
    // 2. Production: Load the index.html file
    win.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // We only want to apply this CSP in production
    if (app.isPackaged) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          // This is a strong, browser-like CSP
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://cdn.jsdelivr.net;",
          ],
        },
      })
    } else {
      // In development, we don't apply any CSP.
      // Vite's dev server will work as expected.
      callback({ responseHeaders: details.responseHeaders })
    }
  })

  createWindow()
})

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
