import { expect, it } from 'vitest'
import { openvinoFile } from '../scripts/openvino-files.mjs'

it('o pacote leva só o OpenVINO de CPU com leitor de ONNX (Linux e Windows)', () => {
  const kept = [
    'bin/ov_node_addon.node',
    'bin/libopenvino.so.2641',
    'bin/libopenvino_intel_cpu_plugin.so',
    'bin/libopenvino_onnx_frontend.so.2026.4.1',
    'bin/libtbb.so.12',
    'bin/libhwloc.so.15',
    'bin/openvino.dll',
    'bin/openvino_intel_cpu_plugin.dll',
    'bin/openvino_onnx_frontend.dll',
    'bin/tbb12.dll',
    'bin/licenses/onednn_third-party-programs.txt',
    'dist/addon.js',
    'package.json',
  ]
  const dropped = [
    'bin/libopenvino_intel_gpu_plugin.so',
    'bin/openvino_intel_npu_compiler.dll',
    'bin/libopenvino_pytorch_frontend.so',
    'bin/tbb12_debug.dll',
    'bin/tbbmalloc_proxy.dll',
    'bin/openvino_c.dll',
    'bin/cache.json',
    'bin/runtime/npu_compiler_version.txt',
    'scripts/download-runtime.js',
  ]
  expect(kept.filter((file) => !openvinoFile(file))).toEqual([])
  expect(dropped.filter((file) => openvinoFile(file))).toEqual([])
})
