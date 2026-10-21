const path = require('node:path')

// Pastas do usuário: XDG no Linux; no Windows, configurações em %APPDATA% e
// biblioteca e logs (grandes, só desta máquina) em %LOCALAPPDATA%.
function desktopPaths(env, platform, home) {
  if (platform === 'win32') {
    const roaming = env.APPDATA || path.win32.join(home, 'AppData', 'Roaming')
    const local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local')
    return {
      configDir: env.KOMA_CONFIG_DIR || path.win32.join(roaming, 'KOMA'),
      dataDir: env.KOMA_DATA_DIR || path.win32.join(local, 'KOMA', 'library'),
      logDir: path.win32.join(env.KOMA_STATE_DIR || path.win32.join(local, 'KOMA'), 'logs'),
    }
  }
  return {
    configDir: env.KOMA_CONFIG_DIR || path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'koma'),
    dataDir: env.KOMA_DATA_DIR || path.join(env.XDG_DATA_HOME || path.join(home, '.local/share'), 'koma', 'library'),
    logDir: path.join(env.KOMA_STATE_DIR || path.join(env.XDG_STATE_HOME || path.join(home, '.local/state'), 'koma'), 'logs'),
  }
}

function bundledNode(bundleRoot, platform) {
  return path.join(bundleRoot, 'runtime', platform === 'win32' ? 'node.exe' : 'node')
}

module.exports = { desktopPaths, bundledNode }
