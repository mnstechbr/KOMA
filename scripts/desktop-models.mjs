import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

// Pesos LFS precisam ser reais e corresponder ao baseline, não apenas existir.
// Modelos adicionados depois do baseline têm hash fixado aqui.
const pinnedModels = {
  'paddleocr_v5_korean_rec.onnx': '322f140154c820fcb83c3d24cfe42c9ec70dd1a1834163306a7338136e4f1eaa',
  'paddleocr_v5_korean_dict.txt': 'a88071c68c01707489baa79ebe0405b7beb5cca229f4fc94cc3ef992328802d7',
  'comic-text-detector.onnx': '1a86ace74961413cbd650002e7bb4dcec4980ffa21b2f19b86933372071d718f',
  'lama_fp32.onnx': '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6',
}

export async function verifyModels(root, modelsDir) {
  for (const name of await fs.readdir(path.join(root, 'models'))) {
    let pointer = ''
    try {
      pointer = execFileSync('git', ['show', `9c7e2706d894a53df1a8bb0ccd6270a8196aaad5:models/${name}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch {
      /* Modelo posterior ao baseline. */
    }
    const hash = pinnedModels[name] || pointer.match(/oid sha256:([a-f0-9]{64})/)?.[1]
    if (!hash) continue
    const data = await fs.readFile(path.join(modelsDir, name))
    if (crypto.createHash('sha256').update(data).digest('hex') !== hash)
      throw new Error(`Modelo inválido: ${name}. Execute npm run desktop:resources.`)
  }
}
